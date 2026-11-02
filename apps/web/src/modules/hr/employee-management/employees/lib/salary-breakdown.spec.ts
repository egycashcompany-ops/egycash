// The salary split from the gross: 70% fixed, 30% attendance bonus, insurance = gross ÷ 1.3.
import { describe, expect, it } from 'vitest';
import { salaryBreakdown } from './salary-breakdown';

describe('the salary, split from the gross', () => {
  it('splits 10,000 the way the sample showed', () => {
    expect(salaryBreakdown(10000)).toEqual({ gross: 10000, fixed: 7000, attendanceBonus: 3000, insurance: 7692.31 });
  });

  it('splits the owner\'s 122 to the piastre', () => {
    expect(salaryBreakdown(122)).toEqual({ gross: 122, fixed: 85.4, attendanceBonus: 36.6, insurance: 93.85 });
  });

  /**
   * Two separately rounded halves can be a piastre off the whole; these never are. Every piastre
   * from 0.01 to 100.00 — a handful of hand-picked values let a separately rounded 30% through,
   * because floating point happens to break most of the exact half-piastre ties.
   */
  it('always adds the two parts back up to the gross', () => {
    const off: number[] = [];
    for (let piastres = 1; piastres <= 10_000; piastres += 1) {
      const gross = piastres / 100;
      const parts = salaryBreakdown(gross);
      const sum = Math.round(((parts?.fixed ?? 0) + (parts?.attendanceBonus ?? 0)) * 100);
      if (sum !== piastres) off.push(gross);
    }
    expect(off).toEqual([]);
  });

  it('has nothing to split without a positive gross', () => {
    expect(salaryBreakdown(null)).toBeNull();
    expect(salaryBreakdown(0)).toBeNull();
    expect(salaryBreakdown(-1)).toBeNull();
    expect(salaryBreakdown(Number.NaN)).toBeNull();
  });
});
