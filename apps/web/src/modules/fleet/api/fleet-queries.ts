// TanStack Query hooks for the Fleet app (ADR-013). Keys follow the platform factory —
// ['fleet', feature, kind, params] — so each FW slice invalidates surgically: an odometer
// mutation moves alarms and the vehicle's derived facts, so both invalidate together; a roster
// save replaces the whole day. The alarms board has a key of its own outside the odometer
// subtree, so every write that moves the projection names it too (`fleetKeys.alarms`). Read
// hooks land here in FW-1 as the module's data foundation; each later slice adds its mutation
// hooks beside them.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ChangeFleetVehicleStatus,
  type CheckInFleetMaintenance,
  type CheckOutFleetMaintenance,
  type CorrectFleetOdometer,
  type CreateFleetAccident,
  type ApproveFleetFuelCharge,
  type CreateFleetFuelCard,
  type CreateFleetNotice,
  type CreateFleetLicenseExpense,
  type CreateFleetCustodyCharge,
  type CreateFleetCustodyMemo,
  type CreateFleetCustodyReplenishment,
  type CreateFleetCustodySettlement,
  type FleetCustodyMemoCandidatesQuery,
  type FleetCustodyPaperSettingsDto,
  type SaveFleetCustodyPaperSettings,
  type UpdateFleetCustodyMemo,
  type SaveFleetLicenseExpenseSettings,
  type UpdateFleetLicenseExpense,
  type RequestFleetFuelCharge,
  type TransferFleetFuelBalance,
  type TransferFleetFuelBatch,
  type UpdateFleetFuelCardMovement,
  type UpdateFleetDealershipInvoice,
  type CreateFleetReceipt,
  type UpdateFleetReceipt,
  type UpdateFleetFuelCard,
  type UpdateFleetNotice,
  type FleetNoticeImageKind,
  type FleetNoticeTemplate,
  type SaveFleetNoticeSettings,
  type SetFleetNoticeDone,
  type CreateFleetCatalogItem,
  type CreateFleetDriverProfile,
  type FleetDriverProfileDto,
  type CreateFleetVehicleType,
  type FleetCatalogItemDto,
  type FleetVehicleTypeDto,
  type CreateFleetUnavailability,
  type CreateFleetVehicle,
  type FleetRosterDayDto,
  type PlanFleetRoster,
  type FleetFixedRosterDto,
  type SaveFleetFixedRoster,
  type RecordFleetDriverViolation,
  type RecordFleetOdometer,
  type FleetViolationSide,
  type RecordFleetDriverViolations,
  type RecordFleetVehicleViolation,
  type SetFleetAccidentStatus,
  type SetFleetGrievance,
  type UpdateFleetAccident,
  type UpdateFleetCatalogItem,
  type OrderFleetCatalog,
  type OrderFleetVehicleTypes,
  type UpdateFleetDriverProfile,
  type UpdateFleetVehicleType,
  type SetFleetViolationCollected,
  type MoveFleetViolations,
  type SetRollupCollected,
  type UpdateFleetViolation,
  type UpdateFleetMaintenance,
  type UpdateFleetUnavailability,
  type UpdateFleetVehicle,
  type SetFleetLicensingMark,
} from '@ecms/contracts';
import { nextViolationsPage } from '../lib/violations-paging';
import { fetchWholeCatalog } from '../lib/whole-catalog';
import { fetchWholeVehicleRegistry } from '../lib/whole-vehicle-registry';
import { writeRefusalOf } from '../lib/write-refusal';
import { detailKey, featureKey, listKey } from '../../../shared/lib/query-keys';
import { errorMessage } from '../../../shared/lib/errors';
import { toast } from '../../../shared/ui/toast/toast-store';
import { store } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { useSetSetting } from '../../../platform/settings/settings-api';
import * as api from './fleet-api';
import { type FleetListParams } from './fleet-api';

const MODULE = 'fleet';

/**
 * Which failures of a write its screen says itself — `true` for one it words and acts on (reads the
 * record again, refetches its list), `false` for one it leaves to the usual toast.
 */
type SaidByScreen = (error: unknown) => boolean;
/** A screen that reports every failure of the write itself — refusals in so many words, the rest
 * with the usual sentence — so nothing is left for the global toast. */
const SAYS_EVERY_FAILURE: SaidByScreen = () => true;

/**
 * Declaring `onError` is what opts a mutation out of the GLOBAL error toast (query-client.ts). A
 * write whose screen names its refusals — «تمت تسوية هذه المذكرة…», «بعض الإيصالات دخلت مذكرة
 * أخرى…» — would otherwise show two: the screen's own, and the global one with the server's English
 * sentence (a 409 DUPLICATE, a 422) under it. So the hook raises that same global toast only for
 * what its screen does not say (`said`), worded exactly as the global one.
 */
const toastUnlessSaid =
  (said: SaidByScreen) =>
  (error: unknown): void => {
    if (!said(error)) toast.error(errorMessage(error, store.getState().locale.locale));
  };

// Feature-subtree invalidation targets — internal: every consumer outside this file goes
// through the hooks, never the keys.
const fleetKeys = {
  vehicles: featureKey(MODULE, 'vehicles'),
  vehicleTypes: featureKey(MODULE, 'vehicleTypes'),
  catalogs: featureKey(MODULE, 'catalogs'),
  drivers: featureKey(MODULE, 'drivers'),
  availability: featureKey(MODULE, 'availability'),
  odometer: featureKey(MODULE, 'odometer'),
  maintenance: featureKey(MODULE, 'maintenance'),
  roster: featureKey(MODULE, 'roster'),
  accidents: featureKey(MODULE, 'accidents'),
  notices: featureKey(MODULE, 'notices'),
  licenseExpenses: featureKey(MODULE, 'licenseExpenses'),
  dealership: featureKey(MODULE, 'dealership'),
  fuelCards: featureKey(MODULE, 'fuelCards'),
  receipts: featureKey(MODULE, 'receipts'),
  custody: featureKey(MODULE, 'custody'),
  violations: featureKey(MODULE, 'violations'),
  licensing: featureKey(MODULE, 'licensing'),
  people: featureKey(MODULE, 'people'),
  // The alarm projection — ONE key whichever permission door fills it, written out here once and
  // used by the query and by every write that moves it. Not under `odometer` or `maintenance`,
  // so invalidating either of those subtrees never reached it: a reading recorded or a visit
  // closed left the alarms board as it was until its 30 s ran out.
  alarms: [MODULE, 'alarms'] as const,
} as const;

// ── Registry + rules ────────────────────────────────────────────────────────
// `enabled` mirrors the caller's §7 permission (dashboard cards fetch only what the user may
// see); it defaults to true so list pages stay unchanged.
export const useVehicles = (params: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'vehicles', params),
    queryFn: () => api.listVehicles(params),
    placeholderData: (prev) => prev,
    enabled,
  });

/**
 * THE WHOLE REGISTRY, every page — see `lib/whole-vehicle-registry`. One cache entry under the
 * `vehicles` subtree, so a vehicle write refreshes it with the rest. `anyStatus` offers every
 * lifecycle status (historical facts); without it, the active cars only.
 */
