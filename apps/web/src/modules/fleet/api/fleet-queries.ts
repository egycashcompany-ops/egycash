// TanStack Query hooks for the Fleet app (ADR-013). Keys follow the platform factory —
// ['fleet', feature, kind, params] — so each FW slice invalidates surgically: an odometer
// mutation moves alarms and the vehicle's derived facts, so both invalidate together; a roster
// save replaces the whole day. Read hooks land here in FW-1 as the module's data foundation;
// each later slice adds its mutation hooks beside them.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ChangeFleetVehicleStatus,
  type CreateFleetVehicle,
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

export const useUnavailability = (params: FleetListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'availability', params),
    queryFn: () => api.listUnavailability(params),
    placeholderData: (prev) => prev,
  });

// ── Odometer + maintenance ──────────────────────────────────────────────────
export const useOdometerLogs = (params: FleetListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'odometer', params),
    queryFn: () => api.listOdometerLogs(params),
    placeholderData: (prev) => prev,
  });

export const useExpectedReading = (vehicleId: string) =>
  useQuery({
    queryKey: [MODULE, 'odometer', 'expected', vehicleId],
    queryFn: () => api.expectedOdometerReading(vehicleId),
    enabled: vehicleId !== '',
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

// ── Roster / accidents / violations ─────────────────────────────────────────
export const useRosterDay = (date: string) =>
  useQuery({
    queryKey: [MODULE, 'roster', 'day', date],
    queryFn: () => api.getRosterDay(date),
    enabled: date !== '',
    placeholderData: (prev) => prev,
  });

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
