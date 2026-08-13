// The repayment schedule (P-HR-05 / D5) — PURE. No database, no clock, no request.
//
// One decision, stated as arithmetic: a principal split into N equal monthly amounts, with the
// rounding difference on the LAST one. Everything interesting about it can therefore be argued
// with in a test that opens no connection — the posture `compensation-rules.ts` and `leave-pay.ts`
// already take.
//
// THE INVARIANT, AND WHY IT IS THE WHOLE FILE:
//
//   sum(installments) === principalMinor
//
// exactly, in integer minor units. D10 froze that a loan is its principal and nothing else — no
// interest, no fee, no penalty — so a schedule that does not add up to the principal is not a
// rounding artefact, it is a different amount of money. Splitting evenly and putting the remainder
// on one named installment is the only way to divide an integer by an integer and keep the total.
//
// WHY THE LAST ONE. The difference is at most (count − 1) minor units — piastres. Putting it on
// the first installment would make the very first deduction the odd one, which is the number an
// employee checks hardest; putting it on the last leaves every ordinary month identical and one
// final month that closes the balance exactly.
import { fromMinorUnits } from '@ecms/contracts';
import { BusinessRuleError } from '../../../shared/errors';

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** One row of a schedule, as the generator produces it. */
export interface ScheduledInstallment {
  seq: number;
  period: string;
  amountMinor: number;
}

/**
 * The month after this one — `2026-12` → `2027-01`.
 *
 * String arithmetic rather than a Date, deliberately: a period is a label on a calendar month, and
 * routing it through a timestamp is how a month becomes the previous one in a different timezone.
 */
export const nextPeriod = (period: string): string => {
  if (!PERIOD_PATTERN.test(period)) {
    throw new BusinessRuleError(`not a period: ${period} (expected YYYY-MM)`);
  }
  const [year, month] = period.split('-').map(Number) as [number, number];
  return month === 12
    ? `${String(year + 1)}-01`
    : `${String(year)}-${String(month + 1).padStart(2, '0')}`;
};

/**
 * The Cairo month a business date falls in — `2026-03-17` → `2026-03`.
 *
 * The date handed in is already a business date (`toDateOnly`, UTC midnight), so reading its UTC
 * parts is reading the day somebody meant rather than the day a server's timezone would name.
 */
export const periodOfDate = (date: Date): string =>
  `${String(date.getUTCFullYear())}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

/** The `count` consecutive months starting at `firstPeriod`, inclusive. */
export const periodsFrom = (firstPeriod: string, count: number): string[] => {
  const periods: string[] = [];
  let period = firstPeriod;
  for (let index = 0; index < count; index += 1) {
    periods.push(period);
    period = nextPeriod(period);
  }
  return periods;
};

/**
 * The schedule for one loan.
 *
 * Refuses rather than approximates in one place, and it is the place that matters: a count larger
 * than the principal's minor units would give some installments a value of zero. An installment of
 * zero is not an installment — it is a month the schedule pretends to occupy — so the whole request
 * is refused instead of being silently shortened.
 */
export const generateSchedule = (
  principalMinor: number,
  installmentCount: number,
  firstPeriod: string,
): ScheduledInstallment[] => {
  if (!Number.isInteger(principalMinor) || principalMinor <= 0) {
    throw new BusinessRuleError('a principal must be a positive amount');
  }
  if (!Number.isInteger(installmentCount) || installmentCount < 1) {
    throw new BusinessRuleError('a schedule needs at least one installment');
  }
  if (principalMinor < installmentCount) {
    throw new BusinessRuleError(
      `${String(fromMinorUnits(principalMinor))} cannot be split into ${String(installmentCount)} installments — each one would be worth nothing`,
    );
  }

  const base = Math.floor(principalMinor / installmentCount);
  const remainder = principalMinor - base * installmentCount;
  return periodsFrom(firstPeriod, installmentCount).map((period, index) => ({
    seq: index + 1,
    period,
    // The remainder lands on the LAST installment, so `sum` is the principal by construction.
    amountMinor: index === installmentCount - 1 ? base + remainder : base,
  }));
};

/** The exact sum of a set of rows, in minor units — integer arithmetic, no rounding step. */
export const totalMinor = (rows: readonly { amountMinor: number }[]): number =>
  rows.reduce((sum, row) => sum + row.amountMinor, 0);

/**
 * Paying MORE in one month, and finishing earlier for it (D7-2, P-HR-05-B). PURE.
 *
 * The extra is taken out of the LAST instalments, walking backwards: months at the end disappear
 * whole, and the one the extra runs out inside is reduced. That is what "repay faster" means — the
 * debt does not change, the calendar does.
 *
 * Returns the replacement rows for the target month and everything after it. The total is
 * `target + later` either way, which is the invariant this whole feature is built on.
 */
export const accelerateTail = (
  target: { period: string; amountMinor: number },
  later: readonly { period: string; amountMinor: number }[],
  extraMinor: number,
): { period: string; amountMinor: number }[] => {
  if (!Number.isInteger(extraMinor) || extraMinor <= 0) {
    throw new BusinessRuleError('an acceleration must be a positive amount');
  }
  const available = later.reduce((sum, row) => sum + row.amountMinor, 0);
  if (extraMinor > available) {
    throw new BusinessRuleError(
      `the instalments after this month come to ${String(fromMinorUnits(available))} — paying ${String(fromMinorUnits(extraMinor))} extra would repay more than is owed`,
    );
  }

  let toAbsorb = extraMinor;
  const tail: { period: string; amountMinor: number }[] = [];
  // Backwards: the months furthest away are the ones an early repayment removes.
  for (const row of [...later].reverse()) {
    if (toAbsorb >= row.amountMinor) {
      toAbsorb -= row.amountMinor;
      continue; // this month disappears entirely
    }
    tail.unshift({ period: row.period, amountMinor: row.amountMinor - toAbsorb });
    toAbsorb = 0;
  }
  return [{ period: target.period, amountMinor: target.amountMinor + extraMinor }, ...tail];
};

/**
 * The invariant, asserted rather than assumed (D6).
 *
 * `generateSchedule` produces it by construction, so this can only fail if somebody one day builds
 * a schedule another way — which is exactly when a system that quietly changes how much somebody
 * owes would be at its most expensive. Rescheduling moves instalments; it does not move the debt.
 */
export const assertScheduleTotals = (
  expectedMinor: number,
  rows: readonly { amountMinor: number }[],
): void => {
  const actual = totalMinor(rows);
  if (actual !== expectedMinor) {
    throw new BusinessRuleError(
      `a schedule must total the amount it is repaying — ${String(fromMinorUnits(actual))} against ${String(fromMinorUnits(expectedMinor))}`,
    );
  }
};