export const useAllVehicles = (
  { anyStatus = false }: { anyStatus?: boolean } = {},
  enabled = true,
) =>
  useQuery({
    queryKey: listKey(MODULE, 'vehicles', { whole: true, anyStatus }),
    queryFn: () => fetchWholeVehicleRegistry(api.listVehicles, anyStatus),
    staleTime: 60_000,
    enabled,
  });

export const useVehicle = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, 'vehicles', id),
    queryFn: () => api.getVehicle(id),
    enabled: id !== '',
  });

// Vehicle mutations (FW-3). Every write invalidates the vehicles subtree; a status change also
// moves the dashboard's counts, which live under the same feature key. The detail cache is
// seeded so FW-4's profile opens on fresh data.
const useVehicleMutation = <TInput, TResult extends { id: string } | void>(
  mutationFn: (input: TInput) => Promise<TResult>,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (doc) => {
      if (doc !== undefined) qc.setQueryData(detailKey(MODULE, 'vehicles', doc.id), doc);
      void qc.invalidateQueries({ queryKey: fleetKeys.vehicles });
      // A car's status, type and code are inputs to the alarm projection (active cars only, the
      // interval per type, the code it is shown under).
      void qc.invalidateQueries({ queryKey: fleetKeys.alarms });
    },
  });
};

export const useCreateVehicle = () =>
  useVehicleMutation((body: CreateFleetVehicle) => api.createVehicle(body));
export const useUpdateVehicle = () =>
  useVehicleMutation(({ id, body }: { id: string; body: UpdateFleetVehicle }) =>
    api.updateVehicle(id, body),
  );
export const useChangeVehicleStatus = () =>
  useVehicleMutation(({ id, body }: { id: string; body: ChangeFleetVehicleStatus }) =>
    api.changeVehicleStatus(id, body),
  );
export const useDeleteVehicle = () => useVehicleMutation((id: string) => api.deleteVehicle(id));

/**
 * The branch the create form preselects. A SERVER fact (resolved by name from live branch data),
 * cached for the session because branches change far less often than the form is opened.
 */
export const useDefaultVehicleBranch = (enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'vehicles', { defaultBranch: true }),
    queryFn: () => api.getDefaultVehicleBranch(),
    staleTime: 300_000,
    enabled,
  });

// License-image writes go through the same vehicle mutation seam as every other vehicle write:
// both endpoints answer with the updated vehicle, so the list repaints from the invalidated
// subtree and the profile from the seeded detail cache — no full refresh anywhere.
export const useUploadVehicleLicenseImage = () =>
  useVehicleMutation(({ id, file }: { id: string; file: File }) =>
    api.uploadVehicleLicenseImage(id, file),
  );
export const useDeleteVehicleLicenseImage = () =>
  useVehicleMutation((id: string) => api.deleteVehicleLicenseImage(id));

export const useVehicleTypes = (params: FleetListParams = { pageSize: 100 }, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'vehicleTypes', params),
    queryFn: () => api.listVehicleTypes(params),
    staleTime: 60_000,
    enabled,
  });

/**
 * One kind's live catalog, WHOLE, cached.
 *
 * `violationSide` narrows a violation type to the half of the violations screen that files it —
 * it is part of the key, so the company form's list and the drivers' bar's list are two cache
 * entries and cannot be served one for the other.
 *
 * Every page, not the first. This asked for `pageSize: 100`, which is the server's own cap and not
 * a number a caller can raise, so a catalog past a hundred entries was cut here — and cut for
 * everything downstream at once, because this ONE cache entry is what the dropdowns offer AND what
 * the list pages build their id → name maps from. An entry off the end was missing from the
 * pickers and rendered as a blank cell in the tables, neither of which looks like a fault. See
 * `lib/whole-catalog` for why the pages are gathered here rather than behind a «تحميل المزيد»
 * nobody would press on a dropdown.
 */
export const useFleetCatalog = (kind: string, violationSide?: FleetViolationSide) =>
  useQuery({
    queryKey: listKey(MODULE, 'catalogs', { kind, violationSide }),
    queryFn: async () =>
      fetchWholeCatalog((page, pageSize) =>
        api.listCatalogItems({
          kind,
          page,
          pageSize,
          ...(violationSide === undefined ? {} : { violationSide }),
        }),
      ),
    staleTime: 60_000,
  });

/** Admin list for the catalogs screen — same feature subtree as the selects' cached lists. */
export const useCatalogItems = (params: FleetListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'catalogs', params),
    queryFn: () => api.listCatalogItems(params),
    placeholderData: (prev) => prev,
  });

// Catalog + rules mutations (FW-10). The maintenance interval lives on the TYPE and a work
// type's countsForAlarm resets the alarm baseline — both are inputs to the server's derived
// alarm projection, so their writes invalidate the odometer subtree and the alarms board
// alongside their own lists.
const useVehicleTypeMutation = <TInput>(
  mutationFn: (input: TInput) => Promise<FleetVehicleTypeDto>,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: fleetKeys.vehicleTypes });
      void qc.invalidateQueries({ queryKey: fleetKeys.odometer });
      void qc.invalidateQueries({ queryKey: fleetKeys.alarms });
    },
  });
};

export const useCreateVehicleType = () =>
  useVehicleTypeMutation((body: CreateFleetVehicleType) => api.createVehicleType(body));
export const useUpdateVehicleType = () =>
  useVehicleTypeMutation(({ id, body }: { id: string; body: UpdateFleetVehicleType }) =>
    api.updateVehicleType(id, body),
  );

const useCatalogItemMutation = <TInput>(
  mutationFn: (input: TInput) => Promise<FleetCatalogItemDto>,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: fleetKeys.catalogs });
      void qc.invalidateQueries({ queryKey: fleetKeys.odometer });
      void qc.invalidateQueries({ queryKey: fleetKeys.alarms });
    },
  });
};

export const useCreateCatalogItem = () =>
  useCatalogItemMutation((body: CreateFleetCatalogItem) => api.createCatalogItem(body));
/**
 * Save a list's order. Every catalog cache refreshes — the dropdowns across Fleet read the same
 * lists, so they follow the new order too.
 */
export const useOrderCatalog = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OrderFleetCatalog) => api.orderCatalog(body),
    onSettled: () => void qc.invalidateQueries({ queryKey: fleetKeys.catalogs }),
  });
};

export const useOrderVehicleTypes = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OrderFleetVehicleTypes) => api.orderVehicleTypes(body),
    onSettled: () => void qc.invalidateQueries({ queryKey: fleetKeys.vehicleTypes }),
  });
};

export const useUpdateCatalogItem = () =>
  useCatalogItemMutation(({ id, body }: { id: string; body: UpdateFleetCatalogItem }) =>
    api.updateCatalogItem(id, body),
  );

/**
 * Fleet settings write: the platform owns the endpoint; what FLEET knows is which of its
 * server-derived caches a changed value moves — alarm thresholds re-colour the odometer
 * projection, the HR-leave switch changes the roster's availability verdicts.
 */
export const useSetFleetSetting = () => {
  const qc = useQueryClient();
  return useSetSetting(() => {
    void qc.invalidateQueries({ queryKey: fleetKeys.odometer });
    // The yellow and red thresholds re-colour the alarms board itself.
    void qc.invalidateQueries({ queryKey: fleetKeys.alarms });
    void qc.invalidateQueries({ queryKey: fleetKeys.roster });
  });
};

