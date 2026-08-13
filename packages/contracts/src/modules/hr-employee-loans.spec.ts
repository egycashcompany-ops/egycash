// The loan vocabulary, pinned (P-HR-05, phase A).
//
// These enums are what every later phase will branch on and what a stored row will carry, so they
// are stated by name rather than counted. The ABSENCES are asserted too — no interest field, no
// fee, no ceiling, no `deducted` status — because "phase A does not do that yet" is a decision to
// keep rather than a gap for somebody to quietly fill.
import { describe, expect, it } from 'vitest';
import {
  AccelerateEmployeeLoanSchema,
  CreateEmployeeLoanSchema,
  DecideEmployeeLoanSchema,
  DisburseEmployeeLoanSchema,
  EmployeeLoanDecidedPayloadV1,
  EmployeeLoanDisbursedPayloadV1,
  HrEmployeeLoanEvents,
  HrEmployeeLoanTemplates,
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

  /**
   * `approved` is the MIDDLE of this machine, not its end: the obligation begins at disbursement.
   *
   * `outstandingAtExit` (D8, P-HR-05-B) arrived with the handler that sets it. It is a statement
   * of fact rather than a decision — the employee left owing money — and it is deliberately not a
   * synonym for `cancelled`: nothing was forgiven.
   */
  it('pins the lifecycle, with active between approved and settled', () => {
    expect([...EMPLOYEE_LOAN_STATUSES]).toEqual([
      'draft',
      'pendingApproval',
      'approved',
      'active',
      'settled',
      'cancelled',
      'outstandingAtExit',
    ]);
  });

  // D3 — a draft deliberately does not reserve the employee.
  it('and names the states that block a second loan', () => {
    expect([...LIVE_EMPLOYEE_LOAN_STATUSES]).toEqual(['pendingApproval', 'approved', 'active']);
    expect([...LIVE_EMPLOYEE_LOAN_STATUSES]).not.toContain('draft');
  });

  /**
   * An intention, a fact, and an intention that was withdrawn — in that order.
   *
   * `deducted` (P-HR-05-B) is the only one of the three that a payslip creates, and the only one
   * nothing may move afterwards. Phase A shipped without it precisely because nothing then could
   * set it; it arrived with the code that does.
   */
  it('gives an instalment three states, one of which is a fact', () => {
    expect([...LOAN_INSTALLMENT_STATUSES]).toEqual(['planned', 'deducted', 'cancelled']);
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

  /**
   * D7-2 — the two early-repayment paths are different SHAPES, not one shape with a flag.
   *
   * An acceleration names a month, because the money will come out of that month's salary. A
   * settlement does not, because no month is being charged. Conflating them is exactly how a
   * payslip ends up claiming a deduction for cash that arrived in an envelope.
   */
  it('an acceleration names a month; a settlement never does', () => {
    expect(
      AccelerateEmployeeLoanSchema.safeParse({
        period: '2026-06',
        extraAmount: 500,
        reason: 'a bonus arrived',
        version: 3,
      }).success,
    ).toBe(true);
    // Not positive, no month, or dressed up as a cash receipt — each is a different operation.
    expect(
      AccelerateEmployeeLoanSchema.safeParse({
        period: '2026-06',
        extraAmount: 0,
        reason: 'nothing',
        version: 3,
      }).success,
    ).toBe(false);
    expect(
      AccelerateEmployeeLoanSchema.safeParse({ extraAmount: 500, reason: 'x', version: 3 }).success,
    ).toBe(false);
    expect(
      AccelerateEmployeeLoanSchema.safeParse({
        period: '2026-06',
        extraAmount: 500,
        reason: 'x',
        settlesExternally: true,
        version: 3,
      }).success,
    ).toBe(false);
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

/**
 * What a loan decision publishes (P-HR-07), pinned by name.
 *
 * Three events, and the ABSENCES are asserted with them: rescheduling, accelerating and settling
 * all change a live plan, and none of them was shown to have an audience. An event with no consumer
 * is a promise nobody asked for, and the cheapest way to make one is to add it "for completeness"
 * while the file is open — which is what this stops.
 */
describe('the loan decisions that are published', () => {
  it('is three moments, named', () => {
    expect(Object.values(HrEmployeeLoanEvents).sort()).toEqual([
      'hr.employeeLoan.decided',
      'hr.employeeLoan.disbursed',
      'hr.employeeLoan.submitted',
    ]);
  });

  it('and the template keys are the same three', () => {
    expect(Object.values(HrEmployeeLoanTemplates).sort()).toEqual(
      Object.values(HrEmployeeLoanEvents).sort(),
    );
  });

  it('publishes nothing for the acts that reshape a live plan', () => {
    const names = Object.values(HrEmployeeLoanEvents).join(' ');
    for (const absent of ['reschedul', 'accelerat', 'settle', 'cancel']) {
      expect(names, absent).not.toContain(absent);
    }
  });

  /**
   * The disbursement payload carries the SCHEDULE, and that is the difference between it and the
   * two before it: from this moment instalments come off a salary, so a consumer needs to know how
   * many and starting when without re-reading the loan — by which time it may have moved.
   */
  it('carries the schedule on the one that changes what somebody is paid', () => {
    const parsed = EmployeeLoanDisbursedPayloadV1.safeParse({
      loanId: '000000000000000000000000',
      employeeId: '000000000000000000000000',
      type: 'loan',
      principal: 6_000,
      currency: 'EGP',
      disbursedAt: '2026-01-15',
      installmentCount: 6,
      firstPeriod: '2026-02',
    });
    expect(parsed.success).toBe(true);
    // An instant is not a date-only: the contract refuses one, as the disburse input does.
    expect(
      EmployeeLoanDisbursedPayloadV1.safeParse({
        loanId: '000000000000000000000000',
        employeeId: '000000000000000000000000',
        type: 'loan',
        principal: 6_000,
        currency: 'EGP',
        disbursedAt: '2026-01-15T00:00:00.000Z',
        installmentCount: 6,
        firstPeriod: '2026-02',
      }).success,
    ).toBe(false);
  });

  // `rejected` sends the request back to `draft`; a consumer treating it as terminal is wrong.
  it('names a decision rather than an outcome', () => {
    for (const decision of ['approved', 'rejected']) {
      expect(
        EmployeeLoanDecidedPayloadV1.safeParse({
          loanId: '000000000000000000000000',
          employeeId: '000000000000000000000000',
          type: 'advance',
          principal: 500,
          currency: 'EGP',
          decision,
        }).success,
        decision,
      ).toBe(true);
    }
  });
});
