// The loan vocabulary, pinned (P-HR-05, phase A).
//
// These enums are what every later phase will branch on and what a stored row will carry, so they
// are stated by name rather than counted. The ABSENCES are asserted too — no interest field, no
// fee, no ceiling, no `deducted` status — because "phase A does not do that yet" is a decision to
// keep rather than a gap for somebody to quietly fill.
import { describe, expect, it } from 'vitest';
import {
  CreateEmployeeLoanSchema,
  DecideEmployeeLoanSchema,
  DisburseEmployeeLoanSchema,
  EMPLOYEE_LOAN_STATUSES,
  EMPLOYEE_LOAN_TYPES,
  LIVE_EMPLOYEE_LOAN_STATUSES,
  LOAN_INSTALLMENT_STATUSES,
  LOAN_MAX_INSTALLMENTS,
  RescheduleEmployeeLoanSchema,
  SettleEmployeeLoanExternallySchema,
} from './hr-employee-loans';

const valid = {
  type: 'loan' as const,
  principal: 6_000,
  currency: 'EGP',
  installmentCount: 6,
  firstPeriod: '2026-02',
  reason: 'house repairs',
};

describe('the loan vocabulary', () => {
  it('is one entity with two types (D1)', () => {
    expect([...EMPLOYEE_LOAN_TYPES]).toEqual(['advance', 'loan']);
  });

  // `approved` is the MIDDLE of this machine, not its end: the obligation begins at disbursement.
  it('pins the lifecycle, with active between approved and settled', () => {
    expect([...EMPLOYEE_LOAN_STATUSES]).toEqual([
      'draft',
      'pendingApproval',
      'approved',
      'active',
      'settled',
      'cancelled',
    ]);
  });

  // D3 — a draft deliberately does not reserve the employee.
  it('and names the states that block a second loan', () => {
    expect([...LIVE_EMPLOYEE_LOAN_STATUSES]).toEqual(['pendingApproval', 'approved', 'active']);
    expect([...LIVE_EMPLOYEE_LOAN_STATUSES]).not.toContain('draft');
  });

  /**
   * An instalment is an INTENTION or one that was withdrawn. There is no third value, because
   * phase A has no payroll and therefore nothing that can deduct. `deducted` arrives in phase B
   * with the code that sets it.
   */
  it('gives an instalment two states, and neither of them is a deduction', () => {
    expect([...LOAN_INSTALLMENT_STATUSES]).toEqual(['planned', 'cancelled']);
    expect([...LOAN_INSTALLMENT_STATUSES]).not.toContain('deducted');
  });
});