// ── Drivers + availability ──────────────────────────────────────────────────
// Driver-profile writes invalidate the drivers subtree; availability writes invalidate the
// availability subtree — the roster/board consumers re-derive from the server when they land.
export const useCreateDriverProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFleetDriverProfile) => api.createDriverProfile(body),
    onSuccess: (doc) => {
      qc.setQueryData(detailKey(MODULE, 'drivers', doc.id), doc);
      void qc.invalidateQueries({ queryKey: fleetKeys.drivers });
    },
  });
};

export const useUpdateDriverProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateFleetDriverProfile }) =>
      api.updateDriverProfile(id, body),
    onSuccess: (doc) => {
      qc.setQueryData(detailKey(MODULE, 'drivers', doc.id), doc);
      void qc.invalidateQueries({ queryKey: fleetKeys.drivers });
    },
  });
};

/**
 * Licence-image writes answer with the updated profile, so the list repaints from the invalidated
 * subtree and the profile page from the seeded detail cache — no full refresh anywhere.
 */
const useDriverImageMutation = <TVars>(fn: (vars: TVars) => Promise<FleetDriverProfileDto>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (doc) => {
      qc.setQueryData(detailKey(MODULE, 'drivers', doc.id), doc);
      void qc.invalidateQueries({ queryKey: fleetKeys.drivers });
    },
  });
};

export const useUploadDriverLicenseImage = () =>
  useDriverImageMutation(({ id, file }: { id: string; file: File }) =>
    api.uploadDriverLicenseImage(id, file),
  );
export const useDeleteDriverLicenseImage = () =>
  useDriverImageMutation((id: string) => api.deleteDriverLicenseImage(id));

export const useRecordUnavailability = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFleetUnavailability) => api.recordUnavailability(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: fleetKeys.availability }),
  });
};

export const useUpdateUnavailability = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateFleetUnavailability }) =>
      api.updateUnavailability(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: fleetKeys.availability }),
  });
};

export const useCancelUnavailability = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelUnavailability(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: fleetKeys.availability }),
  });
};
export const useDrivers = (params: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'drivers', params),
    queryFn: () => api.listDrivers(params),
    placeholderData: (prev) => prev,
    enabled,
  });

export const useDriver = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, 'drivers', id),
    queryFn: () => api.getDriver(id),
    enabled: id !== '',
  });

export const useUnavailability = (params: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'availability', params),
    queryFn: () => api.listUnavailability(params),
    placeholderData: (prev) => prev,
    enabled,
  });

// ── Odometer + maintenance ──────────────────────────────────────────────────
export const useOdometerLogs = (params: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'odometer', params),
    queryFn: () => api.listOdometerLogs(params),
    placeholderData: (prev) => prev,
    enabled,
  });

export const useExpectedReading = (vehicleId: string, enabled = true) =>
  useQuery({
    queryKey: [MODULE, 'odometer', 'expected', vehicleId],
    queryFn: () => api.expectedOdometerReading(vehicleId),
    enabled: enabled && vehicleId !== '',
  });

/**
 * The odometer bracket for a vehicle on a date — ONE cache entry, whichever door is open.
 *
 * The same discipline `useMaintenanceAlarms` follows below: the key names the ANSWER (vehicle +
 * date), never the route, so one reader holding both permissions still fills one entry, and a
 * reader holding either gets the same cached bracket.
 *
 * The date is part of the key because it is part of the question. A visit closed last month has
 * a different bracket from one closed today, and that is exactly what makes a back-dated counter
 * legitimate rather than suspicious — so a changed date must fetch, not reuse.
 */
export const useOdometerBracket = (vehicleId: string, on: string, enabled = true) => {
  const can = useCan();
  const viaMaintenance = can('fleetMaintenance.view');
  const viaOdometer = can('fleetOdometer.view');
  return useQuery({
    queryKey: [MODULE, 'odometer', 'bracket', vehicleId, on],
    queryFn: () =>
      viaMaintenance
        ? api.odometerBracketForMaintenance(vehicleId, on)
        : api.odometerBracket(vehicleId, on),
    staleTime: 30_000,
    enabled: enabled && vehicleId !== '' && on !== '' && (viaMaintenance || viaOdometer),
  });
};

/**
 * The alarm projection — ONE cache entry, whichever door the reader is allowed through.
 *
 * The server exposes the same projection twice, because two permissions legitimately want it:
 * `fleetMaintenance.view` (the workshop screens) and `fleetOdometer.view` (the odometer log).
 * Choosing between them here, rather than in each of the five callers, is what makes the choice
 * a property of the hook instead of a rule five screens have to remember — and one of them
 * already got it wrong, gating the alarms on the ODOMETER permission from the maintenance page.
 *
 * The key is deliberately source-INDEPENDENT. With one key there is exactly one cache entry and
 * therefore exactly one request, so a reader holding both permissions cannot end up with two
 * copies of the projection that could answer differently for the same car. That is a structural
 * guarantee, not a discipline: there is no second key to fill.
 *
 * Maintenance wins when both are held — it is the narrower audience for a maintenance fact — and
 * a reader with neither permission runs no query at all rather than collecting a 403.
 *
 * `useCanReadAlarms` is the same condition, exported for the screens that show or hide a panel
 * on it. One definition, used by both, so a panel can never be hidden from somebody the query
 * would happily have answered for — which is exactly the bug this replaces.
 */
export const useCanReadAlarms = (): boolean => {
  const can = useCan();
  return can('fleetMaintenance.view') || can('fleetOdometer.view');
};

export const useMaintenanceAlarms = (enabled = true) => {
  const can = useCan();
  const viaMaintenance = can('fleetMaintenance.view');
  const viaOdometer = can('fleetOdometer.view');
  return useQuery({
    queryKey: fleetKeys.alarms,
    queryFn: viaMaintenance ? api.listMaintenanceAlarmsForMaintenance : api.listMaintenanceAlarms,
    // Derived on the server per request (FR-3); a short stale window keeps the board honest
    // without hammering the projection.
    staleTime: 30_000,
    enabled: enabled && (viaMaintenance || viaOdometer),
  });
};

export const useMaintenanceVisits = (params: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'maintenance', params),
    queryFn: () => api.listMaintenanceVisits(params),
    placeholderData: (prev) => prev,
    enabled,
  });

// ── Odometer + maintenance mutations (FW-6) ─────────────────────────────────
// Odometer writes move every derived odometer surface (logs, expected reading, bracket) — one
// feature-key invalidation covers them — AND the alarms board, which lives under a key of its
// own: the latest reading is what «فارق» is measured to. Maintenance writes additionally move the
// vehicles' derived inWorkshop flag and the alarm baseline.
/** The two caches every reading write moves: the odometer subtree and the alarms board. */
const invalidateReadings = (qc: ReturnType<typeof useQueryClient>): void => {
  void qc.invalidateQueries({ queryKey: fleetKeys.odometer });
  void qc.invalidateQueries({ queryKey: fleetKeys.alarms });
};

export const useRecordOdometer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordFleetOdometer) => api.recordOdometer(body),
    onSuccess: () => invalidateReadings(qc),
  });
};

export const useCorrectOdometer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CorrectFleetOdometer }) =>
      api.correctOdometer(id, body),
    onSuccess: () => invalidateReadings(qc),
  });
};

