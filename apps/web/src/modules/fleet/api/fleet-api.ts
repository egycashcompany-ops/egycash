// Fleet api/ surface (ADR-013): one typed function per backend endpoint, matching FL-2…FL-6
// exactly — no mock data, no client-side fallbacks; every page reads and writes through here.
// Derived values (km, alarms, inWorkshop, rollups, expected reading) are SERVER facts: the
// client renders them and never recomputes them (frozen fleet design, owner principle 3).
import {
  type ChangeFleetVehicleStatus,
  type CheckInFleetMaintenance,
  type CheckOutFleetMaintenance,
  type CorrectFleetOdometer,
  type CreateFleetAccident,
  type CreateFleetCatalogItem,
  type CreateFleetDriverProfile,
  type CreateFleetUnavailability,
  type CreateFleetVehicle,
  type CreateFleetVehicleType,
  type FleetAccidentDto,
  type FleetAccidentTotalsDto,
  type FleetCatalogItemDto,
  type FleetDefaultBranchDto,
  type FleetDriverProfileDto,
  type FleetDriverUnavailabilityDto,
  type FleetExpectedReadingDto,
  type FleetGrievanceDto,
  type FleetMaintenanceAlarmDto,
  type FleetMaintenanceVisitDto,
  type FleetOdometerLogDto,
  type FleetRosterDayDto,
  type FleetFixedRosterDto,
  type SaveFleetFixedRoster,
  type FleetVehicleDto,
  type FleetVehicleTypeDto,
  type FleetViolationDto,
  type FleetViolationRollupDto,
  type Paginated,
  type PlanFleetRoster,
  type RecordFleetDriverViolation,
  type RecordFleetOdometer,
  type RecordFleetVehicleViolation,
  type SetFleetAccidentStatus,
  type SetFleetGrievance,
  type UpdateFleetAccident,
  type UpdateFleetCatalogItem,
  type UpdateFleetDriverProfile,
  type UpdateFleetMaintenance,
  type UpdateFleetUnavailability,
  type UpdateFleetVehicle,
  type UpdateFleetVehicleType,
  type UpdateFleetViolation,
} from '@ecms/contracts';
import {
  api,
  buildQuery,
  del,
  fetchBlob,
  get,
  getPage,
  patch,
  post,
  upload,
  type QueryParams,
} from '../../../shared/lib/api-client';

export type FleetListParams = QueryParams;

const put = <T>(path: string, body: unknown): Promise<T> =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body) });

// ── Vehicle types (§2.2 — the maintenance rule lives on the TYPE) ───────────
export const listVehicleTypes = (
  params: FleetListParams,
): Promise<Paginated<FleetVehicleTypeDto>> =>
  getPage<FleetVehicleTypeDto>(`/fleet/vehicle-types${buildQuery(params)}`);
export const createVehicleType = (body: CreateFleetVehicleType): Promise<FleetVehicleTypeDto> =>
  post<FleetVehicleTypeDto>('/fleet/vehicle-types', body);
export const updateVehicleType = (
  id: string,
  body: UpdateFleetVehicleType,
): Promise<FleetVehicleTypeDto> => patch<FleetVehicleTypeDto>(`/fleet/vehicle-types/${id}`, body);

// ── Catalogs (§2.10 — workshops, work types, spare parts, mission/violation types…) ─
export const listCatalogItems = (
  params: FleetListParams,
): Promise<Paginated<FleetCatalogItemDto>> =>
  getPage<FleetCatalogItemDto>(`/fleet/catalog-items${buildQuery(params)}`);
export const createCatalogItem = (body: CreateFleetCatalogItem): Promise<FleetCatalogItemDto> =>
  post<FleetCatalogItemDto>('/fleet/catalog-items', body);
export const updateCatalogItem = (
  id: string,
  body: UpdateFleetCatalogItem,
): Promise<FleetCatalogItemDto> => patch<FleetCatalogItemDto>(`/fleet/catalog-items/${id}`, body);

