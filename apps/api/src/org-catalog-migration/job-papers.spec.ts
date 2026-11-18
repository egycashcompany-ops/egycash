// Where «مستندات الوظائف» lines go when their department is linked (P-ORG-3 follow-up).
import { describe, expect, it } from 'vitest';
import { planPaperMoves, type PaperLine } from './job-papers';

let seq = 0;
const line = (over: Partial<PaperLine> & Pick<PaperLine, 'departmentId'>): PaperLine => {
  seq += 1;
  return {
    id: `line${String(seq).padStart(3, '0')}`,
    jobTitleId: 'job1',
    added: [],
    removed: [],
    updatedAt: `2026-11-${String(seq).padStart(2, '0')}T00:00:00.000Z`,
    ...over,
  };
};

/** Two branch copies of «العمليات» (rowA, rowB) joining a new entry; rowC already linked to E1. */
const targets: Record<string, string> = { rowa: 'fold:العمليات', rowb: 'fold:العمليات', rowc: 'id:e1', e1: 'id:e1' };
const targetOf = (id: string): string | null => targets[id] ?? null;

describe('job papers follow their department into the company list', () => {
  it('moves a branch copy\'s line to the department\'s entry', () => {
    const only = line({ departmentId: 'rowA', added: ['weapon'] });
    const plan = planPaperMoves([only], targetOf);
    expect(plan.moves).toEqual([{ lineId: only.id, target: 'fold:العمليات' }]);
    expect(plan.drops).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it('keeps one of two copies that say the same thing, and names no conflict', () => {
    const a = line({ departmentId: 'rowA', added: ['weapon', 'card'] });
    const b = line({ departmentId: 'rowB', added: ['card', 'weapon'] });
    const plan = planPaperMoves([a, b], targetOf);
    expect(plan.moves).toEqual([{ lineId: b.id, target: 'fold:العمليات' }]);
    expect(plan.drops).toEqual([{ lineId: a.id, keptLineId: b.id, sameAsKept: true }]);
    expect(plan.conflicts).toEqual([]);
  });

  it('keeps the line saved last when two copies disagree, and names the conflict', () => {
    const older = line({ departmentId: 'rowA', added: ['weapon'] });
    const newer = line({ departmentId: 'rowB', removed: ['bank-letter'] });
    const plan = planPaperMoves([newer, older], targetOf);
    expect(plan.moves).toEqual([{ lineId: newer.id, target: 'fold:العمليات' }]);
    expect(plan.drops).toEqual([{ lineId: older.id, keptLineId: newer.id, sameAsKept: false }]);
    expect(plan.conflicts).toEqual([
      { target: 'fold:العمليات', jobTitleId: 'job1', kept: newer.id, dropped: [older.id] },
    ]);
  });

  it('treats each job on its own', () => {
    const a = line({ departmentId: 'rowA', jobTitleId: 'job1' });
    const b = line({ departmentId: 'rowB', jobTitleId: 'job2' });
    const plan = planPaperMoves([a, b], targetOf);
    expect(plan.moves.map((m) => m.lineId).sort()).toEqual([a.id, b.id].sort());
    expect(plan.drops).toEqual([]);
  });

  it('leaves a line already under its entry where it is, and folds a row\'s line into it', () => {
    const atEntry = line({ departmentId: 'e1', added: ['card'], updatedAt: '2026-12-01T00:00:00.000Z' });
    const onRow = line({ departmentId: 'rowC', added: ['card'], updatedAt: '2026-10-01T00:00:00.000Z' });
    const plan = planPaperMoves([onRow, atEntry], targetOf);
    expect(plan.moves).toEqual([]);
    expect(plan.drops).toEqual([{ lineId: onRow.id, keptLineId: atEntry.id, sameAsKept: true }]);
  });

  it('leaves alone a line whose department this run does not link (retired or unknown)', () => {
    const stray = line({ departmentId: 'gone' });
    expect(planPaperMoves([stray], targetOf)).toEqual({ moves: [], drops: [], conflicts: [] });
  });

  it('decides the same way whatever order the lines are read in', () => {
    const a = line({ departmentId: 'rowA', added: ['x'], updatedAt: '2026-11-20T00:00:00.000Z' });
    const b = line({ departmentId: 'rowB', added: ['y'], updatedAt: '2026-11-20T00:00:00.000Z' });
    expect(planPaperMoves([a, b], targetOf)).toEqual(planPaperMoves([b, a], targetOf));
  });
});