export const useDeleteOdometer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteOdometer(id),
    onSuccess: () => invalidateReadings(qc),
  });
};

const useMaintenanceMutation = <TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: fleetKeys.maintenance });
      void qc.invalidateQueries({ queryKey: fleetKeys.odometer });
      void qc.invalidateQueries({ queryKey: fleetKeys.vehicles });
      // A visit closed, reopened, edited or deleted moves the baseline the board measures from.
      void qc.invalidateQueries({ queryKey: fleetKeys.alarms });
    },
  });
};

export const useCheckInMaintenance = () =>
  useMaintenanceMutation((body: CheckInFleetMaintenance) => api.checkInMaintenance(body));
export const useCheckOutMaintenance = () =>
  useMaintenanceMutation(({ id, body }: { id: string; body: CheckOutFleetMaintenance }) =>
    api.checkOutMaintenance(id, body),
  );
export const useReopenMaintenance = () =>
  useMaintenanceMutation(({ id, version }: { id: string; version: number }) =>
    api.reopenMaintenance(id, version),
  );
export const useUpdateMaintenance = () =>
  useMaintenanceMutation(({ id, body }: { id: string; body: UpdateFleetMaintenance }) =>
    api.updateMaintenance(id, body),
  );
export const useDeleteMaintenance = () =>
  useMaintenanceMutation((id: string) => api.deleteMaintenance(id));

// ── Roster / accidents / violations ─────────────────────────────────────────
const rosterDayKey = (date: string) => [MODULE, 'roster', 'day', date] as const;

/**
 * One DAY's board. Deliberately WITHOUT `placeholderData` — the exception on this module.
 *
 * Everywhere else that option is right: those queries are keyed by a filter or a page, so the
 * previous answer is the same question's slightly-stale answer and showing it beats a flash of
 * nothing. Here the key IS the entity's identity. Serving the previous key's data means showing
 * ANOTHER DAY's roster — not stale data, wrong data — and this board is editable, so the harm
 * ran past display: with the previous day's rows in hand the page armed «حفظ», and a save inside
 * that window posted THAT day's crew under the NEW date, silently overwriting the day the
 * dispatcher had actually planned.
 *
 * A skeleton while the day loads is the correct answer to "what is on the board for this date"
 * when the answer is not known yet.
 */
export const useRosterDay = (date: string) =>
  useQuery({
    queryKey: rosterDayKey(date),
    queryFn: () => api.getRosterDay(date),
    enabled: date !== '',
  });

/**
 * TODAY's board, for the driver card — «العربيه اللى متعين عليها». The roster board's own key, so
 * the card shares its cache, its save and its realtime refresh; a longer `staleTime` on THIS
 * observer only, so hovering name after name does not re-run the day's availability pass every
 * 30 s. «Today» is the board's own UTC day (`RosterPage`), so the two never disagree.
 */
export const useRosterToday = (enabled: boolean) => {
  const today = new Date().toISOString().slice(0, 10);
  return useQuery({
    queryKey: rosterDayKey(today),
    queryFn: () => api.getRosterDay(today),
    enabled,
    staleTime: 5 * 60_000,
  });
};

// A plan save answers with the refreshed board in the same round-trip (FL-5 point 7), so the
// day's cache is replaced directly — no refetch between save and repaint. A failed save still
// invalidates: the usual cause of a 409 is a board gone stale under the user.
export const usePlanRoster = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { dateKey: string; body: PlanFleetRoster }) => api.planRoster(input.body),
    onSuccess: (board, { dateKey }) => {
      qc.setQueryData(rosterDayKey(dateKey), {
        date: board.date,
        rows: board.rows,
        availableDrivers: board.availableDrivers,
        unavailableDrivers: board.unavailableDrivers,
      } satisfies FleetRosterDayDto);
    },
    onError: () => void qc.invalidateQueries({ queryKey: fleetKeys.roster }),
  });
};

// ── Fixed crew (الطقم الثابت) ───────────────────────────────────────────────
//
// Its own key, never the roster's: the two boards answer different questions and a save on one
// must not repaint the other. No date in the key, because the answer does not have one.
const fixedRosterKey = [MODULE, 'fixed-roster'] as const;

/**
 * The dashboard's one read. `staleTime` matches the alarm projection's: these are aggregates over
 * live collections, worth a moment's cache and not worth a request per card.
 */
export const useFleetDashboard = (enabled = true) =>
  useQuery({
    queryKey: [MODULE, 'dashboard'],
    queryFn: api.getFleetDashboard,
    staleTime: 30_000,
    enabled,
  });

export const useFixedRoster = () =>
  useQuery({ queryKey: fixedRosterKey, queryFn: api.getFixedRoster });

// The save answers with the refreshed board in the same round-trip, so the cache is replaced
// directly — no refetch between save and repaint. A FAILED save deliberately re-reads nothing;
// see `onError` below for why a refusal is the worst moment to replace the board.
export const useSaveFixedRoster = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveFleetFixedRoster) => api.saveFixedRoster(body),
    onSuccess: (board) => {
      qc.setQueryData(fixedRosterKey, {
        rows: board.rows,
        drivers: board.drivers,
      } satisfies FleetFixedRosterDto);
    },
    // Deliberately NOT an invalidate. A refusal is the moment the reader most needs their work:
    // re-reading the board would hand the page a new `saved` array, the draft would reset to it,
    // and the drags that caused the refusal would vanish along with the chance to fix them. The
    // handler stays defined even though it does nothing — that is what opts this mutation out of
    // the GLOBAL error toast (query-client.ts), leaving the page's own catch as the one message.
    onError: () => {
      /* keep the draft — the refusal is about the payload, not about the board being stale */
    },
  });
};

export const useAccidents = (params: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'accidents', params),
    queryFn: () => api.listAccidents(params),
    placeholderData: (prev) => prev,
    enabled,
  });

/**
 * The totals under the accident list — a SECOND request, on purpose.
 *
 * It has to be: the page endpoint answers about one page, and these figures are about everything
 * the filters match. Keyed on the filters alone, so paging or resizing does not refetch it and
 * cannot change it; it is invalidated with the rest of the accident subtree when a file is
 * recorded, edited, closed or deleted, because those DO change what the filters match.
 */
export const useAccidentSummary = (params: FleetListParams, enabled = true) =>
  useQuery({
    // Under the SAME feature key as the list, so the one accident invalidation already wired for
    // record/edit/close/delete refreshes the figures too; `summary` only keeps the two apart.
    queryKey: listKey(MODULE, 'accidents', { summary: true, ...params }),
    queryFn: () => api.accidentSummary(params),
    placeholderData: (prev) => prev,
    enabled,
  });

// Accident mutations (FW-8). One subtree covers the list AND the dashboard's open-files KPI;
// nothing else derives from accidents (amounts stay stored facts until §13-Q9).
const useAccidentMutation = <TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: fleetKeys.accidents }),
  });
};

export const useCreateAccident = () =>
  useAccidentMutation((body: CreateFleetAccident) => api.createAccident(body));
export const useUpdateAccident = () =>
  useAccidentMutation(({ id, body }: { id: string; body: UpdateFleetAccident }) =>
    api.updateAccident(id, body),
  );