// ── Vehicle registry (§2.1/§4.1 — `inWorkshop` arrives DERIVED from the server) ─
export const listVehicles = (params: FleetListParams): Promise<Paginated<FleetVehicleDto>> =>
  getPage<FleetVehicleDto>(`/fleet/vehicles${buildQuery(params)}`);
export const getVehicle = (id: string): Promise<FleetVehicleDto> =>
  get<FleetVehicleDto>(`/fleet/vehicles/${id}`);
export const createVehicle = (body: CreateFleetVehicle): Promise<FleetVehicleDto> =>
  post<FleetVehicleDto>('/fleet/vehicles', body);
export const updateVehicle = (id: string, body: UpdateFleetVehicle): Promise<FleetVehicleDto> =>
  patch<FleetVehicleDto>(`/fleet/vehicles/${id}`, body);
export const changeVehicleStatus = (
  id: string,
  body: ChangeFleetVehicleStatus,
): Promise<FleetVehicleDto> => post<FleetVehicleDto>(`/fleet/vehicles/${id}/status`, body);
export const deleteVehicle = (id: string): Promise<void> => del<void>(`/fleet/vehicles/${id}`);
/** The create form's branch default — a SERVER fact resolved from live branch data (§2.1). */
export const getDefaultVehicleBranch = (): Promise<FleetDefaultBranchDto> =>
  get<FleetDefaultBranchDto>('/fleet/vehicles/default-branch');

// ── Vehicle license image (§6/§8 — one current scan per vehicle) ────────────
export const uploadVehicleLicenseImage = (id: string, file: File): Promise<FleetVehicleDto> => {
  const form = new FormData();
  form.append('file', file);
  return upload<FleetVehicleDto>(`/fleet/vehicles/${id}/license-image`, form);
};
/**
 * The BYTES, not a URL. The file is guarded (ADR-023), so its signed URL needs a bearer token an
 * `<img src>` cannot carry — the caller turns this blob into an object URL to render it, and into
 * a data URL to print it.
 */
export const fetchVehicleLicenseImage = (id: string): Promise<Blob> =>
  fetchBlob(`/fleet/vehicles/${id}/license-image`);
export const deleteVehicleLicenseImage = (id: string): Promise<FleetVehicleDto> =>
  del<FleetVehicleDto>(`/fleet/vehicles/${id}/license-image`);

// ── Driver profiles (§2.3 — HR-employee extensions, FR-11) ──────────────────
export const listDrivers = (params: FleetListParams): Promise<Paginated<FleetDriverProfileDto>> =>
  getPage<FleetDriverProfileDto>(`/fleet/drivers${buildQuery(params)}`);
export const getDriver = (id: string): Promise<FleetDriverProfileDto> =>
  get<FleetDriverProfileDto>(`/fleet/drivers/${id}`);
export const createDriverProfile = (
  body: CreateFleetDriverProfile,
): Promise<FleetDriverProfileDto> => post<FleetDriverProfileDto>('/fleet/drivers', body);
export const updateDriverProfile = (
  id: string,
  body: UpdateFleetDriverProfile,
): Promise<FleetDriverProfileDto> => patch<FleetDriverProfileDto>(`/fleet/drivers/${id}`, body);

// ── Driver license image (one current scan per driver) ──────────────────────
export const uploadDriverLicenseImage = (
  id: string,
  file: File,
): Promise<FleetDriverProfileDto> => {
  const form = new FormData();
  form.append('file', file);
  return upload<FleetDriverProfileDto>(`/fleet/drivers/${id}/license-image`, form);
};
/** The BYTES, not a URL — same reason as the vehicle's scan: the file is guarded (ADR-023). */
export const fetchDriverLicenseImage = (id: string): Promise<Blob> =>
  fetchBlob(`/fleet/drivers/${id}/license-image`);
export const deleteDriverLicenseImage = (id: string): Promise<FleetDriverProfileDto> =>
  del<FleetDriverProfileDto>(`/fleet/drivers/${id}/license-image`);

