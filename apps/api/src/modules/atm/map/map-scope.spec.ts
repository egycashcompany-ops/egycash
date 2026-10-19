// The machine map's scope rule and its edit branch (docs/12-planning/atm-map-zones.md §6.2, §9.2):
// finer scopes narrow to the branch where the machine repository widens to the company, `own` reads
// nothing, a browser branch only narrows, writes are enumerated through `keyReachesBranch`, and the
// zones are edited in the top bar's branch — or the caller's only editable one — never another.
import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { NEVER_MATCH, orgScopeMatch } from '../../../shared/base/org-scope-match';
import { ValidationError } from '../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../shared/types';

const ALEX = '64a000000000000000000001';
const TANTA = '64a000000000000000000002';
const DEPT = '64a0000000000000000000d1';
const SECTION = '64a0000000000000000000e1';

const branches = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock('../../../platform/organization', () => ({
  branchRepository: {
    list: vi.fn(async () => ({
      items: branches.ids.map((id) => ({ _id: id, status: 'active' })),
    })),
  },
}));

const { mapScopeBranches, mapScopeMatch, narrowToBranch, resolveZoneEditBranch, writableBranches } =
  await import('./map-scope');

const selector = (over: Partial<ScopeSelector>): ScopeSelector => ({
  scope: 'branch',
  userId: '64a0000000000000000000aa',
  branchId: ALEX,
  departmentId: DEPT,
  sectionId: SECTION,
  ...over,
});

const context = (over: Partial<AuthContext>): AuthContext => ({
  userId: '64a0000000000000000000aa',
  sessionId: 's',
  branchId: ALEX,
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions: {},
  permissionVersion: 1,
  isPrivileged: false,
  ...over,
});

const oid = (id: string) => new Types.ObjectId(id);

describe('mapScopeMatch (DM-10)', () => {
  it('reads everything for organization', () => {
    expect(mapScopeMatch(selector({ scope: 'organization' }))).toEqual({});
  });

  it('reads the home branch for a branch grant', () => {
    expect(mapScopeMatch(selector({ scope: 'branch' }))).toEqual({ branchId: oid(ALEX) });
  });

  it('reads the branches a department reach sits in', () => {
    const match = mapScopeMatch(
      selector({ scope: 'department', departmentIds: [DEPT], departmentBranchIds: [TANTA] }),
    );
    expect(match).toEqual({ branchId: { $in: [oid(TANTA)] } });
  });

  it('narrows a section grant to the home branch', () => {
    expect(mapScopeMatch(selector({ scope: 'section' }))).toEqual({ branchId: oid(ALEX) });
  });

  it('narrows a home-only department grant to the home branch', () => {
    expect(mapScopeMatch(selector({ scope: 'department' }))).toEqual({ branchId: oid(ALEX) });
  });

  it('reads nothing for own', () => {
    expect(mapScopeMatch(selector({ scope: 'own' }))).toEqual({ ...NEVER_MATCH });
  });

  it('reads nothing for a non-organization shape orgScopeMatch answers with {}', () => {
    // A department reach with no branch to narrow to — the one shape orgScopeMatch cannot place.
    const shape = selector({ scope: 'department', departmentIds: [DEPT], departmentBranchIds: [] });
    expect(orgScopeMatch(shape, { branch: 'branchId' }, { finerNarrowsToBranch: true })).toEqual(
      {},
    );
    expect(mapScopeMatch(shape)).toEqual({ ...NEVER_MATCH });
    expect(mapScopeBranches(shape)).toEqual([]);
  });

  it('differs from the machine repository, which widens a department grant to the company', () => {
    const department = selector({ scope: 'department' });
    expect(orgScopeMatch(department, { branch: 'branchId' })).toEqual({});
    expect(mapScopeMatch(department)).toEqual({ branchId: oid(ALEX) });
  });
});

describe('mapScopeBranches', () => {
  it('names the same branches the match reads', () => {
    expect(mapScopeBranches(selector({ scope: 'organization' }))).toBe('all');
    expect(mapScopeBranches(selector({ scope: 'branch' }))).toEqual([ALEX]);
    expect(mapScopeBranches(selector({ scope: 'own' }))).toEqual([]);
    expect(
      mapScopeBranches(
        selector({ scope: 'department', departmentIds: [DEPT], departmentBranchIds: [TANTA] }),
      ),
    ).toEqual([TANTA]);
  });
});

