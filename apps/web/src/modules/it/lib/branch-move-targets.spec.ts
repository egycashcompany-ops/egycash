// Where «نقل إلى فرع» and «تحويل إلى فرع» may go: the branches the SERVER says the custody grant
// reaches (`GET /it/assets/move-targets`), in the branch options' order, less the branch the things
// leave — and nothing at all until both lists are in, so the picker never flashes «no branch».
import { describe, expect, it } from 'vitest';
import { branchMoveTargets } from './branch-move-targets';

const BRANCHES = [
  { id: 'b-hq', name: 'المهندسين' },
  { id: 'b-oct', name: 'أكتوبر' },
  { id: 'b-alex', name: 'الإسكندرية' },
  { id: 'b-asyut', name: 'أسيوط' },
];
const ids = (branches: readonly { id: string }[] | null): string[] | null =>
  branches === null ? null : branches.map((branch) => branch.id);

describe('the branches a move may go to', () => {
  it('offers only the branches the server names — never one it would refuse with 403', () => {
    // An account whose grants together reach every branch, but whose custody grant reaches two:
    // `me` would have offered all four.
    expect(ids(branchMoveTargets(BRANCHES, ['b-oct', 'b-asyut'], null))).toEqual([
      'b-oct',
      'b-asyut',
    ]);
  });

  it('keeps the branch options’ order and names, whatever order the server answers in', () => {
    expect(branchMoveTargets(BRANCHES, ['b-asyut', 'b-hq', 'b-oct'], null)).toEqual([
      BRANCHES[0],
      BRANCHES[1],
      BRANCHES[3],
    ]);
  });

  it('never offers the branch the things leave', () => {
    expect(ids(branchMoveTargets(BRANCHES, ['b-hq', 'b-oct', 'b-alex'], 'b-hq'))).toEqual([
      'b-oct',
      'b-alex',
    ]);
    // Assets from several branches leave none: each branch is somewhere for the others.
    expect(ids(branchMoveTargets(BRANCHES, ['b-hq', 'b-oct'], null))).toEqual(['b-hq', 'b-oct']);
  });

  it('offers nothing when the grant reaches only the branch they leave, or no whole branch', () => {
    // A branch-scoped grant over the store the items leave.
    expect(branchMoveTargets(BRANCHES, ['b-hq'], 'b-hq')).toEqual([]);
    // A department-scoped grant: never a whole branch on the server.
    expect(branchMoveTargets(BRANCHES, [], 'b-hq')).toEqual([]);
  });

  it('names no branch the options do not hold (an inactive one, say)', () => {
    expect(ids(branchMoveTargets(BRANCHES, ['b-oct', 'b-closed'], null))).toEqual(['b-oct']);
  });

  it('waits while either list is still on its way — no «no branch» before the answer', () => {
    expect(branchMoveTargets(BRANCHES, undefined, 'b-hq')).toBeNull();
    expect(branchMoveTargets(undefined, ['b-oct'], 'b-hq')).toBeNull();
    expect(branchMoveTargets(undefined, undefined, null)).toBeNull();
  });
});
