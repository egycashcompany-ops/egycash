import { describe, expect, it } from 'vitest';
import { collisionsWithinOneBranch, groupByFoldedName } from './grouping';

const unit = (code: string, ar: string) => ({ code, name: { ar } });

describe('groupByFoldedName', () => {
  it('groups the same department repeated across branches', () => {
    const groups = groupByFoldedName([
      unit('DEP-0001', 'الحركة'),
      unit('DEP-0007', 'الحركة'),
      unit('DEP-0012', 'الحركة'),
      unit('DEP-0002', 'الخزينة'),
    ]);
    expect(groups[0]).toMatchObject({
      count: 3,
      names: ['الحركة'],
      codes: ['DEP-0001', 'DEP-0007', 'DEP-0012'],
    });
    expect(groups[1]?.count).toBe(1);
  });

  it('folds the exact spelling variants the importer folds, and keeps BOTH spellings visible', () => {
    // These pairs are the ones `orgKey`'s own comment names. If this report folded them
    // differently from the importer it would be describing a duplication nobody created.
    const groups = groupByFoldedName([
      unit('DEP-0001', 'الرقابة والمستهلكات'),
      unit('DEP-0002', 'الرقابة و المستهلكات'),
    ]);
    expect(groups).toHaveLength(1);
    // Both spellings survive into the group, because deciding which one wins is the owner's call,
    // not this function's — it proposes the merge and shows what is being merged.
    expect(groups[0]?.names).toEqual(['الرقابة والمستهلكات', 'الرقابة و المستهلكات']);
  });

  it('folds the bracket variants too', () => {
    expect(
      groupByFoldedName([
        unit('SEC-0001', 'التشغيل ( ادارى )'),
        unit('SEC-0002', 'التشغيل ( إدارى )'),
      ]),
    ).toHaveLength(1);
    expect(
      groupByFoldedName([unit('SEC-0003', 'التشغيل (خارجى)'), unit('SEC-0004', 'التشغيل ( خارجى )')]),
    ).toHaveLength(1);
  });

  it('does not merge units that are genuinely different', () => {
    // The job-titles screen shows «سائق», «سائق ب», «سائق ج» — grades, not copies. A report that
    // merged them would tell the owner to delete real seats.
    expect(
      groupByFoldedName([unit('JT-1', 'سائق'), unit('JT-2', 'سائق ب'), unit('JT-3', 'سائق ج')]),
    ).toHaveLength(3);
  });

  it('keeps an unfoldable name as its own group rather than merging every one of them', () => {
    expect(groupByFoldedName([unit('A', '  '), unit('B', '()')])).toHaveLength(2);
  });
});

describe('collisionsWithinOneBranch', () => {
  const withBranch = (code: string, ar: string, branchId: string) => ({ ...unit(code, ar), branchId });

  it('finds nothing when each branch holds one of each name — the normal case', () => {
    expect(
      collisionsWithinOneBranch([
        withBranch('DEP-0001', 'الحركة', 'branch-a'),
        withBranch('DEP-0007', 'الحركة', 'branch-b'),
      ]),
    ).toEqual([]);
  });

  it('reports a pair inside ONE branch, which blocks the per-branch uniqueness rule', () => {
    const found = collisionsWithinOneBranch([
      withBranch('DEP-0001', 'الرقابة والمستهلكات', 'branch-a'),
      withBranch('DEP-0002', 'الرقابة و المستهلكات', 'branch-a'),
      withBranch('DEP-0007', 'الحركة', 'branch-a'),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.branchId).toBe('branch-a');
    expect(found[0]?.codes).toEqual(['DEP-0001', 'DEP-0002']);
  });
});