describe('narrowToBranch (DM-11)', () => {
  it('is nothing when no branch is asked', () => {
    expect(narrowToBranch(selector({}), undefined)).toEqual({});
  });

  it('narrows inside the reach', () => {
    expect(narrowToBranch(selector({}), ALEX)).toEqual({ branchId: oid(ALEX) });
    expect(narrowToBranch(selector({ scope: 'organization' }), TANTA)).toEqual({
      branchId: oid(TANTA),
    });
  });

  it('refuses a branch outside the reach with 400 OUT_OF_REACH, never widening', () => {
    let thrown: unknown;
    try {
      narrowToBranch(selector({}), TANTA);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ValidationError);
    expect((thrown as ValidationError).httpStatus).toBe(400);
    expect((thrown as ValidationError).details).toEqual([
      expect.objectContaining({ field: 'query.branchId', code: 'OUT_OF_REACH' }),
    ]);
    expect(() => narrowToBranch(selector({ scope: 'own' }), ALEX)).toThrow(ValidationError);
  });
});

describe('writableBranches', () => {
  it('drops the branches keyReachesBranch refuses', async () => {
    const ctx = context({ permissions: { 'atmMachine.locate': 'branch' } });
    expect(await writableBranches(ctx, 'atmMachine.locate', [ALEX, TANTA])).toEqual([ALEX]);
    const department = context({
      departmentId: DEPT,
      permissions: { 'atmMachine.locate': 'department' },
    });
    expect(await writableBranches(department, 'atmMachine.locate', [ALEX])).toEqual([]);
  });

  it("answers 'all' only for an organization grant over 'all'", async () => {
    branches.ids = [ALEX, TANTA];
    const org = context({ branchId: null, permissions: { 'atmMachine.locate': 'organization' } });
    expect(await writableBranches(org, 'atmMachine.locate', 'all')).toBe('all');
    expect(await writableBranches(org, 'atmMachine.locate', [TANTA])).toEqual([TANTA]);
    const branch = context({ permissions: { 'atmMachine.locate': 'branch' } });
    expect(await writableBranches(branch, 'atmMachine.locate', 'all')).toEqual([ALEX]);
  });
});

describe('resolveZoneEditBranch (D-M6, DM-12)', () => {
  const editor = (over: Partial<AuthContext>): AuthContext =>
    context({
      permissions: { 'atmMap.view': 'branch', 'atmZone.manage': 'branch' },
      ...over,
    });

  it('case A: an organization editor placed in Alex with the top bar at Tanta edits Tanta', async () => {
    branches.ids = [ALEX, TANTA];
    const ctx = editor({
      permissions: { 'atmMap.view': 'organization', 'atmZone.manage': 'organization' },
      activeBranchId: TANTA,
    });
    expect(await resolveZoneEditBranch(ctx)).toEqual({ branchId: TANTA });
  });

  it('case A: the same editor with «كل الفروع» in a multi-branch company must choose one', async () => {
    branches.ids = [ALEX, TANTA];
    const ctx = editor({
      permissions: { 'atmMap.view': 'organization', 'atmZone.manage': 'organization' },
      activeBranchId: null,
    });
    expect(await resolveZoneEditBranch(ctx)).toEqual({ branchId: null, blocked: 'chooseBranch' });
  });

  it('an organization editor in a one-branch company edits that branch', async () => {
    branches.ids = [TANTA];
    const ctx = editor({
      branchId: null,
      permissions: { 'atmMap.view': 'organization', 'atmZone.manage': 'organization' },
    });
    expect(await resolveZoneEditBranch(ctx)).toEqual({ branchId: TANTA });
  });

  it("case B: another key's delegation reaching Tanta does not move a branch editor out of Alex", async () => {
    const ctx = editor({
      permissions: {
        'atmMap.view': 'branch',
        'atmZone.manage': 'branch',
        'atmRegister.view': 'branch',
      },
      reach: { branchIds: [ALEX, TANTA], departments: [] },
      keyReach: { 'atmRegister.view': { branchIds: [ALEX, TANTA], departments: [] } },
      activeBranchId: TANTA,
    });
    expect(await resolveZoneEditBranch(ctx)).toEqual({ branchId: ALEX });
  });

  it('a branch editor in Alex edits Alex whatever the top bar says', async () => {
    expect(await resolveZoneEditBranch(editor({ activeBranchId: TANTA }))).toEqual({
      branchId: ALEX,
    });
    expect(await resolveZoneEditBranch(editor({ activeBranchId: null }))).toEqual({
      branchId: ALEX,
    });
  });

  it('a department-scoped editor edits nothing', async () => {
    const ctx = editor({
      departmentId: DEPT,
      permissions: { 'atmMap.view': 'department', 'atmZone.manage': 'department' },
    });
    expect(await resolveZoneEditBranch(ctx)).toEqual({
      branchId: null,
      blocked: 'branchNotEditable',
    });
  });
});
