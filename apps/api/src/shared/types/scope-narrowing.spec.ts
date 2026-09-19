// The branch switcher narrows. It never widens.
//
// One control in the command bar decides what every list in the application shows, so the rule it
// obeys is worth stating as tests rather than trusting to the reading of one `if`. The property
// that matters is one-directional: whatever a caller sends, they end up seeing the same rows as
// before or fewer — never a row their grant did not already reach.
import { describe, expect, it } from 'vitest';
import {
  currentBranchId,
  reachesBranch,
  scopeSelector,
  widestScopeSelector,
  type AuthContext,
} from './index';

const BRANCH_A = '650000000000000000000010';
const BRANCH_B = '650000000000000000000011';

const ctx = (over: Partial<AuthContext> = {}): AuthContext => ({
  userId: 'u1',
  sessionId: 's1',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions: {},
  permissionVersion: 1,
  isPrivileged: false,
  ...over,
});

describe('an organization-wide grant narrows to the chosen branch', () => {
  it('becomes a branch scope pointed at the chosen branch', () => {
    const selector = scopeSelector(
      ctx({ permissions: { 'goldBar.view': 'organization' }, activeBranchId: BRANCH_A }),
      'goldBar.view',
    );
    expect(selector.scope).toBe('branch');
    expect(selector.branchId).toBe(BRANCH_A);
  });

  it('stays organization-wide when the whole company is chosen', () => {
    const selector = scopeSelector(
      ctx({ permissions: { 'goldBar.view': 'organization' }, activeBranchId: null }),
      'goldBar.view',
    );
    expect(selector.scope).toBe('organization');
  });

  it('stays organization-wide when nothing was ever chosen', () => {
    const selector = scopeSelector(
      ctx({ permissions: { 'goldBar.view': 'organization' } }),
      'goldBar.view',
    );
    expect(selector.scope).toBe('organization');
  });
});

describe('nothing else moves', () => {
  /**
   * The one that must never regress. A caller placed in branch A who sends branch B keeps branch A:
   * the switcher is a narrowing of what you already hold, not a way to look somewhere else.
   */
  it('leaves a branch-placed caller in their OWN branch, whatever they send', () => {
    const selector = scopeSelector(
      ctx({
        branchId: BRANCH_A,
        permissions: { 'goldBar.view': 'branch' },
        activeBranchId: BRANCH_B,
      }),
      'goldBar.view',
    );
    expect(selector.scope).toBe('branch');
    expect(selector.branchId).toBe(BRANCH_A);
  });

  it('does not widen a department grant to a branch', () => {
    const selector = scopeSelector(
      ctx({
        departmentId: 'd1',
        permissions: { 'goldBar.view': 'department' },
        activeBranchId: BRANCH_A,
      }),
      'goldBar.view',
    );
    expect(selector.scope).toBe('department');
    expect(selector.branchId).toBeNull();
  });

  it('does not widen a section grant', () => {
    const selector = scopeSelector(
      ctx({ sectionId: 's1', permissions: { 'goldBar.view': 'section' }, activeBranchId: BRANCH_A }),
      'goldBar.view',
    );
    expect(selector.scope).toBe('section');
  });

  it('does not widen an own grant', () => {
    const selector = scopeSelector(
      ctx({ permissions: { 'goldBar.view': 'own' }, activeBranchId: BRANCH_A }),
      'goldBar.view',
    );
    expect(selector.scope).toBe('own');
  });

  it('leaves a caller who holds the permission not at all on `own`', () => {
    const selector = scopeSelector(ctx({ activeBranchId: BRANCH_A }), 'goldBar.view');
    expect(selector.scope).toBe('own');
  });
});

describe('it is decided per permission, not per caller', () => {
  it('narrows the organization-wide grant and leaves the branch grant alone in the same context', () => {
    const caller = ctx({
      branchId: BRANCH_A,
      permissions: { 'goldBar.view': 'organization', 'goldVault.view': 'branch' },
      activeBranchId: BRANCH_B,
    });
    expect(scopeSelector(caller, 'goldBar.view').branchId).toBe(BRANCH_B);
    expect(scopeSelector(caller, 'goldVault.view').branchId).toBe(BRANCH_A);
  });
});

/**
 * A grant that reaches more than one branch — a manager given a second branch to follow.
 *
 * Two rules, same shape as the organization-wide case above. The reach is the ceiling: the switcher
 * may narrow to ONE of the held branches and never to a branch outside them. And a caller whose
 * grants reach only their home unit is untouched — `reach` empty means the single ids apply, which
 * is every context that existed before the field did.
 */
