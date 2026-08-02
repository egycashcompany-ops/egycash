// TanStack Query hooks for the Fleet app (ADR-013). Keys follow the platform factory —
// ['fleet', feature, kind, params] — so each FW slice invalidates surgically: an odometer
// mutation moves alarms and the vehicle's derived facts, so both invalidate together; a roster
// save replaces the whole day. Read hooks land here in FW-1 as the module's data foundation;
// each later slice adds its mutation hooks beside them.
import { useQuery } from '@tanstack/react-query';
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
export const useVehicles = (params: FleetListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'vehicles', params),
    queryFn: () => api.listVehicles(params),
    placeholderData: (prev) => prev,
  });

export const useVehicle = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, 'vehicles', id),
    queryFn: () => api.getVehicle(id),
    enabled: id !== '',
  });

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

export const useMaintenanceAlarms = () =>
  useQuery({
    queryKey: [MODULE, 'odometer', 'alarms'],
    queryFn: api.listMaintenanceAlarms,
    // Derived on the server per request (FR-3); a short stale window keeps the board honest
    // without hammering the projection.
    staleTime: 30_000,
  });

export const useMaintenanceVisits = (params: FleetListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'maintenance', params),
    queryFn: () => api.listMaintenanceVisits(params),
    placeholderData: (prev) => prev,
  });

// ── Roster / accidents / violations ─────────────────────────────────────────
export const useRosterDay = (date: string) =>
  useQuery({
    queryKey: [MODULE, 'roster', 'day', date],
    queryFn: () => api.getRosterDay(date),
    enabled: date !== '',
    placeholderData: (prev) => prev,
  });

export const useAccidents = (params: FleetListParams) =>
  useQuery({
    queryKey: listKey(MODULE, 'accidents', params),
    queryFn: () => api.listAccidents(params),
    placeholderData: (prev) => prev,
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
