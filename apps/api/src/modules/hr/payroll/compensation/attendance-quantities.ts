// Turning frozen attendance rows into the quantities a pay item multiplies (PY-4). PURE.
//
// This file knows the SHAPE of a feed row and nothing else about attendance: no model, no query,
// no service. It is handed rows and hands back counts, which is why every calendar case below —
// a rehire mid-month, a row from before the hire date, a slice that covers half the month — is
// tested without a database.
//
// TWO RULES CARRY THE WEIGHT:
//
//   1. a row counts only inside the TRIPLE intersection the rest of PY-3 already uses —
//      assignment ∩ period ∩ employment. The feed knows nothing about employment, so it will
//      happily hand over a day before the hire and a day after the exit; both are dropped here.
//   2. the count IS the proration. Having counted only the days that qualify, multiplying by
//      `daysInForce / daysInPeriod` afterwards would charge the same absence twice — so a
//      quantity line carries no proration factor at all (see `compensation-rules.ts`).
import {
  QUANTITY_SOURCE_UNITS,
  type AttendanceFeedRow,
  type PayItemQuantitySource,
} from '@ecms/contracts';
import { toDateOnly } from '../../shared/business-date';
import { type DateSpan } from './compensation-rules';

/**
 * The statuses that mean "came to work", by name.
 *
 * `incomplete` is deliberately absent: a day whose checkout never arrived is neither attendance
 * nor absence, and deciding which it is would be a labour rule. So are `weekend`, `holiday` and
 * `dayOff` — a worked holiday counting twice is a rule nobody has granted this system either.
 */
const ATTENDED_STATUSES = ['present', 'late', 'earlyLeave', 'lateAndEarly'] as const;

/** How each source reads ONE row: a day contributes 1, a minute field contributes its value. */
const CONTRIBUTION: Record<PayItemQuantitySource, (row: AttendanceFeedRow) => number> = {
  attendedDays: (row) => ((ATTENDED_STATUSES as readonly string[]).includes(row.status) ? 1 : 0),
  absentDays: (row) => (row.status === 'absent' ? 1 : 0),
  leaveDays: (row) => (row.status === 'onLeave' ? 1 : 0),
  workedMinutes: (row) => row.workedMinutes,
  lateMinutes: (row) => row.lateMinutes,
  earlyLeaveMinutes: (row) => row.earlyLeaveMinutes,
  approvedOvertimeMinutes: (row) => row.approvedOvertimeMinutes,
};

/** A window a row must fall inside to count. Both ends inclusive, `to: null` = no upper bound. */
export interface QuantityWindow {
  from: Date;
  to: Date | null;
}

const covers = (window: QuantityWindow, day: Date): boolean =>
  window.from.getTime() <= day.getTime() &&
  (window.to === null || window.to.getTime() >= day.getTime());

/** Inside at least one of the employee's employment spans — a rehire's gap is not inside any. */
const employed = (spans: readonly DateSpan[], day: Date): boolean =>
  spans.some((span) => covers(span, day));

/**
 * The quantity for one source over the rows that qualify.
 *
 * Every minute field on a feed row is a non-negative integer by contract, and a day contributes
 * either 0 or 1, so the result can never be negative. The assertion is here anyway: this is the
 * only place a number crosses from another module into a figure someone is paid, and a guard that
 * costs one comparison is cheaper than trusting a schema at a distance.
 */
export const quantityFor = (
  rows: readonly AttendanceFeedRow[],
  source: PayItemQuantitySource,
  inForce: QuantityWindow,
  employmentSpans: readonly DateSpan[],
): number => {
  const contribute = CONTRIBUTION[source];
  let total = 0;
  for (const row of rows) {
    const day = toDateOnly(new Date(`${row.workDate}T00:00:00.000Z`));
    if (!covers(inForce, day)) continue;
    if (!employed(employmentSpans, day)) continue;
    const value = contribute(row);
    if (value < 0) {
      throw new RangeError(`attendance quantity ${source} is negative on ${row.workDate}`);
    }
    total += value;
  }
  return total;
};

/** `days` or `minutes` — restated here so a caller need not import the whole table. */
export const unitOf = (source: PayItemQuantitySource): 'days' | 'minutes' =>
  QUANTITY_SOURCE_UNITS[source];

/**
 * One period's frozen rows for one employee, or the fact that the period is not frozen.
 *
 * `null` is not "no rows" — it is "not knowable yet", and the two produce entirely different
 * lines: an unknown quantity leaves its line `pendingQuantity`, while an empty period of frozen
 * rows produces a real, computed zero.
 */
export interface FrozenAttendance {
  rows: readonly AttendanceFeedRow[];
  /** The freeze stamp the rows carry — the version of the truth being priced. */
  frozenAt: string | null;
}
