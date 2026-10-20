// «إجمالي العهدة» = Σ شحن − Σ custody receipts + Σ استعاضة − Σ تسوية — to the piastre, and allowed
// below zero. The reads themselves run against a real mongo in the integration suite.
import { describe, expect, it } from 'vitest';
import {
  chargeReasonOf,
  dayKey,
  fromPiastres,
  fundOf,
  letterFigureOf,
  monthBounds,
  toPiastres,
  utcDay,
} from './custody-fund';

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

describe('fundOf', () => {
  it('reproduces his scenario: 100000 − 82508 + 81908 + 200000 − 124139.46 − 15286', () => {
    expect(
      fundOf({ charged: 300000, spent: 82508 + 15286, replenished: 81908, settled: 124139.46 }),
    ).toBe(159974.54);
  });

  it('is exact to the piastre where floating point is not', () => {
    expect(fundOf({ charged: 0.3, spent: 0.1 + 0.2, replenished: 0, settled: 0 })).toBe(0);
    expect(fundOf({ charged: 0.1, spent: 0, replenished: 0.2, settled: 0 })).toBe(0.3);
  });

  it('may be negative — spent before any charge, or a settlement past the fund', () => {
    expect(fundOf({ charged: 0, spent: 1250.5, replenished: 0, settled: 0 })).toBe(-1250.5);
    expect(fundOf({ charged: 100, spent: 0, replenished: 0, settled: 250 })).toBe(-150);
  });

  it('is never -0', () => {
    expect(Object.is(fundOf({ charged: 0, spent: 0, replenished: 0, settled: 0 }), 0)).toBe(true);
    expect(Object.is(fromPiastres(-0), 0)).toBe(true);
    expect(toPiastres(124139.46)).toBe(12413946);
  });
});

describe('letterFigureOf — the bracket figure his letters print', () => {
  const terms = { charged: { count: 2, amount: 300000 }, fundTotal: 299400 };

  it('is everything charged on a replenishment, the fund on a settlement, none on a charge', () => {
    expect(letterFigureOf('replenish', terms)).toBe(300000);
    expect(letterFigureOf('settle', terms)).toBe(299400);
    expect(letterFigureOf('charge', terms)).toBeNull();
  });
});

describe('the fund’s days', () => {
  it('keeps a moment’s UTC day, written YYYY-MM-DD', () => {
    expect(utcDay(new Date('2026-10-05T21:30:00.000Z'))).toEqual(day('2026-10-05'));
    expect(dayKey(day('2026-09-01'))).toBe('2026-09-01');
  });

  it('defaults a letter’s period to whole months over the days it covers', () => {
    expect(monthBounds([])).toBeNull();
    expect(monthBounds([day('2026-09-16'), day('2026-09-01'), day('2026-09-28')])).toEqual({
      from: day('2026-09-01'),
      to: day('2026-09-30'),
    });
    expect(monthBounds([day('2026-10-03'), day('2026-08-17')])).toEqual({
      from: day('2026-08-01'),
      to: day('2026-10-31'),
    });
    expect(monthBounds([day('2028-02-10')])?.to, 'a leap February').toEqual(day('2028-02-29'));
    expect(monthBounds([day('2026-12-05')])?.to, 'across the year').toEqual(day('2026-12-31'));
  });
});

describe('chargeReasonOf — the reason kept without his letter’s «نظير»', () => {
  it('takes a leading «نظير» off, alone or after «وذلك»', () => {
    expect(chargeReasonOf('نظير تشغيل السيارات لشهر سبتمبر')).toBe('تشغيل السيارات لشهر سبتمبر');
    expect(chargeReasonOf('  نظير:  24 سياره تجديد ')).toBe('24 سياره تجديد');
    expect(chargeReasonOf('وذلك نظير مد مدة 23 سيارة')).toBe('مد مدة 23 سيارة');
    expect(chargeReasonOf('و ذلك نظير مد مدة')).toBe('مد مدة');
    expect(chargeReasonOf('نظير')).toBe('');
  });

  it('leaves every other reason as typed, and an empty one empty', () => {
    expect(chargeReasonOf('تشغيل السيارات نظير الشهر')).toBe('تشغيل السيارات نظير الشهر');
    expect(chargeReasonOf('نظيره في الشهر الماضي')).toBe('نظيره في الشهر الماضي');
    expect(chargeReasonOf('')).toBe('');
    expect(chargeReasonOf('   ')).toBe('');
  });
});
