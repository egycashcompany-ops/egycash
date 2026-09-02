// The maintenance alarm (fleet design §4.4, FR-3; owner FL-4 points 2/3): DERIVED, never
// stored, computed in the backend only. `computeAlarm` is the pure half — the exact arithmetic
// the legacy ran in `cars_log.ejs:664-687`, with its two guards preserved — so the decision is
// unit-tested without a database. The service half only gathers inputs.
import {
  FleetSettingKeys,
  odometerBracketBreach,
  type FleetAlarmLevel,
  type FleetMaintenanceAlarmDto,
  type FleetNoAlarmReason,
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
  /**
   * The highest reading the chain already held ON the baseline's own date — the lower half of the
   * odometer bracket, resolved by the caller. `null` when the chain has nothing that early, which
   * constrains nothing rather than meaning zero.
   */
  baselineLowerBound: number | null;
}

export interface AlarmResult {
  level: FleetAlarmLevel;
  remainingKm: number | null;
  sinceServiceKm: number | null;
  /**
   * WHICH guard returned, or `null` when the arithmetic ran.
   *
   * Reported from inside the guards themselves — the only place that knows. Deriving it anywhere
   * else would mean a second copy of these six conditions, free to drift from the ones that
   * actually decide; this function stays the single source of truth for both the answer and the
   * reason there isn't one.
   *
   * `null` on the computed path even when `level` is `'none'`: that is a measured, healthy cycle,
   * not a missing answer, and the two must not read alike.
   */
  noAlarmReason: FleetNoAlarmReason | null;
}

/**
 * remaining = interval − (latestReading − counterAtLastService). Guards preserved from the
 * legacy view: no rule / no readings / no baseline ⇒ no data (never a false alarm), and a
 * reading OLDER than the last service says nothing about the new cycle.
 *
 * Two guards the legacy did not have, both asking the same question in different places: are
 * these two numbers readings of the same instrument at all? The legacy printed whatever the
 * subtraction produced. This refuses, because a distance that runs backwards is not a small
 * distance — it is a pair that never belonged on one sequence.
 *
 * WHY `baselineBelowChain` COMES BEFORE `readingOlderThanService`. The four legacy guards all
 * describe states that heal themselves: buy an interval, take a reading, record a service, wait
 * for the next reading. `baselineBelowChain` does not — a fresh reading would only be subtracted
 * from the same unusable baseline, so telling an operator to "wait for a reading after the
 * service" would send them to do something that cannot help. Naming the durable problem first is
 * what makes the reason actionable. The other four keep their order among themselves.
 */
export const computeAlarm = (input: AlarmInput): AlarmResult => {
  const none = (noAlarmReason: FleetNoAlarmReason): AlarmResult => ({
    level: 'none',
    remainingKm: null,
    sinceServiceKm: null,
    noAlarmReason,
  });
  if (input.intervalKm <= 0) return none('noInterval');
  if (input.latestReading === null || input.latestReadingDate === null) return none('noReading');
  if (input.baselineCounter === null || input.baselineDate === null) return none('noService');
  // The LOWER half of the odometer bracket, applied to the baseline itself: on the day the car
  // left the workshop the chain already stood at `baselineLowerBound`, and an odometer does not
  // run backwards, so a baseline beneath it was never on this car's sequence. `null` means the
  // chain held nothing that early — no bound, nothing to contradict.
  //
  // Asked through the SHARED bracket rule rather than a second `<` written here: the dialogs warn
  // with the same function while somebody types, and two copies of one comparison would be free
  // to disagree about the same visit. Only the lower half is passed — the upper half of the
  // bracket is about readings taken AFTER the service, which the guard below covers differently.
  if (
    odometerBracketBreach(input.baselineCounter, {
      lowerBound: input.baselineLowerBound,
      upperBound: null,
    }) === 'belowChain'
  ) {
    return none('baselineBelowChain');
  }
  if (input.latestReadingDate <= input.baselineDate) return none('readingOlderThanService');
  // The UPPER half, in the only form the projection can afford: the vehicle's latest reading is
  // its own bound, and a baseline above it would make the subtraction negative. It survives the
  // bracket above because an absent later reading leaves that side unconstrained — so this is
  // genuinely a separate refusal, not a duplicate of it, and it stays last as the final
  // defensive invariant on the arithmetic itself.
  if (input.latestReading < input.baselineCounter) return none('baselineAboveReading');

  const sinceServiceKm = input.latestReading - input.baselineCounter;
  const remainingKm = input.intervalKm - sinceServiceKm;
  const level: FleetAlarmLevel =
    remainingKm <= input.redKm ? 'red' : remainingKm <= input.yellowKm ? 'yellow' : 'none';
  return { level, remainingKm, sinceServiceKm, noAlarmReason: null };
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

  // Each baseline against the chain AS IT STOOD ON ITS OWN SERVICE DATE — one query for the whole
  // fleet, not one per car. Only vehicles that actually have a baseline are asked about: a car
  // with no counting visit has no date to ask on, and `noService` answers it first anyway.
  const lowerBounds = await fleetOdometerRepository.lowerBoundsAt(
    [...baselines.values()].map((baseline) => ({
      vehicleId: baseline.vehicleId,
      on: baseline.serviceDate,
    })),
  );

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
      baselineLowerBound: baseline === null ? null : (lowerBounds.get(id)?.reading ?? null),
    });
    return {
      vehicleId: id,
      code: vehicle.code,
      level: result.level,
      remainingKm: result.remainingKm,
      sinceServiceKm: result.sinceServiceKm,
      lastServiceAt: baseline === null ? null : baseline.serviceDate.toISOString(),
      lastServiceVisitId: baseline?.visitId ?? null,
      // Straight from the guards. Re-deriving it here would be a second copy of the rule.
      noAlarmReason: result.noAlarmReason,
    };
  });
};
