// The ATM branch-record scope rule and the work branch (docs/12-planning/atm-settlements-phase1.md
// §6.2, §10.2): the helpers moved from the map keep the map's cases (and the map's names are the
// same functions), and `resolveWorkBranch` answers the top bar's branch when the view key reads
// it, else the caller's only readable branch, else the reason — per page key pair.
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

const scope = await import('./branch-scope');
const map = await import('../map/map-scope');
const {
  activeBranchIds,
  branchScopeBranches,
  branchScopeMatch,
  narrowToBranch,
  resolveWorkBranch,
  writableBranches,
} = scope;

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

describe('the map keeps its names for the same functions', () => {
  it('aliases, not copies', () => {
    expect(map.mapScopeMatch).toBe(branchScopeMatch);
    expect(map.mapScopeBranches).toBe(branchScopeBranches);
    expect(map.narrowToBranch).toBe(narrowToBranch);
    expect(map.activeBranchIds).toBe(activeBranchIds);
    expect(map.writableBranches).toBe(writableBranches);
  });
});

describe('branchScopeMatch (DM-10, DS-23)', () => {
  it('reads everything for organization', () => {
    expect(branchScopeMatch(selector({ scope: 'organization' }))).toEqual({});
  });

  it('reads the home branch for a branch grant', () => {
    expect(branchScopeMatch(selector({ scope: 'branch' }))).toEqual({ branchId: oid(ALEX) });
  });

  it('reads the branches a department reach sits in', () => {
    const match = branchScopeMatch(
      selector({ scope: 'department', departmentIds: [DEPT], departmentBranchIds: [TANTA] }),
    );
    expect(match).toEqual({ branchId: { $in: [oid(TANTA)] } });
  });

  it('narrows a section grant and a home-only department grant to the home branch', () => {
    expect(branchScopeMatch(selector({ scope: 'section' }))).toEqual({ branchId: oid(ALEX) });
    expect(branchScopeMatch(selector({ scope: 'department' }))).toEqual({ branchId: oid(ALEX) });
  });

  it('reads nothing for own', () => {
    expect(branchScopeMatch(selector({ scope: 'own' }))).toEqual({ ...NEVER_MATCH });
  });

  it('reads nothing for a non-organization shape orgScopeMatch answers with {}', () => {
    const shape = selector({ scope: 'department', departmentIds: [DEPT], departmentBranchIds: [] });
    expect(orgScopeMatch(shape, { branch: 'branchId' }, { finerNarrowsToBranch: true })).toEqual(
      {},
    );
    expect(branchScopeMatch(shape)).toEqual({ ...NEVER_MATCH });
    expect(branchScopeBranches(shape)).toEqual([]);
  });
});

describe('branchScopeBranches', () => {
  it('names the same branches the match reads', () => {
    expect(branchScopeBranches(selector({ scope: 'organization' }))).toBe('all');
    expect(branchScopeBranches(selector({ scope: 'branch' }))).toEqual([ALEX]);
    expect(branchScopeBranches(selector({ scope: 'own' }))).toEqual([]);
    expect(
      branchScopeBranches(
        selector({ scope: 'department', departmentIds: [DEPT], departmentBranchIds: [TANTA] }),
      ),
    ).toEqual([TANTA]);
  });
});

describe('narrowToBranch (DM-11)', () => {
  it('is nothing when no branch is asked, and narrows inside the reach', () => {
    expect(narrowToBranch(selector({}), undefined)).toEqual({});
    expect(narrowToBranch(selector({}), ALEX)).toEqual({ branchId: oid(ALEX) });
    expect(narrowToBranch(selector({ scope: 'organization' }), TANTA)).toEqual({
      branchId: oid(TANTA),
    });
  });

  it('refuses a branch outside the reach with 400 OUT_OF_REACH, naming the field', () => {
    let thrown: unknown;
    try {
      narrowToBranch(selector({}), TANTA, 'body.branchId');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ValidationError);
    expect((thrown as ValidationError).httpStatus).toBe(400);
    expect((thrown as ValidationError).details).toEqual([
      expect.objectContaining({ field: 'body.branchId', code: 'OUT_OF_REACH' }),
    ]);
    expect(() => narrowToBranch(selector({ scope: 'own' }), ALEX)).toThrow(ValidationError);
  });
});