export const useSetAccidentStatus = () =>
  useAccidentMutation(({ id, body }: { id: string; body: SetFleetAccidentStatus }) =>
    api.setAccidentStatus(id, body),
  );
export const useDeleteAccident = () => useAccidentMutation((id: string) => api.deleteAccident(id));

/**
 * One car's transfer log and its remaining — under the accidents subtree, so every accident write
 * (a transfer rides on one) and every realtime `fleet.accident` signal refreshes it.
 */
export const useAccidentCarTransfers = (vehicleId: string, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'accidents', { transfers: vehicleId }),
    queryFn: () => api.accidentCarTransfers(vehicleId),
    enabled: enabled && vehicleId !== '',
  });

/** The cars with something left to give — under the accidents subtree, so every write refreshes it. */
export const useAccidentCarBalances = (enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'accidents', { carBalances: true }),
    queryFn: () => api.accidentCarBalances(),
    enabled,
  });

export const useVoidAccidentTransfer = () =>
  useAccidentMutation(({ accidentId, transferId }: { accidentId: string; transferId: string }) =>
    api.voidAccidentTransfer(accidentId, transferId),
  );

export const useViolations = (params: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'violations', params),
    queryFn: () => api.listViolations(params),
    placeholderData: (prev) => prev,
    enabled,
  });

/**
 * The same list, LOADED A PAGE AT A TIME AND KEPT.
 *
 * The drivers' board carries no pager — the owner asked for «السابق / التالي» gone — and a single
 * `useViolations` then showed one page and no way to the rest: the count beside the filters said
 * «٤٤٠» over a hundred visible rows. This is the idiom the users screen's activity timeline
 * already uses for the same problem (`useUserTimeline`): one query key, pages accumulated in
 * `data.pages`, and a «تحميل المزيد» under the board.
 *
 * `params` must NOT carry `page` — the page number is this hook's to supply, and a caller that
 * pinned one would fetch it again for every «more».
 */
export const useViolationsPages = (params: Omit<FleetListParams, 'page'>) =>
  useInfiniteQuery({
    queryKey: listKey(MODULE, 'violations', { ...params, paged: 'infinite' }),
    queryFn: ({ pageParam }) => api.listViolations({ ...params, page: pageParam }),
    initialPageParam: 1,
    // The stop is the SERVER's `totalPages`, not «did this page come back full?» — see
    // `lib/violations-paging` for why the difference matters on an exact multiple of the page size.
    getNextPageParam: (last, pages) => nextViolationsPage(last.meta, pages.length),
  });

/** `year` omitted = every year, one row per (vehicle, year). */
export const useViolationRollup = (
  years?: readonly number[],
  /** The cars the picker holds — SEVERAL, and by code. See the endpoint for why it is not an id. */
  vehicleCodes?: readonly string[],
  enabled = true,
) =>
  useQuery({
    // The years and the codes are part of the KEY as strings: a fresh array each render would mint
    // a new key every time and the board would refetch on every keystroke elsewhere on the screen.
    queryKey: [
      MODULE,
      'violations',
      'rollup',
      { year: (years ?? []).join(','), vehicleCodes: (vehicleCodes ?? []).join(',') },
    ],
    queryFn: () => api.violationRollup(years, vehicleCodes),
    placeholderData: (prev) => prev,
    enabled,
  });

// Violation mutations (FW-9). One subtree covers the list AND the derived annual rollup —
// a grievance set moves only the rollup, a row write moves both, so they invalidate together.
const useViolationMutation = <TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: fleetKeys.violations }),
  });
};

export const useRecordVehicleViolation = () =>
  useViolationMutation((body: RecordFleetVehicleViolation) => api.recordVehicleViolation(body));
export const useRecordDriverViolation = () =>
  useViolationMutation((body: RecordFleetDriverViolation) => api.recordDriverViolation(body));
export const useRecordDriverViolations = () =>
  useViolationMutation((body: RecordFleetDriverViolations) => api.recordDriverViolations(body));
export const useSetViolationCollected = () =>
  useViolationMutation(({ id, body }: { id: string; body: SetFleetViolationCollected }) =>
    api.setViolationCollected(id, body),
  );
export const useMoveViolations = () =>
  useViolationMutation((body: MoveFleetViolations) => api.moveViolations(body));
export const useSetRollupCollected = () =>
  useViolationMutation((body: SetRollupCollected) => api.setRollupCollected(body));
export const useUpdateViolation = () =>
  useViolationMutation(({ id, body }: { id: string; body: UpdateFleetViolation }) =>
    api.updateViolation(id, body),
  );
export const useSetGrievance = () =>
  useViolationMutation((body: SetFleetGrievance) => api.setGrievance(body));
export const useDeleteViolation = () =>
  useViolationMutation((id: string) => api.deleteViolation(id));

/**
 * The go-live run rows, for the notice on the vehicles and drivers screens. Asked only by a
 * reader who could act on the answer — the endpoint refuses everyone else, and a 403 on every
 * visit to the registry is noise a screen must not generate for itself.
 */
export const useFleetGoLiveRuns = (enabled: boolean) =>
  useQuery({
    queryKey: [MODULE, 'go-live'],
    queryFn: api.getFleetGoLiveRuns,
    staleTime: 30_000,
    enabled,
  });

// ── Licensing board (التراخيص) ────────────────────────────────────────────────

/**
 * The board. `staleTime: 0` on purpose — which cars are on it is DERIVED from the registry, so an
 * admin renaming «برقاش ت» to «برقاش م» must take the car off this screen on the next look rather
 * than at the end of a cache window.
 */
export const useLicensingBoard = (enabled = true) =>
  useQuery({
    queryKey: fleetKeys.licensing,
    queryFn: api.licensingBoard,
    placeholderData: (prev) => prev,
    enabled,
  });

/**
 * One square. The server answers with the whole refreshed board and it is written straight into
 * the cache: the endpoint has just recomputed membership, so a car that left the board while the
 * clerk was working disappears with the same round trip rather than on a later refetch.
 */
export const useSetLicensingMark = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetFleetLicensingMark) => api.setLicensingMark(body),
    onSuccess: (rows) => qc.setQueryData(fleetKeys.licensing, rows),
  });
};

/**
 * The people Fleet may name, as ONE list every screen shares.
 *
 * One request for a board of a hundred rows rather than one per cell: the roster is the company's
 * drivers, and a screen that asked per id spent a hundred round trips to print a hundred names.
 * Long `staleTime` because a name is not a figure — it changes when somebody is hired, not while
 * a dispatcher reads a page.
 */
export const useFleetPeople = (enabled = true, includeExited = false) =>
  useQuery({
    // The wider list under its own key, BENEATH the usual one, so an invalidation of the people
    // refreshes both and neither screen is ever handed the other's list.
    queryKey: includeExited ? [...fleetKeys.people, 'withExited'] : fleetKeys.people,
    queryFn: () => api.listFleetPeople(includeExited),
    staleTime: 5 * 60_000,
    enabled,
  });

// ── Insurance notices (الإخطارات) ─────────────────────────────────────────────
export const useNotices = (params: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'notices', params),
    queryFn: () => api.listNotices(params),
    enabled,
  });

