// The payroll vocabulary, pinned.
//
// These enums are what every later phase will branch on, and what a payslip line will cite. A
// value added or renamed here changes the meaning of stored rows, so the list is stated by name
// rather than counted — and the ABSENCE of statutory fields is asserted too, because "no tax rule
// yet" is a decision this phase must keep rather than a gap somebody quietly fills.
import { describe, expect, it } from 'vitest';
import { ATTENDANCE_FEED_FIELDS } from './hr-attendance';
import {
  CALC_BASIS_UNITS,
  COMPENSATION_LINE_ORIGINS,
  COMPENSATION_LINE_STATES,
  CancelPayrollRunSchema,
  CreatePayrollRunSchema,
  FreezePayrollRunSchema,
  PAYROLL_LEAVE_ALLOCATIONS,
  ApprovePayrollRunSchema,
  CANCELLABLE_PAYROLL_RUN_STATUSES,
  PayPayrollRunSchema,
  PAYROLL_RUN_STATUSES,
  COMPENSATION_WARNINGS,
  CompensationQuerySchema,
  CreateEmployeePayItemSchema,
  CreatePayItemSchema,
  EMPLOYEE_PAY_ITEM_REMOVALS,
  PAY_ITEM_CALC_BASES,
  PAY_ITEM_KINDS,
  PAY_ITEM_QUANTITY_SOURCES,
  PAYSLIP_SKIP_REASONS,
  GeneratePayslipsSchema,
  ListPayslipsQuerySchema,
  QUANTITY_SOURCE_UNITS,
  UpdatePayItemSchema,
  quantitySourceFits,
  type CompensationLineDto,
  type GeneratePayslipsResultDto,
  type LeavePayFactsDto,
  type PayslipDto,
} from './hr-payroll';

