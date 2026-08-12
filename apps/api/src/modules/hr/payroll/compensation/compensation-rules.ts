// The compensation rules engine (PY-3) — PURE. No database, no clock, no request.
//
// Everything this file needs is passed in, which is why the interesting half of the test suite
// never opens a connection: proration on a 28-day month, a slice that straddles both ends of the
// period, an employee rehired mid-month — all of it is arithmetic over values.
//
// THE FIVE STEPS, IN ORDER, WITHOUT A BRANCH:
//   1. the period's calendar bounds;
//   2. the employment days inside it (the union of the employee's hire→exit spans);
//   3. each assignment's effective slice — assignment ∩ period ∩ employment;
//   4. one priced line per slice, with EXACTLY ONE rounding step at its end;
//   5. a deterministic sort, then integer totals.
//
// PY-4 adds the quantity lines. `perDay` and `perMinute` items are priced from FROZEN attendance
// rows handed in as a value — the engine still reads nothing. Their quantity is counted over the
// same triple intersection, and they carry NO proration factor: the count already is the
// proration, and applying both would charge one absence twice.
//
// WHAT IS NOT HERE, AND WHY. No tax, no contribution, no minimum-pay floor, and no rule about
// which days count as attendance — the pay item names its own quantity source, and the statuses
// nobody has ruled on (`incomplete`, `weekend`, `holiday`, `dayOff`) belong to no group. `net` is
// earnings minus deductions, not take-home pay. Each of those is a rule somebody has to grant
// this system, and none has been granted.
import {
  COMPENSATION_LINE_STATES,
  fromMinorUnits,
  scaleMinorUnits,
  sumMinorUnits,
  toMinorUnits,
  type CompensationEffectsDto,
  type CompensationLineDto,
  type CompensationWarning,
  type PayItemCalcBasis,
  type PayItemKind,
  type PayItemQuantitySource,
} from '@ecms/contracts';
import { BusinessRuleError } from '../../../../shared/errors';
import { calendarDaysInclusive, dateOnlyIso, toDateOnly } from '../../shared/business-date';
import { quantityFor, unitOf, type FrozenAttendance } from './attendance-quantities';

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The period's calendar bounds, as date-only UTC midnights.
 *
 * Payroll owns this rather than importing Attendance's copy: which days a month has is a fact
 * about the calendar, not about attendance, and a payroll that could not name its own period
 * without reaching into another feature would have the dependency backwards.
 */
export const periodRange = (period: string): { from: Date; to: Date } => {
  if (!PERIOD_PATTERN.test(period)) {
    throw new BusinessRuleError(`not a period: ${period} (expected YYYY-MM)`);
  }
  const [year, month] = period.split('-').map(Number) as [number, number];
  return {
    from: new Date(Date.UTC(year, month - 1, 1)),
    // Day 0 of the NEXT month is the last day of this one — 28, 29, 30 or 31, correctly.
    to: new Date(Date.UTC(year, month, 0)),
  };
};

/** A closed interval; `to: null` means "does not end". */
export interface DateSpan {
  from: Date;
  to: Date | null;
}

/** One assignment as the engine reads it — PY-2's row plus the catalog item it cites. */
export interface AssignmentInput {
  id: string;
  payItemId: string;
  amount: number;
  currency: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  item: {
    code: string;
    name: { ar: string; en: string };
    kind: PayItemKind;
    calcBasis: PayItemCalcBasis;
    /** PY-4: which attendance quantity a `perDay`/`perMinute` item multiplies. */
    quantitySource: PayItemQuantitySource | null;
    sortOrder: number;
  };
}

export interface CompensationInput {
  employeeId: string;
  period: string;
  /** `employment.salary` — nullable in the model, and its absence is refused, never zeroed. */
  basicSalary: { amount: number; currency: string } | null;
  /** `employmentPeriods[]`: hire→exit spans, plural because a rehire opens a new one. */
  employmentSpans: readonly DateSpan[];
  assignments: readonly AssignmentInput[];
  /** Whether the employee still carries the older `employment.allowances[]` list (D1). */
  hasLegacyAllowances: boolean;
  /**
   * The period's frozen attendance, or `null` when it is not frozen (PY-4).
   *
   * Null is "not knowable yet", never "nothing happened": it leaves every quantity line pending,
   * while a frozen period with no rows produces a real zero. The engine stays pure — the reading
   * happens at the port, and the answer arrives here as a value.
   */
  attendance: FrozenAttendance | null;
}

/**
 * Inclusive intersection of a span with a BOUNDED window; null when they do not meet.
 *
 * The window is always bounded — it is a calendar month, or a slice already cut down to one — so
 * an open-ended span (`to: null`) simply runs to the window's end. Taking the bounded side as a
 * separate parameter keeps this total: there is no "both sides open" case to answer wrongly.
 */
