// TanStack Query hooks for the Fleet app (ADR-013). Keys follow the platform factory —
// ['fleet', feature, kind, params] — so each FW slice invalidates surgically: an odometer
// mutation moves alarms and the vehicle's derived facts, so both invalidate together; a roster
// save replaces the whole day. Read hooks land here in FW-1 as the module's data foundation;
// each later slice adds its mutation hooks beside them.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ChangeFleetVehicleStatus,
  type CheckInFleetMaintenance,
  type CheckOutFleetMaintenance,
  type CorrectFleetOdometer,
  type CreateFleetAccident,
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
  type RecordFleetVehicleViolation,
  type SetFleetAccidentStatus,
  type SetFleetGrievance,
  type UpdateFleetAccident,
  type UpdateFleetCatalogItem,
  type UpdateFleetDriverProfile,
  type UpdateFleetVehicleType,
  type UpdateFleetViolation,
  type UpdateFleetMaintenance,
  type UpdateFleetUnavailability,
  type UpdateFleetVehicle,
} from '@ecms/contracts';
import { detailKey, featureKey, listKey } from '../../../shared/lib/query-keys';
import { useSetSetting } from '../../../platform/settings/settings-api';
import * as api from './fleet-api';
import { type FleetListParams } from './fleet-api';

const MODULE = 'fleet';

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
  violations: featureKey(MODULE, 'violations'),
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

export const useFleetCatalog = (kind: string) =>
  useQuery({
    queryKey: listKey(MODULE, 'catalogs', { kind }),
    queryFn: () => api.listCatalogItems({ kind, pageSize: 100 }),
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
// alarm projection, so their writes invalidate the odometer subtree alongside their own lists.
const useVehicleTypeMutation = <TInput>(
  mutationFn: (input: TInput) => Promise<FleetVehicleTypeDto>,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: fleetKeys.vehicleTypes });
      void qc.invalidateQueries({ queryKey: fleetKeys.odometer });
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
    },
  });
};

export const useCreateCatalogItem = () =>
  useCatalogItemMutation((body: CreateFleetCatalogItem) => api.createCatalogItem(body));
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

export const useMaintenanceAlarms = (enabled = true) =>
  useQuery({
    queryKey: [MODULE, 'odometer', 'alarms'],
    queryFn: api.listMaintenanceAlarms,
    // Derived on the server per request (FR-3); a short stale window keeps the board honest
    // without hammering the projection.
    staleTime: 30_000,
    enabled,
  });

export const useMaintenanceVisits = (params: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'maintenance', params),
    queryFn: () => api.listMaintenanceVisits(params),
    placeholderData: (prev) => prev,
    enabled,
  });

// ── Odometer + maintenance mutations (FW-6) ─────────────────────────────────
// Odometer writes move every derived odometer surface (logs, expected reading, the alarm
// projection) — one feature-key invalidation covers them all. Maintenance writes additionally
// move the vehicles' derived inWorkshop flag and the alarm baseline.
export const useRecordOdometer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordFleetOdometer) => api.recordOdometer(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: fleetKeys.odometer }),
  });
};

export const useCorrectOdometer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CorrectFleetOdometer }) =>
      api.correctOdometer(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: fleetKeys.odometer }),
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

export const useRosterDay = (date: string) =>
  useQuery({
    queryKey: rosterDayKey(date),
    queryFn: () => api.getRosterDay(date),
    enabled: date !== '',
    placeholderData: (prev) => prev,
  });

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

export const useViolations = (params: FleetListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'violations', params),
    queryFn: () => api.listViolations(params),
    placeholderData: (prev) => prev,
  });

export const useViolationRollup = (year: number, vehicleId?: string, enabled = true) =>
  useQuery({
    queryKey: [MODULE, 'violations', 'rollup', { year, vehicleId }],
    queryFn: () => api.violationRollup(year, vehicleId),
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
export const useUpdateViolation = () =>
  useViolationMutation(({ id, body }: { id: string; body: UpdateFleetViolation }) =>
    api.updateViolation(id, body),
  );
export const useSetGrievance = () =>
  useViolationMutation((body: SetFleetGrievance) => api.setGrievance(body));
export const useDeleteViolation = () =>
  useViolationMutation((id: string) => api.deleteViolation(id));
