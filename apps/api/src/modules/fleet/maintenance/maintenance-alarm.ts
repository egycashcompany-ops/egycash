// The maintenance alarm (fleet design §4.4, FR-3; owner FL-4 points 2/3): DERIVED, never
// stored, computed in the backend only. `computeAlarm` is the pure half — the exact arithmetic
// the legacy ran in `cars_log.ejs:664-687`, with its two guards preserved — so the decision is
// unit-tested without a database. The service half only gathers inputs.
import {
  FleetSettingKeys,
  type FleetAlarmLevel,
  type FleetMaintenanceAlarmDto,
} from '@ecms/contracts';
import { settingsService } from '../../../platform/settings';
import { fleetCatalogItemRepository } from '../catalogs/catalog-item.repository';
import { fleetVehicleTypeRepository } from '../vehicle-types/vehicle-type.repository';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetOdometerRepository } from '../odometer/odometer.repository';
import { fleetMaintenanceRepository } from './maintenance.repository';

export interface AlarmInput {
  /** Per vehicle TYPE; 0 = no rule. */
  intervalKm: number;
  yellowKm: number;
  redKm: number;
  latestReading: number | null;
  latestReadingDate: Date | null;
  baselineCounter: number | null;
  baselineDate: Date | null;
}

export interface AlarmResult {
  level: FleetAlarmLevel;
  remainingKm: number | null;
  sinceServiceKm: number | null;
}

/**
 * remaining = interval − (latestReading − counterAtLastService). Guards preserved from the
 * legacy view: no rule / no readings / no baseline ⇒ no data (never a false alarm), and a
 * reading OLDER than the last service says nothing about the new cycle.
 */
export const computeAlarm = (input: AlarmInput): AlarmResult => {
  const none: AlarmResult = { level: 'none', remainingKm: null, sinceServiceKm: null };
  if (input.intervalKm <= 0) return none;
  if (input.latestReading === null || input.latestReadingDate === null) return none;
  if (input.baselineCounter === null || input.baselineDate === null) return none;
  if (input.latestReadingDate <= input.baselineDate) return none;

  const sinceServiceKm = input.latestReading - input.baselineCounter;
  const remainingKm = input.intervalKm - sinceServiceKm;
  const level: FleetAlarmLevel =
    remainingKm <= input.redKm ? 'red' : remainingKm <= input.yellowKm ? 'yellow' : 'none';
  return { level, remainingKm, sinceServiceKm };
};

const allActiveVehicles = async () => {
  const vehicles = [];
  for (let page = 1; ; page += 1) {
    const batch = await fleetVehicleRepository.list({
      filter: { status: 'active' },
      page,
      pageSize: 100,
    });
    vehicles.push(...batch.items);
    if (batch.items.length < 100) return vehicles;
  }
};

/** Alarm projection for a set of vehicles (or every active vehicle). Query-time, per FR-3. */
export const computeAlarms = async (
  vehicleIds?: readonly string[],
): Promise<FleetMaintenanceAlarmDto[]> => {
  const vehicles =
    vehicleIds === undefined
      ? await allActiveVehicles()
      : await Promise.all(vehicleIds.map((id) => fleetVehicleRepository.getById(id)));
  if (vehicles.length === 0) return [];

  const ids = vehicles.map((v) => String(v._id));
  const [yellowKm, redKm] = await Promise.all([
    settingsService.resolve<number>(FleetSettingKeys.AlarmYellowKm, {
      userId: null,
      branchId: null,
    }),
    settingsService.resolve<number>(FleetSettingKeys.AlarmRedKm, { userId: null, branchId: null }),
  ]);

  const countingTypes = await fleetCatalogItemRepository.list({
    filter: { kind: 'workType', countsForAlarm: true, isActive: true },
    page: 1,
    pageSize: 100,
  });
  const countingIds = countingTypes.items.map((item) => String(item._id));

  const [readings, baselines] = await Promise.all([
    fleetOdometerRepository.latestReadings(ids),
    fleetMaintenanceRepository.alarmBaselines(ids, countingIds),
  ]);

  // One interval lookup per distinct TYPE, not per vehicle.
  const intervals = new Map<string, number>();
  for (const vehicle of vehicles) {
    const typeId = String(vehicle.typeId);
    if (!intervals.has(typeId)) {
      const type = await fleetVehicleTypeRepository.findById(typeId);
      intervals.set(typeId, type?.maintenanceIntervalKm ?? 0);
    }
  }

  return vehicles.map((vehicle) => {
    const id = String(vehicle._id);
    const reading = readings.get(id) ?? null;
    const baseline = baselines.get(id) ?? null;
    const result = computeAlarm({
      intervalKm: intervals.get(String(vehicle.typeId)) ?? 0,
      yellowKm,
      redKm,
      latestReading: reading?.reading ?? null,
      latestReadingDate: reading?.date ?? null,
      baselineCounter: baseline?.odometerAtService ?? null,
      baselineDate: baseline?.serviceDate ?? null,
    });
    return {
      vehicleId: id,
      code: vehicle.code,
      level: result.level,
      remainingKm: result.remainingKm,
      sinceServiceKm: result.sinceServiceKm,
      lastServiceAt: baseline === null ? null : baseline.serviceDate.toISOString(),
    };
  });
};
