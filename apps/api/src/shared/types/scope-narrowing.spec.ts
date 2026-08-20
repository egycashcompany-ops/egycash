// The branch switcher narrows. It never widens.
//
// One control in the command bar decides what every list in the application shows, so the rule it
// obeys is worth stating as tests rather than trusting to the reading of one `if`. The property
// that matters is one-directional: whatever a caller sends, they end up seeing the same rows as
// before or fewer — never a row their grant did not already reach.
import { describe, expect, it } from 'vitest';
import { scopeSelector, type AuthContext } from './index';

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