describe('what a loan request accepts', () => {
  it('takes a principal and the two schedule inputs', () => {
    expect(CreateEmployeeLoanSchema.safeParse(valid).success).toBe(true);
  });

  // An advance is a loan with one instalment (D1) — not a second entity, and not a special case.
  it('and an advance is simply one instalment', () => {
    expect(
      CreateEmployeeLoanSchema.safeParse({ ...valid, type: 'advance', installmentCount: 1 }).success,
    ).toBe(true);
  });

  it('refuses a principal that is not positive', () => {
    for (const principal of [0, -1]) {
      expect(CreateEmployeeLoanSchema.safeParse({ ...valid, principal }).success, String(principal)).toBe(
        false,
      );
    }
  });

  it('refuses a period that is not a Cairo month', () => {
    for (const firstPeriod of ['2026-13', '2026', '2026-1', '2026-02-01']) {
      expect(
        CreateEmployeeLoanSchema.safeParse({ ...valid, firstPeriod }).success,
        firstPeriod,
      ).toBe(false);
    }
  });

  it('refuses a count below one, and bounds how many rows one write may create', () => {
    expect(CreateEmployeeLoanSchema.safeParse({ ...valid, installmentCount: 0 }).success).toBe(false);
    expect(
      CreateEmployeeLoanSchema.safeParse({ ...valid, installmentCount: LOAN_MAX_INSTALLMENTS })
        .success,
    ).toBe(true);
    expect(
      CreateEmployeeLoanSchema.safeParse({ ...valid, installmentCount: LOAN_MAX_INSTALLMENTS + 1 })
        .success,
    ).toBe(false);
  });

  it('requires a reason — money handed over for no stated reason is not a record', () => {
    expect(CreateEmployeeLoanSchema.safeParse({ ...valid, reason: '' }).success).toBe(false);
    const withoutReason: Record<string, unknown> = { ...valid };
    delete withoutReason['reason'];
    expect(CreateEmployeeLoanSchema.safeParse(withoutReason).success).toBe(false);
  });

  /**
   * D4 and D10, asserted as absences. `.strict()` is what makes this a test rather than a wish:
   * a field nobody declared is rejected outright, so an interest rate cannot arrive by accident.
   */
  it('rejects an interest rate, a fee and a ceiling outright', () => {
    for (const extra of [
      { interestRate: 5 },
      { interest: 5 },
      { fee: 100 },
      { adminFee: 100 },
      { maxAmount: 1_000 },
      { penalty: 50 },
    ]) {
      expect(
        CreateEmployeeLoanSchema.safeParse({ ...valid, ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });
});

describe('the operations on a live loan', () => {
  it('a decision is a decision plus a version', () => {
    expect(
      DecideEmployeeLoanSchema.safeParse({ decision: 'approved', version: 0 }).success,
    ).toBe(true);
    expect(DecideEmployeeLoanSchema.safeParse({ decision: 'maybe', version: 0 }).success).toBe(false);
  });

  it('a disbursement is a date, and a date only', () => {
    expect(
      DisburseEmployeeLoanSchema.safeParse({ disbursedAt: '2026-01-15', version: 0 }).success,
    ).toBe(true);
    expect(
      DisburseEmployeeLoanSchema.safeParse({ disbursedAt: '2026-01-15T00:00:00.000Z', version: 0 })
        .success,
    ).toBe(false);
    // It records a payment; it does not restate one. An amount here would be a second principal.
    expect(
      DisburseEmployeeLoanSchema.safeParse({ disbursedAt: '2026-01-15', amount: 10, version: 0 })
        .success,
    ).toBe(false);
  });

  /**
   * D6 — the amount is deliberately NOT an input.
   *
   * A reschedule takes the same two inputs the original schedule took, and the server re-splits
   * exactly what is left. That is what makes "the debt did not move" true by construction instead
   * of true when a client gets the rounding right.
   */
  it('a reschedule states months, never money', () => {
    expect(
      RescheduleEmployeeLoanSchema.safeParse({
        installmentCount: 4,
        firstPeriod: '2026-06',
        reason: 'smaller instalments',
        version: 1,
      }).success,
    ).toBe(true);
    for (const extra of [{ amount: 100 }, { principal: 100 }, { installments: [] }]) {
      expect(
        RescheduleEmployeeLoanSchema.safeParse({
          installmentCount: 4,
          firstPeriod: '2026-06',
          reason: 'smaller instalments',
          version: 1,
          ...extra,
        }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });

  it('an external settlement carries an amount and a reason', () => {
    expect(
      SettleEmployeeLoanExternallySchema.safeParse({
        amount: 1_000,
        reason: 'paid in cash',
        version: 2,
      }).success,
    ).toBe(true);
    expect(
      SettleEmployeeLoanExternallySchema.safeParse({ amount: 0, reason: 'nothing', version: 2 })
        .success,
    ).toBe(false);
    // It is not a payroll instruction: no period, because no month is being charged.
    expect(
      SettleEmployeeLoanExternallySchema.safeParse({
        amount: 1_000,
        reason: 'paid in cash',
        period: '2026-02',
        version: 2,
      }).success,
    ).toBe(false);
  });
});
