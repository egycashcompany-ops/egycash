// The branch switcher narrows. It never widens.
//
// One control in the command bar decides what every list in the application shows, so the rule it
// obeys is worth stating as tests rather than trusting to the reading of one `if`. The property
// that matters is one-directional: whatever a caller sends, they end up seeing the same rows as
// before or fewer — never a row their grant did not already reach.
import { describe, expect, it } from 'vitest';
import {
  currentBranchId,
  keyCoversUnit,
  keyReachesBranch,
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
  const REACH = { branchIds: [BRANCH_A, BRANCH_B], departments: [] };

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
        reach: { branchIds: [], departments: [] },
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

  it('carries every branch copy of the department, and the branches they sit in — never the branches themselves', () => {
    const selector = scopeSelector(
      ctx({
        departmentId: D1,
        permissions: { 'goldBar.view': 'department' },
        reach: { branchIds: [], departments: [{ id: D1, branchId: BRANCH_A }, { id: D2, branchId: BRANCH_B }] },
      }),
      'goldBar.view',
    );
    expect(selector.scope).toBe('department');
    expect(selector.departmentIds).toEqual([D1, D2]);
    expect(selector.departmentBranchIds).toEqual([BRANCH_A, BRANCH_B]);
    expect(selector.branchIds).toBeUndefined();
  });

  it('narrows to the copy inside the chosen branch, and to nothing else', () => {
    const selector = scopeSelector(
      ctx({
        departmentId: D1,
        permissions: { 'goldBar.view': 'department' },
        reach: { branchIds: [], departments: [{ id: D1, branchId: BRANCH_A }, { id: D2, branchId: BRANCH_B }] },
        activeBranchId: BRANCH_B,
      }),
      'goldBar.view',
    );
    expect(selector.departmentIds).toEqual([D2]);
    expect(selector.departmentBranchIds).toEqual([BRANCH_B]);
    expect(selector.branchIds).toBeUndefined();
  });
});

describe('a key covers UNITS — whole branches and department copies are different things (Gap 1)', () => {
  const D_A = '650000000000000000000201'; // «الحركة» in branch A
  const D_B = '650000000000000000000202'; // «الحركة» in branch B
  const OTHER_A = '650000000000000000000203'; // «الأمن» in branch A

  /** Branch scope: the whole of A — every department in it — and nothing in B. */
  const branchHolder = ctx({
    branchId: BRANCH_A,
    permissions: { 'employee.view': 'branch' },
  });
  /** Department + branch: «الحركة» in A only. */
  const branchDepartmentHolder = ctx({
    branchId: BRANCH_A,
    departmentId: D_A,
    permissions: { 'employee.view': 'department' },
  });
  /** Department-wide: «الحركة» in every branch, and no branch as a whole. */
  const departmentWideHolder = ctx({
    permissions: { 'employee.view': 'department' },
    reach: { branchIds: [], departments: [{ id: D_A, branchId: BRANCH_A }, { id: D_B, branchId: BRANCH_B }] },
    keyReach: {
      'employee.view': { branchIds: [], departments: [{ id: D_A, branchId: BRANCH_A }, { id: D_B, branchId: BRANCH_B }] },
    },
  });

  it('branch scope covers the whole branch and any department in it', () => {
    expect(keyCoversUnit(branchHolder, 'employee.view', BRANCH_A, null)).toBe(true);
    expect(keyCoversUnit(branchHolder, 'employee.view', BRANCH_A, D_A)).toBe(true);
    expect(keyCoversUnit(branchHolder, 'employee.view', BRANCH_A, OTHER_A)).toBe(true);
    expect(keyCoversUnit(branchHolder, 'employee.view', BRANCH_B, null)).toBe(false);
    expect(keyCoversUnit(branchHolder, 'employee.view', BRANCH_B, D_B)).toBe(false);
  });

  it('department + branch covers that department there, never the branch and never another department', () => {
    expect(keyCoversUnit(branchDepartmentHolder, 'employee.view', BRANCH_A, D_A)).toBe(true);
    expect(keyCoversUnit(branchDepartmentHolder, 'employee.view', BRANCH_A, null)).toBe(false);
    expect(keyCoversUnit(branchDepartmentHolder, 'employee.view', BRANCH_A, OTHER_A)).toBe(false);
    expect(keyCoversUnit(branchDepartmentHolder, 'employee.view', BRANCH_B, D_B)).toBe(false);
  });

  it('department-wide covers the department in every branch, and no branch as a whole', () => {
    expect(keyCoversUnit(departmentWideHolder, 'employee.view', BRANCH_A, D_A)).toBe(true);
    expect(keyCoversUnit(departmentWideHolder, 'employee.view', BRANCH_B, D_B)).toBe(true);
    expect(keyCoversUnit(departmentWideHolder, 'employee.view', BRANCH_A, null)).toBe(false);
    expect(keyCoversUnit(departmentWideHolder, 'employee.view', BRANCH_B, null)).toBe(false);
    expect(keyCoversUnit(departmentWideHolder, 'employee.view', BRANCH_A, OTHER_A)).toBe(false);
    // The whole-branch question is the same function, asked with no department.
    expect(keyReachesBranch(departmentWideHolder, 'employee.view', BRANCH_A)).toBe(false);
  });

  it('a key held at home as a branch and elsewhere as one department filters as the OR of both units', () => {
    const mixed = ctx({
      branchId: BRANCH_A,
      permissions: { 'employee.view': 'branch' },
      reach: { branchIds: [BRANCH_A], departments: [{ id: D_B, branchId: BRANCH_B }] },
      keyReach: { 'employee.view': { branchIds: [BRANCH_A], departments: [{ id: D_B, branchId: BRANCH_B }] } },
    });
    const selector = scopeSelector(mixed, 'employee.view');
    expect(selector.branchIds).toEqual([BRANCH_A]);
    expect(selector.departmentIds).toEqual([D_B]);
    expect(keyCoversUnit(mixed, 'employee.view', BRANCH_B, null)).toBe(false);
    expect(keyCoversUnit(mixed, 'employee.view', BRANCH_B, D_B)).toBe(true);
    // Narrowing to B keeps only the unit inside B: the department, not the branch.
    const narrowed = scopeSelector({ ...mixed, activeBranchId: BRANCH_B }, 'employee.view');
    expect(narrowed.branchIds).toBeUndefined();
    expect(narrowed.departmentIds).toEqual([D_B]);
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
      reach: { branchIds: [BRANCH_A, BRANCH_B], departments: [] },
    });
    expect(currentBranchId(c)).toBe(BRANCH_B);
  });

  it('is the chosen branch for an organization-wide caller, who may choose anywhere', () => {
    expect(currentBranchId(ctx({ activeBranchId: BRANCH_B }))).toBe(BRANCH_B);
  });

  it('is the only branch a reach names when the caller has no home', () => {
    expect(currentBranchId(ctx({ reach: { branchIds: [BRANCH_B], departments: [] } }))).toBe(BRANCH_B);
  });

  it('is nothing for a multi-branch caller with no home who has not chosen', () => {
    const c = ctx({ reach: { branchIds: [BRANCH_A, BRANCH_B], departments: [] } });
    expect(currentBranchId(c)).toBeNull();
  });

  it('ignores a choice outside the reach for a caller with no home', () => {
    const c = ctx({
      activeBranchId: '650000000000000000000099',
      reach: { branchIds: [BRANCH_A, BRANCH_B], departments: [] },
    });
    expect(currentBranchId(c)).toBeNull();
  });
});

