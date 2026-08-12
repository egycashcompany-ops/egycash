// Payroll money — the one place an amount is turned into a number this system can add up
// without surprises (P-HR-02 / PY-2).
//
// WHY THIS EXISTS. PY-2 is the first payroll phase that carries an amount, and JavaScript's
// `number` is a binary double: `0.1 + 0.2` is `0.30000000000000004`, and a naive
// `Math.round(x * 100)` on `1.005` yields `1.00` because the double behind that literal is
// actually 1.00499999999999989…. Payroll cannot afford either. So every amount is converted ONCE
// to an integer number of minor units, arithmetic happens on those integers, and the conversion
// back is the only division.
//
// WHAT IS A DECISION HERE, AND WHAT IS NOT:
//
//   • Two decimal places is a STORAGE PRECISION — "the smallest amount this system records is one
//     hundredth of a currency unit". It is not a statement about any currency's legal subdivision,
//     and nothing here reads the currency code to pick a different scale.
//   • Half-up away from zero is the rounding this module performs, applied to the decimal the
//     caller actually wrote (recovered from the number's shortest round-trip form), so `1.005`
//     becomes `1.01` and `-1.005` becomes `-1.01`.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT KNOW. It has no tax rounding, no overtime rounding, no
// per-currency rule, no notion of a payslip, a period or a proration. `scaleMinorUnits` defines
// what ONE rounding step does — never when to take one. Which quantity multiplies which item, in
// what order, and at which step the result is rounded are payroll rules, and they arrive with the
// phase that is given them (PY-3). Inventing them here would be inventing law.
import { z } from 'zod';

/** Storage precision, not a currency's legal subdivision — see the header. */
export const MONEY_DECIMAL_PLACES = 2;

/** Minor units in one currency unit: 10^MONEY_DECIMAL_PLACES. */
export const MONEY_MINOR_UNITS_PER_UNIT = 100;

/**
 * The largest magnitude this module accepts, in major units.
 *
 * A sanity bound, not a business limit: it keeps every minor-unit value (and a sum of a few
 * thousand of them) inside `Number.MAX_SAFE_INTEGER`, which is what makes the integer arithmetic
 * below exact rather than approximately exact.
 */
export const MONEY_MAX_AMOUNT = 1_000_000_000_000;

/**
 * Below this magnitude a number cannot round to a whole minor unit (half a minor unit is 0.005),
 * so it is zero. Testing it first also keeps `String()` out of exponent notation — which it only
 * uses under 1e-6 or at/above 1e21, and the upper end is excluded by MONEY_MAX_AMOUNT.
 */
const NEGLIGIBLE = 1e-6;

/**
 * An amount as an exact integer count of minor units.
 *
 * Rounds half-up away from zero at the decimal the caller wrote, NOT at the binary double behind
 * it — that distinction is the whole point:
 *
 *   toMinorUnits(1.005)                 === 101      (naive Math.round(1.005 * 100) gives 100)
 *   toMinorUnits(0.1 + 0.2)             === 30       (the double is 0.30000000000000004)
 *   toMinorUnits(-1.005)                === -101     (away from zero, symmetrically)
 *
 * @throws RangeError when the value is not finite or is outside MONEY_MAX_AMOUNT.
 */
export const toMinorUnits = (amount: number): number => {
  if (!Number.isFinite(amount)) throw new RangeError('an amount must be a finite number');
  if (Math.abs(amount) > MONEY_MAX_AMOUNT) throw new RangeError('amount out of range');
  if (Math.abs(amount) < NEGLIGIBLE) return 0;

  const sign = amount < 0 ? -1 : 1;
  // Plain decimal for every in-range magnitude — the two exponent-notation windows are excluded
  // by the range check and the negligible check above.
  const [whole = '0', fraction = ''] = String(Math.abs(amount)).split('.');
  const digits = `${fraction}000`;
  const kept = Number(digits.slice(0, MONEY_DECIMAL_PLACES));
  // Half-up needs only the first dropped digit: the remainder reaches half a minor unit exactly
  // when that digit is 5 or more, whatever follows it.
  const roundUp = Number(digits[MONEY_DECIMAL_PLACES]) >= 5 ? 1 : 0;
  return sign * (Number(whole) * MONEY_MINOR_UNITS_PER_UNIT + kept + roundUp);
};

/** Minor units back to major units. The only division in this module. */
export const fromMinorUnits = (minorUnits: number): number => {
  if (!Number.isSafeInteger(minorUnits)) {
    throw new RangeError('minor units must be a safe integer');
  }
  return minorUnits / MONEY_MINOR_UNITS_PER_UNIT;
};

/** The amount as this system would record it — `fromMinorUnits(toMinorUnits(amount))`. */
export const roundAmount = (amount: number): number => fromMinorUnits(toMinorUnits(amount));

/**
 * Whether a value is an amount this system can record EXACTLY — finite, in range, and already at
 * storage precision. `1.5` is; `1.005` is not, because recording it would silently change it.
 */
export const isMoneyAmount = (value: unknown): value is number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (Math.abs(value) > MONEY_MAX_AMOUNT) return false;
  return roundAmount(value) === value;
};

/** Exact integer sum. Adding minor units never loses a hundredth the way adding doubles can. */
export const sumMinorUnits = (values: readonly number[]): number => {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value)) throw new RangeError('minor units must be a safe integer');
    total += value;
    if (!Number.isSafeInteger(total)) throw new RangeError('minor-unit sum out of range');
  }
  return total;
};

/**
 * One rounding step: minor units × a plain factor, half-up away from zero.
 *
 * This is the primitive a later phase multiplies by a quantity with (days, minutes, a percentage
 * expressed as a fraction). It says what a single rounding does and nothing else — WHICH factor,
 * in what order, and whether a calculation rounds once at the end or at every line are payroll
 * rules that belong to the phase that is given them.
 */
export const scaleMinorUnits = (minorUnits: number, factor: number): number => {
  if (!Number.isSafeInteger(minorUnits)) throw new RangeError('minor units must be a safe integer');
  if (!Number.isFinite(factor)) throw new RangeError('a factor must be a finite number');
  const scaled = minorUnits * factor;
  const rounded = scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
  if (!Number.isSafeInteger(rounded)) throw new RangeError('minor-unit product out of range');
  return rounded;
};

/**
 * An amount on the wire: a number this system can record without changing it.
 *
 * Deliberately refuses `1.005` rather than silently rounding it — a payroll figure a user typed
 * and a payroll figure this system stored must be the same figure, and the way to say "one and a
 * half piastres is not a thing" is to fail, not to round behind their back.
 */
export const MoneyAmountSchema = z
  .number()
  .refine((value) => Number.isFinite(value) && Math.abs(value) <= MONEY_MAX_AMOUNT, {
    message: 'amount out of range',
  })
  .refine(isMoneyAmount, {
    message: `an amount is recorded to ${String(MONEY_DECIMAL_PLACES)} decimal places`,
  });

/**
 * The currency code, with the same default every other compensation figure in this system uses
 * (`MoneySchema` / `AllowanceSchema` — frozen employee design §7). No parallel currency system:
 * this is that same three-letter code, restated where payroll validates an amount beside it.
 */
export const MoneyCurrencySchema = z.string().length(3).default('EGP');
