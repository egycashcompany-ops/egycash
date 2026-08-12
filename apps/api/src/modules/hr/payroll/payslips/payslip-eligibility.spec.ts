// Who gets a payslip, and who is reported instead (PY-7). No database.
//
// The two questions this file answers are the ones a batch gets wrong quietly: it pays somebody
// who left, or it silently issues a document with a blank where a figure belongs. Both are
// arithmetic over values, so both are settled here.
import { describe, expect, it } from 'vitest';
import { type CompensationEffectsDto, type CompensationLineDto } from '@ecms/contracts';
import { employedDuring, skipReasonFor } from './payslip-eligibility';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const MARCH = { from: d('2026-03-01'), to: d('2026-03-31') };

describe('who is in the batch', () => {
  it('includes someone employed for the whole month', () => {
    expect(employedDuring([{ from: d('2020-01-01'), to: null }], MARCH)).toBe(true);
  });

  // The case `listEmployedSystem` would get wrong: they are not employed TODAY, and they worked
  // ten days of the month being paid.
  it('includes someone who left mid-month', () => {
    expect(employedDuring([{ from: d('2020-01-01'), to: d('2026-03-10') }], MARCH)).toBe(true);
  });

  it('includes someone hired mid-month', () => {
    expect(employedDuring([{ from: d('2026-03-25'), to: null }], MARCH)).toBe(true);
  });

  it('includes someone employed for exactly one day of it, at either end', () => {
    expect(employedDuring([{ from: d('2026-03-31'), to: null }], MARCH)).toBe(true);
    expect(employedDuring([{ from: d('2020-01-01'), to: d('2026-03-01') }], MARCH)).toBe(true);
  });

  it('excludes someone who left the day before it started', () => {
    expect(employedDuring([{ from: d('2020-01-01'), to: d('2026-02-28') }], MARCH)).toBe(false);
  });

  it('excludes someone hired the day after it ended', () => {
    expect(employedDuring([{ from: d('2026-04-01'), to: null }], MARCH)).toBe(false);
  });

  it('includes a rehire whose SECOND span reaches the month', () => {
    expect(
      employedDuring(
        [
          { from: d('2018-01-01'), to: d('2019-06-30') },
          { from: d('2026-03-15'), to: null },
        ],
        MARCH,
      ),
    ).toBe(true);
  });

  it('excludes someone with no employment span at all', () => {
    expect(employedDuring([], MARCH)).toBe(false);
  });
});

const line = (over: Partial<CompensationLineDto> = {}): CompensationLineDto =>
  ({
    origin: 'payItem',
    sourceAssignmentId: 'a1',
    payItemId: 'p1',
    code: 'HOUSING',
    name: { ar: 'بدل', en: 'Housing' },
    kind: 'earning',
    calcBasis: 'fixed',
    currency: 'EGP',
    baseAmount: 3000,
    prorationFactor: 1,
    daysInForce: 31,
    daysInPeriod: 31,
    quantity: null,
    quantitySource: null,
    quantityUnit: null,
    feedFrozenAt: null,
    leavePayRate: null,
    leaveTypeCode: null,
    amountMinor: 300_000,
    amount: 3000,
    state: 'computed',
    ...over,
  }) as CompensationLineDto;

const effects = (over: Partial<CompensationEffectsDto> = {}): CompensationEffectsDto =>
  ({
    employeeId: 'e1',
    period: '2026-03',
    from: '2026-03-01',
    to: '2026-03-31',
    currency: 'EGP',
    basicSalary: 10_000,
    employmentDaysInPeriod: 31,
    daysInPeriod: 31,
    earnings: [line()],
    deductions: [],
    deferred: [],
    leave: null,
    totalEarningsMinor: 300_000,
    totalEarnings: 3000,
    totalDeductionsMinor: 0,
    totalDeductions: 0,
    netMinor: 300_000,
    net: 3000,
    warnings: [],
    ...over,
  }) as CompensationEffectsDto;

describe('why somebody got no payslip', () => {
  it('issues one when every line has a figure', () => {
    expect(skipReasonFor(effects())).toBeNull();
  });

  // The rule this whole phase turns on: a payslip with a blank is worse than an absent one.
  it('refuses one while any line is still pending', () => {
    expect(
      skipReasonFor(
        effects({ deferred: [line({ state: 'pendingQuantity', amount: null, amountMinor: null })] }),
      ),
    ).toBe('pendingLine');
  });

  it('refuses one for a period where nothing was in force', () => {
    expect(skipReasonFor(effects({ earnings: [], deductions: [], netMinor: 0, net: 0 }))).toBe(
      'noLines',
    );
  });

  it('issues one for a deduction-only month — a negative net is still a figure', () => {
    expect(
      skipReasonFor(
        effects({
          earnings: [],
          deductions: [line({ kind: 'deduction' })],
          totalEarningsMinor: 0,
          netMinor: -300_000,
        }),
      ),
    ).toBeNull();
  });

  // A warning is a thing the reader has to know, not a reason to withhold the document.
  it('issues one that carries warnings', () => {
    expect(skipReasonFor(effects({ warnings: ['netBelowZero', 'leaveDaysAlsoPriced'] }))).toBeNull();
  });

  it('reports the pending line first when a calculation has both problems', () => {
    expect(
      skipReasonFor(
        effects({
          earnings: [],
          deductions: [],
          deferred: [line({ state: 'pendingLeaveSnapshot', amount: null, amountMinor: null })],
        }),
      ),
    ).toBe('pendingLine');
  });
});
