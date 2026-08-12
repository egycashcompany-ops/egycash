// Payroll money, pinned.
//
// The whole reason this module exists is that a `number` in JavaScript is a binary double, and
// payroll cannot round the way a double happens to. So the interesting tests here are not the
// happy ones — they are the values where the OBVIOUS implementation is wrong, each stated beside
// what that obvious implementation would have produced.
import { describe, expect, it } from 'vitest';
import {
  MONEY_DECIMAL_PLACES,
  MONEY_MAX_AMOUNT,
  MONEY_MINOR_UNITS_PER_UNIT,
  MoneyAmountSchema,
  fromMinorUnits,
  isMoneyAmount,
  roundAmount,
  scaleMinorUnits,
  sumMinorUnits,
  toMinorUnits,
} from './hr-payroll-money';

describe('the storage precision', () => {
  it('is two decimal places, and nothing reads a currency to change that', () => {
    expect(MONEY_DECIMAL_PLACES).toBe(2);
    expect(MONEY_MINOR_UNITS_PER_UNIT).toBe(100);
  });
});

describe('toMinorUnits — values that break the obvious implementation', () => {
  // `1.005 * 100` is 100.49999999999999, so `Math.round` of it is 100 and the piastre is lost.
  it('rounds the decimal the caller wrote, not the double behind it', () => {
    expect(Math.round(1.005 * 100)).toBe(100); // what the obvious version does
    expect(toMinorUnits(1.005)).toBe(101); // what this one does
    expect(toMinorUnits(8.165)).toBe(817); // 8.165 * 100 is 816.4999999999999
    expect(toMinorUnits(4.475)).toBe(448); // 4.475 * 100 is 447.49999999999994
  });

  it('absorbs an addition that already went wrong', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(toMinorUnits(0.1 + 0.2)).toBe(30);
  });

  it('rounds half AWAY FROM ZERO, symmetrically', () => {
    expect(toMinorUnits(-1.005)).toBe(-101);
    expect(toMinorUnits(2.345)).toBe(235);
    expect(toMinorUnits(-2.345)).toBe(-235);
  });

  it('keeps everything already at precision exactly as written', () => {
    expect(toMinorUnits(0)).toBe(0);
    expect(toMinorUnits(1)).toBe(100);
    expect(toMinorUnits(1500)).toBe(150_000);
    expect(toMinorUnits(1500.25)).toBe(150_025);
    expect(toMinorUnits(0.05)).toBe(5);
    expect(toMinorUnits(-0.05)).toBe(-5);
  });

  it('drops what cannot be a whole minor unit, without reaching for exponent notation', () => {
    expect(toMinorUnits(1e-7)).toBe(0);
    expect(toMinorUnits(-1e-9)).toBe(0);
    expect(toMinorUnits(0.004)).toBe(0);
    expect(toMinorUnits(0.005)).toBe(1);
  });

  it('refuses what it cannot represent exactly', () => {
    expect(() => toMinorUnits(Number.NaN)).toThrow(RangeError);
    expect(() => toMinorUnits(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => toMinorUnits(MONEY_MAX_AMOUNT * 10)).toThrow(RangeError);
  });

  it('stays inside safe-integer arithmetic at the bound', () => {
    expect(Number.isSafeInteger(toMinorUnits(MONEY_MAX_AMOUNT))).toBe(true);
  });
});

