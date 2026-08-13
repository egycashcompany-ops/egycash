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
// PY-5 adds the leave lines, and they are the first lines here NOBODY ASSIGNED — they come from
// the run's leave snapshot, so they carry no assignment and no catalog row and say so through
// `origin`. One deduction per (leave type, pay rate) of `basic × (100 − payRate)% × days ÷
// daysInPeriod`; leave paid in full produces no line at all. The arithmetic lives in
// `leave-pay.ts`, which is likewise pure.
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
import {
  isChargeable,
  leaveFactsOf,
  shortfallMinor,
  shortfallsOf,
  type FrozenLeave,
  type LeaveShortfall,
} from './leave-pay';

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
   * The APPROVED one-off bonuses and penalties for this month (P-HR-04).
   *
   * A decision, not a rate — so unlike an assignment these are NOT prorated and carry no interval.
   * They arrive already filtered to `approved`: the port is what keeps a proposal out of a total.
   */
  adjustments: readonly AdjustmentInput[];
  /**
   * This month's loan instalments (P-HR-05-B).
   *
   * The engine is told an amount and a sentence, and nothing else: no balance, no schedule, no
   * status, no idea how many months are left. A repayment plan is not a payroll rule — what
   * reaches here is what this month costs, exactly as an approved adjustment does.
   */
  loanInstallments: readonly LoanInstallmentLine[];
  /**
   * The period's frozen attendance, or `null` when it is not frozen (PY-4).
   *
   * Null is "not knowable yet", never "nothing happened": it leaves every quantity line pending,
   * while a frozen period with no rows produces a real zero. The engine stays pure — the reading
   * happens at the port, and the answer arrives here as a value.
   */
  attendance: FrozenAttendance | null;
  /**
   * The period's pinned leave, or `null` when no run has pinned it (PY-5).
   *
   * The same distinction the attendance field makes, for a different reason: without a frozen run
   * the leave ledger has never been cut to this month, so whether any leave happened is not a
   * question this calculation can answer. It says so with a `pendingLeaveSnapshot` line rather
   * than charging a confident nothing.
   */
  leave: FrozenLeave | null;
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
    origin: 'payItem' as const,
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
    // PY-5's fields, empty on every assigned line: a pay item has no pay rate of its own.
    leavePayRate: null,
    leaveTypeCode: null,
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

/** The code every leave line carries. Not a catalog row — no such pay item exists or should. */
const LEAVE_LINE_CODE = 'LEAVE_SHORTFALL';

const LEAVE_LINE_NAME = {
  ar: 'خصم إجازة غير مدفوعة',
  en: 'Unpaid leave shortfall',
};

/**
 * One leave deduction, derived rather than assigned (PY-5).
 *
 * It is shaped as a `percentOfBase` line because that is exactly what it is: a percentage of the
 * basic salary, prorated over the period by the days it applies to. `baseAmount` is the percentage
 * actually CHARGED (`100 − payRate`) while `leavePayRate` keeps the rate the employee was paid, so
 * the subtraction is visible on the line instead of hidden inside it.
 */
const toLeaveLine = (
  shortfall: LeaveShortfall,
  basicMinor: number,
  periodDays: number,
  currency: string,
): CompensationLineDto => {
  const minor = shortfallMinor(shortfall, basicMinor, periodDays);
  return {
    origin: 'leaveSnapshot',
    sourceAssignmentId: null,
    payItemId: null,
    code: LEAVE_LINE_CODE,
    name: LEAVE_LINE_NAME,
    kind: 'deduction',
    calcBasis: 'percentOfBase',
    currency,
    baseAmount: MAX_PERCENT - shortfall.payRate,
    prorationFactor: shortfall.days / periodDays,
    daysInForce: shortfall.days,
    daysInPeriod: periodDays,
    quantity: shortfall.days,
    quantitySource: null,
    quantityUnit: 'days',
    // Null on purpose: `feedFrozenAt` is the ATTENDANCE stamp, and this line never touched
    // attendance. The stamp that matters here is the run's, and it is on `leave.snapshotAt`
    // where one stamp covers every leave line at once.
    feedFrozenAt: null,
    leavePayRate: shortfall.payRate,
    leaveTypeCode: shortfall.typeCode,
    amountMinor: minor,
    amount: fromMinorUnits(minor),
    state: COMPENSATION_LINE_STATES[0],
  };
};

/**
 * The one line that stands in for leave nobody has pinned yet (PY-5).
 *
 * Emitted whenever the period has no frozen run — including for an employee who took no leave at
 * all, because without a run that is not a fact anyone can state. It is deferred, never totalled,
 * and it exists so a compensation figure cannot quietly omit a deduction while looking complete.
 */
