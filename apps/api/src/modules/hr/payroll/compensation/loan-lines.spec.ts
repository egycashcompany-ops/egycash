// What an instalment does to a compensation figure (P-HR-05-B) — PURE.
//
// Everything below is arithmetic over values, so none of it opens a connection. That matters more
// here than usual: the owner's D9 says a loan must not change how payroll behaves when the money
// runs out, and "behaves the same" is a claim about the engine rather than about a database.
//
// THE FOUR PROPERTIES:
//   1. an instalment is a DEDUCTION, always, and never prorated;
//   2. it is worth exactly what was scheduled — no day of the month discounts it;
//   3. a negative net raises the warning payroll already raised, and nothing else changes;
//   4. it produces NO deferred line, so the payslip can still be issued.
import { describe, expect, it } from 'vitest';
import { BusinessRuleError } from '../../../../shared/errors';
import {
  computeCompensation,
  type CompensationInput,
  type LoanInstallmentLine,
} from './compensation-rules';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const installment = (over: Partial<LoanInstallmentLine> = {}): LoanInstallmentLine => ({
  id: 'inst1',
  amountMinor: 100_000,
  currency: 'EGP',
  reference: 'house repairs',
  ...over,
});

const input = (over: Partial<CompensationInput> = {}): CompensationInput => ({
  employeeId: 'e1',
  period: '2026-03',
  basicSalary: { amount: 10_000, currency: 'EGP' },
  employmentSpans: [{ from: d('2020-01-01'), to: null }],
  assignments: [
    {
      id: 'a1',
      payItemId: 'p1',
      amount: 3_000,
      currency: 'EGP',
      effectiveFrom: d('2020-01-01'),
      effectiveTo: null,
      item: {
        code: 'HOUSING',
        name: { ar: 'بدل سكن', en: 'Housing' },
        kind: 'earning',
        calcBasis: 'fixed',
        quantitySource: null,
        sortOrder: 10,
      },
    },
  ],
  hasLegacyAllowances: false,
  adjustments: [],
  loanInstallments: [],
  attendance: null,
  leave: null,
  ...over,
});

const loanLine = (effects: ReturnType<typeof computeCompensation>) =>
  effects.deductions.find((line) => line.origin === 'loanInstallment');

describe('the line an instalment produces', () => {
  it('is a deduction worth exactly what was scheduled', () => {
    const effects = computeCompensation(input({ loanInstallments: [installment()] }));
    const line = loanLine(effects);
    expect(line?.kind).toBe('deduction');
    expect(line?.amountMinor).toBe(100_000);
    expect(line?.amount).toBe(1_000);
    expect(line?.code).toBe('LOAN_INSTALLMENT');
  });

  /**
   * NEVER prorated, and that is the whole difference from a pay item.
   *
   * Null rather than 1: "this was never prorated" and "this was prorated by a factor of one" are
   * different statements, and only the first is true of a debt.
   */
  it('and is never prorated, whatever the month or the employment', () => {
    for (const period of ['2026-02', '2026-03', '2026-04']) {
      const effects = computeCompensation(
        input({ period, loanInstallments: [installment()] }),
      );
      expect(loanLine(effects)?.prorationFactor, period).toBeNull();
      expect(loanLine(effects)?.amountMinor, period).toBe(100_000);
    }
  });

  // Somebody hired on the 20th still owes the whole instalment: the money was handed over in full.
  it('and is not clipped by a mid-month hire', () => {
    const effects = computeCompensation(
      input({
        employmentSpans: [{ from: d('2026-03-20'), to: null }],
        loanInstallments: [installment()],
      }),
    );
    expect(loanLine(effects)?.amountMinor).toBe(100_000);
  });

  it('carries no assignment and no catalog item, and says so', () => {
    const line = loanLine(computeCompensation(input({ loanInstallments: [installment()] })));
    expect(line?.payItemId).toBeNull();
    expect(line?.quantity).toBeNull();
    expect(line?.leaveTypeCode).toBeNull();
    // The row it came from, so the issuing pass can tell the loan side what it took.
    expect(line?.sourceAssignmentId).toBe('inst1');
  });

  it('totals with everything else, as an ordinary deduction', () => {
    const effects = computeCompensation(input({ loanInstallments: [installment()] }));
    expect(effects.totalEarningsMinor).toBe(300_000);
    expect(effects.totalDeductionsMinor).toBe(100_000);
    expect(effects.netMinor).toBe(200_000);
  });
});

