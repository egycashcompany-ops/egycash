// The backfill's one piece of judgement, tested exhaustively (P-SCOPE-1, D-DEPT-3).
//
// Every case here is a way the migration could attribute somebody's pay to the wrong department —
// which is a scope decision, not a display detail. The one that matters most is the third: a
// record that PREDATES every recorded move must not inherit today's department.
import { describe, expect, it } from 'vitest';
import { departmentAt, type DepartmentMove } from './department-at';

const D = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const move = (from: string | null, to: string | null, on: string): DepartmentMove => ({
  from,
  to,
  effectiveDate: D(on),
});

describe('the department in force on a date', () => {
  it('is the current one when nothing was ever recorded', () => {
    expect(departmentAt([], D('2025-06-01'), 'DEP-NOW')).toBe('DEP-NOW');
    expect(departmentAt([], D('2025-06-01'), null)).toBeNull();
  });

  /**
   * THE ERROR THIS FUNCTION EXISTS TO PREVENT. The employee is in B today; the payslip is from
   * before they ever moved. Answering "B" would attribute a 2025 payslip to a department they
   * joined in 2026 — and it would look right, because B is where they are.
   */
  it('is where they came FROM when the date predates every move', () => {
    const moves = [move('DEP-A', 'DEP-B', '2026-03-01')];
    expect(departmentAt(moves, D('2025-11-30'), 'DEP-B')).toBe('DEP-A');
  });

  it('is the destination of the last move that had taken effect', () => {
    const moves = [
      move('DEP-A', 'DEP-B', '2026-03-01'),
      move('DEP-B', 'DEP-C', '2026-07-01'),
    ];
    expect(departmentAt(moves, D('2026-05-15'), 'DEP-C')).toBe('DEP-B');
    expect(departmentAt(moves, D('2026-09-01'), 'DEP-C')).toBe('DEP-C');
  });

  /** A move takes effect ON its effective date, not the day after. */
  it('counts a move that takes effect on the very date asked about', () => {
    const moves = [move('DEP-A', 'DEP-B', '2026-03-01')];
    expect(departmentAt(moves, D('2026-03-01'), 'DEP-B')).toBe('DEP-B');
    expect(departmentAt(moves, D('2026-02-28'), 'DEP-B')).toBe('DEP-A');
  });

  /** The caller reads rows in whatever order the query returned; ordering is this function's job. */
  it('does not depend on the order it is handed the moves', () => {
    const ordered = [
      move('DEP-A', 'DEP-B', '2026-03-01'),
      move('DEP-B', 'DEP-C', '2026-07-01'),
    ];
    const shuffled = [ordered[1] as DepartmentMove, ordered[0] as DepartmentMove];
    expect(departmentAt(shuffled, D('2026-05-15'), 'DEP-C')).toBe('DEP-B');
    expect(departmentAt(shuffled, D('2026-01-01'), 'DEP-C')).toBe('DEP-A');
  });

  it('falls back to the current department when a move recorded no destination', () => {
    const moves = [move('DEP-A', null, '2026-03-01')];
    expect(departmentAt(moves, D('2026-06-01'), 'DEP-NOW')).toBe('DEP-NOW');
  });

  /** Two moves on one day: the later one in the sorted order wins, deterministically. */
  it('is deterministic when two moves share an effective date', () => {
    const moves = [move('DEP-A', 'DEP-B', '2026-03-01'), move('DEP-B', 'DEP-C', '2026-03-01')];
    expect(departmentAt(moves, D('2026-03-01'), 'DEP-C')).toBe('DEP-C');
  });
});