describe('reachesBranch', () => {
  it('is the home branch and every branch the grants reach', () => {
    const c = ctx({ branchId: BRANCH_A, reach: { branchIds: [BRANCH_B], departments: [] } });
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
      reach: { branchIds: [BRANCH_A, BRANCH_B], departments: [] },
    });
    expect(widestScopeSelector(c, ['screening.view', 'interview.view']).scope).toBe('organization');
    const narrower = ctx({
      branchId: BRANCH_A,
      permissions: { 'screening.view': 'own', 'interview.view': 'branch' },
      reach: { branchIds: [BRANCH_A, BRANCH_B], departments: [] },
    });
    const selector = widestScopeSelector(narrower, ['screening.view', 'interview.view']);
    expect(selector.scope).toBe('branch');
    expect(selector.branchIds).toEqual([BRANCH_A, BRANCH_B]);
  });

  it('falls back to own when none of the keys is granted', () => {
    expect(widestScopeSelector(ctx({}), ['screening.view']).scope).toBe('own');
  });
});

describe('reach is read per key when the snapshot records it (ADR-032)', () => {
  const twoAndOne = ctx({
    branchId: BRANCH_A,
    permissions: { 'employee.view': 'branch', 'attendance.view': 'branch' },
    reach: { branchIds: [BRANCH_A, BRANCH_B], departments: [] },
    keyReach: { 'employee.view': { branchIds: [BRANCH_A, BRANCH_B], departments: [] } },
  });

  it('a key with an entry reaches its own sites; a key without one reaches home only', () => {
    expect(scopeSelector(twoAndOne, 'employee.view').branchIds).toEqual([BRANCH_A, BRANCH_B]);
    const home = scopeSelector(twoAndOne, 'attendance.view');
    expect(home.branchIds).toBeUndefined();
    expect(home.branchId).toBe(BRANCH_A);
  });

  it('a snapshot without per-key reach falls back to the union, as before', () => {
    const old = ctx({
      branchId: BRANCH_A,
      permissions: { 'attendance.view': 'branch' },
      reach: { branchIds: [BRANCH_A, BRANCH_B], departments: [] },
    });
    expect(scopeSelector(old, 'attendance.view').branchIds).toEqual([BRANCH_A, BRANCH_B]);
  });

  it('keyReachesBranch answers per key, and organization-wide for everywhere', () => {
    expect(keyReachesBranch(twoAndOne, 'employee.view', BRANCH_B)).toBe(true);
    expect(keyReachesBranch(twoAndOne, 'attendance.view', BRANCH_B)).toBe(false);
    expect(keyReachesBranch(twoAndOne, 'attendance.view', BRANCH_A)).toBe(true);
    expect(keyReachesBranch(twoAndOne, 'leave.view', BRANCH_A)).toBe(false);
    const org = ctx({ permissions: { 'employee.view': 'organization' } });
    expect(keyReachesBranch(org, 'employee.view', BRANCH_B)).toBe(true);
    // Narrower than a site is never "held in the site".
    const own = ctx({ branchId: BRANCH_A, permissions: { 'employee.view': 'own' } });
    expect(keyReachesBranch(own, 'employee.view', BRANCH_A)).toBe(false);
  });
});

