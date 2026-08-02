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
  type CreateFleetDriverProfile,
  type CreateFleetUnavailability,
  type CreateFleetVehicle,
  type FleetRosterDayDto,
  type PlanFleetRoster,
  type RecordFleetOdometer,
  type UpdateFleetDriverProfile,
  type UpdateFleetMaintenance,
  type UpdateFleetUnavailability,
  type UpdateFleetVehicle,
} from '@ecms/contracts';
import { detailKey, featureKey, listKey } from '../../../shared/lib/query-keys';
import * as api from './fleet-api';
import { type FleetListParams } from './fleet-api';

const MODULE = 'fleet';

export const fleetKeys = {
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

export const useVehicleTypes = (params: FleetListParams = { pageSize: 100 }) =>
  useQuery({
    queryKey: listKey(MODULE, 'vehicleTypes', params),
    queryFn: () => api.listVehicleTypes(params),
    staleTime: 60_000,
  });

export const useFleetCatalog = (kind: string) =>
  useQuery({
    queryKey: listKey(MODULE, 'catalogs', { kind }),
    queryFn: () => api.listCatalogItems({ kind, pageSize: 100 }),
    staleTime: 60_000,
  });

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
export const useDrivers = (params: FleetListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'drivers', params),
    queryFn: () => api.listDrivers(params),
    placeholderData: (prev) => prev,
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
export const useOdometerLogs = (params: FleetListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'odometer', params),
    queryFn: () => api.listOdometerLogs(params),
    placeholderData: (prev) => prev,
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

export const useAccidents = (params: FleetListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'accidents', params),
    queryFn: () => api.listAccidents(params),
    placeholderData: (prev) => prev,
    enabled,
  });

export const useViolations = (params: FleetListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'violations', params),
    queryFn: () => api.listViolations(params),
    placeholderData: (prev) => prev,
  });

export const useViolationRollup = (year: number, vehicleId?: string) =>
  useQuery({
    queryKey: [MODULE, 'violations', 'rollup', { year, vehicleId }],
    queryFn: () => api.violationRollup(year, vehicleId),
  });