describe('writableBranches', () => {
  it('drops the branches keyReachesBranch refuses; a department grant writes nowhere', async () => {
    const ctx = context({ permissions: { 'atmSettlementPlan.manage': 'branch' } });
    expect(await writableBranches(ctx, 'atmSettlementPlan.manage', [ALEX, TANTA])).toEqual([ALEX]);
    const department = context({
      departmentId: DEPT,
      permissions: { 'atmSettlementPlan.manage': 'department' },
    });
    expect(await writableBranches(department, 'atmSettlementPlan.manage', [ALEX])).toEqual([]);
  });

  it("answers 'all' only for an organization grant over 'all'", async () => {
    branches.ids = [ALEX, TANTA];
    const org = context({ branchId: null, permissions: { k: 'organization' } });
    expect(await writableBranches(org, 'k', 'all')).toBe('all');
    expect(await writableBranches(org, 'k', [TANTA])).toEqual([TANTA]);
    const branch = context({ permissions: { k: 'branch' } });
    expect(await writableBranches(branch, 'k', 'all')).toEqual([ALEX]);
  });
});

describe('resolveWorkBranch (DS-22)', () => {
  const PLANS = ['atmSettlementPlan.view', 'atmSettlementPlan.manage'] as const;
  const LAYOUTS = ['atmCassetteLayout.view', 'atmCassetteLayout.manage'] as const;

  it('the top bar branch when the view key reads it, with canWrite per write key', async () => {
    branches.ids = [ALEX, TANTA];
    const org = context({
      permissions: {
        'atmSettlementPlan.view': 'organization',
        'atmSettlementPlan.manage': 'organization',
      },
      activeBranchId: TANTA,
    });
    expect(await resolveWorkBranch(org, ...PLANS)).toEqual({ branchId: TANTA, canWrite: true });
    const reader = context({
      permissions: { 'atmSettlementPlan.view': 'organization' },
      activeBranchId: TANTA,
    });
    expect(await resolveWorkBranch(reader, ...PLANS)).toEqual({
      branchId: TANTA,
      canWrite: false,
    });
  });

  it('an organization caller at «كل الفروع» with two branches must choose one', async () => {
    branches.ids = [ALEX, TANTA];
    const ctx = context({
      branchId: null,
      permissions: { 'atmSettlementPlan.view': 'organization' },
      activeBranchId: null,
    });
    expect(await resolveWorkBranch(ctx, ...PLANS)).toEqual({
      branchId: null,
      blocked: 'chooseBranch',
    });
  });

  it('an organization caller in a one-branch company works in that branch', async () => {
    branches.ids = [TANTA];
    const ctx = context({
      branchId: null,
      permissions: { 'atmSettlementPlan.view': 'organization' },
    });
    expect(await resolveWorkBranch(ctx, ...PLANS)).toEqual({ branchId: TANTA, canWrite: false });
  });

  it('a branch grant works in its home branch whatever the top bar says', async () => {
    const ctx = context({
      permissions: { 'atmSettlementPlan.view': 'branch', 'atmSettlementPlan.manage': 'branch' },
      activeBranchId: TANTA,
    });
    expect(await resolveWorkBranch(ctx, ...PLANS)).toEqual({ branchId: ALEX, canWrite: true });
  });

  it('a department grant reads its branch and never writes it', async () => {
    const ctx = context({
      departmentId: DEPT,
      permissions: {
        'atmSettlementPlan.view': 'department',
        'atmSettlementPlan.manage': 'department',
      },
    });
    expect(await resolveWorkBranch(ctx, ...PLANS)).toEqual({ branchId: ALEX, canWrite: false });
  });

  it('no reach → noBranch; own reads nothing', async () => {
    expect(await resolveWorkBranch(context({}), ...PLANS)).toEqual({
      branchId: null,
      blocked: 'noBranch',
    });
    const own = context({ permissions: { 'atmSettlementPlan.view': 'own' } });
    expect(await resolveWorkBranch(own, ...PLANS)).toEqual({
      branchId: null,
      blocked: 'noBranch',
    });
  });

  it('the same user resolves differently for the plans and the layouts pages', async () => {
    branches.ids = [ALEX, TANTA];
    const ctx = context({
      permissions: {
        'atmSettlementPlan.view': 'organization',
        'atmSettlementPlan.manage': 'organization',
        'atmCassetteLayout.view': 'branch',
      },
      activeBranchId: TANTA,
    });
    expect(await resolveWorkBranch(ctx, ...PLANS)).toEqual({ branchId: TANTA, canWrite: true });
    expect(await resolveWorkBranch(ctx, ...LAYOUTS)).toEqual({ branchId: ALEX, canWrite: false });
  });
});