// ── Driver unavailability — التمامات (§2.4) ─────────────────────────────────
export const listUnavailability = (
  params: FleetListParams,
): Promise<Paginated<FleetDriverUnavailabilityDto>> =>
  getPage<FleetDriverUnavailabilityDto>(`/fleet/availability${buildQuery(params)}`);
export const recordUnavailability = (
  body: CreateFleetUnavailability,
): Promise<FleetDriverUnavailabilityDto> =>
  post<FleetDriverUnavailabilityDto>('/fleet/availability', body);
export const updateUnavailability = (
  id: string,
  body: UpdateFleetUnavailability,
): Promise<FleetDriverUnavailabilityDto> =>
  patch<FleetDriverUnavailabilityDto>(`/fleet/availability/${id}`, body);
export const cancelUnavailability = (id: string): Promise<void> =>
  del<void>(`/fleet/availability/${id}`);

// ── Odometer (§4.3 — continuity; the SERVER computes km and the expected reading) ─
export const listOdometerLogs = (
  params: FleetListParams,
): Promise<Paginated<FleetOdometerLogDto>> =>
  getPage<FleetOdometerLogDto>(`/fleet/odometer${buildQuery(params)}`);
export const expectedOdometerReading = (vehicleId: string): Promise<FleetExpectedReadingDto> =>
  get<FleetExpectedReadingDto>(`/fleet/odometer/expected${buildQuery({ vehicleId })}`);
/**
 * The alarm projection, through the ODOMETER's door (`fleetOdometer.view`).
 *
 * There are two doors to one answer — see `listMaintenanceAlarmsForMaintenance`. Which one a
 * reader goes through is decided ONCE, by permission, inside `useMaintenanceAlarms`; nothing
 * calls either of these directly.
 */
export const listMaintenanceAlarms = (): Promise<FleetMaintenanceAlarmDto[]> =>
  get<FleetMaintenanceAlarmDto[]>('/fleet/odometer/alarms');
/**
 * The SAME projection, through the MAINTENANCE door (`fleetMaintenance.view`).
 *
 * Same `computeAlarms()` behind the same handler on the server — the paths differ only in the
 * permission they demand, so these two functions return the same rows for the same fleet and
 * exist solely so a maintenance reader is not asked for the odometer log's permission.
 */
export const listMaintenanceAlarmsForMaintenance = (): Promise<FleetMaintenanceAlarmDto[]> =>
  get<FleetMaintenanceAlarmDto[]>('/fleet/maintenance/alarms');
export const recordOdometer = (body: RecordFleetOdometer): Promise<FleetOdometerLogDto> =>
  post<FleetOdometerLogDto>('/fleet/odometer', body);
export const correctOdometer = (
  id: string,
  body: CorrectFleetOdometer,
): Promise<FleetOdometerLogDto> => patch<FleetOdometerLogDto>(`/fleet/odometer/${id}`, body);

// ── Maintenance visits (§4.2 — check-in / check-out / reopen) ───────────────
export const listMaintenanceVisits = (
  params: FleetListParams,
): Promise<Paginated<FleetMaintenanceVisitDto>> =>
  getPage<FleetMaintenanceVisitDto>(`/fleet/maintenance${buildQuery(params)}`);
export const checkInMaintenance = (
  body: CheckInFleetMaintenance,
): Promise<FleetMaintenanceVisitDto> => post<FleetMaintenanceVisitDto>('/fleet/maintenance', body);
export const checkOutMaintenance = (
  id: string,
  body: CheckOutFleetMaintenance,
): Promise<FleetMaintenanceVisitDto> =>
  post<FleetMaintenanceVisitDto>(`/fleet/maintenance/${id}/check-out`, body);
export const reopenMaintenance = (id: string, version: number): Promise<FleetMaintenanceVisitDto> =>
  post<FleetMaintenanceVisitDto>(`/fleet/maintenance/${id}/reopen`, { version });
