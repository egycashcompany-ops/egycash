// The compensation rules, exercised without a database (PY-3).
//
// The engine is pure, so there is no excuse for leaving a case out — and the cases that matter are
// the calendar ones: a 28-day February, a slice that starts mid-month, an employee rehired between
// two spans. Each assertion below states the arithmetic it expects rather than recomputing it, so
// a change in the rule fails with a number a reader can argue with.
import { describe, expect, it } from 'vitest';
import { type AttendanceFeedRow, type CompensationLineDto } from '@ecms/contracts';
import { BusinessRuleError } from '../../../../shared/errors';
import { type FrozenAttendance } from './attendance-quantities';
import { type FrozenLeave } from './leave-pay';
import {
  computeCompensation,
  daysInForce,
  daysWithin,
  periodRange,
  type AssignmentInput,
  type CompensationInput,
} from './compensation-rules';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const item = (
  over: Partial<AssignmentInput['item']> = {},
): AssignmentInput['item'] => ({
  code: 'HOUSING',
  name: { ar: 'بدل سكن', en: 'Housing' },
  kind: 'earning',
  calcBasis: 'fixed',
  quantitySource: null,
  sortOrder: 10,
  ...over,
});

const assignment = (over: Partial<AssignmentInput> = {}): AssignmentInput => ({
  id: 'a1',
  payItemId: 'p1',
  amount: 3000,
  currency: 'EGP',
  effectiveFrom: d('2020-01-01'),
  effectiveTo: null,
  item: item(),
  ...over,
});

const input = (over: Partial<CompensationInput> = {}): CompensationInput => ({
  employeeId: 'e1',
  period: '2026-03',
  basicSalary: { amount: 10_000, currency: 'EGP' },
  employmentSpans: [{ from: d('2020-01-01'), to: null }],
  assignments: [],
  hasLegacyAllowances: false,
  // P-HR-04 — no one-off decision, which is what every case below predates.
  adjustments: [],
  loanInstallments: [],
  attendance: null,
  // PY-5 — the default is "no run has pinned this period", which is what every PY-3 and PY-4 case
  // below assumes: they predate leave pricing and must keep answering exactly as they did.
  leave: null,
  ...over,
});

/**
 * The deferred lines that came from an ASSIGNMENT.
 *
 * Every case in this file leaves `leave` null, which since PY-5 means the period has no frozen
 * run and earns one `pendingLeaveSnapshot` line of its own. That line is correct and is asserted
 * where it belongs; here it is simply not the subject, so these cases say which deferral they
 * mean instead of counting the whole array.
 */
const deferredItems = (result: { deferred: CompensationLineDto[] }): CompensationLineDto[] =>
  result.deferred.filter((line) => line.origin === 'payItem');