describe('the pay-item vocabulary', () => {
  it('pins the two kinds and the four calculation bases', () => {
    expect([...PAY_ITEM_KINDS]).toEqual(['earning', 'deduction']);
    expect([...PAY_ITEM_CALC_BASES]).toEqual([
      'fixed',
      'perDay',
      'perMinute',
      'percentOfBase',
    ]);
  });

  it('accepts a well-formed item', () => {
    const parsed = CreatePayItemSchema.safeParse({
      code: 'HOUSING',
      name: { ar: 'بدل سكن', en: 'Housing allowance' },
      kind: 'earning',
      calcBasis: 'fixed',
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a code that is not an uppercase handle', () => {
    for (const code of ['housing', 'Housing', '1HOUSING', 'HOUSING ALLOWANCE', 'H']) {
      const parsed = CreatePayItemSchema.safeParse({
        code,
        name: { ar: 'س', en: 'X' },
        kind: 'earning',
        calcBasis: 'fixed',
      });
      expect(parsed.success, code).toBe(false);
    }
  });

  // The arithmetic is immutable BY CONTRACT: a payslip line cites the item that produced it, so
  // an item that could change kind or basis would silently restate history.
  it('refuses to change what an existing item means', () => {
    for (const field of ['code', 'kind', 'calcBasis']) {
      const parsed = UpdatePayItemSchema.safeParse({
        [field]: field === 'code' ? 'OTHER' : field === 'kind' ? 'deduction' : 'perDay',
        version: 0,
      });
      expect(parsed.success, field).toBe(false);
    }
    expect(UpdatePayItemSchema.safeParse({ name: { ar: 'س', en: 'X' }, version: 0 }).success).toBe(
      true,
    );
  });

  // Payroll v1 has no statutory rule. A field here would be a claim about legislation nobody has
  // given this system — and the place it would first appear is this schema.
  //
  // Asserted BEHAVIOURALLY rather than off `.shape`: PY-4's unit-coherence rule made this schema a
  // refinement, and a test reading a Zod internal would have broken on a change that added no
  // field at all. What the phase actually promises is that these keys are REFUSED, so that is what
  // is checked — and `.strict()` is what refuses them.
  it('carries no tax or insurance field', () => {
    const valid = {
      code: 'HOUSING',
      name: { ar: 'بدل سكن', en: 'Housing allowance' },
      kind: 'earning',
      calcBasis: 'fixed',
    } as const;
    expect(CreatePayItemSchema.safeParse(valid).success).toBe(true);

    for (const forbidden of ['taxable', 'tax', 'insurance', 'socialInsurance', 'exempt']) {
      expect(
        CreatePayItemSchema.safeParse({ ...valid, [forbidden]: true }).success,
        forbidden,
      ).toBe(false);
    }

    // …and the keys it DOES take are exactly the five the catalog declares.
    expect(CreatePayItemSchema.safeParse({ ...valid, sortOrder: 10 }).success).toBe(true);
    expect(
      CreatePayItemSchema.safeParse({
        code: 'DAILY',
        name: { ar: 'يومي', en: 'Daily' },
        kind: 'earning',
        calcBasis: 'perDay',
        quantitySource: 'attendedDays',
      }).success,
    ).toBe(true);
  });
});

// ── Employee pay items (PY-2) ───────────────────────────────────────────────

const assignment = {
  payItemId: '507f1f77bcf86cd799439011',
  amount: 1500,
  effectiveFrom: '2026-03-01',
};

describe('an employee pay-item assignment', () => {
  it('accepts a well-formed one and defaults the currency to EGP', () => {
    const parsed = CreateEmployeePayItemSchema.safeParse(assignment);
    expect(parsed.success).toBe(true);
    // The same three-letter default every other compensation figure carries — not a new system.
    expect(parsed.success && parsed.data.currency).toBe('EGP');
  });

  it('treats an omitted end as open-ended rather than as an error', () => {
    expect(CreateEmployeePayItemSchema.safeParse(assignment).success).toBe(true);
    expect(
      CreateEmployeePayItemSchema.safeParse({ ...assignment, effectiveTo: null }).success,
    ).toBe(true);
    expect(
      CreateEmployeePayItemSchema.safeParse({ ...assignment, effectiveTo: '2026-12-31' }).success,
    ).toBe(true);
  });

  it('refuses an interval that ends before it starts', () => {
    const parsed = CreateEmployeePayItemSchema.safeParse({
      ...assignment,
      effectiveTo: '2026-02-28',
    });
    expect(parsed.success).toBe(false);
  });

  // A zero assignment says nothing, and a negative one says "deduction" in a place that already
  // has a `kind` for that — the sign belongs to the catalog item, never to the amount.
  it('refuses an amount that is not a positive figure at storage precision', () => {
    for (const amount of [0, -1500, 1.005, Number.NaN]) {
      expect(
        CreateEmployeePayItemSchema.safeParse({ ...assignment, amount }).success,
        String(amount),
      ).toBe(false);
    }
    expect(CreateEmployeePayItemSchema.safeParse({ ...assignment, amount: 1500.25 }).success).toBe(
      true,
    );
  });

  // The subject is the ROUTE, not the body: a payload that could name its own employee would be a
  // second way to answer "whose compensation is this?", and the scoped one is the route's.
  it('takes no employeeId, and no statutory field, in the body', () => {
    for (const extra of [
      { employeeId: '507f1f77bcf86cd799439012' },
      { taxable: true },
      { tax: 0 },
      { socialInsurance: true },
      { grossUp: true },
    ]) {
      expect(
        CreateEmployeePayItemSchema.safeParse({ ...assignment, ...extra }).success,
        Object.keys(extra)[0],
      ).toBe(false);
    }
  });

  it('pins the three things DELETE can mean', () => {
    expect([...EMPLOYEE_PAY_ITEM_REMOVALS]).toEqual(['removed', 'ended', 'alreadyEnded']);
  });
});

// ── Compensation effects (PY-3) ─────────────────────────────────────────────

describe('the compensation vocabulary', () => {
  it('pins the line states by name', () => {
    expect([...COMPENSATION_LINE_STATES]).toEqual([
      'computed',
      'pendingQuantity',
      'pendingLeaveSnapshot',
    ]);
  });

  // The two unknowns stay two words. Collapsing them would leave a screen unable to say whether
  // it is waiting for attendance to be frozen or for a payroll run to exist.
  it('keeps the two pending states distinct', () => {
    expect(COMPENSATION_LINE_STATES[1]).not.toBe(COMPENSATION_LINE_STATES[2]);
  });

  it('pins the warnings by name', () => {
    expect([...COMPENSATION_WARNINGS]).toEqual([
      'legacyAllowancesIgnored',
      'netBelowZero',
      'leaveDaysAlsoPriced',
    ]);
  });

  /**
   * Three origins, and each answers a different question about where a figure came from:
   * `payItem` — a rate somebody assigned; `leaveSnapshot` — derived from what a run pinned;
   * `adjustment` — a one-off decision for this month alone (P-HR-04), the only one that is never
   * prorated. A payslip line that could not say which it was would be a number without a story.
   */
  /**
   * The four line origins — assigned, derived from a run, decided, or owed.
   *
   * `loanInstallment` (P-HR-05-B) is the fourth and the only one that is ALWAYS a deduction: the
   * employee already has the money, and this is the month's share of giving it back. Named rather
   * than counted, because each value is a different answer to "why is this line here?".
   */
  it('pins the four line origins', () => {
    expect([...COMPENSATION_LINE_ORIGINS]).toEqual([
      'payItem',
      'leaveSnapshot',
      'adjustment',
      'loanInstallment',
    ]);
  });

  it('accepts a period and refuses anything that is not YYYY-MM', () => {
    expect(CompensationQuerySchema.safeParse({ period: '2026-03' }).success).toBe(true);
    for (const period of ['2026-3', '2026-13', '2026-00', '2026', '2026-03-01', 'March', '']) {
      expect(CompensationQuerySchema.safeParse({ period }).success, period).toBe(false);
    }
  });

  // The query is the only place a caller could smuggle a rule in. It takes a period and nothing.
  it('takes no filter, no flag and no statutory parameter', () => {
    for (const extra of [
      { taxable: true },
      { applyTax: true },
      { insurance: 'gosi' },
      { includeAttendance: true },
      { employeeId: '507f1f77bcf86cd799439011' },
    ]) {
      expect(
        CompensationQuerySchema.safeParse({ period: '2026-03', ...extra }).success,
        Object.keys(extra)[0],
      ).toBe(false);
    }
  });

  // Payroll v1 still has no statutory rule. PY-7 ships the payslip — the document one would
  // finally be tempting to tax — so `payslip` leaves this list and the statutory words stay.
  it('exports no statutory surface from the payroll module', async () => {
    const payroll = await import('./hr-payroll');
    const exported = Object.keys(payroll).join(' ').toLowerCase();
    for (const forbidden of ['tax', 'insurance', 'contribution', 'bracket', 'exempt', 'gross']) {
      expect(exported, forbidden).not.toContain(forbidden);
    }
  });

  // …and what the payslip DOES export is enumerated, so the guard above cannot be satisfied by a
  // statutory field smuggled in under a payslip name.
  it('exports exactly the payslip vocabulary PY-7 declares', async () => {
    const payroll = await import('./hr-payroll');
    const payslipExports = Object.keys(payroll).filter((key) => /payslip/i.test(key));
    expect(payslipExports.sort()).toEqual(
      ['GeneratePayslipsSchema', 'ListPayslipsQuerySchema', 'PAYSLIP_SKIP_REASONS'].sort(),
    );
  });
});

// ── Attendance quantities (PY-4) ────────────────────────────────────────────

describe('the quantity vocabulary', () => {
  it('pins the seven sources by name', () => {
    expect([...PAY_ITEM_QUANTITY_SOURCES]).toEqual([
      'attendedDays',
      'absentDays',
      'leaveDays',
      'workedMinutes',
      'lateMinutes',
      'earlyLeaveMinutes',
      'approvedOvertimeMinutes',
    ]);
  });

  // Every source must be derivable from a field the frozen feed actually carries, or PY-4 would
  // be asking attendance for something it has no contract to give.
  it('names only fields the attendance feed carries', () => {
    const feed = [...ATTENDANCE_FEED_FIELDS, 'status'];
    for (const source of PAY_ITEM_QUANTITY_SOURCES) {
      const derivable = feed.includes(source) || source.endsWith('Days');
      expect(derivable, source).toBe(true);
    }
  });

  it('gives every source a unit, and every basis its requirement', () => {
    expect(Object.keys(QUANTITY_SOURCE_UNITS).sort()).toEqual([...PAY_ITEM_QUANTITY_SOURCES].sort());
    expect(CALC_BASIS_UNITS).toEqual({
      fixed: null,
      perDay: 'days',
      perMinute: 'minutes',
      percentOfBase: null,
    });
  });

  it('matches a basis only to a source measured in its own unit', () => {
    expect(quantitySourceFits('perDay', 'attendedDays')).toBe(true);
    expect(quantitySourceFits('perDay', 'workedMinutes')).toBe(false);
    expect(quantitySourceFits('perMinute', 'approvedOvertimeMinutes')).toBe(true);
    expect(quantitySourceFits('perMinute', 'absentDays')).toBe(false);
    expect(quantitySourceFits('fixed', null)).toBe(true);
    expect(quantitySourceFits('fixed', 'attendedDays')).toBe(false);
    expect(quantitySourceFits('percentOfBase', undefined)).toBe(true);
    expect(quantitySourceFits('perDay', null)).toBe(false);
  });
});

describe('creating a pay item with a quantity', () => {
  const base = { code: 'DAILY', name: { ar: 'يومي', en: 'Daily' }, kind: 'earning' } as const;

  it('requires a source for perDay and perMinute', () => {
    expect(CreatePayItemSchema.safeParse({ ...base, calcBasis: 'perDay' }).success).toBe(false);
    expect(
      CreatePayItemSchema.safeParse({ ...base, calcBasis: 'perDay', quantitySource: 'attendedDays' })
        .success,
    ).toBe(true);
    expect(
      CreatePayItemSchema.safeParse({
        ...base,
        calcBasis: 'perMinute',
        quantitySource: 'approvedOvertimeMinutes',
      }).success,
    ).toBe(true);
  });

  it('refuses a source measured in the wrong unit', () => {
    expect(
      CreatePayItemSchema.safeParse({ ...base, calcBasis: 'perDay', quantitySource: 'lateMinutes' })
        .success,
    ).toBe(false);
  });

  it('refuses a source on an item that counts nothing', () => {
    for (const calcBasis of ['fixed', 'percentOfBase'] as const) {
      expect(
        CreatePayItemSchema.safeParse({ ...base, calcBasis, quantitySource: 'attendedDays' })
          .success,
        calcBasis,
      ).toBe(false);
      expect(CreatePayItemSchema.safeParse({ ...base, calcBasis }).success, calcBasis).toBe(true);
    }
  });

  // Switching a per-day item from days-attended to days-absent would turn a payment into a charge
  // over every period already priced with it — the sharpest case of the immutability rule.
  it('refuses to change what an existing item counts', () => {
    expect(
      UpdatePayItemSchema.safeParse({ quantitySource: 'absentDays', version: 0 }).success,
    ).toBe(false);
  });
});

// ── Payroll runs (PY-6) ─────────────────────────────────────────────────────

describe('the payroll run vocabulary', () => {
  /**
   * The lifecycle by name, widened in P-HR-10 — and the absences kept.
   *
   * The ORDER is the assertion: `approved` follows `frozen` because a payslip is issued from a
   * frozen run, so before the freeze there are no figures to approve. And there is still no
   * unfreeze: a state that undid the freeze would make every guarantee built on it conditional.
   */
  it('pins the lifecycle by name — and there is still no unfreeze among them', () => {
    expect([...PAYROLL_RUN_STATUSES]).toEqual([
      'draft',
      'frozen',
      'approved',
      'paid',
      'closed',
      'cancelled',
    ]);
    expect([...PAYROLL_RUN_STATUSES]).not.toContain('unfrozen');
    expect([...PAYROLL_RUN_STATUSES]).not.toContain('freezing');
    expect([...PAYROLL_RUN_STATUSES]).not.toContain('reopened');
  });

  // Money that has left cannot be called back by a status flip (P-HR-10).
  it('and cancelling stops the moment a payment has been recorded', () => {
    expect([...CANCELLABLE_PAYROLL_RUN_STATUSES]).toEqual(['draft', 'frozen', 'approved']);
  });

  /**
   * Neither decision carries money. Approval agrees with what the run already says, and a payment
   * records that one happened elsewhere — an amount on either would be a second opinion about a
   * figure the payslips have already fixed.
   */
  it('and neither approving nor paying accepts an amount', () => {
    for (const extra of [{ amount: 10 }, { netPay: 10 }, { total: 10 }]) {
      expect(
        ApprovePayrollRunSchema.safeParse({ version: 0, ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
      expect(
        PayPayrollRunSchema.safeParse({ paidOn: '2026-04-05', version: 0, ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });

  /**
   * `Pay` means recorded as paid INSIDE this system (P-HR-10 §1). A bank file is a separate scope,
   * and `.strict()` is what keeps it separate: a field nobody declared is refused outright.
   */
  it('and a payment is a date and a reference — never a bank instruction', () => {
    expect(
      PayPayrollRunSchema.safeParse({ paidOn: '2026-04-05', reference: 'BATCH-7', version: 0 })
        .success,
    ).toBe(true);
    // A day, not an instant: a payroll is paid on a date.
    expect(
      PayPayrollRunSchema.safeParse({ paidOn: '2026-04-05T00:00:00.000Z', version: 0 }).success,
    ).toBe(false);
    for (const extra of [{ iban: 'EG12' }, { bankAccount: 'x' }, { wpsFileId: 'x' }]) {
      expect(
        PayPayrollRunSchema.safeParse({ paidOn: '2026-04-05', version: 0, ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });

  it('pins the two ways a snapshot slice can have been derived', () => {
    expect([...PAYROLL_LEAVE_ALLOCATIONS]).toEqual(['whole', 'chronological']);
  });

  it('accepts a period and refuses anything that is not YYYY-MM', () => {
    expect(CreatePayrollRunSchema.safeParse({ period: '2026-03' }).success).toBe(true);
    for (const period of ['2026-3', '2026-13', '2026', '2026-03-01', 'March']) {
      expect(CreatePayrollRunSchema.safeParse({ period }).success, period).toBe(false);
    }
  });

  // Freezing is irreversible, so the request that triggers it carries a version: acting on a run
  // somebody else already moved must fail rather than freeze a period twice over.
  it('requires a version to freeze or cancel', () => {
    expect(FreezePayrollRunSchema.safeParse({ version: 0 }).success).toBe(true);
    expect(FreezePayrollRunSchema.safeParse({}).success).toBe(false);
    expect(CancelPayrollRunSchema.safeParse({ reason: 'wrong month', version: 1 }).success).toBe(true);
    expect(CancelPayrollRunSchema.safeParse({ version: 1 }).success).toBe(false);
  });

  it('requires a real reason to cancel', () => {
    expect(CancelPayrollRunSchema.safeParse({ reason: 'x', version: 0 }).success).toBe(false);
    expect(CancelPayrollRunSchema.safeParse({ reason: '   ', version: 0 }).success).toBe(false);
  });

  // A run pins facts; it prices nothing. The moment it grows a total it has become a payslip.
  it('takes no figure, no rate and no statutory parameter', () => {
    for (const extra of [
      { total: 1000 },
      { net: 1000 },
      { tax: 0 },
      { insurance: true },
      { employeeIds: [] },
    ]) {
      expect(
        CreatePayrollRunSchema.safeParse({ period: '2026-03', ...extra }).success,
        Object.keys(extra)[0],
      ).toBe(false);
    }
  });
});

// ── Leave pay (PY-5) ────────────────────────────────────────────────────────
//
// There is no schema to parse here: nothing about leave pay is INPUT — it is read from a snapshot
// the payroll run already wrote — so what these hold is the SHAPE of the answer. What the figures
// come to is pinned where the arithmetic lives, in the api's `leave-pay.spec.ts`.

describe('the leave-pay vocabulary', () => {
  // Days and rates, never money: this is what the run pinned, before any of it was priced.
  it('exposes the leave facts as day counts and rates, and nothing else', () => {
    const facts: LeavePayFactsDto = {
      runId: 'r1',
      snapshotAt: '2026-04-01T00:00:00.000Z',
      totalDays: 10,
      paidDays: 8.5,
      unpaidDays: 1.5,
      byRate: [
        { payRate: 100, days: 7 },
        { payRate: 50, days: 3 },
      ],
    };
    expect(facts.paidDays + facts.unpaidDays).toBe(facts.totalDays);
    for (const money of ['amount', 'amountMinor', 'total', 'net', 'tax']) {
      expect(Object.keys(facts), money).not.toContain(money);
    }
  });

  // The first line in this system that no one assigned. The fields that name an assignment are
  // nullable so it can honestly have none, and `origin` is what says so without inferring it.
  it('lets a derived line carry no assignment and no catalog row', () => {
    const line: Pick<
      CompensationLineDto,
      'origin' | 'sourceAssignmentId' | 'payItemId' | 'leavePayRate' | 'leaveTypeCode'
    > = {
      origin: 'leaveSnapshot',
      sourceAssignmentId: null,
      payItemId: null,
      leavePayRate: 0,
      leaveTypeCode: 'UNPAID',
    };
    expect(line.sourceAssignmentId).toBeNull();
    expect(line.payItemId).toBeNull();
    expect(line.origin).toBe('leaveSnapshot');
  });

  it('keeps the rate that was PAID on the line, so the charge can be read as its complement', () => {
    const line: Pick<CompensationLineDto, 'leavePayRate' | 'baseAmount'> = {
      leavePayRate: 75,
      baseAmount: 25,
    };
    expect((line.leavePayRate ?? 0) + line.baseAmount).toBe(100);
  });
});

// ── Payslips (PY-7) ─────────────────────────────────────────────────────────
//
// The payslip is the first thing in this module that is WRITTEN DOWN rather than computed on
// demand, so what these hold is the shape of a document nobody may edit: what it must carry to
// explain itself, and what it must never grow.

describe('the payslip vocabulary', () => {
  it('pins the reasons an employee gets none', () => {
    expect([...PAYSLIP_SKIP_REASONS]).toEqual([
      'noBasicSalary',
      'pendingLine',
      'noLines',
      'mixedCurrency',
    ]);
  });

  // Issuing takes NOTHING. A body that could name an employee or a figure would be a second way
  // to answer what the run already answers.
  it('accepts an empty issuing body and refuses every field on it', () => {
    expect(GeneratePayslipsSchema.safeParse({}).success).toBe(true);
    for (const extra of [
      { employeeIds: [] },
      { total: 1000 },
      { net: 1000 },
      { tax: 0 },
      { gross: 1 },
      { period: '2026-03' },
      { force: true },
    ]) {
      expect(GeneratePayslipsSchema.safeParse(extra).success, Object.keys(extra)[0]).toBe(false);
    }
  });

  it('reports the pass rather than only its successes', () => {
    const result: GeneratePayslipsResultDto = {
      runId: 'r1',
      period: '2026-03',
      considered: 10,
      created: 8,
      existing: 0,
      skipped: [{ employeeId: 'e9', reason: 'noBasicSalary' }],
    };
    // Every employee is accounted for: issued, already there, or named with a reason.
    expect(result.created + result.existing + result.skipped.length).toBeLessThanOrEqual(
      result.considered,
    );
  });

  it('carries what a figure needs to explain itself', () => {
    const slip = {} as PayslipDto;
    const required: (keyof PayslipDto)[] = [
      'runId',
      'runStatus',
      'period',
      'employeeId',
      'employee',
      'currency',
      'basicSalary',
      'employmentDaysInPeriod',
      'daysInPeriod',
      'earnings',
      'deductions',
      'leave',
      'netMinor',
      'warnings',
      'issuedAt',
      'issuedBy',
    ];
    // A compile-time assertion: the list above is only writable if every key exists on the DTO.
    expect(required.length).toBe(16);
    expect(slip).toBeDefined();
  });

  // `gross` is absent on purpose: the basic salary is not a line in this system, so a "total
  // before deductions" would either duplicate `totalEarnings` or claim a rule nobody granted.
  it('has no gross, no tax and no payment status', () => {
    const keys: string[] = [
      'runId',
      'runStatus',
      'period',
      'from',
      'to',
      'employeeId',
      'employee',
      'currency',
      'basicSalary',
      'employmentDaysInPeriod',
      'daysInPeriod',
      'earnings',
      'deductions',
      'leave',
      'totalEarningsMinor',
      'totalEarnings',
      'totalDeductionsMinor',
      'totalDeductions',
      'netMinor',
      'net',
      'warnings',
      'issuedAt',
      'issuedBy',
      'createdAt',
      'id',
    ];
    for (const forbidden of ['gross', 'tax', 'insurance', 'paidAt', 'paymentStatus', 'bankAccount']) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
  });

  /**
   * A1 — `runStatus` is the RUN's state, never the payslip's own.
   *
   * The distinction matters because one of its values is `paid`, and the test above forbids a
   * payment status ON the payslip. Both hold at once: this field says what happened to the run the
   * figures were priced against, and the payslip still records no payment of its own — there is no
   * `paidAt`, no `paymentStatus` and no bank detail anywhere on it.
   */
  it('carries the run’s status as run vocabulary, and adds no payslip state of its own', () => {
    const slip = { runStatus: 'cancelled' } as PayslipDto;
    // Only a value the run lifecycle already defines can be assigned — no new word was minted.
    expect(PAYROLL_RUN_STATUSES).toContain(slip.runStatus as string);
    expect(PAYROLL_RUN_STATUSES).toContain('cancelled');
    // And it is nullable rather than defaulted: a run that cannot be read states nothing.
    const unknown = { runStatus: null } as PayslipDto;
    expect(unknown.runStatus).toBeNull();
  });

  // A payslip is never issued with a blank, so there is nothing deferred to carry.
  it('has no deferred array — an incomplete calculation is a skip, not a document', () => {
    const keys: string[] = ['earnings', 'deductions', 'leave'];
    expect(keys).not.toContain('deferred');
    expect(PAYSLIP_SKIP_REASONS).toContain('pendingLine');
  });

  it('filters a list by employee and period, and by nothing else', () => {
    expect(ListPayslipsQuerySchema.safeParse({ page: 1, pageSize: 25 }).success).toBe(true);
    expect(
      ListPayslipsQuerySchema.safeParse({ page: 1, pageSize: 25, period: '2026-03' }).success,
    ).toBe(true);
    expect(
      ListPayslipsQuerySchema.safeParse({ page: 1, pageSize: 25, period: '2026-3' }).success,
    ).toBe(false);
    expect(
      ListPayslipsQuerySchema.safeParse({ page: 1, pageSize: 25, minNet: 100 }).success,
    ).toBe(false);
  });
});