const pendingLeaveLine = (periodDays: number, currency: string): CompensationLineDto => ({
  origin: 'leaveSnapshot',
  sourceAssignmentId: null,
  payItemId: null,
  code: LEAVE_LINE_CODE,
  name: LEAVE_LINE_NAME,
  kind: 'deduction',
  calcBasis: 'percentOfBase',
  currency,
  baseAmount: 0,
  prorationFactor: null,
  daysInForce: 0,
  daysInPeriod: periodDays,
  quantity: null,
  quantitySource: null,
  quantityUnit: 'days',
  feedFrozenAt: null,
  leavePayRate: null,
  leaveTypeCode: null,
  amountMinor: null,
  amount: null,
  state: COMPENSATION_LINE_STATES[2],
});

/**
 * The whole calculation.
 *
 * Refuses rather than approximates in three places, each because the alternative is a number that
 * looks right and is not: no basic salary (a percentage of nothing), a pay item in another
 * currency (a total in two currencies), and a percentage outside 0–100 (an input slip).
 */
/** One approved bonus or penalty, as the port hands it over (P-HR-04). */
export interface AdjustmentInput {
  id: string;
  kind: 'bonus' | 'penalty';
  amount: number;
  currency: string;
  reason: string;
  /** D4 — the catalog item lending the line its identity, when one was chosen. */
  payItemId: string | null;
  payItem: { code: string; name: { ar: string; en: string } } | null;
}

const ADJUSTMENT_CODE = { bonus: 'BONUS', penalty: 'PENALTY' } as const;
const ADJUSTMENT_NAME = {
  bonus: { ar: 'منحة', en: 'Bonus' },
  penalty: { ar: 'جزاء', en: 'Penalty' },
} as const;

/**
 * The line a decision produces (P-HR-04).
 *
 * NOT PRORATED, and that is the whole difference from an assigned pay item: `prorationFactor` is
 * null and the amount is exactly what was approved. Somebody decided to pay 5,000 in March; the
 * day of March they decided it on is not a discount.
 *
 * D4 — the identity comes from the chosen catalog item when there is one, and from a fixed code
 * and name plus the reason when there is not. The same shape PY-5's leave line already uses: a
 * money line that belongs to no assignment is not a new idea here.
 */
const toAdjustmentLine = (
  adjustment: AdjustmentInput,
  periodDays: number,
): CompensationLineDto => {
  const minor = toMinorUnits(adjustment.amount);
  return {
    origin: 'adjustment',
    sourceAssignmentId: adjustment.id,
    payItemId: adjustment.payItemId,
    code: adjustment.payItem?.code ?? ADJUSTMENT_CODE[adjustment.kind],
    name: adjustment.payItem?.name ?? ADJUSTMENT_NAME[adjustment.kind],
    kind: adjustment.kind === 'bonus' ? 'earning' : 'deduction',
    calcBasis: 'fixed',
    currency: adjustment.currency,
    baseAmount: adjustment.amount,
    // Null, not 1 — "this was never prorated" and "this was prorated by a factor of one" are
    // different statements, and only the first is true.
    prorationFactor: null,
    daysInForce: periodDays,
    daysInPeriod: periodDays,
    quantity: null,
    quantitySource: null,
    quantityUnit: null,
    feedFrozenAt: null,
    leavePayRate: null,
    leaveTypeCode: null,
    amountMinor: minor,
    amount: fromMinorUnits(minor),
    state: COMPENSATION_LINE_STATES[0],
  };
};

/**
 * One month's instalment of a debt the employee already has in hand (P-HR-05-B).
 *
 * Everything the engine is allowed to know about lending is in these four fields. Adding a fifth —
 * a balance, a count, a status — would make this file the second place a repayment plan lives.
 */
export interface LoanInstallmentLine {
  id: string;
  amountMinor: number;
  currency: string;
  /** What the deduction is FOR, in the words somebody wrote when the money was lent. */
  reference: string;
}

const LOAN_LINE_CODE = 'LOAN_INSTALLMENT';
const LOAN_LINE_NAME = { ar: 'قسط قرض', en: 'Loan instalment' };

/**
 * The line an instalment produces.
 *
 * ALWAYS a deduction, and never prorated: somebody received a sum of money and agreed to give this
 * much of it back this month, and which day of the month the payslip is cut on is not a discount.
 * `prorationFactor` is null for the same reason it is null on an adjustment — "never prorated" and
 * "prorated by a factor of one" are different statements, and only the first is true.
 *
 * `sourceAssignmentId` carries the row this came from, exactly as an adjustment carries its own
 * id: it is what lets the issuing pass tell the loan side which instalment a payslip took.
 */
