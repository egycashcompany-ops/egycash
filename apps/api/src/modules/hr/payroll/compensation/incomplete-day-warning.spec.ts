// D6-R — an unfinished day stops being silent (owner ruling, option C).
//
// THE HISTORY THIS GUARDS. D6 was approved in two halves. The first half — an `incomplete` day is
// never guessed, so it contributes nothing to any quantity — was built and is correct. The second
// half was not built at all, and the divergence survived four phases of payroll work: a day
// somebody worked but never checked out of passed through the calculation contributing zero, and
// NOTHING said so. A day priced at nothing is indistinguishable from a day nobody worked, which is
// exactly the shape of defect that only surfaces when somebody's salary is short.
//
// The ruling closes it with a warning rather than a refusal, so what has to be pinned here is a
// pair: the warning appears when an unfinished day actually cost the employee something, and it
// stays quiet when it did not. A warning that cried on every salaried payslip would be worse than
// the silence it replaced, because it would train the reader to skip the whole list.
import { describe, expect, it } from 'vitest';
import { type AttendanceFeedRow } from '@ecms/contracts';
import { type FrozenAttendance } from './attendance-quantities';
import {
  computeCompensation,
  type AssignmentInput,
  type CompensationInput,
} from './compensation-rules';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const item = (over: Partial<AssignmentInput['item']> = {}): AssignmentInput['item'] => ({
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

/** A pay item priced per attended day — the only kind an unfinished day can shortchange. */
const perDay = assignment({
  id: 'a2',
  amount: 250,
  item: item({ code: 'PER_DAY', calcBasis: 'perDay', quantitySource: 'attendedDays', sortOrder: 30 }),
});

const feedRow = (workDate: string, status: string): AttendanceFeedRow =>
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
    flags: [],
  }) as unknown as AttendanceFeedRow;

const frozen = (rows: readonly AttendanceFeedRow[]): FrozenAttendance => ({
  rows,
  frozenAt: '2026-04-01T00:00:00.000Z',
});

const input = (over: Partial<CompensationInput> = {}): CompensationInput => ({
  employeeId: 'e1',
  period: '2026-03',
  basicSalary: { amount: 10_000, currency: 'EGP' },
  employmentSpans: [{ from: d('2020-01-01'), to: null }],
  assignments: [],
  hasLegacyAllowances: false,
  adjustments: [],
  loanInstallments: [],
  attendance: null,
  leave: null,
  ...over,
});

const warningsOf = (over: Partial<CompensationInput>): readonly string[] =>
  computeCompensation(input(over)).warnings;

describe('the warning fires when an unfinished day actually cost something', () => {
  it('names the day when attendance prices this payslip', () => {
    expect(
      warningsOf({
        assignments: [perDay],
        attendance: frozen([feedRow('2026-03-10', 'present'), feedRow('2026-03-11', 'incomplete')]),
      }),
    ).toContain('incompleteDay');
  });

  /**
   * The first half of D6, restated from the money's side so the two halves are pinned together.
   *
   * The warning says the day was not counted; this asserts it truly was not. If a later change
   * ever taught the engine to guess an unfinished day into `attendedDays`, the count below moves
   * and this fails — which is the whole point of asserting the number rather than the warning.
   */
  it('still prices the unfinished day at nothing — the warning reports, it does not repair', () => {
    const result = computeCompensation(
      input({
        assignments: [perDay],
        attendance: frozen([feedRow('2026-03-10', 'present'), feedRow('2026-03-11', 'incomplete')]),
      }),
    );
    const line = result.earnings.find((l) => l.code === 'PER_DAY');
    expect(line?.quantity).toBe(1); // the present day only — never 2
    expect(line?.amount).toBe(250);
  });

  it('fires on any unfinished day in the period, not just the first', () => {
    expect(
      warningsOf({
        assignments: [perDay],
        attendance: frozen([feedRow('2026-03-28', 'incomplete')]),
      }),
    ).toContain('incompleteDay');
  });
});

describe('and stays quiet when it would be noise', () => {
  /**
   * THE ASSERTION THAT KEEPS THE WARNING WORTH READING.
   *
   * A month of fixed allowances is not shortchanged by an unfinished day — nothing here counts
   * days at all. Warning anyway would put a line on every salaried payslip in any month somebody
   * forgot to punch out, which is how a warning list stops being read. Same restraint
   * `leaveDaysAlsoPriced` already uses: name a real collision, never a hypothetical one.
   */
  it('is silent when no pay item is priced on attendance', () => {
    expect(
      warningsOf({
        assignments: [assignment()],
        attendance: frozen([feedRow('2026-03-11', 'incomplete')]),
      }),
    ).not.toContain('incompleteDay');
  });

  it('is silent when the period holds no unfinished day', () => {
    expect(
      warningsOf({
        assignments: [perDay],
        attendance: frozen([feedRow('2026-03-10', 'present'), feedRow('2026-03-12', 'absent')]),
      }),
    ).not.toContain('incompleteDay');
  });

  it('is silent when attendance was never frozen — there is nothing to have missed yet', () => {
    expect(warningsOf({ assignments: [perDay], attendance: null })).not.toContain('incompleteDay');
  });

  /**
   * A day inside the month but outside the employee's employment is not theirs to be warned about.
   *
   * Someone hired on the 16th cannot be shortchanged by an unfinished day on the 11th, and the
   * feed will hand that row over anyway — it knows the period, not the employment. Reusing the
   * same employment filter the quantity count uses is what keeps the warning and the number
   * telling one story.
   */
  it('ignores an unfinished day from before the employee was hired', () => {
    expect(
      warningsOf({
        assignments: [perDay],
        employmentSpans: [{ from: d('2026-03-16'), to: null }],
        attendance: frozen([feedRow('2026-03-11', 'incomplete')]),
      }),
    ).not.toContain('incompleteDay');
  });

  it('ignores an unfinished day inside a rehire gap', () => {
    expect(
      warningsOf({
        assignments: [perDay],
        employmentSpans: [
          { from: d('2020-01-01'), to: d('2026-03-05') },
          { from: d('2026-03-20'), to: null },
        ],
        attendance: frozen([feedRow('2026-03-11', 'incomplete')]),
      }),
    ).not.toContain('incompleteDay');
  });
});

describe('it joins the vocabulary without disturbing it', () => {
  it('does not suppress the warnings that were already there', () => {
    const warnings = warningsOf({
      assignments: [perDay],
      hasLegacyAllowances: true,
      attendance: frozen([feedRow('2026-03-11', 'incomplete')]),
    });
    expect(warnings).toContain('legacyAllowancesIgnored');
    expect(warnings).toContain('incompleteDay');
  });
});