const intersect = (span: DateSpan, window: { from: Date; to: Date }): { from: Date; to: Date } | null => {
  const from = span.from.getTime() > window.from.getTime() ? span.from : window.from;
  const to = span.to === null || span.to.getTime() > window.to.getTime() ? window.to : span.to;
  return from.getTime() > to.getTime() ? null : { from, to };
};

/**
 * Calendar days of `window` covered by the union of `spans`, counting both endpoints.
 *
 * The spans are the employee's employment periods, which never overlap, so summing each
 * intersection is the union — no de-duplication needed. Gaps between them are simply not counted,
 * which is what makes a rehire mid-month come out right.
 */
export const daysWithin = (window: { from: Date; to: Date }, spans: readonly DateSpan[]): number => {
  let days = 0;
  for (const span of spans) {
    const overlap = intersect(span, window);
    if (overlap !== null) days += calendarDaysInclusive(overlap.from, overlap.to);
  }
  return days;
};

/**
 * The slice an assignment is actually in force for: assignment ∩ period ∩ employment.
 *
 * The employment leg is D2's clipping — an open-ended assignment on someone who left in the
 * middle of the month stops at their last day, and NOTHING is written to say so. A calculation
 * that edited the history it reads would be a different kind of program.
 */
export const daysInForce = (
  assignment: Pick<AssignmentInput, 'effectiveFrom' | 'effectiveTo'>,
  window: { from: Date; to: Date },
  spans: readonly DateSpan[],
): number => {
  const inPeriod = intersect(
    { from: toDateOnly(assignment.effectiveFrom), to: assignment.effectiveTo === null ? null : toDateOnly(assignment.effectiveTo) },
    window,
  );
  if (inPeriod === null) return 0;
  return daysWithin(inPeriod, spans);
};

/** Total order over lines: earnings before deductions, then the catalog's order, then the code. */
const KIND_RANK: Record<PayItemKind, number> = { earning: 0, deduction: 1 };
const byPresentation = (a: AssignmentInput, b: AssignmentInput): number =>
  KIND_RANK[a.item.kind] - KIND_RANK[b.item.kind] ||
  a.item.sortOrder - b.item.sortOrder ||
  a.item.code.localeCompare(b.item.code);

/** `percentOfBase` is a human percentage — `10` is ten per cent. D6 caps it at a whole base. */
const MAX_PERCENT = 100;

/**
 * One line's minor units, with EXACTLY ONE rounding step.
 *
 * For `percentOfBase` the percentage and the proration are multiplied into a single factor rather
 * than applied one after the other: two rounding steps on the same line would lose a piastre that
 * nothing in the totals could ever put back.
 */
const priceLine = (
  assignment: AssignmentInput,
  factor: number,
  basicMinor: number | null,
): number => {
  if (assignment.item.calcBasis === 'fixed') {
    return scaleMinorUnits(toMinorUnits(assignment.amount), factor);
  }
  // percentOfBase — the base is the BASIC SALARY only: no allowance, no other item, no compounding.
  if (basicMinor === null) {
    throw new BusinessRuleError(
      `${assignment.item.code} is a percentage of the basic salary, and this employee has none recorded`,
    );
  }
  if (assignment.amount <= 0 || assignment.amount > MAX_PERCENT) {
    throw new BusinessRuleError(
      `${assignment.item.code} is ${String(assignment.amount)}% of the basic salary — a percentage must be greater than 0 and at most ${String(MAX_PERCENT)}`,
    );
  }
  return scaleMinorUnits(basicMinor, (assignment.amount / MAX_PERCENT) * factor);
};

const toLine = (
  assignment: AssignmentInput,
  slice: { from: Date; to: Date },
  forceDays: number,
  periodDays: number,
  basicMinor: number | null,
  spans: readonly DateSpan[],
  attendance: FrozenAttendance | null,
): CompensationLineDto => {
  const shared = {
    sourceAssignmentId: assignment.id,
    payItemId: assignment.payItemId,
    code: assignment.item.code,
    name: assignment.item.name,
    kind: assignment.item.kind,
    calcBasis: assignment.item.calcBasis,
    currency: assignment.currency,
    baseAmount: assignment.amount,
    daysInForce: forceDays,
    daysInPeriod: periodDays,
  };
  const flat = {
    ...shared,
    quantity: null,
    quantitySource: null,
    quantityUnit: null,
    feedFrozenAt: null,
  };

  if (assignment.item.calcBasis === 'perDay' || assignment.item.calcBasis === 'perMinute') {
    const source = assignment.item.quantitySource;
    // The catalog guarantees a source for these two bases; an item that lost it cannot be priced,
    // and guessing one would be inventing what the organization meant.
    if (source === null || attendance === null) {
      // PY-4 / D2 — unknown, not zero. The line is SHOWN (hiding an assigned item explains
      // nothing) and excluded from every total (a total containing a guess is worse than none).
      return { ...flat, prorationFactor: null, amountMinor: null, amount: null, state: COMPENSATION_LINE_STATES[1] };
    }

    const quantity = quantityFor(attendance.rows, source, slice, spans);
    // NO proration factor, deliberately: the quantity was counted over the slice already, so
    // multiplying by daysInForce/daysInPeriod would charge the same absence a second time.
    const minor = scaleMinorUnits(toMinorUnits(assignment.amount), quantity);
    return {
      ...shared,
      prorationFactor: null,
      quantity,
      quantitySource: source,
      quantityUnit: unitOf(source),
      feedFrozenAt: attendance.frozenAt,
      amountMinor: minor,
      amount: fromMinorUnits(minor),
      state: COMPENSATION_LINE_STATES[0],
    };
  }

  const factor = forceDays / periodDays;
  const minor = priceLine(assignment, factor, basicMinor);
  return {
    ...flat,
    prorationFactor: factor,
    amountMinor: minor,
    amount: fromMinorUnits(minor),
    state: COMPENSATION_LINE_STATES[0],
  };
};

