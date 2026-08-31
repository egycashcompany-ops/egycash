// A personnel action's effective date is a BUSINESS DATE, and both history walks must read it as
// one. The defect this pins was wrong exactly one day in thirty.
//
// WHAT WENT WRONG. `employee-action.service.ts` stamps an action taking effect today with
// `new Date()` — an instant, carrying a time of day. Both walks that ask "what was true on date
// D?" compare that stored value against a DATE-ONLY boundary: a payroll period's last day, at UTC
// midnight. On the 3rd of the month, `2026-08-03T09:02Z` is comfortably below `2026-08-31T00:00Z`
// and the comparison is right. On the 31st, `2026-08-31T09:02Z` is ABOVE `2026-08-31T00:00Z`, so
// a change recorded that day sorted after the month it belonged to and the walk undid it.
//
// The consequences were not cosmetic. A raise granted on the last day of a month was priced at the
// OLD salary for that month; a transfer recorded on the last day attributed that month's payslip
// to the department the employee had just left — and therefore to the wrong cost centre. Both were
// silent, both self-corrected the following day, and neither had a test that ran on the day it
// broke: the suite only fails on month ends, which is how this reached `main`.
//
// EVERY CASE BELOW IS THE SAME DAY IN TWO CONVENTIONS. That is the property, so it is stated as
// one: the hour a change was recorded may never decide which month it belongs to.
import { describe, expect, it } from 'vitest';
import { departmentAt } from './department-at';
import { salaryAsOf } from '../payroll/compensation/salary-history';

const money = (amount: number) => ({ amount, currency: 'EGP' });

/** The last day of August 2026 as a period boundary — date-only, UTC midnight. */
const augustEnd = new Date(Date.UTC(2026, 8, 0));

describe('a raise recorded on the last day of a month belongs to that month', () => {
  it('applies when the change carries a time of day (the defect)', () => {
    expect(
      salaryAsOf(money(30_000), [{ effectiveDate: new Date('2026-08-31T09:02:00.000Z'), from: money(12_000), to: money(30_000) }], augustEnd)
        ?.amount,
    ).toBe(30_000);
  });

  it('applies just before UTC midnight too — the worst instant of the worst day', () => {
    expect(
      salaryAsOf(money(30_000), [{ effectiveDate: new Date('2026-08-31T23:59:59.999Z'), from: money(12_000), to: money(30_000) }], augustEnd)
        ?.amount,
    ).toBe(30_000);
  });

  it('was always right on any other day, and stays right', () => {
    expect(
      salaryAsOf(money(30_000), [{ effectiveDate: new Date('2026-08-15T09:02:00.000Z'), from: money(12_000), to: money(30_000) }], augustEnd)
        ?.amount,
    ).toBe(30_000);
  });

  /**
   * The other half of PY-8, and the reason this is a normalization rather than a loosened
   * comparison: a raise in SEPTEMBER must still not reach August. Making the boundary generous
   * would have fixed the failing day by breaking the guarantee the walk exists for.
   */
  it('still does not reach back into a month that ended before it', () => {
    expect(
      salaryAsOf(money(30_000), [{ effectiveDate: new Date('2026-09-01T00:30:00.000Z'), from: money(12_000), to: money(30_000) }], augustEnd)
        ?.amount,
    ).toBe(12_000);
  });
});

describe('a transfer recorded on the last day of a month belongs to that month', () => {
  it('is in force when the move carries a time of day (the defect)', () => {
    expect(
      departmentAt([{ from: 'ops', to: 'finance', effectiveDate: new Date('2026-08-31T09:02:00.000Z') }], augustEnd, 'finance'),
    ).toBe('finance');
  });

  it('is in force just before UTC midnight too', () => {
    expect(
      departmentAt([{ from: 'ops', to: 'finance', effectiveDate: new Date('2026-08-31T23:59:59.999Z') }], augustEnd, 'finance'),
    ).toBe('finance');
  });

  it('a move in the next month is still not in force — the guarantee is unchanged', () => {
    expect(
      departmentAt([{ from: 'ops', to: 'finance', effectiveDate: new Date('2026-09-01T00:30:00.000Z') }], augustEnd, 'finance'),
    ).toBe('ops');
  });

  /**
   * Ordering is normalized too, not only the comparison.
   *
   * Two moves on the SAME last day must not be re-ranked by their clock times relative to a
   * boundary they both now equal — the walk keeps the array order it was given for same-day moves,
   * so the later-listed one wins, which is the order the repository already sorts by (`seq`).
   */
  it('handles two moves on the same last day without the clock deciding', () => {
    expect(
      departmentAt(
        [
          { from: 'ops', to: 'finance', effectiveDate: new Date('2026-08-31T08:00:00.000Z') },
          { from: 'finance', to: 'audit', effectiveDate: new Date('2026-08-31T17:00:00.000Z') },
        ],
        augustEnd,
        'audit',
      ),
    ).toBe('audit');
  });
});
