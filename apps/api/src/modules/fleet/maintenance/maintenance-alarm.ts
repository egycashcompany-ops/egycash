// The maintenance alarm (fleet design §4.4, FR-3; owner FL-4 points 2/3): DERIVED, never
// stored, computed in the backend only. `computeAlarm` is the pure half — the exact arithmetic
// the legacy ran in `cars_log.ejs:664-687`, with its two guards preserved — so the decision is
// unit-tested without a database. The service half only gathers inputs.
import {
  FleetSettingKeys,
  odometerBracketBreach,
  type FleetAlarmLevel,
  type FleetAlarmUncountedVisitDto,
  type FleetAlarmUncountedWhy,
  type FleetMaintenanceAlarmDto,
  type FleetNoAlarmReason,
} from '@ecms/contracts';
import { settingsService } from '../../../platform/settings';
import { fleetCatalogItemRepository } from '../catalogs/catalog-item.repository';
import { fleetVehicleTypeRepository } from '../vehicle-types/vehicle-type.repository';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetOdometerRepository } from '../odometer/odometer.repository';
import {
  fleetMaintenanceRepository,
  type AlarmBaseline,
  type NewestVisit,
} from './maintenance.repository';
import { measureFromVisit } from './measure-from-visit';

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
   * The highest reading the chain already held BEFORE the day the baseline COUNTER was taken — the
   * check-in day for an entry counter, the check-out day for an exit one — the lower half of the
   * odometer bracket, resolved by the caller. That day's own readings take no part: the register
   * keeps no time of day, so one of them may have been taken after the counter (R4). A visit with
   * no counter is measured from the reading the chain held on its check-out day, its own bound.
   * `null` when the chain has nothing that early, which constrains nothing rather than meaning zero.
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
  // The LOWER half of the odometer bracket, applied to the baseline itself: on the day that
  // counter was read the chain already stood at `baselineLowerBound`, and an odometer does not
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

/**
 * The car's newest visit, when the alarm cannot measure from it — still open, or of a work type
 * that does not count — so a screen can say why the visit a reader expects is not the one used.
 * `null` when the newest visit IS the baseline, or counts and is closed.
 */
const newerUncounted = (
  newest: NewestVisit | null,
  baseline: AlarmBaseline | null,
  countingIds: readonly string[],
): FleetAlarmUncountedVisitDto | null => {
  if (newest === null || newest.visitId === baseline?.visitId) return null;
  const why: FleetAlarmUncountedWhy | null =
    newest.outDate === null
      ? 'open'
      : countingIds.includes(newest.workTypeId)
        ? null
        : 'notCounting';
  if (why === null) return null;
  return {
    visitId: newest.visitId,
    inDate: newest.inDate.toISOString(),
    outDate: newest.outDate === null ? null : newest.outDate.toISOString(),
    why,
  };
};

/**
 * Alarm projection for every ACTIVE vehicle. Query-time, per FR-3.
 *
 * It used to take an optional list of ids, and no caller ever passed one — all four go through
 * the no-argument path. The unused branch was not merely dead but DIFFERENT: it skipped the
 * `status: 'active'` filter this one applies, and answered a soft-deleted id with a thrown
 * `NotFoundError` rather than an empty projection. Two behaviours behind one name, and the one
 * nobody ran was the one nobody tested.
 */
export const computeAlarms = async (): Promise<FleetMaintenanceAlarmDto[]> => {
  const vehicles = await allActiveVehicles();
  if (vehicles.length === 0) return [];

  const ids = vehicles.map((v) => String(v._id));
  const [yellowKm, redKm] = await Promise.all([
    settingsService.resolve<number>(FleetSettingKeys.AlarmYellowKm, {
      userId: null,
      branchId: null,
    }),
    settingsService.resolve<number>(FleetSettingKeys.AlarmRedKm, { userId: null, branchId: null }),
  ]);

  // Archived types included, and no page limit — see `countingWorkTypeIds`. A baseline is a
  // historical fact, and retiring the vocabulary that named it does not un-make it.
  const countingIds = await fleetCatalogItemRepository.countingWorkTypeIds();

  const [readings, baselines, newest] = await Promise.all([
    fleetOdometerRepository.latestReadings(ids),
    fleetMaintenanceRepository.alarmBaselines(ids, countingIds),
    fleetMaintenanceRepository.newestVisits(ids),
  ]);

  // Each counter against the chain AS IT STOOD BEFORE THE DAY IT WAS TAKEN — one query per kind of
  // counter for the whole fleet, not one per car. An entry counter is judged on the day the car went
  // IN: it was read then, and readings taken between check-in and check-out do not make it untrue —
  // asked on the check-out day, car 219's 84,080 of 25 June was refused because the chain had
  // reached 84,189 by the 28th. And only the days BEFORE count (R4): the register keeps no time of
  // day, so a reading dated on the service day may have been taken after the counter — car 295's
  // 22,790 was refused by a reading of its own day. An exit counter is asked about even when an
  // entry counter exists too, because the entry one is what R3 falls back to.
  //
  // A visit with no counter keeps the day: its stand-in is the reading the car LEFT on.
  const visits = [...baselines.values()];
  const askedOn = (pick: (visit: AlarmBaseline) => Date | null) =>
    visits.flatMap((visit) => {
      const on = pick(visit);
      return on === null ? [] : [{ vehicleId: visit.vehicleId, on }];
    });
  // How many days each car ran since its last service with nobody writing the counter — counted
  // from each car's own service date. See the DTO field.
  const [unread, exitBounds, entryBounds, standIns] = await Promise.all([
    fleetOdometerRepository.daysWithoutReadingSince(
      vehicles.map((vehicle) => ({
        vehicleId: String(vehicle._id),
        since: baselines.get(String(vehicle._id))?.serviceDate ?? null,
      })),
    ),
    fleetOdometerRepository.lowerBoundsAt(
      askedOn((visit) => (visit.exitCounter === null ? null : visit.serviceDate)),
      { includeDay: false },
    ),
    fleetOdometerRepository.lowerBoundsAt(
      askedOn((visit) => (visit.entryCounter === null ? null : visit.inDate)),
      { includeDay: false },
    ),
    fleetOdometerRepository.lowerBoundsAt(
      askedOn((visit) =>
        visit.exitCounter === null && visit.entryCounter === null ? visit.serviceDate : null,
      ),
    ),
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
    const { result, baseline: used } = measureFromVisit(
      computeAlarm,
      {
        intervalKm: intervals.get(String(vehicle.typeId)) ?? 0,
        yellowKm,
        redKm,
        latestReading: reading?.reading ?? null,
        latestReadingDate: reading?.date ?? null,
      },
      baseline === null
        ? null
        : {
            visitId: baseline.visitId,
            inDate: baseline.inDate,
            outDate: baseline.serviceDate,
            entryCounter: baseline.entryCounter,
            exitCounter: baseline.exitCounter,
            exitBound: exitBounds.get(id) ?? null,
            entryBound: entryBounds.get(id) ?? null,
            standIn: standIns.get(id) ?? null,
          },
    );
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
      daysWithoutReading: unread.get(id) ?? 0,
      // The very reading the arithmetic above measured from — see the DTO.
      latestReading: reading?.reading ?? null,
      latestReadingAt: reading === null ? null : reading.date.toISOString(),
      latestReadingLogId: reading?.logId ?? null,
      baseline: used,
      newerUncountedVisit: newerUncounted(newest.get(id) ?? null, baseline, countingIds),
    };
  });
};