export const useNoticesSummary = (params: FleetListParams, enabled = true) =>
  useQuery({
    // Under the list's own key, so every notice change refreshes the figures too.
    queryKey: listKey(MODULE, 'notices', { summary: true, ...params }),
    queryFn: () => api.noticesSummary(params),
    placeholderData: (prev) => prev,
    enabled,
  });

export const useNotice = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, 'notices', id),
    queryFn: () => api.getNotice(id),
    enabled: id !== '',
  });

const useNoticeMutation = <TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: fleetKeys.notices }),
  });
};

export const useCreateNotice = () =>
  useNoticeMutation((body: CreateFleetNotice) => api.createNotice(body));
export const useUpdateNotice = () =>
  useNoticeMutation(({ id, body }: { id: string; body: UpdateFleetNotice }) =>
    api.updateNotice(id, body),
  );
export const useDeleteNotice = () => useNoticeMutation((id: string) => api.deleteNotice(id));
export const useSetNoticeDone = () =>
  useNoticeMutation(({ id, body }: { id: string; body: SetFleetNoticeDone }) =>
    api.setNoticeDone(id, body),
  );
export const useUploadNoticeImage = () =>
  useNoticeMutation(({ id, kind, file }: { id: string; kind: FleetNoticeImageKind; file: File }) =>
    api.uploadNoticeImage(id, kind, file),
  );
export const useDeleteNoticeImage = () =>
  useNoticeMutation(({ id, kind }: { id: string; kind: FleetNoticeImageKind }) =>
    api.deleteNoticeImage(id, kind),
  );

/** A form's set-up — what each box starts with, and which boxes share one answer. */
export const useNoticeSettings = (template: FleetNoticeTemplate) =>
  useQuery({
    queryKey: [...fleetKeys.notices, 'settings', template],
    queryFn: () => api.getNoticeSettings(template),
  });
export const useSaveNoticeSettings = () =>
  useNoticeMutation(
    ({ template, body }: { template: FleetNoticeTemplate; body: SaveFleetNoticeSettings }) =>
      api.saveNoticeSettings(template, body),
  );

// ── Dealership invoices (التوكيل) ────────────────────────────────────────────
export const useDealershipInvoices = (params: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'dealership', params),
    queryFn: () => api.listDealershipInvoices(params),
    placeholderData: (prev) => prev,
    enabled,
  });

/** The figures between the filters and the table — the whole filtered set, never the page. */
export const useDealershipSummary = (params: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'dealership', { summary: true, ...params }),
    queryFn: () => api.dealershipSummary(params),
    placeholderData: (prev) => prev,
    enabled,
  });

const useDealershipMutation = <TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: fleetKeys.dealership }),
  });
};

export const useUpdateDealershipInvoice = () =>
  useDealershipMutation(({ id, body }: { id: string; body: UpdateFleetDealershipInvoice }) =>
    api.updateDealershipInvoice(id, body),
  );
export const useDeleteDealershipInvoice = () =>
  useDealershipMutation((id: string) => api.deleteDealershipInvoice(id));
export const useUploadDealershipImage = () =>
  useDealershipMutation(({ id, file }: { id: string; file: File }) =>
    api.uploadDealershipImage(id, file),
  );
export const useDeleteDealershipImage = () =>
  useDealershipMutation((id: string) => api.deleteDealershipImage(id));

// ── Fuel cards (الفيز) ────────────────────────────────────────────────────────
/**
 * EVERY card the filters match — the two screens show cards grouped under their car, which is
 * not a paged question. Walked page by page like a catalog.
 */
export const useAllFuelCards = (params: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'fuelCards', { whole: true, ...params }),
    queryFn: () =>
      fetchWholeCatalog((page, pageSize) =>
        api.listFuelCards({ ...params, page, pageSize, sortBy: 'vehicleCode', sortDir: 'asc' }),
      ),
    placeholderData: (prev) => prev,
    enabled,
  });

export const useFuelCardSummary = (params: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'fuelCards', { summary: true, ...params }),
    queryFn: () => api.fuelCardSummary(params),
    placeholderData: (prev) => prev,
    enabled,
  });

/** The card's log, newest first. */
export const useFuelCardMovements = (cardId: string) =>
  useQuery({
    queryKey: listKey(MODULE, 'fuelCards', { movements: cardId }),
    queryFn: () => api.listFuelCardMovements({ cardId, pageSize: 100 }),
    enabled: cardId !== '',
  });

const useFuelCardMutation = <TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: fleetKeys.fuelCards }),
  });
};

export const useCreateFuelCard = () =>
  useFuelCardMutation((body: CreateFleetFuelCard) => api.createFuelCard(body));
export const useUpdateFuelCard = () =>
  useFuelCardMutation(({ id, body }: { id: string; body: UpdateFleetFuelCard }) =>
    api.updateFuelCard(id, body),
  );
export const useDeleteFuelCard = () => useFuelCardMutation((id: string) => api.deleteFuelCard(id));
export const useUploadFuelCardImage = () =>
  useFuelCardMutation(({ id, file }: { id: string; file: File }) =>
    api.uploadFuelCardImage(id, file),
  );
export const useDeleteFuelCardImage = () =>
  useFuelCardMutation((id: string) => api.deleteFuelCardImage(id));
export const useRequestFuelCharge = () =>
  useFuelCardMutation(({ id, body }: { id: string; body: RequestFleetFuelCharge }) =>
    api.requestFuelCharge(id, body),
  );
export const useApproveFuelCharge = () =>
  useFuelCardMutation(({ id, body }: { id: string; body: ApproveFleetFuelCharge }) =>
    api.approveFuelCharge(id, body),
  );
export const useTransferFuelBalance = () =>
  useFuelCardMutation((body: TransferFleetFuelBalance) => api.transferFuelBalance(body));
export const useTransferFuelBatch = () =>
  useFuelCardMutation((body: TransferFleetFuelBatch) => api.transferFuelBatch(body));
export const useUpdateFuelCardMovement = () =>
  useFuelCardMutation(({ id, body }: { id: string; body: UpdateFleetFuelCardMovement }) =>
    api.updateFuelCardMovement(id, body),
  );
export const useDeleteFuelCardMovement = () =>
  useFuelCardMutation((id: string) => api.deleteFuelCardMovement(id));

// ── Receipts (خصم الإيصالات) and the custody ledger (العهدة) ─────────────────
export const useReceipts = (params: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'receipts', params),
    queryFn: () => api.listReceipts(params),
    placeholderData: (prev) => prev,
    enabled,
  });
export const useReceiptSummary = (params: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'receipts', { summary: true, ...params }),
    queryFn: () => api.receiptSummary(params),
    placeholderData: (prev) => prev,
    enabled,
  });
// A receipt moves money on three screens: its own, the ledger it feeds, and the card it charged.
// `said`, when given, is what the sending screen reports itself (`toastUnlessSaid`); without it the
// write keeps the global toast — a new receipt and the photo's two writes name no refusal.
const useReceiptMutation = <TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  said?: SaidByScreen,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: fleetKeys.receipts });
      void qc.invalidateQueries({ queryKey: fleetKeys.custody });
      void qc.invalidateQueries({ queryKey: fleetKeys.fuelCards });
    },
    ...(said === undefined ? {} : { onError: toastUnlessSaid(said) }),
  });
};
export const useCreateReceipt = () =>
  useReceiptMutation((body: CreateFleetReceipt) => api.createReceipt(body));
