// The maintenance alarm (fleet design §4.4, FR-3; owner FL-4 points 2/3): DERIVED, never
// stored, computed in the backend only. `computeAlarm` is the pure half — the exact arithmetic
// the legacy ran in `cars_log.ejs:664-687`, with its two guards preserved — so the decision is
// unit-tested without a database. The service half only gathers inputs.
import {
  FleetSettingKeys,
  odometerBracketBreach,
  type FleetAlarmLevel,
  type FleetAlarmNamedDto,
  type FleetAlarmUncountedVisitDto,
  type FleetAlarmUncountedWhy,
  type FleetMaintenanceAlarmDto,
  type FleetNoAlarmReason,
  type LocalizedString,
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
import { measureFromVisit, type VisitCounters } from './measure-from-visit';

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

/** Every ACTIVE live car — id, code and make — in one read (see `activeForAlarm`). */
const allActiveVehicles = () => fleetVehicleRepository.activeForAlarm();

/** A catalog entry or a make by id, as the card names it — `null` when it is not there at all. */
type Names = ReadonlyMap<string, LocalizedString>;

const named = (names: Names, id: string | null | undefined): FleetAlarmNamedDto | null => {
  const name = id == null ? undefined : names.get(id);
  return name === undefined ? null : { id: id as string, name: { ar: name.ar, en: name.en } };
};

/**
 * Every live make's interval and name, in ONE read — the makes are a handful, and asking for each
 * by id cost a round trip per make, one after another, on every projection. Live only, as the
 * per-id `findById` answered: a deleted make has no interval (`noInterval`) and no name.
 */
const makeRules = async (): Promise<{ intervals: Map<string, number>; makes: Names }> => {
  const types = await fleetVehicleTypeRepository.listAll();
  return {
    intervals: new Map(types.map((type) => [String(type._id), type.maintenanceIntervalKm ?? 0])),
    makes: new Map(types.map((type) => [String(type._id), type.name])),
  };
};

/**
 * The car's newest visit, when the alarm does not measure from it — so a screen can say why the
 * visit a reader expects is not the one used:
 *   • `open` — still in the workshop; the cycle resets when the car comes back;
 *   • `notCounting` — closed, but its work type does not count for the alarm;
 *   • `checkedOutEarlier` (C8) — closed AND counting, yet not the baseline. The baseline is the
 *     latest CHECK-OUT, the newest visit the latest CHECK-IN, so another counting visit was checked
 *     out after this one (or on the same day and recorded after it) and the cycle is measured from
 *     that one. Nothing used to say so: a visit entered late and closed late silently beat a
 *     newer one.
 * `null` when the newest visit IS the baseline, or when there is no visit at all.
 */
const newerUncounted = (
  newest: NewestVisit | null,
  baseline: AlarmBaseline | null,
  countingIds: readonly string[],
  names: Names,
): FleetAlarmUncountedVisitDto | null => {
  if (newest === null || newest.visitId === baseline?.visitId) return null;
  const why: FleetAlarmUncountedWhy | null =
    newest.outDate === null
      ? 'open'
      : !countingIds.includes(newest.workTypeId)
        ? 'notCounting'
        : // A closed counting visit always leaves a baseline; `null` only if the two reads disagree.
          baseline === null
          ? null
          : 'checkedOutEarlier';
  if (why === null) return null;
  return {
    visitId: newest.visitId,
    inDate: newest.inDate.toISOString(),
    outDate: newest.outDate === null ? null : newest.outDate.toISOString(),
    why,
    workType: named(names, newest.workTypeId),
    workshop: named(names, newest.workshopId),
    // Said for every reason, so an OPEN visit's card can tell «counts once closed» from «never».
    counts: countingIds.includes(newest.workTypeId),
  };
};

/**
 * The names of the work types and workshops the card mentions — ONE catalog read by id for the
 * whole fleet. Archived and retired entries included: the name of the work a visit recorded is
 * history, and it still names that visit. An id with no catalog entry at all stays unnamed.
 */
const catalogNames = async (ids: readonly string[]): Promise<Names> => {
  const items = await fleetCatalogItemRepository.findByIdsSystem([...new Set(ids)]);
  return new Map(items.map((item) => [String(item._id), item.name]));
};

/** A counting visit as the chain is asked about it — the alarm's baseline, or a row's (D1). */
export interface VisitToJudge {
  vehicleId: string;
  visitId: string;
  inDate: Date;
  /** The check-out day — the day the cycle starts on. */
  outDate: Date;
  entryCounter: number | null;
  exitCounter: number | null;
}

/** The chain points a visit's numbers are judged against — `measureFromVisit`'s three bounds. */
export type VisitBounds = Pick<VisitCounters, 'exitBound' | 'entryBound' | 'standIn'>;

export const NO_BOUNDS: VisitBounds = { exitBound: null, entryBound: null, standIn: null };

const toJudge = (baseline: AlarmBaseline): VisitToJudge => ({
  vehicleId: baseline.vehicleId,
  visitId: baseline.visitId,
  inDate: baseline.inDate,
  outDate: baseline.serviceDate,
  entryCounter: baseline.entryCounter,
  exitCounter: baseline.exitCounter,
});

/**
 * Each visit's counters against the chain AS IT STOOD BEFORE THE DAY THEY WERE TAKEN — one query
 * per kind of counter for the whole set, not one per car. AT MOST ONE VISIT PER CAR per call: the
 * repository answers by car. Keyed by visit.
 *
 * An entry counter is judged on the day the car went IN: it was read then, and readings taken
 * between check-in and check-out do not make it untrue — asked on the check-out day, car 219's
 * 84,080 of 25 June was refused because the chain had reached 84,189 by the 28th. And only the
 * days BEFORE count (R4): the register keeps no time of day, so a reading dated on the service day
 * may have been taken after the counter — car 295's 22,790 was refused by a reading of its own day.
 * An exit counter is asked about even when an entry counter exists too, because the entry one is
 * what R3 falls back to.
 *
 * A visit with no counter keeps the day: its stand-in is the reading the car LEFT on.
 *
 * Shared by the alarm and the per-row gap (`odometer/service-gap.ts`), so a row's figure and the
 * car's are judged by one rule.
 */
export const visitBounds = async (
  visits: readonly VisitToJudge[],
): Promise<Map<string, VisitBounds>> => {
  const askedOn = (pick: (visit: VisitToJudge) => Date | null) =>
    visits.flatMap((visit) => {
      const on = pick(visit);
      return on === null ? [] : [{ vehicleId: visit.vehicleId, on }];
    });
  const [exitBounds, entryBounds, standIns] = await Promise.all([
    fleetOdometerRepository.lowerBoundsAt(
      askedOn((visit) => (visit.exitCounter === null ? null : visit.outDate)),
      { includeDay: false },
    ),
    fleetOdometerRepository.lowerBoundsAt(
      askedOn((visit) => (visit.entryCounter === null ? null : visit.inDate)),
      { includeDay: false },
    ),
    fleetOdometerRepository.lowerBoundsAt(
      askedOn((visit) =>
        visit.exitCounter === null && visit.entryCounter === null ? visit.outDate : null,
      ),
    ),
  ]);
  return new Map(
    visits.map((visit) => [
      visit.visitId,
      {
        exitBound: exitBounds.get(visit.vehicleId) ?? null,
        entryBound: entryBounds.get(visit.vehicleId) ?? null,
        standIn: standIns.get(visit.vehicleId) ?? null,
      },
    ]),
  );
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
  // THREE ROUND TRIPS, each a few reads at once: those that need nothing, those that need the cars,
  // those that need the cars' baselines. It was a dozen or more in a row — the cars a page at a
  // time, then the settings, the counting work types, and the makes one after another. A fleet
  // with no active car now pays for four small reads it did not need; every other fleet stops
  // waiting for each of them in turn.
  const [vehicles, yellowKm, redKm, countingIds, { intervals, makes }] = await Promise.all([
    allActiveVehicles(),
    settingsService.resolve<number>(FleetSettingKeys.AlarmYellowKm, {
      userId: null,
      branchId: null,
    }),
    settingsService.resolve<number>(FleetSettingKeys.AlarmRedKm, { userId: null, branchId: null }),
    // Archived types included, and no page limit — see `countingWorkTypeIds`. A baseline is a
    // historical fact, and retiring the vocabulary that named it does not un-make it.
    fleetCatalogItemRepository.countingWorkTypeIds(),
    // Its interval, and its name for the card. A make that is gone (deleted) has neither — no
    // rule, `noInterval` — and the card says so.
    makeRules(),
  ]);
  if (vehicles.length === 0) return [];

  const ids = vehicles.map((v) => String(v._id));
  const [readings, baselines, newest] = await Promise.all([
    fleetOdometerRepository.latestReadings(ids),
    fleetMaintenanceRepository.alarmBaselines(ids, countingIds),
    fleetMaintenanceRepository.newestVisits(ids),
  ]);

  // How many days each car ran since its last service with nobody writing the counter — counted
  // from each car's own service date (see the DTO field) — and each baseline's chain points.
  // And the names the card mentions — the counted visits' work types, the newer visits' work types
  // and workshops — in one catalog read.
  const [unread, bounds, names] = await Promise.all([
    fleetOdometerRepository.daysWithoutReadingSince(
      vehicles.map((vehicle) => ({
        vehicleId: String(vehicle._id),
        since: baselines.get(String(vehicle._id))?.serviceDate ?? null,
      })),
    ),
    visitBounds([...baselines.values()].map(toJudge)),
    catalogNames([
      ...[...baselines.values()].map((visit) => visit.workTypeId),
      ...[...newest.values()].flatMap((visit) => [visit.workTypeId, visit.workshopId]),
    ]),
  ]);

  return vehicles.map((vehicle) => {
    const id = String(vehicle._id);
    const reading = readings.get(id) ?? null;
    const baseline = baselines.get(id) ?? null;
    const intervalKm = intervals.get(String(vehicle.typeId)) ?? 0;
    const { result, baseline: used } = measureFromVisit(
      computeAlarm,
      {
        intervalKm,
        yellowKm,
        redKm,
        latestReading: reading?.reading ?? null,
        latestReadingDate: reading?.date ?? null,
      },
      baseline === null
        ? null
        : { ...toJudge(baseline), ...(bounds.get(baseline.visitId) ?? NO_BOUNDS) },
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
      // The counted visit, named by its work type — «آخر زيارة خرجت: صيانة».
      baseline: used === null ? null : { ...used, workType: named(names, baseline?.workTypeId) },
      newerUncountedVisit: newerUncounted(newest.get(id) ?? null, baseline, countingIds, names),
      // What the figure was judged by, as THIS answer resolved it — see the DTO.
      rule: {
        vehicleType: named(makes, String(vehicle.typeId)),
        intervalKm,
        yellowKm,
        redKm,
      },
      // C6 — the newest-dated reading beside the highest; equal on a healthy chain.
      newestReading:
        reading === null
          ? null
          : { reading: reading.newest.reading, date: reading.newest.date.toISOString() },
    };
  });
};