export const updateMaintenance = (
  id: string,
  body: UpdateFleetMaintenance,
): Promise<FleetMaintenanceVisitDto> =>
  patch<FleetMaintenanceVisitDto>(`/fleet/maintenance/${id}`, body);
export const deleteMaintenance = (id: string): Promise<void> =>
  del<void>(`/fleet/maintenance/${id}`);

// ── Daily roster (§4.5 — the board comes back with every save; drag-ready) ──
export const getRosterDay = (date: string): Promise<FleetRosterDayDto> =>
  get<FleetRosterDayDto>(`/fleet/roster${buildQuery({ date })}`);
export const planRoster = (
  body: PlanFleetRoster,
): Promise<FleetRosterDayDto & { changedCount: number }> =>
  post<FleetRosterDayDto & { changedCount: number }>('/fleet/roster', body);

export const getFixedRoster = (): Promise<FleetFixedRosterDto> =>
  get<FleetFixedRosterDto>('/fleet/fixed-roster');
export const saveFixedRoster = (
  body: SaveFleetFixedRoster,
): Promise<FleetFixedRosterDto & { changedCount: number }> =>
  post<FleetFixedRosterDto & { changedCount: number }>('/fleet/fixed-roster', body);

// ── Accidents (§4.6, FR-10) ─────────────────────────────────────────────────
export const listAccidents = (params: FleetListParams): Promise<Paginated<FleetAccidentDto>> =>
  getPage<FleetAccidentDto>(`/fleet/accidents${buildQuery(params)}`);
/**
 * The figures under the list, over EVERY accident the filters match.
 *
 * Takes the filters and nothing else — no page, no size. The endpoint's schema is strict and has
 * no room for them, so a caller cannot narrow the sum to a page even by mistake.
 */
export const accidentSummary = (params: FleetListParams): Promise<FleetAccidentTotalsDto> =>
  get<FleetAccidentTotalsDto>(`/fleet/accidents/summary${buildQuery(params)}`);
export const createAccident = (body: CreateFleetAccident): Promise<FleetAccidentDto> =>
  post<FleetAccidentDto>('/fleet/accidents', body);
export const updateAccident = (id: string, body: UpdateFleetAccident): Promise<FleetAccidentDto> =>
  patch<FleetAccidentDto>(`/fleet/accidents/${id}`, body);
export const setAccidentStatus = (
  id: string,
  body: SetFleetAccidentStatus,
): Promise<FleetAccidentDto> => post<FleetAccidentDto>(`/fleet/accidents/${id}/status`, body);
export const deleteAccident = (id: string): Promise<void> => del<void>(`/fleet/accidents/${id}`);

// ── Violations + grievances (§4.7, FR-9 — amounts and rollups are server-derived) ─
export const listViolations = (params: FleetListParams): Promise<Paginated<FleetViolationDto>> =>
  getPage<FleetViolationDto>(`/fleet/violations${buildQuery(params)}`);
export const violationRollup = (
  year: number,
  vehicleId?: string,
): Promise<FleetViolationRollupDto[]> =>
  get<FleetViolationRollupDto[]>(`/fleet/violations/rollup${buildQuery({ year, vehicleId })}`);
export const recordVehicleViolation = (
  body: RecordFleetVehicleViolation,
): Promise<FleetViolationDto> => post<FleetViolationDto>('/fleet/violations/vehicle', body);
export const recordDriverViolation = (
  body: RecordFleetDriverViolation,
): Promise<FleetViolationDto> => post<FleetViolationDto>('/fleet/violations/driver', body);
export const updateViolation = (
  id: string,
  body: UpdateFleetViolation,
): Promise<FleetViolationDto> => patch<FleetViolationDto>(`/fleet/violations/${id}`, body);
export const setGrievance = (body: SetFleetGrievance): Promise<FleetGrievanceDto> =>
  put<FleetGrievanceDto>('/fleet/violations/grievance', body);
export const deleteViolation = (id: string): Promise<void> => del<void>(`/fleet/violations/${id}`);
