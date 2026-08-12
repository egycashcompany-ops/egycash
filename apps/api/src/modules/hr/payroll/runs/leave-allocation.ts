// Cutting a leave consumption down to one payroll period (PY-6). PURE.
//
// THE PROBLEM. A `consume` ledger entry is split by YEAR and never by month, so a request running
// from 28 March to 6 April is ONE entry: ten days, `effectiveFrom` 2026-03-28, `effectiveTo`
// 2026-04-06, and a `paidBreakdown` like `[{7, 100}, {3, 50}]` that carries NO dates. Payroll is
// paid by the month. Which of those seven fully-paid days fell in March is not recorded anywhere.
//
// THE ANSWER, AND ITS TWO CASES:
//
//   • `whole` — the entry lies entirely inside the period. Its breakdown is copied verbatim and
//     no judgement is exercised at all. This is the majority of real entries.
//   • `chronological` — the entry straddles the boundary, so the tiers are laid over the days in
//     DATE ORDER. That is not an invention: `paidBreakdownFor` walks the type's tiers from the
//     year's running consumption, so the tier list already means "the first days consumed, at the
//     first rate" — and the days of one request are consecutive. Laying the order of the tiers
//     over the order of the days is reading that meaning, not adding to it.
//
// Every row records which case applied, so the inference never disappears into a figure.
import {
  type LeavePaidBreakdown,
  type PayrollLeaveAllocation,
} from '@ecms/contracts';
import { calendarDaysInclusive, toDateOnly } from '../../shared/business-date';

/** A consumption as the ledger holds it: a dated span, a day count, and an undated split. */
export interface ConsumedLeave {
  from: Date;
  to: Date;
  /** Days consumed, in half-day steps — NOT necessarily the calendar length of the span. */
  days: number;
  breakdown: readonly LeavePaidBreakdown[];
}

export interface LeaveSlice {
  from: Date;
  to: Date;
  days: number;
  breakdown: LeavePaidBreakdown[];
  allocation: PayrollLeaveAllocation;
}

/** Inclusive intersection with a bounded window; null when they do not meet. */
const intersect = (
  span: { from: Date; to: Date },
  window: { from: Date; to: Date },
): { from: Date; to: Date } | null => {
  const from = span.from.getTime() > window.from.getTime() ? span.from : window.from;
  const to = span.to.getTime() < window.to.getTime() ? span.to : window.to;
  return from.getTime() > to.getTime() ? null : { from, to };
};

/**
 * Days of the consumption that fall before `boundary`, and how many fall inside the slice.
 *
 * Half-days are the wrinkle: `days` need not equal the calendar length, because a request may
 * start or end at midday. The rule (D2) is that a half day is carried on its OWN calendar day at
 * half a day — never rounded — so the consumption's days are spread over its calendar days in
 * proportion, and the slice takes its share. That keeps the slices summing to the entry's own
 * `days` exactly, which the reconciliation test then holds us to.
 */
const daysBefore = (consumed: ConsumedLeave, slice: { from: Date; to: Date }): number => {
  const spanDays = calendarDaysInclusive(consumed.from, consumed.to);
  const perCalendarDay = consumed.days / spanDays;
  const skipped = calendarDaysInclusive(consumed.from, slice.from) - 1;
  return skipped * perCalendarDay;
};

/**
 * Take `days` worth of the breakdown, starting `offset` days in — the chronological rule.
 *
 * Walks the tiers in order, skipping what belongs to earlier days and taking what belongs to
 * these. The output preserves tier order, so a slice spanning a rate change carries both rates in
 * the order they applied.
 */
export const takeBreakdown = (
  breakdown: readonly LeavePaidBreakdown[],
  offset: number,
  days: number,
): LeavePaidBreakdown[] => {
  const out: LeavePaidBreakdown[] = [];
  let skip = offset;
  let remaining = days;
  for (const tier of breakdown) {
    if (remaining <= 0) break;
    const available = tier.days - Math.min(skip, tier.days);
    skip = Math.max(0, skip - tier.days);
    if (available <= 0) continue;
    const take = Math.min(remaining, available);
    // Guard against a floating tail from the half-day proportion above: a sliver below a hundredth
    // of a day is arithmetic noise, not a tier.
    if (take > 0.005) out.push({ days: round2(take), payRate: tier.payRate });
    remaining -= take;
  }
  return out;
};

/** Two decimals — days come in half-day steps, and the proportion above can leave a tail. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * The part of one consumption that belongs to one period, or null when none does.
 *
 * The whole-entry case is answered without touching the breakdown at all, which is both the
 * cheapest path and the honest one: nothing was inferred, so `allocation` says `whole`.
 */
export const sliceForPeriod = (
  consumed: ConsumedLeave,
  window: { from: Date; to: Date },
): LeaveSlice | null => {
  const from = toDateOnly(consumed.from);
  const to = toDateOnly(consumed.to);
  const span = intersect({ from, to }, window);
  if (span === null) return null;

  const wholeEntry =
    span.from.getTime() === from.getTime() && span.to.getTime() === to.getTime();
  if (wholeEntry) {
    return {
      from: span.from,
      to: span.to,
      days: consumed.days,
      breakdown: consumed.breakdown.map((tier) => ({ ...tier })),
      allocation: 'whole',
    };
  }

  const spanDays = calendarDaysInclusive(from, to);
  const perCalendarDay = consumed.days / spanDays;
  const sliceDays = round2(calendarDaysInclusive(span.from, span.to) * perCalendarDay);
  const offset = daysBefore({ ...consumed, from, to }, span);
  return {
    from: span.from,
    to: span.to,
    days: sliceDays,
    breakdown: takeBreakdown(consumed.breakdown, offset, sliceDays),
    allocation: 'chronological',
  };
};