// ── Several branches at once ────────────────────────────────────────────────
//
// «كل الشاشات دي موجودة عند كل الفروع، الداتا بس اللي بتتغير» — so somebody who looks after three
// sites is comparing them, and one-at-a-time makes him do the comparing in his head. The property
// under test is the same one-directional one as above, now with a set: whatever he ticks, he ends
// up with the rows his grant already reached or fewer, never more.
describe('narrowing to several branches at once', () => {
  const BRANCH_C = '650000000000000000000012';

  it('turns an organization grant into a branch scope listing exactly those branches', () => {
    const selector = scopeSelector(
      ctx({
        permissions: { 'goldBar.view': 'organization' },
        activeBranchIds: [BRANCH_A, BRANCH_B],
      }),
      'goldBar.view',
    );
    expect(selector.scope).toBe('branch');
    expect(selector.branchIds).toEqual([BRANCH_A, BRANCH_B]);
  });

  it('keeps the single-branch shape when exactly one is ticked', () => {
    // `branchId` rather than a one-element `branchIds`: the repository layer reads both, and the
    // equality form is the cheaper query of the two.
    const selector = scopeSelector(
      ctx({ permissions: { 'goldBar.view': 'organization' }, activeBranchIds: [BRANCH_A] }),
      'goldBar.view',
    );
    expect(selector.branchId).toBe(BRANCH_A);
    expect(selector.branchIds).toBeUndefined();
  });

  it('keeps a multi-branch grant to the ticked branches, and drops the rest of its reach', () => {
    const selector = scopeSelector(
      ctx({
        permissions: { 'vehicle.view': 'branch' },
        reach: { branchIds: [BRANCH_A, BRANCH_B, BRANCH_C], departments: [] },
        activeBranchIds: [BRANCH_A, BRANCH_C],
      }),
      'vehicle.view',
    );
    expect(selector.branchIds).toEqual([BRANCH_A, BRANCH_C]);
  });

  it('never widens: a ticked branch the grant does not reach adds nothing', () => {
    const selector = scopeSelector(
      ctx({
        permissions: { 'vehicle.view': 'branch' },
        reach: { branchIds: [BRANCH_A], departments: [] },
        activeBranchIds: [BRANCH_A, BRANCH_B],
      }),
      'vehicle.view',
    );
    expect(selector.branchIds).toEqual([BRANCH_A]);
  });

  it('ignores a selection that names nothing the key reaches, rather than showing nothing', () => {
    // The same rule the single case already obeyed: a choice outside the reach leaves the caller
    // seeing everything the key covers, which is the view he would have had anyway.
    const selector = scopeSelector(
      ctx({
        permissions: { 'vehicle.view': 'branch' },
        reach: { branchIds: [BRANCH_A], departments: [] },
        activeBranchIds: [BRANCH_B],
      }),
      'vehicle.view',
    );
    expect(selector.branchIds).toEqual([BRANCH_A]);
  });

  it('narrows a department-level reach to the departments inside the ticked branches', () => {
    const selector = scopeSelector(
      ctx({
        permissions: { 'vehicle.view': 'department' },
        reach: {
          branchIds: [],
          departments: [
            { id: 'd-a', branchId: BRANCH_A },
            { id: 'd-b', branchId: BRANCH_B },
            { id: 'd-c', branchId: BRANCH_C },
          ],
        },
        activeBranchIds: [BRANCH_A, BRANCH_C],
      }),
      'vehicle.view',
    );
    expect(selector.departmentIds).toEqual(['d-a', 'd-c']);
    expect(selector.departmentBranchIds).toEqual([BRANCH_A, BRANCH_C]);
  });

  // The one question a set cannot answer. `activeBranchId` is left null by the middleware whenever
  // several are ticked, so a caller comparing three sites falls through to his placement rather
  // than having one of the three picked for him to file into.
  it('files a new document nowhere in particular while several are ticked', () => {
    expect(
      currentBranchId(ctx({ reach: { branchIds: [BRANCH_A, BRANCH_B], departments: [] } })),
    ).toBeNull();
  });

  it('files it into the caller’s own branch when he has one', () => {
    expect(
      currentBranchId(
        ctx({ branchId: BRANCH_C, reach: { branchIds: [BRANCH_A, BRANCH_B], departments: [] } }),
      ),
    ).toBe(BRANCH_C);
  });
});