describe('a multi-branch grant narrows within its reach', () => {
  const REACH = { branchIds: [BRANCH_A, BRANCH_B], departmentIds: [] };

  it('lists every reached branch when nothing is chosen', () => {
    const selector = scopeSelector(
      ctx({ branchId: BRANCH_A, permissions: { 'goldBar.view': 'branch' }, reach: REACH }),
      'goldBar.view',
    );
    expect(selector.scope).toBe('branch');
    expect(selector.branchIds).toEqual([BRANCH_A, BRANCH_B]);
  });

  it('narrows to the chosen branch when it is one of the reached ones', () => {
    const selector = scopeSelector(
      ctx({ branchId: BRANCH_A, permissions: { 'goldBar.view': 'branch' }, reach: REACH, activeBranchId: BRANCH_B }),
      'goldBar.view',
    );
    expect(selector.branchIds).toEqual([BRANCH_B]);
  });

  /** THE CEILING. A branch outside the reach is not a narrowing, so it is ignored. */
  it('ignores a chosen branch outside the reach and keeps the whole reach', () => {
    const OUTSIDE = '650000000000000000000099';
    const selector = scopeSelector(
      ctx({ branchId: BRANCH_A, permissions: { 'goldBar.view': 'branch' }, reach: REACH, activeBranchId: OUTSIDE }),
      'goldBar.view',
    );
    expect(selector.branchIds).toEqual([BRANCH_A, BRANCH_B]);
  });

  it('leaves a caller with an empty reach on the single home id, exactly as before', () => {
    const selector = scopeSelector(
      ctx({
        branchId: BRANCH_A,
        permissions: { 'goldBar.view': 'branch' },
        reach: { branchIds: [], departmentIds: [] },
        activeBranchId: BRANCH_B,
      }),
      'goldBar.view',
    );
    expect(selector.branchId).toBe(BRANCH_A);
    expect(selector.branchIds).toBeUndefined();
  });
});

describe('a company-wide department grant', () => {
  const D1 = '650000000000000000000101';
  const D2 = '650000000000000000000102';

  it('carries every branch copy of the department, and the branches they sit in', () => {
    const selector = scopeSelector(
      ctx({
        departmentId: D1,
        permissions: { 'goldBar.view': 'department' },
        reach: { branchIds: [BRANCH_A, BRANCH_B], departmentIds: [D1, D2] },
      }),
      'goldBar.view',
    );
    expect(selector.scope).toBe('department');
    expect(selector.departmentIds).toEqual([D1, D2]);
    expect(selector.branchIds).toEqual([BRANCH_A, BRANCH_B]);
  });

  it('narrows the branches, not the department, when one branch is chosen', () => {
    const selector = scopeSelector(
      ctx({
        departmentId: D1,
        permissions: { 'goldBar.view': 'department' },
        reach: { branchIds: [BRANCH_A, BRANCH_B], departmentIds: [D1, D2] },
        activeBranchId: BRANCH_B,
      }),
      'goldBar.view',
    );
    expect(selector.departmentIds).toEqual([D1, D2]);
    expect(selector.branchIds).toEqual([BRANCH_B]);
  });
});

describe('the branch a caller is acting in (currentBranchId)', () => {
  it('is the home branch for a caller placed in one, whatever the header says', () => {
    expect(currentBranchId(ctx({ branchId: BRANCH_A, activeBranchId: BRANCH_B }))).toBe(BRANCH_A);
  });

  it('is the chosen branch when the caller reaches it', () => {
    const c = ctx({
      branchId: BRANCH_A,
      activeBranchId: BRANCH_B,
      reach: { branchIds: [BRANCH_A, BRANCH_B], departmentIds: [] },
    });
    expect(currentBranchId(c)).toBe(BRANCH_B);
  });

  it('is the chosen branch for an organization-wide caller, who may choose anywhere', () => {
    expect(currentBranchId(ctx({ activeBranchId: BRANCH_B }))).toBe(BRANCH_B);
  });

  it('is the only branch a reach names when the caller has no home', () => {
    expect(currentBranchId(ctx({ reach: { branchIds: [BRANCH_B], departmentIds: [] } }))).toBe(BRANCH_B);
  });

  it('is nothing for a multi-branch caller with no home who has not chosen', () => {
    const c = ctx({ reach: { branchIds: [BRANCH_A, BRANCH_B], departmentIds: [] } });
    expect(currentBranchId(c)).toBeNull();
  });

  it('ignores a choice outside the reach for a caller with no home', () => {
    const c = ctx({
      activeBranchId: '650000000000000000000099',
      reach: { branchIds: [BRANCH_A, BRANCH_B], departmentIds: [] },
    });
    expect(currentBranchId(c)).toBeNull();
  });
});

describe('reachesBranch', () => {
  it('is the home branch and every branch the grants reach', () => {
    const c = ctx({ branchId: BRANCH_A, reach: { branchIds: [BRANCH_B], departmentIds: [] } });
    expect(reachesBranch(c, BRANCH_A)).toBe(true);
    expect(reachesBranch(c, BRANCH_B)).toBe(true);
    expect(reachesBranch(c, '650000000000000000000099')).toBe(false);
  });
});

describe('the widest of several grants (widestScopeSelector)', () => {
  it('is built for the KEY that wins, so it carries that grant\'s reach', () => {
    const c = ctx({
      branchId: BRANCH_A,
      permissions: { 'screening.view': 'branch', 'interview.view': 'organization' },
      reach: { branchIds: [BRANCH_A, BRANCH_B], departmentIds: [] },
    });
    expect(widestScopeSelector(c, ['screening.view', 'interview.view']).scope).toBe('organization');
    const narrower = ctx({
      branchId: BRANCH_A,
      permissions: { 'screening.view': 'own', 'interview.view': 'branch' },
      reach: { branchIds: [BRANCH_A, BRANCH_B], departmentIds: [] },
    });
    const selector = widestScopeSelector(narrower, ['screening.view', 'interview.view']);
    expect(selector.scope).toBe('branch');
    expect(selector.branchIds).toEqual([BRANCH_A, BRANCH_B]);
  });

  it('falls back to own when none of the keys is granted', () => {
    expect(widestScopeSelector(ctx({}), ['screening.view']).scope).toBe('own');
  });
});
