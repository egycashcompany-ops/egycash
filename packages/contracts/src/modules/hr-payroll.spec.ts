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
  COMPENSATION_LINE_STATES,
  COMPENSATION_WARNINGS,
  CompensationQuerySchema,
  CreateEmployeePayItemSchema,
  CreatePayItemSchema,
  EMPLOYEE_PAY_ITEM_REMOVALS,
  PAY_ITEM_CALC_BASES,
  PAY_ITEM_KINDS,
  PAY_ITEM_QUANTITY_SOURCES,
  QUANTITY_SOURCE_UNITS,
  UpdatePayItemSchema,
  quantitySourceFits,
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
  it('pins the two line states by name', () => {
    expect([...COMPENSATION_LINE_STATES]).toEqual(['computed', 'pendingQuantity']);
  });

  it('pins the two warnings by name', () => {
    expect([...COMPENSATION_WARNINGS]).toEqual(['legacyAllowancesIgnored', 'netBelowZero']);
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

  // Payroll v1 still has no statutory rule, and PY-3 is where one would first be tempting: the
  // phase that finally produces a figure someone might want to tax.
  it('exports no statutory surface from the payroll module', async () => {
    const payroll = await import('./hr-payroll');
    const exported = Object.keys(payroll).join(' ').toLowerCase();
    for (const forbidden of ['tax', 'insurance', 'contribution', 'bracket', 'payslip', 'exempt']) {
      expect(exported, forbidden).not.toContain(forbidden);
    }
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