describe('fromMinorUnits and roundAmount', () => {
  it('round-trips every representable amount', () => {
    for (const amount of [0, 0.01, 0.05, 1, 1.5, 1500.25, 99_999.99]) {
      expect(fromMinorUnits(toMinorUnits(amount)), String(amount)).toBe(amount);
    }
  });

  it('is idempotent — rounding a rounded amount changes nothing', () => {
    for (const amount of [1.005, 0.1 + 0.2, 8.165, 2.345]) {
      expect(roundAmount(roundAmount(amount))).toBe(roundAmount(amount));
    }
    expect(roundAmount(1.005)).toBe(1.01);
    expect(roundAmount(0.1 + 0.2)).toBe(0.3);
  });

  it('refuses minor units that are not a whole count', () => {
    expect(() => fromMinorUnits(10.5)).toThrow(RangeError);
    expect(() => fromMinorUnits(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
  });
});

describe('isMoneyAmount', () => {
  it('accepts what this system can record without changing it', () => {
    for (const value of [0, 0.01, 1, 1.5, -1.5, 1500.25, MONEY_MAX_AMOUNT]) {
      expect(isMoneyAmount(value), String(value)).toBe(true);
    }
  });

  it('rejects a third decimal rather than silently rounding it', () => {
    expect(isMoneyAmount(1.005)).toBe(false);
    expect(isMoneyAmount(0.001)).toBe(false);
    expect(isMoneyAmount(0.1 + 0.2)).toBe(false);
  });

  it('rejects anything that is not a finite in-range number', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, '1.5', null, undefined, {}]) {
      expect(isMoneyAmount(value), String(value)).toBe(false);
    }
    expect(isMoneyAmount(MONEY_MAX_AMOUNT + 1)).toBe(false);
  });
});

describe('sumMinorUnits', () => {
  // The canonical demonstration: ten tenths do not add up to one in floating point.
  it('adds exactly where adding doubles does not', () => {
    const tenths = Array.from({ length: 10 }, () => 0.1);
    expect(tenths.reduce((a, b) => a + b, 0)).not.toBe(1);
    expect(sumMinorUnits(tenths.map(toMinorUnits))).toBe(100);
    expect(fromMinorUnits(sumMinorUnits(tenths.map(toMinorUnits)))).toBe(1);
  });

  it('is zero over nothing, and refuses a fractional term', () => {
    expect(sumMinorUnits([])).toBe(0);
    expect(() => sumMinorUnits([1, 2.5])).toThrow(RangeError);
  });
});

describe('scaleMinorUnits', () => {
  it('performs ONE rounding step, half away from zero', () => {
    expect(scaleMinorUnits(100, 3)).toBe(300);
    expect(scaleMinorUnits(101, 0.5)).toBe(51); // 50.5 → away from zero
    expect(scaleMinorUnits(-101, 0.5)).toBe(-51);
    expect(scaleMinorUnits(150_000, 0.1)).toBe(15_000);
  });

  it('refuses arguments it cannot round exactly', () => {
    expect(() => scaleMinorUnits(1.5, 2)).toThrow(RangeError);
    expect(() => scaleMinorUnits(100, Number.NaN)).toThrow(RangeError);
    expect(() => scaleMinorUnits(Number.MAX_SAFE_INTEGER, 10)).toThrow(RangeError);
  });
});

describe('MoneyAmountSchema', () => {
  it('accepts an amount at storage precision', () => {
    for (const value of [0, 1, 1500, 1500.25, 0.05]) {
      expect(MoneyAmountSchema.safeParse(value).success, String(value)).toBe(true);
    }
  });

  it('fails a third decimal instead of rounding behind the caller', () => {
    const parsed = MoneyAmountSchema.safeParse(1.005);
    expect(parsed.success).toBe(false);
    expect(MoneyAmountSchema.safeParse(0.001).success).toBe(false);
  });

  it('fails what is out of range or not a number at all', () => {
    expect(MoneyAmountSchema.safeParse(MONEY_MAX_AMOUNT * 2).success).toBe(false);
    expect(MoneyAmountSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
    expect(MoneyAmountSchema.safeParse('1500').success).toBe(false);
  });
});

// This module prices nothing. The moment it grows a bracket, an exemption or a "tax rounding"
// mode it has stopped being arithmetic and started being legislation.
describe('what this module deliberately does not know', () => {
  it('exports no statutory or payroll-calculation surface', async () => {
    const money = await import('./hr-payroll-money');
    const exported = Object.keys(money).join(' ');
    for (const forbidden of ['tax', 'insurance', 'overtime', 'payslip', 'gross', 'net', 'bracket']) {
      expect(exported.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });
});