const toLoanLine = (
  installment: LoanInstallmentLine,
  periodDays: number,
): CompensationLineDto => ({
  origin: 'loanInstallment',
  sourceAssignmentId: installment.id,
  payItemId: null,
  code: LOAN_LINE_CODE,
  name: LOAN_LINE_NAME,
  kind: 'deduction',
  calcBasis: 'fixed',
  currency: installment.currency,
  baseAmount: fromMinorUnits(installment.amountMinor),
  prorationFactor: null,
  daysInForce: periodDays,
  daysInPeriod: periodDays,
  quantity: null,
  quantitySource: null,
  quantityUnit: null,
  feedFrozenAt: null,
  leavePayRate: null,
  leaveTypeCode: null,
  amountMinor: installment.amountMinor,
  amount: fromMinorUnits(installment.amountMinor),
  state: COMPENSATION_LINE_STATES[0],
});

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

  // P-HR-04 — the same single-currency rule, applied to decisions as well as to assignments.
  for (const adjustment of input.adjustments) {
    if (adjustment.currency !== currency) {
      throw new BusinessRuleError(
        `an adjustment is recorded in ${adjustment.currency} but this employee is paid in ${currency} — a single calculation cannot mix currencies`,
      );
    }
  }

  // P-HR-05-B — and to instalments. A debt in another currency cannot be subtracted from this pay.
  for (const installment of input.loanInstallments) {
    if (installment.currency !== currency) {
      throw new BusinessRuleError(
        `an instalment is recorded in ${installment.currency} but this employee is paid in ${currency} — a single calculation cannot mix currencies`,
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

  // PY-5 — leave, after the assigned lines and never mixed into their sort: these lines have no
  // catalog `sortOrder` to be ordered by, so they follow the items in their own stated order
  // (rate descending, then type) at the end of the deductions.
  const leaveFacts = input.leave === null ? null : leaveFactsOf(input.leave);
  let leaveLines = 0;
  if (input.leave === null) {
    deferred.push(pendingLeaveLine(periodDays, currency));
  } else {
    for (const shortfall of shortfallsOf(input.leave)) {
      // Leave paid in full costs nothing, so it produces NO LINE — not a zero one. A row of
      // zeroes on every fully-paid annual leave would bury the ones that cost something.
      if (!isChargeable(shortfall)) continue;
      deductions.push(toLeaveLine(shortfall, basicMinor, periodDays, currency));
      leaveLines += 1;
    }
  }

  // P-HR-04 — decisions last, after both the rates and the leave. They have no catalog sort order
  // and no interval to be ordered by, so they read in the order they were approved: the sequence
  // somebody granted them in is the only order that means anything.
  for (const adjustment of input.adjustments) {
    const line = toAdjustmentLine(adjustment, periodDays);
    if (line.kind === 'earning') earnings.push(line);
    else deductions.push(line);
  }

  // P-HR-05-B — instalments last, after the decisions. They are the only source that is always a
  // deduction, and the only one whose money the employee already has: everything above is what
  // this month EARNED, and this is what it gives back.
  for (const installment of input.loanInstallments) {
    deductions.push(toLoanLine(installment, periodDays));
  }

  // Integer arithmetic: the sum of the lines shown IS the total shown, with no stray piastre.
  const totalEarningsMinor = sumMinorUnits(earnings.map((l) => l.amountMinor ?? 0));
  const totalDeductionsMinor = sumMinorUnits(deductions.map((l) => l.amountMinor ?? 0));
  const netMinor = totalEarningsMinor - totalDeductionsMinor;

  const warnings: CompensationWarning[] = [];
  if (input.hasLegacyAllowances) warnings.push('legacyAllowancesIgnored');
  if (netMinor < 0) warnings.push('netBelowZero'); // D4 — reported, never floored
  // PY-5 / D5 — the same absence charged twice, by two counts that are not even equal. Raised
  // only when BOTH actually produced a line: a `leaveDays` item alongside leave paid in full is
  // no collision at all, because the leave side charged nothing.
  if (
    leaveLines > 0 &&
    [...earnings, ...deductions].some((line) => line.quantitySource === 'leaveDays')
  ) {
    warnings.push('leaveDaysAlsoPriced');
  }

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
    leave: leaveFacts,
    totalEarningsMinor,
    totalEarnings: fromMinorUnits(totalEarningsMinor),
    totalDeductionsMinor,
    totalDeductions: fromMinorUnits(totalDeductionsMinor),
    netMinor,
    net: fromMinorUnits(netMinor),
    warnings,
  };
};
