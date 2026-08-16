// The one rule that decides which cost centre a payslip carries (P-HR-23, D-CC-7).
//
// Pure, so every boundary is a millisecond rather than a fixture. And the boundaries are the whole
// point: the anchor is the LAST DAY OF THE PERIOD, so a membership that starts on that exact day
// counts and one that ended the day before does not.
import { describe, expect, it } from 'vitest';
import { costCentreOn, type DatedMembership } from './cost-center-resolution';

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const row = (id: string, from: string, to: string | null): DatedMembership => ({
  costCenterId: id,
  effectiveFrom: day(from),
  effectiveTo: to === null ? null : day(to),
});

const JULY_END = day('2026-07-31');

describe('the centre in force on a day', () => {
  it('is null when the employee was never placed', () => {
    expect(costCentreOn([], JULY_END)).toBeNull();
  });

  it('is the open interval when one covers the day', () => {
    expect(costCentreOn([row('ops', '2026-01-01', null)], JULY_END)).toBe('ops');
  });

  it('includes both ends of a closed interval', () => {
    expect(costCentreOn([row('ops', '2026-07-31', '2026-07-31')], JULY_END)).toBe('ops');
    expect(costCentreOn([row('ops', '2026-07-01', '2026-07-31')], JULY_END)).toBe('ops');
  });

  it('excludes an interval that ended the day before', () => {
    expect(costCentreOn([row('ops', '2026-01-01', '2026-07-30')], JULY_END)).toBeNull();
  });

  it('excludes an interval that starts the day after', () => {
    expect(costCentreOn([row('ops', '2026-08-01', null)], JULY_END)).toBeNull();
  });

  /**
   * D-CC-7, stated as a test: a move on the 15th does not split the month. The payslip belongs
   * wholly to the centre the period CLOSED in, and no proration exists to say otherwise.
   */
  it('gives the whole month to the centre the period closed in', () => {
    const moved = [row('ops', '2026-01-01', '2026-07-14'), row('retail', '2026-07-15', null)];
    expect(costCentreOn(moved, JULY_END)).toBe('retail');
  });

  /**
   * Overlap is refused at write time, so two covering rows should be impossible. If one ever
   * appears — a repair gone wrong, a row older than the rule — the LATEST anchor wins every time.
   * A stable wrong answer can be found and fixed; one that changes per query cannot.
   */
  it('is deterministic even if two rows somehow cover the same day', () => {
    const a = [row('ops', '2026-01-01', null), row('retail', '2026-06-01', null)];
    expect(costCentreOn(a, JULY_END)).toBe('retail');
    expect(costCentreOn([...a].reverse(), JULY_END)).toBe('retail');
  });
});