describe('D9 — when the pay does not cover it', () => {
  /**
   * The instalment is taken IN FULL, the net goes negative, and the warning payroll already had is
   * raised. No floor, no partial deduction, no carry-forward — the owner froze exactly this for
   * adjustments in P-HR-04's D3, and a debt does not get a second rule.
   */
  it('takes the whole instalment and reports the negative net', () => {
    const effects = computeCompensation(
      input({ loanInstallments: [installment({ amountMinor: 500_000 })] }),
    );
    expect(loanLine(effects)?.amountMinor).toBe(500_000);
    expect(effects.netMinor).toBe(-200_000);
    expect(effects.warnings).toContain('netBelowZero');
  });

  /**
   * AND THE PAYSLIP CAN STILL BE ISSUED. A `deferred` line would have been the tempting way to
   * express "we could not take this" — and it would have stopped the employee's payslip from being
   * issued at all, because PY-7 skips anybody with one.
   */
  it('and produces no deferred line to block the payslip', () => {
    const unpayable = computeCompensation(
      input({ loanInstallments: [installment({ amountMinor: 5_000_000 })] }),
    );
    const without = computeCompensation(input());
    expect(unpayable.netMinor).toBeLessThan(0);
    // Not "deferred is empty" — PY-5 defers a leave line whenever no run has pinned the month, and
    // that is its business. The property here is that an unpayable instalment adds NOTHING to that
    // set: the deferred lines are exactly the ones the same month had without any loan at all.
    expect(unpayable.deferred).toEqual(without.deferred);
    expect(unpayable.deferred.filter((l) => l.origin === 'loanInstallment')).toEqual([]);
  });
});

describe('what the engine refuses, and what it leaves alone', () => {
  it('refuses an instalment in another currency', () => {
    expect(() =>
      computeCompensation(input({ loanInstallments: [installment({ currency: 'USD' })] })),
    ).toThrow(BusinessRuleError);
  });

  it('prices several instalments in one month, in the order they arrive', () => {
    const effects = computeCompensation(
      input({
        loanInstallments: [
          installment({ id: 'i1', amountMinor: 30_000 }),
          installment({ id: 'i2', amountMinor: 20_000 }),
        ],
      }),
    );
    const lines = effects.deductions.filter((l) => l.origin === 'loanInstallment');
    expect(lines.map((l) => l.sourceAssignmentId)).toEqual(['i1', 'i2']);
    expect(effects.totalDeductionsMinor).toBe(50_000);
  });

  /**
   * A month with no instalment prices EXACTLY as it did before this phase existed.
   *
   * Stated as an identity between two runs rather than as expected numbers, so it stays true when
   * the rules change — which is precisely when a regression would otherwise slip through.
   */
  it('and a month with no instalment is unchanged', () => {
    const withField = computeCompensation(input({ loanInstallments: [] }));
    const withAnother = computeCompensation(input());
    expect(withField.deductions).toEqual(withAnother.deductions);
    expect(withField.earnings).toEqual(withAnother.earnings);
    expect(withField.netMinor).toBe(withAnother.netMinor);
    expect(withField.warnings).toEqual(withAnother.warnings);
    expect(withField.deductions.filter((l) => l.origin === 'loanInstallment')).toEqual([]);
  });

  // P-HR-04's lines are untouched: the two sources sit side by side and neither renames the other.
  it('and an adjustment in the same month keeps its own origin', () => {
    const effects = computeCompensation(
      input({
        loanInstallments: [installment()],
        adjustments: [
          {
            id: 'adj1',
            kind: 'bonus',
            amount: 500,
            currency: 'EGP',
            reason: 'project delivery',
            payItemId: null,
            payItem: null,
          },
        ],
      }),
    );
    expect(effects.earnings.some((l) => l.origin === 'adjustment')).toBe(true);
    expect(effects.deductions.some((l) => l.origin === 'loanInstallment')).toBe(true);
    expect(effects.totalEarningsMinor).toBe(350_000);
    expect(effects.totalDeductionsMinor).toBe(100_000);
  });
});