describe('periodRange', () => {
  it('bounds each month by its real last day', () => {
    expect(periodRange('2026-03').to.toISOString().slice(0, 10)).toBe('2026-03-31');
    expect(periodRange('2026-02').to.toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(periodRange('2028-02').to.toISOString().slice(0, 10)).toBe('2028-02-29');
    expect(periodRange('2026-04').to.toISOString().slice(0, 10)).toBe('2026-04-30');
  });

  it('refuses anything that is not YYYY-MM', () => {
    for (const bad of ['2026-3', '2026-13', '2026-00', 'March', '2026', '2026-03-01']) {
      expect(() => periodRange(bad), bad).toThrow(BusinessRuleError);
    }
  });
});

describe('day counting is inclusive at BOTH ends', () => {
  const march = periodRange('2026-03');

  it('counts a whole month as its whole length', () => {
    expect(daysWithin(march, [{ from: d('2020-01-01'), to: null }])).toBe(31);
  });

  it('counts a single day as one, not zero', () => {
    expect(daysWithin(march, [{ from: d('2026-03-10'), to: d('2026-03-10') }])).toBe(1);
  });

  // The property that makes proration add up: splitting a month at any point loses no day.
  it('splits a month without losing or gaining a day', () => {
    const first = daysWithin(march, [{ from: d('2026-03-01'), to: d('2026-03-16') }]);
    const rest = daysWithin(march, [{ from: d('2026-03-17'), to: d('2026-03-31') }]);
    expect(first).toBe(16);
    expect(rest).toBe(15);
    expect(first + rest).toBe(31);
  });

  it('sums disjoint spans and skips the gap between them — a rehire', () => {
    expect(
      daysWithin(march, [
        { from: d('2026-03-01'), to: d('2026-03-10') },
        { from: d('2026-03-21'), to: null },
      ]),
    ).toBe(10 + 11);
  });

  it('is zero when nothing overlaps', () => {
    expect(daysWithin(march, [{ from: d('2026-05-01'), to: null }])).toBe(0);
    expect(daysWithin(march, [])).toBe(0);
  });
});

describe('daysInForce — assignment ∩ period ∩ employment', () => {
  const march = periodRange('2026-03');
  const employed = [{ from: d('2020-01-01'), to: null }];

  it('clips an assignment that starts inside the period', () => {
    expect(daysInForce({ effectiveFrom: d('2026-03-16'), effectiveTo: null }, march, employed)).toBe(16);
  });

  it('clips one that ends inside it', () => {
    expect(
      daysInForce({ effectiveFrom: d('2020-01-01'), effectiveTo: d('2026-03-15') }, march, employed),
    ).toBe(15);
  });

  // D2 — the employment leg. Nothing is written to say the assignment ended; it simply stops
  // being in force on the day the person left.
  it('clips at the exit even when the assignment is open-ended', () => {
    expect(
      daysInForce({ effectiveFrom: d('2020-01-01'), effectiveTo: null }, march, [
        { from: d('2020-01-01'), to: d('2026-03-10') },
      ]),
    ).toBe(10);
  });

  it('is zero for an assignment that does not reach the period at all', () => {
    expect(
      daysInForce({ effectiveFrom: d('2026-05-01'), effectiveTo: null }, march, employed),
    ).toBe(0);
  });
});

describe('fixed items', () => {
  it('pays the whole amount for a whole month', () => {
    const result = computeCompensation(input({ assignments: [assignment()] }));
    expect(result.earnings).toHaveLength(1);
    expect(result.earnings[0]?.amount).toBe(3000);
    expect(result.earnings[0]?.prorationFactor).toBe(1);
    expect(result.totalEarnings).toBe(3000);
    expect(result.net).toBe(3000);
  });

  it('prorates by calendar days, and the two halves of a month add back to the whole', () => {
    const early = computeCompensation(
      input({ assignments: [assignment({ effectiveTo: d('2026-03-15') })] }),
    );
    const late = computeCompensation(
      input({ assignments: [assignment({ effectiveFrom: d('2026-03-16') })] }),
    );
    expect(early.earnings[0]?.amount).toBe(1451.61); // 3000 × 15/31
    expect(late.earnings[0]?.amount).toBe(1548.39); // 3000 × 16/31
    expect((early.earnings[0]?.amount ?? 0) + (late.earnings[0]?.amount ?? 0)).toBe(3000);
  });

  it('prorates a single day, and reports the fraction it used', () => {
    const result = computeCompensation(
      input({
        assignments: [assignment({ effectiveFrom: d('2026-03-05'), effectiveTo: d('2026-03-05') })],
      }),
    );
    expect(result.earnings[0]?.amount).toBe(96.77); // 3000 × 1/31
    expect(result.earnings[0]?.daysInForce).toBe(1);
    expect(result.earnings[0]?.daysInPeriod).toBe(31);
  });

  it('uses the month’s own length as the denominator', () => {
    const february = computeCompensation(input({ period: '2026-02', assignments: [assignment()] }));
    expect(february.daysInPeriod).toBe(28);
    expect(february.earnings[0]?.amount).toBe(3000);
  });

  it('leaves out an assignment that is not in force at all, rather than showing a zero', () => {
    const result = computeCompensation(
      input({ assignments: [assignment({ effectiveFrom: d('2026-06-01') })] }),
    );
    expect(result.earnings).toEqual([]);
    expect(result.net).toBe(0);
  });
});

describe('percentOfBase', () => {
  const percent = (amount: number, over: Partial<AssignmentInput> = {}): AssignmentInput =>
    assignment({
      amount,
      item: item({ code: 'PCT', calcBasis: 'percentOfBase', sortOrder: 20 }),
      ...over,
    });

  it('reads the figure as a human percentage of the BASIC SALARY only', () => {
    const result = computeCompensation(input({ assignments: [percent(10)] }));
    expect(result.earnings[0]?.amount).toBe(1000); // 10% of 10,000 — not of 10,000 + anything
    expect(result.earnings[0]?.baseAmount).toBe(10);
  });

  // Two factors, one rounding: applying the percentage and then the proration separately would
  // round twice and lose a piastre nothing could put back.
  it('folds the percentage and the proration into a single rounding step', () => {
    const result = computeCompensation(
      input({ assignments: [percent(10, { effectiveFrom: d('2026-03-16') })] }),
    );
    expect(result.earnings[0]?.amount).toBe(516.13); // 10,000 × 0.10 × 16/31 = 516.129…
  });

  it('does not prorate the base itself — the factor is applied once, to the result', () => {
    const half = computeCompensation(
      input({ assignments: [percent(50, { effectiveFrom: d('2026-03-16') })] }),
    );
    expect(half.earnings[0]?.amount).toBe(2580.65); // 10,000 × 0.50 × 16/31, not × 16/31 twice
  });

  it('refuses when the employee has no basic salary — that is undefined, not zero (F4)', () => {
    expect(() =>
      computeCompensation(input({ basicSalary: null, assignments: [percent(10)] })),
    ).toThrow(BusinessRuleError);
  });

  // D6 — a safety bound against an input slip, not a legal rule.
  it('refuses a percentage outside 0–100', () => {
    expect(() => computeCompensation(input({ assignments: [percent(101)] }))).toThrow(
      BusinessRuleError,
    );
    expect(() => computeCompensation(input({ assignments: [percent(100)] }))).not.toThrow();
  });
});

describe('perDay and perMinute with no frozen attendance (D7 · PY-4 D2)', () => {
  const perDay = assignment({
    id: 'a2',
    amount: 250,
    item: item({ code: 'PER_DAY', calcBasis: 'perDay', quantitySource: 'attendedDays', sortOrder: 30 }),
  });

  it('shows the line but gives it no figure while the period is unfrozen', () => {
    const result = computeCompensation(input({ assignments: [perDay] }));
    expect(deferredItems(result)).toHaveLength(1);
    expect(result.deferred[0]?.state).toBe('pendingQuantity');
    expect(result.deferred[0]?.amount).toBeNull();
    expect(result.deferred[0]?.amountMinor).toBeNull();
    expect(result.deferred[0]?.prorationFactor).toBeNull();
    // …and it stays out of the earnings, the deductions and every total.
    expect(result.earnings).toEqual([]);
    expect(result.totalEarnings).toBe(0);
    expect(result.net).toBe(0);
  });

  it('does the same for perMinute', () => {
    const result = computeCompensation(
      input({
        assignments: [
          assignment({
            item: item({
              code: 'OT_RATE',
              calcBasis: 'perMinute',
              quantitySource: 'approvedOvertimeMinutes',
              sortOrder: 40,
            }),
          }),
        ],
      }),
    );
    expect(result.deferred[0]?.state).toBe('pendingQuantity');
    expect(result.totalEarnings).toBe(0);
  });
});

describe('earnings, deductions and the net', () => {
  const earning = assignment({ id: 'e', amount: 1000, item: item({ code: 'BONUS', sortOrder: 10 }) });
  const deduction = assignment({
    id: 'd',
    amount: 300,
    item: item({ code: 'LOAN', kind: 'deduction', sortOrder: 20 }),
  });

  it('separates the two sides and nets them', () => {
    const result = computeCompensation(input({ assignments: [deduction, earning] }));
    expect(result.earnings.map((l) => l.code)).toEqual(['BONUS']);
    expect(result.deductions.map((l) => l.code)).toEqual(['LOAN']);
    expect(result.totalEarnings).toBe(1000);
    expect(result.totalDeductions).toBe(300);
    expect(result.net).toBe(700);
  });

  // D4 — reported exactly as computed. Flooring pay at zero is a labour rule nobody has granted.
  it('reports a negative net with a warning instead of flooring it', () => {
    const result = computeCompensation(
      input({
        assignments: [
          assignment({ id: 'd1', amount: 5000, item: item({ code: 'LOAN', kind: 'deduction' }) }),
          earning,
        ],
      }),
    );
    expect(result.net).toBe(-4000);
    expect(result.warnings).toContain('netBelowZero');
  });

  it('adds the lines shown to exactly the total shown', () => {
    const thirds = [1, 2, 3].map((n) =>
      assignment({
        id: `t${String(n)}`,
        payItemId: `p${String(n)}`,
        amount: 33.33,
        item: item({ code: `T${String(n)}`, sortOrder: n }),
      }),
    );
    const result = computeCompensation(input({ assignments: thirds }));
    const shown = result.earnings.reduce((sum, l) => sum + (l.amount ?? 0), 0);
    expect(result.totalEarnings).toBe(shown);
    expect(result.totalEarningsMinor).toBe(9999);
  });
});

describe('deterministic order', () => {
  it('sorts earnings before deductions, then by catalog order, then by code', () => {
    const make = (code: string, kind: 'earning' | 'deduction', sortOrder: number): AssignmentInput =>
      assignment({ id: code, payItemId: code, amount: 10, item: item({ code, kind, sortOrder }) });

    const scrambled = [
      make('ZED', 'deduction', 10),
      make('BETA', 'earning', 20),
      make('ALPHA', 'earning', 20),
      make('AAA', 'deduction', 5),
      make('GAMMA', 'earning', 10),
    ];
    const result = computeCompensation(input({ assignments: scrambled }));
    expect(result.earnings.map((l) => l.code)).toEqual(['GAMMA', 'ALPHA', 'BETA']);
    expect(result.deductions.map((l) => l.code)).toEqual(['AAA', 'ZED']);
  });

  it('produces the same output for the same input, whatever order it arrives in', () => {
    const items = [
      assignment({ id: '1', payItemId: '1', item: item({ code: 'AAA', sortOrder: 30 }) }),
      assignment({ id: '2', payItemId: '2', item: item({ code: 'BBB', sortOrder: 10 }) }),
      assignment({ id: '3', payItemId: '3', item: item({ code: 'CCC', sortOrder: 20 }) }),
    ];
    const forwards = computeCompensation(input({ assignments: items }));
    const backwards = computeCompensation(input({ assignments: [...items].reverse() }));
    expect(backwards).toEqual(forwards);
  });
});

describe('currency (one per calculation)', () => {
  it('refuses the WHOLE calculation when an item is in another currency', () => {
    expect(() =>
      computeCompensation(input({ assignments: [assignment({ currency: 'USD' })] })),
    ).toThrow(BusinessRuleError);
  });

  it('reports the basic salary’s currency as the calculation’s', () => {
    const result = computeCompensation(
      input({
        basicSalary: { amount: 10_000, currency: 'SAR' },
        assignments: [assignment({ currency: 'SAR' })],
      }),
    );
    expect(result.currency).toBe('SAR');
  });
});

describe('employment periods', () => {
  it('reports the employed days of the period, not the whole month', () => {
    const result = computeCompensation(
      input({ employmentSpans: [{ from: d('2026-03-16'), to: null }] }),
    );
    expect(result.employmentDaysInPeriod).toBe(16);
    expect(result.daysInPeriod).toBe(31);
  });

  it('counts two spans and the gap between them correctly (a rehire)', () => {
    const result = computeCompensation(
      input({
        employmentSpans: [
          { from: d('2020-01-01'), to: d('2026-03-10') },
          { from: d('2026-03-21'), to: null },
        ],
        assignments: [assignment()],
      }),
    );
    expect(result.employmentDaysInPeriod).toBe(21);
    expect(result.earnings[0]?.daysInForce).toBe(21);
    expect(result.earnings[0]?.amount).toBe(2032.26); // 3000 × 21/31
  });

  it('produces nothing at all for a period outside every span', () => {
    const result = computeCompensation(
      input({
        employmentSpans: [{ from: d('2020-01-01'), to: d('2025-12-31') }],
        assignments: [assignment()],
      }),
    );
    expect(result.employmentDaysInPeriod).toBe(0);
    expect(result.earnings).toEqual([]);
    expect(result.net).toBe(0);
  });
});

describe('what the result refuses to claim', () => {
  // D1 — the older allowance list is not read, and the reader is told so rather than left to
  // wonder why a figure they can see on the employment tab is missing here.
  it('warns when the legacy allowance list is present, and still ignores it', () => {
    const result = computeCompensation(input({ hasLegacyAllowances: true }));
    expect(result.warnings).toContain('legacyAllowancesIgnored');
    expect(result.totalEarnings).toBe(0);
  });

  it('carries no tax, insurance or payslip field anywhere in the result', () => {
    const result = computeCompensation(input({ assignments: [assignment()] }));
    const serialized = JSON.stringify(result).toLowerCase();
    for (const forbidden of ['tax', 'insurance', 'payslip', 'gross', 'takehome', 'contribution']) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
    for (const forbidden of ['taxable', 'insurable', 'grossPay', 'netPay']) {
      expect(result, forbidden).not.toHaveProperty(forbidden);
    }
  });
});

// ── PY-4 — pricing from frozen attendance ───────────────────────────────────

const feedRow = (
  workDate: string,
  status: string,
  over: Record<string, unknown> = {},
): AttendanceFeedRow =>
  ({
    employeeId: 'e1',
    workDate,
    status,
    shiftId: 's1',
    workedMinutes: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    approvedOvertimeMinutes: 0,
    leaveId: null,
    branchId: 'b1',
    flags: [],
    frozenAt: '2026-04-01T03:00:00.000Z',
    ...over,
  }) as AttendanceFeedRow;

const frozen = (rows: AttendanceFeedRow[]): FrozenAttendance => ({
  rows,
  frozenAt: '2026-04-01T03:00:00.000Z',
});

const perDayItem = (over: Partial<AssignmentInput> = {}): AssignmentInput =>
  assignment({
    id: 'q1',
    amount: 100,
    item: item({ code: 'DAILY', calcBasis: 'perDay', quantitySource: 'attendedDays', sortOrder: 30 }),
    ...over,
  });

describe('quantity lines price from the frozen feed', () => {
  const tenAttended = Array.from({ length: 10 }, (_, i) =>
    feedRow(`2026-03-${String(i + 2).padStart(2, '0')}`, 'present'),
  );

  it('multiplies the rate by the counted quantity', () => {
    const result = computeCompensation(
      input({ assignments: [perDayItem()], attendance: frozen(tenAttended) }),
    );
    expect(result.earnings).toHaveLength(1);
    expect(result.earnings[0]?.quantity).toBe(10);
    expect(result.earnings[0]?.amount).toBe(1000); // 100 × 10
    expect(deferredItems(result)).toEqual([]);
    expect(result.totalEarnings).toBe(1000);
  });

  it('records the provenance the figure needs to explain itself', () => {
    const line = computeCompensation(
      input({ assignments: [perDayItem()], attendance: frozen(tenAttended) }),
    ).earnings[0];
    expect(line?.quantitySource).toBe('attendedDays');
    expect(line?.quantityUnit).toBe('days');
    expect(line?.feedFrozenAt).toBe('2026-04-01T03:00:00.000Z');
    expect(line?.baseAmount).toBe(100);
  });

  /**
   * The rule the whole phase turns on. The quantity was counted over the slice already, so
   * applying `daysInForce / daysInPeriod` on top would charge the same absence twice.
   */
  it('NEVER prorates a quantity line, even when the item ran for part of the month', () => {
    const halfMonth = computeCompensation(
      input({
        assignments: [perDayItem({ effectiveFrom: d('2026-03-16') })],
        attendance: frozen(tenAttended),
      }),
    );
    const line = halfMonth.earnings[0];
    expect(line?.prorationFactor).toBeNull();
    // Only the attendance inside the slice counts — the 16th onwards, so none of the first ten.
    expect(line?.quantity).toBe(0);
    expect(line?.amount).toBe(0);

    // …and with attendance inside the slice, the figure is the raw product, not a fraction of it.
    const inSlice = computeCompensation(
      input({
        assignments: [perDayItem({ effectiveFrom: d('2026-03-16') })],
        attendance: frozen([feedRow('2026-03-20', 'present'), feedRow('2026-03-21', 'present')]),
      }),
    );
    expect(inSlice.earnings[0]?.quantity).toBe(2);
    expect(inSlice.earnings[0]?.amount).toBe(200); // 100 × 2, NOT 100 × 2 × 16/31
  });

  it('shows a real zero when the period is frozen and nothing was counted', () => {
    const result = computeCompensation(
      input({
        assignments: [perDayItem()],
        attendance: frozen([feedRow('2026-03-07', 'weekend'), feedRow('2026-03-08', 'holiday')]),
      }),
    );
    // A KNOWN zero, unlike the unfrozen case: computed, in the earnings, in the totals.
    expect(result.earnings[0]?.state).toBe('computed');
    expect(result.earnings[0]?.quantity).toBe(0);
    expect(result.earnings[0]?.amount).toBe(0);
    expect(deferredItems(result)).toEqual([]);
  });

  it('leaves the line pending when the period is not frozen, and never guesses a zero', () => {
    const result = computeCompensation(input({ assignments: [perDayItem()], attendance: null }));
    expect(result.deferred[0]?.state).toBe('pendingQuantity');
    expect(result.deferred[0]?.quantity).toBeNull();
    expect(result.deferred[0]?.feedFrozenAt).toBeNull();
    expect(result.earnings).toEqual([]);
    expect(result.totalEarnings).toBe(0);
  });

  it('leaves it pending when the item somehow carries no source', () => {
    const result = computeCompensation(
      input({
        assignments: [
          assignment({ item: item({ code: 'NO_SRC', calcBasis: 'perDay', quantitySource: null }) }),
        ],
        attendance: frozen(tenAttended),
      }),
    );
    expect(result.deferred[0]?.state).toBe('pendingQuantity');
  });

  it('nets a per-minute deduction against a per-day earning', () => {
    const result = computeCompensation(
      input({
        assignments: [
          perDayItem(),
          assignment({
            id: 'q2',
            amount: 2,
            item: item({
              code: 'LATE_FEE',
              kind: 'deduction',
              calcBasis: 'perMinute',
              quantitySource: 'lateMinutes',
              sortOrder: 40,
            }),
          }),
        ],
        attendance: frozen([
          ...tenAttended,
          feedRow('2026-03-13', 'late', { lateMinutes: 25 }),
        ]),
      }),
    );
    expect(result.earnings[0]?.amount).toBe(1100); // 11 attended days × 100
    expect(result.deductions[0]?.amount).toBe(50); // 25 late minutes × 2
    expect(result.net).toBe(1050);
  });

  it('counts only the days the employee was employed for', () => {
    const result = computeCompensation(
      input({
        assignments: [perDayItem()],
        employmentSpans: [{ from: d('2026-03-06'), to: null }],
        attendance: frozen(tenAttended),
      }),
    );
    expect(result.earnings[0]?.quantity).toBe(6); // the 6th to the 11th
    expect(result.earnings[0]?.amount).toBe(600);
  });

  it('leaves flat and percentage lines exactly as PY-3 priced them', () => {
    const result = computeCompensation(
      input({
        assignments: [assignment()],
        attendance: frozen(tenAttended),
      }),
    );
    expect(result.earnings[0]?.prorationFactor).toBe(1);
    expect(result.earnings[0]?.quantity).toBeNull();
    expect(result.earnings[0]?.quantitySource).toBeNull();
    expect(result.earnings[0]?.feedFrozenAt).toBeNull();
    expect(result.earnings[0]?.amount).toBe(3000);
  });

  it('is deterministic — the same frozen input prices the same twice', () => {
    const once = computeCompensation(
      input({ assignments: [perDayItem()], attendance: frozen(tenAttended) }),
    );
    const twice = computeCompensation(
      input({ assignments: [perDayItem()], attendance: frozen([...tenAttended].reverse()) }),
    );
    expect(twice).toEqual(once);
  });
});

// ── PY-5 — the leave lines ──────────────────────────────────────────────────
//
// The first lines in this engine that nobody assigned. What they are worth is settled in
// `leave-pay.spec.ts`; what matters here is where they land: in the deductions, out of the
// earnings, inside the totals, and carrying the provenance that says they were derived.

const pinned = (slices: FrozenLeave['slices']): FrozenLeave => ({
  runId: 'run1',
  snapshotAt: '2026-04-01T09:00:00.000Z',
  slices,
});

const unpaidDay = pinned([{ typeCode: 'UNPAID', days: 1, breakdown: [{ days: 1, payRate: 0 }] }]);

describe('leave lines (PY-5)', () => {
  it('deducts the shortfall and says where it came from', () => {
    const result = computeCompensation(input({ leave: unpaidDay }));
    expect(result.deductions).toHaveLength(1);
    const line = result.deductions[0];
    expect(line?.origin).toBe('leaveSnapshot');
    expect(line?.sourceAssignmentId).toBeNull();
    expect(line?.payItemId).toBeNull();
    expect(line?.leavePayRate).toBe(0);
    expect(line?.leaveTypeCode).toBe('UNPAID');
    expect(line?.baseAmount).toBe(100); // the percentage CHARGED, the complement of the rate
    expect(line?.state).toBe('computed');
    // 10,000 ÷ 31 = 322.58
    expect(line?.amount).toBe(322.58);
    expect(result.totalDeductions).toBe(322.58);
    expect(result.net).toBe(-322.58);
  });

  it('produces NO line for leave paid in full — not a zero one', () => {
    const result = computeCompensation(
      input({
        leave: pinned([{ typeCode: 'ANNUAL', days: 5, breakdown: [{ days: 5, payRate: 100 }] }]),
      }),
    );
    expect(result.deductions).toEqual([]);
    expect(result.deferred).toEqual([]);
    expect(result.totalDeductions).toBe(0);
    // …and the days are still REPORTED, so a reader is not left wondering where the leave went.
    expect(result.leave?.totalDays).toBe(5);
    expect(result.leave?.paidDays).toBe(5);
    expect(result.leave?.unpaidDays).toBe(0);
  });

  it('splits a tiered consumption into one line per rate', () => {
    const result = computeCompensation(
      input({
        leave: pinned([
          { typeCode: 'SICK', days: 10, breakdown: [{ days: 7, payRate: 100 }, { days: 3, payRate: 50 }] },
        ]),
      }),
    );
    // Only the 50% tier costs anything; the 100% tier is not a line at all.
    expect(result.deductions).toHaveLength(1);
    expect(result.deductions[0]?.leavePayRate).toBe(50);
    expect(result.deductions[0]?.daysInForce).toBe(3);
    // 10,000 × 50% × 3 ÷ 31 = 483.87
    expect(result.deductions[0]?.amount).toBe(483.87);
  });

  it('carries the run stamp so the figure names its own version of the truth', () => {
    const result = computeCompensation(input({ leave: unpaidDay }));
    expect(result.leave?.snapshotAt).toBe('2026-04-01T09:00:00.000Z');
    expect(result.leave?.runId).toBe('run1');
    // …and NOT on the attendance stamp, which this line never touched.
    expect(result.deductions[0]?.feedFrozenAt).toBeNull();
  });

  it('nets a leave deduction against an assigned earning', () => {
    const result = computeCompensation(input({ assignments: [assignment()], leave: unpaidDay }));
    expect(result.totalEarnings).toBe(3000);
    expect(result.totalDeductions).toBe(322.58);
    expect(result.net).toBe(2677.42);
    expect(result.warnings).toEqual([]);
  });

  it('keeps the assigned deductions before the derived ones', () => {
    const result = computeCompensation(
      input({
        assignments: [
          assignment({ item: item({ code: 'LOAN', kind: 'deduction', sortOrder: 5 }) }),
        ],
        leave: unpaidDay,
      }),
    );
    expect(result.deductions.map((l) => l.code)).toEqual(['LOAN', 'LEAVE_SHORTFALL']);
  });

  it('prices half a day as half a day', () => {
    const result = computeCompensation(
      input({
        leave: pinned([{ typeCode: 'UNPAID', days: 0.5, breakdown: [{ days: 0.5, payRate: 0 }] }]),
      }),
    );
    expect(result.deductions[0]?.daysInForce).toBe(0.5);
    // 10,000 × 0.5 ÷ 31 = 161.29
    expect(result.deductions[0]?.amount).toBe(161.29);
  });

  it('answers a frozen period with no leave as a real zero, not a pending line', () => {
    const result = computeCompensation(input({ leave: pinned([]) }));
    expect(result.deductions).toEqual([]);
    expect(result.deferred).toEqual([]);
    expect(result.leave?.totalDays).toBe(0);
  });
});

describe('leave with no frozen run (D4)', () => {
  it('defers one line rather than charging a confident nothing', () => {
    const result = computeCompensation(input({ leave: null }));
    expect(result.deferred).toHaveLength(1);
    const line = result.deferred[0];
    expect(line?.state).toBe('pendingLeaveSnapshot');
    expect(line?.origin).toBe('leaveSnapshot');
    expect(line?.amount).toBeNull();
    expect(line?.amountMinor).toBeNull();
    expect(line?.quantity).toBeNull();
    expect(result.leave).toBeNull();
  });

  it('keeps the deferred leave line out of every total', () => {
    const result = computeCompensation(input({ assignments: [assignment()], leave: null }));
    expect(result.totalEarnings).toBe(3000);
    expect(result.totalDeductions).toBe(0);
    expect(result.net).toBe(3000);
  });

  it('is a different word from an unfrozen quantity, because the fix is different', () => {
    const result = computeCompensation(
      input({
        assignments: [
          assignment({ item: item({ calcBasis: 'perDay', quantitySource: 'attendedDays' }) }),
        ],
        attendance: null,
        leave: null,
      }),
    );
    expect(result.deferred.map((l) => l.state)).toEqual([
      'pendingQuantity',
      'pendingLeaveSnapshot',
    ]);
  });
});

describe('the double-count warning (D5)', () => {
  const leaveDaysItem = assignment({
    id: 'a9',
    amount: 200,
    item: item({ code: 'LEAVE_PAY', calcBasis: 'perDay', quantitySource: 'leaveDays', sortOrder: 50 }),
  });
  const oneLeaveRow: AttendanceFeedRow[] = [
    {
      employeeId: 'e1',
      workDate: '2026-03-10',
      status: 'onLeave',
      shiftId: null,
      workedMinutes: 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      approvedOvertimeMinutes: 0,
      leaveId: 'l1',
      branchId: 'b1',
      flags: [],
      frozenAt: '2026-04-01T00:00:00.000Z',
    },
  ];

  it('warns when the same absence is charged from both sides', () => {
    const result = computeCompensation(
      input({
        assignments: [leaveDaysItem],
        attendance: { rows: oneLeaveRow, frozenAt: '2026-04-01T00:00:00.000Z' },
        leave: unpaidDay,
      }),
    );
    expect(result.warnings).toContain('leaveDaysAlsoPriced');
  });

  it('stays quiet when the leave side charged nothing', () => {
    const result = computeCompensation(
      input({
        assignments: [leaveDaysItem],
        attendance: { rows: oneLeaveRow, frozenAt: '2026-04-01T00:00:00.000Z' },
        leave: pinned([{ typeCode: 'ANNUAL', days: 1, breakdown: [{ days: 1, payRate: 100 }] }]),
      }),
    );
    expect(result.warnings).toEqual([]);
  });

  it('stays quiet when no item is priced on leaveDays', () => {
    const result = computeCompensation(input({ assignments: [assignment()], leave: unpaidDay }));
    expect(result.warnings).toEqual([]);
  });

  // It WARNS — it does not hide the item and it does not refuse. An organization may have a
  // reason to pay for leave days as well, and a silently dropped line explains nothing.
  it('still prices both lines', () => {
    const result = computeCompensation(
      input({
        assignments: [leaveDaysItem],
        attendance: { rows: oneLeaveRow, frozenAt: '2026-04-01T00:00:00.000Z' },
        leave: unpaidDay,
      }),
    );
    expect(result.earnings).toHaveLength(1);
    expect(result.earnings[0]?.amount).toBe(200);
    expect(result.deductions).toHaveLength(1);
  });
});