/** The receipt form names a custody memo's lock (422) and a stale receipt (409) and reads it again. */
export const useUpdateReceipt = () =>
  useReceiptMutation(
    ({ id, body }: { id: string; body: UpdateFleetReceipt }) => api.updateReceipt(id, body),
    (error) => writeRefusalOf(error) !== null,
  );
/** The receipts board names a custody memo's lock (422) on a delete and reads its list again. */
export const useDeleteReceipt = () =>
  useReceiptMutation(
    (id: string) => api.deleteReceipt(id),
    (error) => writeRefusalOf(error) === 'locked',
  );
export const useUploadReceiptImage = () =>
  useReceiptMutation(({ id, file }: { id: string; file: File }) =>
    api.uploadReceiptImage(id, file),
  );
export const useDeleteReceiptImage = () =>
  useReceiptMutation((id: string) => api.deleteReceiptImage(id));
export const useCustodySummary = (params: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'custody', { summary: true, ...params }),
    queryFn: () => api.custodySummary(params),
    placeholderData: (prev) => prev,
    enabled,
  });
/**
 * «لوحة تحكم» — read only while it is open, under the ledger's key, so whatever refreshes the board
 * (a receipt saved, deleted, moved) refreshes it too. No placeholder from the last answer: reopened
 * over other filters, it would show the old filters' sums under the new filters' words.
 */
export const useCustodyDashboard = (params: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'custody', { dashboard: true, ...params }),
    queryFn: () => api.custodyDashboard(params),
    enabled,
  });
export const useCustodyMovements = (params: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'custody', params),
    queryFn: () => api.listCustodyMovements(params),
    placeholderData: (prev) => prev,
    enabled,
  });
/**
 * A car's «السجل» over the custody board: the same movements over the board's filters and that one
 * car, with the log's OWN page and size — turning its pages never moves the board's. Under the
 * ledger's key, so a receipt saved or deleted refreshes it too. The last page stays on screen while
 * the next one comes; the log is drawn keyed by its car, so another car starts it afresh rather
 * than show the last car's rows under the new car's name.
 */
export const useCustodyLog = (
  filters: FleetListParams,
  page: number,
  pageSize: number,
  enabled = true,
) =>
  useQuery({
    queryKey: listKey(MODULE, 'custody', { log: true, ...filters, page, pageSize }),
    queryFn: () => api.listCustodyMovements({ ...filters, page, pageSize }),
    placeholderData: (prev) => prev,
    enabled,
  });

// ── Licensing expenses (مصروفات التراخيص) ─────────────────────────────────────
export const useLicenseExpenses = (params: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'licenseExpenses', params),
    queryFn: () => api.listLicenseExpenses(params),
    placeholderData: (prev) => prev,
    enabled,
  });
/** «الإحصائيات» over the whole filtered set — under the list's key, so every write refreshes it. */
export const useLicenseExpenseSummary = (params: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'licenseExpenses', { summary: true, ...params }),
    queryFn: () => api.licenseExpenseSummary(params),
    placeholderData: (prev) => prev,
    enabled,
  });

export const useLicenseExpense = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, 'licenseExpenses', id),
    queryFn: () => api.getLicenseExpense(id),
    enabled: id !== '',
  });

const useLicenseExpenseMutation = <TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  said?: SaidByScreen,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    // A record written, changed or removed is a settle candidate gained, changed or lost — the
    // custody fund's «تسوية العهدة» reads its parts, so the custody subtree goes stale with it.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: fleetKeys.licenseExpenses });
      void qc.invalidateQueries({ queryKey: fleetKeys.custody });
    },
    ...(said === undefined ? {} : { onError: toastUnlessSaid(said) }),
  });
};

/**
 * The editor words every failure of a new record itself (`onSave`), so the global toast would only
 * repeat it.
 */
export const useCreateLicenseExpense = () =>
  useLicenseExpenseMutation(
    (body: CreateFleetLicenseExpense) => api.createLicenseExpense(body),
    SAYS_EVERY_FAILURE,
  );
/**
 * The editor names a settled record (422) and a stale one (409), reads it again, and words every
 * other failure itself — as the list does for a delete — so neither leaves anything to the global
 * toast.
 */
export const useUpdateLicenseExpense = () =>
  useLicenseExpenseMutation(
    ({ id, body }: { id: string; body: UpdateFleetLicenseExpense }) =>
      api.updateLicenseExpense(id, body),
    SAYS_EVERY_FAILURE,
  );
export const useDeleteLicenseExpense = () =>
  useLicenseExpenseMutation((id: string) => api.deleteLicenseExpense(id), SAYS_EVERY_FAILURE);

export const licenseExpenseSettingsKey = [...fleetKeys.licenseExpenses, 'settings'] as const;

/** The names every new memo starts with — «تتظبط مرة في الإعداد». */
export const useLicenseExpenseSettings = () =>
  useQuery({
    queryKey: licenseExpenseSettingsKey,
    queryFn: () => api.getLicenseExpenseSettings(),
  });
/**
 * The saved set-up goes straight into the cache, its new version with it: the next save — the
 * signatures right after a template — then carries the version the server now holds instead of
 * waiting for the refetch, and is not refused as stale.
 */
export const useSaveLicenseExpenseSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveFleetLicenseExpenseSettings) => api.saveLicenseExpenseSettings(body),
    onSuccess: (saved) => {
      qc.setQueryData(licenseExpenseSettingsKey, saved);
      void qc.invalidateQueries({ queryKey: fleetKeys.licenseExpenses });
    },
  });
};

// ── Custody memos («المذكرات»), the fund («سجل العهدة») and the papers («إعداد المذكرات») ──────
// Every key sits under the custody subtree (`['fleet', 'custody']`): a receipt saved, edited or
// deleted (`useReceiptMutation`, the `fleet.receipt` signal) already throws that subtree away, so
// the memos' banner, the editor's candidates, the ledger's spend lines and the fund all follow a
// receipt with no wiring of their own. Exported so a spec can seed exactly what a hook reads.
export const custodyFundKey = [...fleetKeys.custody, 'fund'] as const;
export const custodyLedgerKey = [...fleetKeys.custody, 'ledger'] as const;
export const custodyMemosKey = [...fleetKeys.custody, 'memos'] as const;
export const custodyPaperSettingsKey = [...fleetKeys.custody, 'paper-settings'] as const;

/** The pieces of every key below, so a spec seeds the very key a hook reads. */
export const custodyQueryKeys = {
  fund: (): readonly unknown[] => custodyFundKey,
  ledger: (params: FleetListParams): readonly unknown[] => [...custodyLedgerKey, 'list', params],
  ledgerTotals: (filters: FleetListParams): readonly unknown[] => [
    ...custodyLedgerKey,
    'summary',
    filters,
  ],
  operation: (id: string): readonly unknown[] => [...custodyLedgerKey, 'operation', id],
  candidates: (op: 'replenish' | 'settle'): readonly unknown[] => [
    ...custodyLedgerKey,
    'candidates',
    op,
  ],
  memos: (params: FleetListParams): readonly unknown[] => [...custodyMemosKey, 'list', params],
  memoTotals: (filters: FleetListParams): readonly unknown[] => [
    ...custodyMemosKey,
    'summary',
    filters,
  ],
  memosOutside: (): readonly unknown[] => [...custodyMemosKey, 'outside'],
  memo: (id: string): readonly unknown[] => [...custodyMemosKey, 'detail', id],
  memoCandidates: (query: FleetCustodyMemoCandidatesQuery): readonly unknown[] => [
    ...custodyMemosKey,
    'candidates',
    query,
  ],
  paperSettings: (): readonly unknown[] => custodyPaperSettingsKey,
} as const;