/**
 * The whole calculation.
 *
 * Refuses rather than approximates in three places, each because the alternative is a number that
 * looks right and is not: no basic salary (a percentage of nothing), a pay item in another
 * currency (a total in two currencies), and a percentage outside 0–100 (an input slip).
 */
export const computeCompensation = (input: CompensationInput): CompensationEffectsDto => {
  const window = periodRange(input.period);
  const periodDays = calendarDaysInclusive(window.from, window.to);

  if (input.basicSalary === null) {
    throw new BusinessRuleError(
      'this employee has no basic salary recorded, so no compensation can be computed',
    );
  }
  const currency = input.basicSalary.currency;
  const basicMinor = toMinorUnits(input.basicSalary.amount);

  // One currency per calculation, refused whole rather than per line: a total quietly missing an
  // item because it was priced in another currency is worse than no total.
  for (const assignment of input.assignments) {
    if (assignment.currency !== currency) {
      throw new BusinessRuleError(
        `${assignment.item.code} is assigned in ${assignment.currency} but this employee is paid in ${currency} — a single calculation cannot mix currencies`,
      );
    }
  }

  const spans = input.employmentSpans.map((span) => ({
    from: toDateOnly(span.from),
    to: span.to === null ? null : toDateOnly(span.to),
  }));
  const employmentDays = daysWithin(window, spans);

  const earnings: CompensationLineDto[] = [];
  const deductions: CompensationLineDto[] = [];
  const deferred: CompensationLineDto[] = [];

  for (const assignment of [...input.assignments].sort(byPresentation)) {
    const forceDays = daysInForce(assignment, window, spans);
    if (forceDays === 0) continue; // not in force this period — no line at all, not a zero line
    // The slice a quantity is counted over: the assignment's own interval clipped to the period.
    // The employment leg is applied inside the count, span by span, so a rehire's gap drops out.
    const slice = intersect(
      {
        from: toDateOnly(assignment.effectiveFrom),
        to: assignment.effectiveTo === null ? null : toDateOnly(assignment.effectiveTo),
      },
      window,
    ) as { from: Date; to: Date };
    const line = toLine(assignment, slice, forceDays, periodDays, basicMinor, spans, input.attendance);
    if (line.state === 'pendingQuantity') deferred.push(line);
    else if (line.kind === 'earning') earnings.push(line);
    else deductions.push(line);
  }

  // Integer arithmetic: the sum of the lines shown IS the total shown, with no stray piastre.
  const totalEarningsMinor = sumMinorUnits(earnings.map((l) => l.amountMinor ?? 0));
  const totalDeductionsMinor = sumMinorUnits(deductions.map((l) => l.amountMinor ?? 0));
  const netMinor = totalEarningsMinor - totalDeductionsMinor;

  const warnings: CompensationWarning[] = [];
  if (input.hasLegacyAllowances) warnings.push('legacyAllowancesIgnored');
  if (netMinor < 0) warnings.push('netBelowZero'); // D4 — reported, never floored

  return {
    employeeId: input.employeeId,
    period: input.period,
    from: dateOnlyIso(window.from),
    to: dateOnlyIso(window.to),
    currency,
    basicSalary: input.basicSalary.amount,
    employmentDaysInPeriod: employmentDays,
    daysInPeriod: periodDays,
    earnings,
    deductions,
    deferred,
    totalEarningsMinor,
    totalEarnings: fromMinorUnits(totalEarningsMinor),
    totalDeductionsMinor,
    totalDeductions: fromMinorUnits(totalDeductionsMinor),
    netMinor,
    net: fromMinorUnits(netMinor),
    warnings,
  };
};
