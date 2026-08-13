// What an approved decision comes to (P-HR-04), exercised without a database.
//
// The property that matters most has a negative shape: an adjustment is NOT prorated. A pay item
// is a rate and gets scaled by the days it was in force; a decision to pay somebody 5,000 in March
// is 5,000 whatever day of March it was taken on. Everything else here is arithmetic; that one is
// the reason the phase exists.
import { describe, expect, it } from 'vitest';
import { BusinessRuleError } from '../../../../shared/errors';
import {
  computeCompensation,
  type AdjustmentInput,
  type CompensationInput,
} from './compensation-rules';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const adjustment = (over: Partial<AdjustmentInput> = {}): AdjustmentInput => ({
  id: 'adj1',
  kind: 'bonus',
  amount: 5_000,
  currency: 'EGP',
  reason: 'project delivery',
  payItemId: null,
  payItem: null,
  ...over,
});

const input = (over: Partial<CompensationInput> = {}): CompensationInput => ({
  employeeId: 'e1',
  period: '2026-03',
  basicSalary: { amount: 10_000, currency: 'EGP' },
  employmentSpans: [{ from: d('2020-01-01'), to: null }],
  assignments: [],
  hasLegacyAllowances: false,
  attendance: null,
  leave: null,
  adjustments: [],
  ...over,
});

describe('an adjustment is a decision, not a rate', () => {
  it('pays exactly what was approved', () => {
    const result = computeCompensation(input({ adjustments: [adjustment()] }));
    expect(result.earnings.map((l) => l.code)).toEqual(['BONUS']);
    expect(result.totalEarningsMinor).toBe(500_000); // 5,000.00 — not a fraction of it
    expect(result.netMinor).toBe(500_000);
  });

  /**
   * THE ASSERTION THE PHASE EXISTS FOR.
   *
   * `prorationFactor: null` is not decoration — it is the difference between this line and every
   * assigned one, and it is what a reader checks to know the amount was not scaled. Null says
   * "never prorated"; a factor of 1 would say "prorated, and it happened to come to one".
   */
  it('is never prorated — no factor, and no days to scale by', () => {
    const line = computeCompensation(input({ adjustments: [adjustment()] })).earnings[0];
    expect(line?.prorationFactor).toBeNull();
    expect(line?.baseAmount).toBe(5_000);
    expect(line?.amount).toBe(5_000);
    // Days are reported for the reader's context, and are equal — nothing divides by them.
    expect(line?.daysInForce).toBe(line?.daysInPeriod);
  });

  it('a penalty deducts, and the kind is what carries the sign', () => {
    const result = computeCompensation(
      input({ adjustments: [adjustment({ kind: 'penalty', amount: 750 })] }),
    );
    expect(result.earnings).toEqual([]);
    expect(result.deductions.map((l) => l.code)).toEqual(['PENALTY']);
    // The stored amount stays POSITIVE; the direction lives in `kind`, and the total subtracts.
    expect(result.deductions[0]?.amount).toBe(750);
    expect(result.totalDeductionsMinor).toBe(75_000);
    expect(result.netMinor).toBe(-75_000);
  });

  // D3 — reported, never floored and never carried forward. The behaviour payroll already had.
  it('lets the net go below zero and says so', () => {
    const result = computeCompensation(
      input({ adjustments: [adjustment({ kind: 'penalty', amount: 999_999 })] }),
    );
    expect(result.netMinor).toBeLessThan(0);
    expect(result.warnings).toContain('netBelowZero');
  });

  // D5 — one-off, but nothing stops several one-offs landing in the same month.
  it('adds up several decisions in one month', () => {
    const result = computeCompensation(
      input({
        adjustments: [
          adjustment({ id: 'a', amount: 1_000 }),
          adjustment({ id: 'b', amount: 250 }),
          adjustment({ id: 'c', kind: 'penalty', amount: 400 }),
        ],
      }),
    );
    expect(result.totalEarningsMinor).toBe(125_000);
    expect(result.totalDeductionsMinor).toBe(40_000);
    expect(result.netMinor).toBe(85_000);
  });
});

describe('how the line names itself (D4)', () => {
  it('takes the catalog item’s identity when one was chosen', () => {
    const line = computeCompensation(
      input({
        adjustments: [
          adjustment({
            payItemId: 'p1',
            payItem: { code: 'EID_BONUS', name: { ar: 'منحة العيد', en: 'Eid bonus' } },
          }),
        ],
      }),
    ).earnings[0];
    expect(line?.code).toBe('EID_BONUS');
    expect(line?.name.en).toBe('Eid bonus');
    expect(line?.payItemId).toBe('p1');
  });

  it('and falls back to its own code when none was', () => {
    const line = computeCompensation(input({ adjustments: [adjustment()] })).earnings[0];
    expect(line?.code).toBe('BONUS');
    expect(line?.payItemId).toBeNull();
    // The entry it came from is still named, so a figure can always be traced to its decision.
    expect(line?.sourceAssignmentId).toBe('adj1');
  });

  it('is marked as its own origin, not as a pay item', () => {
    const line = computeCompensation(input({ adjustments: [adjustment()] })).earnings[0];
    expect(line?.origin).toBe('adjustment');
  });
});

describe('what it still refuses', () => {
  it('a currency the salary is not in', () => {
    expect(() =>
      computeCompensation(input({ adjustments: [adjustment({ currency: 'USD' })] })),
    ).toThrow(BusinessRuleError);
  });
});

/**
 * The regression that matters to everything already shipped: a month with no decisions prices
 * exactly as it did before this phase existed.
 */
describe('a period with no adjustments is untouched', () => {
  it('produces the same figures as an empty list', () => {
    const before = computeCompensation(input());
    expect(before.earnings).toEqual([]);
    expect(before.deductions).toEqual([]);
    expect(before.totalEarningsMinor).toBe(0);
    expect(before.netMinor).toBe(0);
    expect(before.warnings).not.toContain('netBelowZero');
  });
});