/**
 * «إجمالي العهدة» and everything that made it — unfiltered, one answer for the tabs' badges, the
 * ledger's tiles and every fund dialog's «إجمالي العهدة الآن».
 */
export const useCustodyFundSummary = (enabled = true) =>
  useQuery({
    queryKey: custodyQueryKeys.fund(),
    queryFn: () => api.getCustodyFundSummary(),
    enabled,
  });
export const useCustodyLedger = (params: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: custodyQueryKeys.ledger(params),
    queryFn: () => api.listCustodyLedger(params),
    placeholderData: (prev) => prev,
    enabled,
  });
/** The count chip over every row the filters match — never the page. */
export const useCustodyLedgerTotals = (filters: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: custodyQueryKeys.ledgerTotals(filters),
    queryFn: () => api.custodyLedgerTotals(filters),
    placeholderData: (prev) => prev,
    enabled,
  });
/** One operation with its snapshot and its place in the ledger; nothing asked for `''`. */
export const useCustodyOperation = (id: string) =>
  useQuery({
    queryKey: custodyQueryKeys.operation(id),
    queryFn: () => api.getCustodyOperation(id),
    enabled: id !== '',
  });
/** Read while «استعاضة العهدة» is open — no placeholder: a stale list would tick stale memos. */
export const useReplenishCandidates = (enabled: boolean) =>
  useQuery({
    queryKey: custodyQueryKeys.candidates('replenish'),
    queryFn: () => api.custodyReplenishCandidates(),
    enabled,
  });
/** Read while «تسوية العهدة» is open. */
export const useSettleCandidates = (enabled: boolean) =>
  useQuery({
    queryKey: custodyQueryKeys.candidates('settle'),
    queryFn: () => api.custodySettleCandidates(),
    enabled,
  });

export const useCustodyMemos = (params: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: custodyQueryKeys.memos(params),
    queryFn: () => api.listCustodyMemos(params),
    placeholderData: (prev) => prev,
    enabled,
  });
/** The strip's figures over EVERY memo the filters match — never summed from the rows shown. */
export const useCustodyMemoTotals = (filters: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: custodyQueryKeys.memoTotals(filters),
    queryFn: () => api.custodyMemoTotals(filters),
    placeholderData: (prev) => prev,
    enabled,
  });
/** «إيصالات لم تدخل أي مذكرة بعد», per kind. */
export const useCustodyMemosOutside = (enabled = true) =>
  useQuery({
    queryKey: custodyQueryKeys.memosOutside(),
    queryFn: () => api.custodyMemosOutside(),
    enabled,
  });
export const useCustodyMemo = (id: string) =>
  useQuery({
    queryKey: custodyQueryKeys.memo(id),
    queryFn: () => api.getCustodyMemo(id),
    enabled: id !== '',
  });
/**
 * What a memo of the kind can hold — keyed by the kind (and the memo being edited) alone, and with
 * NO placeholder: the only other answer it could show is another kind's receipts, which under this
 * kind's tab would be ticked as this kind's.
 */
export const custodyMemoCandidatesOptions = (
  query: FleetCustodyMemoCandidatesQuery,
  enabled = true,
) => ({
  queryKey: custodyQueryKeys.memoCandidates(query),
  queryFn: () => api.custodyMemoCandidates(query),
  enabled,
});
export const useCustodyMemoCandidates = (query: FleetCustodyMemoCandidatesQuery, enabled = true) =>
  useQuery(custodyMemoCandidatesOptions(query, enabled));
/** The names every paper prints with — his own (`version: null`) until somebody saves. */
export const useCustodyPaperSettings = (enabled = true) =>
  useQuery({
    queryKey: custodyQueryKeys.paperSettings(),
    queryFn: () => api.getCustodyPaperSettings(),
    enabled,
  });

/**
 * A memo written, changed or deleted moves the custody subtree (the banner, the fund's pending
 * memos, the ledger) and the receipts screen too — each receipt says which memo holds it.
 *
 * Every screen that sends one — the editor, «المذكرات», «استعاضة العهدة» — words each failure
 * itself: a receipt another memo took (409), receipts that changed (400), a memo replenished (422),
 * changed (409) or deleted (404), each in so many words, and the rest with the usual sentence. So
 * the global toast is left nothing to add.
 */
const useCustodyMemoMutation = <TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: fleetKeys.custody });
      void qc.invalidateQueries({ queryKey: fleetKeys.receipts });
    },
    onError: toastUnlessSaid(SAYS_EVERY_FAILURE),
  });
};
export const useCreateCustodyMemo = () =>
  useCustodyMemoMutation((body: CreateFleetCustodyMemo) => api.createCustodyMemo(body));
export const useUpdateCustodyMemo = () =>
  useCustodyMemoMutation(({ id, body }: { id: string; body: UpdateFleetCustodyMemo }) =>
    api.updateCustodyMemo(id, body),
  );
export const useDeleteCustodyMemo = () =>
  useCustodyMemoMutation((id: string) => api.deleteCustodyMemo(id));

/**
 * «شحن العهدة» — the fund, its ledger and its tabs move; nothing else does. Its dialog words every
 * failure itself (`useFundOperation`), as «تسوية العهدة» and «استعاضة العهدة» do.
 */
export const useChargeCustody = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFleetCustodyCharge) => api.chargeCustody(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: fleetKeys.custody }),
    onError: toastUnlessSaid(SAYS_EVERY_FAILURE),
  });
};
/**
 * «استعاضة العهدة» — the memos it brings back are replenished: the custody subtree moves, and the
 * receipts screen, whose rows say their memo was replenished (and lock with it).
 */
export const useReplenishCustody = () =>
  useCustodyMemoMutation((body: CreateFleetCustodyReplenishment) => api.replenishCustody(body));
/** «تسوية العهدة» — the fund moves, and so does «الحالة» of every licence part it settled. */
export const useSettleCustody = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFleetCustodySettlement) => api.settleCustody(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: fleetKeys.custody });
      void qc.invalidateQueries({ queryKey: fleetKeys.licenseExpenses });
    },
    onError: toastUnlessSaid(SAYS_EVERY_FAILURE),
  });
};
/**
 * The saved names go straight into the cache, their new version with them — the next save then
 * carries the version the server holds — and the read is refreshed behind it.
 */
export const useSaveCustodyPaperSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveFleetCustodyPaperSettings) => api.saveCustodyPaperSettings(body),
    onSuccess: (saved: FleetCustodyPaperSettingsDto) => {
      qc.setQueryData(custodyPaperSettingsKey, saved);
      void qc.invalidateQueries({ queryKey: custodyPaperSettingsKey });
    },
    // «إعداد المذكرات» says a stale save, and every other failure, itself: one toast, not two.
    onError: toastUnlessSaid(SAYS_EVERY_FAILURE),
  });
};
