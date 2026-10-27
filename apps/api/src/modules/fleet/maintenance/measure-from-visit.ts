// Which number of the baseline visit the alarm measures from — and the facts that say so.
//
// `computeAlarm` is the rule and stays the only one. This is the step before it: a counting visit
// can hold two counters, «العداد عند الصيانة» (entry) and «عداد الخروج من الصيانة» (exit), or
// neither, and something has to choose which number the rule is asked about. Pure, so the choice is
// tested without a database; `computeAlarms` gathers its inputs.
//
// THE CHOICE. The exit counter first — the honest zero of a new cycle is the reading the car drove
// away on — then the entry counter, then, for a visit that wrote neither, the reading the chain held
// on its check-out day standing in for one.
//
// R3 — WHEN THE EXIT COUNTER IS CONTRADICTED. A reading can show the exit counter is not a point on
// this car's chain: below a reading the chain already held (a late closure whose readings in between
// were typed in afterwards, or a typo too low), or above the car's latest reading (a typo too high).
// If the entry counter, judged on its own day by the same rule, stands, the cycle is measured from it
// instead, and the exit counter is reported as set aside together with the reading that contradicts
// it. The error this can make is at most the distance driven between check-in and check-out,
// counted as distance since the service — so the alarm fires early, never late. It never replaces a
// counter with a chain reading: the workshop's own entry counter is still a workshop counter.
import type { FleetAlarmBaselineDto, FleetAlarmChainPointDto } from '@ecms/contracts';
import type { ChainBound } from '../odometer/odometer.repository';
// Types only: `computeAlarms` lives beside `computeAlarm` and imports this file, so importing the
// rule as a value here would close an import cycle. The rule is handed in instead (`AlarmRule`).
import type { AlarmInput, AlarmResult } from './maintenance-alarm';

/** `computeAlarm` itself — handed in, see the import above. */
export type AlarmRule = (input: AlarmInput) => AlarmResult;

/** What is the same whichever counter is measured from: the car's rule, thresholds and latest reading. */
export type AlarmCommon = Pick<
  AlarmInput,
  'intervalKm' | 'yellowKm' | 'redKm' | 'latestReading' | 'latestReadingDate'
>;

/** The baseline visit, with the chain points each of its numbers is judged against. */
export interface VisitCounters {
  visitId: string;
  inDate: Date;
  /** The check-out day — the day the new cycle starts on, whichever counter is used. */
  outDate: Date;
  entryCounter: number | null;
  exitCounter: number | null;
  /** The highest reading dated BEFORE the check-out day — what an exit counter is judged against. */
  exitBound: ChainBound | null;
  /** The highest reading dated BEFORE the check-in day — what an entry counter is judged against. */
  entryBound: ChainBound | null;
  /** The highest reading dated ON OR BEFORE the check-out day — the stand-in for a visit with no counter. */
  standIn: ChainBound | null;
}

export interface Measured {
  result: AlarmResult;
  /** `null` exactly when there is no baseline visit. */
  baseline: FleetAlarmBaselineDto | null;
}

const point = (bound: ChainBound | null): FleetAlarmChainPointDto | null =>
  bound === null ? null : { reading: bound.reading, date: bound.date.toISOString() };

/** The two refusals that say a counter is not on the chain — the only ones R3 answers. */
const contradiction = (result: AlarmResult): 'belowChain' | 'aboveReading' | null =>
  result.noAlarmReason === 'baselineBelowChain'
    ? 'belowChain'
    : result.noAlarmReason === 'baselineAboveReading'
      ? 'aboveReading'
      : null;

export const measureFromVisit = (
  rule: AlarmRule,
  common: AlarmCommon,
  visit: VisitCounters | null,
): Measured => {
  if (visit === null) {
    const result = rule({
      ...common,
      baselineCounter: null,
      baselineDate: null,
      baselineLowerBound: null,
    });
    return { result, baseline: null };
  }

  // Whichever counter is used, the cycle starts when the car came OUT: only the day the counter is
  // judged on moves with it.
  const measure = (counter: number | null, bound: ChainBound | null): AlarmResult =>
    rule({
      ...common,
      baselineCounter: counter,
      baselineDate: visit.outDate,
      baselineLowerBound: bound?.reading ?? null,
    });
  const facts = (
    source: FleetAlarmBaselineDto['source'],
    counter: number | null,
    counterDate: Date,
    judgedAgainst: ChainBound | null,
    exitSetAside: FleetAlarmBaselineDto['exitSetAside'] = null,
  ): FleetAlarmBaselineDto => ({
    visitId: visit.visitId,
    inDate: visit.inDate.toISOString(),
    outDate: visit.outDate.toISOString(),
    entryCounter: visit.entryCounter,
    exitCounter: visit.exitCounter,
    source,
    counter,
    counterDate: counterDate.toISOString(),
    judgedAgainst: point(judgedAgainst),
    exitSetAside,
  });

  if (visit.exitCounter !== null) {
    const exit = measure(visit.exitCounter, visit.exitBound);
    const because = contradiction(exit);
    if (because !== null && visit.entryCounter !== null) {
      // The reading that contradicts the exit counter: the chain point it sits below, or the latest
      // reading it sits above. Both exist whenever the rule gave that refusal.
      const conflict =
        because === 'belowChain'
          ? point(visit.exitBound)
          : common.latestReading === null || common.latestReadingDate === null
            ? null
            : {
                reading: common.latestReading,
                date: common.latestReadingDate.toISOString(),
              };
      const entry = measure(visit.entryCounter, visit.entryBound);
      if (conflict !== null && contradiction(entry) === null) {
        return {
          result: entry,
          baseline: facts('entry', visit.entryCounter, visit.inDate, visit.entryBound, {
            because,
            conflict,
          }),
        };
      }
    }
    return {
      result: exit,
      baseline: facts('exit', visit.exitCounter, visit.outDate, visit.exitBound),
    };
  }

  if (visit.entryCounter !== null) {
    return {
      result: measure(visit.entryCounter, visit.entryBound),
      baseline: facts('entry', visit.entryCounter, visit.inDate, visit.entryBound),
    };
  }

  // No counter at all: the reading the car stood at on its check-out day stands in for one. It is
  // its own lower bound — it IS the chain — so nothing judged it, and `judgedAgainst` stays empty
  // rather than repeating the stand-in.
  const standIn = visit.standIn?.reading ?? null;
  return {
    result: measure(standIn, visit.standIn),
    baseline: facts('reading', standIn, visit.outDate, null),
  };
};
