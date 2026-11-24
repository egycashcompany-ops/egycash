// The fail-closed branch-record rule and the work branch, written once for every module with branch
// records. ATM's map and settlements re-export these (modules/atm/shared/branch-scope.spec.ts pins
// that they are the same functions); the cases here are the ones ATM first pinned, with the
// active-branch list passed in, because shared code reads no platform data.
import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../errors';
import { type AuthContext, type ScopeSelector } from '../types';
import {
  branchScopeBranches,
  branchScopeMatch,
  narrowToBranch,
  resolveWorkBranch,
  writableBranches,
} from './branch-scope';
import { NEVER_MATCH, orgScopeMatch } from './org-scope-match';

const ALEX = '64a000000000000000000001';
const TANTA = '64a000000000000000000002';
const DEPT = '64a0000000000000000000d1';
const SECTION = '64a0000000000000000000e1';

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

/** A loader over a fixed branch list, counting its calls. */
const loader = (ids: string[]) => vi.fn(async () => ids);

describe('branchScopeMatch', () => {
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

describe('narrowToBranch', () => {
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
    const active = loader([ALEX, TANTA]);
    const ctx = context({ permissions: { k: 'branch' } });
    expect(await writableBranches(ctx, 'k', [ALEX, TANTA], active)).toEqual([ALEX]);
    const department = context({ departmentId: DEPT, permissions: { k: 'department' } });
    expect(await writableBranches(department, 'k', [ALEX], active)).toEqual([]);
    expect(active).not.toHaveBeenCalled();
  });

  it("answers 'all' only for an organization grant over 'all', without reading the branches", async () => {
    const active = loader([ALEX, TANTA]);
    const org = context({ branchId: null, permissions: { k: 'organization' } });
    expect(await writableBranches(org, 'k', 'all', active)).toBe('all');
    expect(active).not.toHaveBeenCalled();
    expect(await writableBranches(org, 'k', [TANTA], active)).toEqual([TANTA]);
  });

  it("reads the active branches when a narrower grant asks over 'all'", async () => {
    const active = loader([ALEX, TANTA]);
    const branch = context({ permissions: { k: 'branch' } });
    expect(await writableBranches(branch, 'k', 'all', active)).toEqual([ALEX]);
    expect(active).toHaveBeenCalledTimes(1);
  });
});

describe('resolveWorkBranch', () => {
  const KEYS = ['x.view', 'x.manage'] as const;

  it('the top bar branch when the view key reads it, with canWrite per write key', async () => {
    const active = loader([ALEX, TANTA]);
    const org = context({
      permissions: { 'x.view': 'organization', 'x.manage': 'organization' },
      activeBranchId: TANTA,
    });
    expect(await resolveWorkBranch(org, ...KEYS, active)).toEqual({
      branchId: TANTA,
      canWrite: true,
    });
    const reader = context({ permissions: { 'x.view': 'organization' }, activeBranchId: TANTA });
    expect(await resolveWorkBranch(reader, ...KEYS, active)).toEqual({
      branchId: TANTA,
      canWrite: false,
    });
    expect(active).not.toHaveBeenCalled();
  });

  it('an organization caller at «كل الفروع» with two branches must choose one', async () => {
    const ctx = context({
      branchId: null,
      permissions: { 'x.view': 'organization' },
      activeBranchId: null,
    });
    expect(await resolveWorkBranch(ctx, ...KEYS, loader([ALEX, TANTA]))).toEqual({
      branchId: null,
      blocked: 'chooseBranch',
    });
  });

  it('an organization caller in a one-branch company works in that branch', async () => {
    const ctx = context({ branchId: null, permissions: { 'x.view': 'organization' } });
    expect(await resolveWorkBranch(ctx, ...KEYS, loader([TANTA]))).toEqual({
      branchId: TANTA,
      canWrite: false,
    });
  });

  it('a branch grant works in its home branch whatever the top bar says', async () => {
    const ctx = context({
      permissions: { 'x.view': 'branch', 'x.manage': 'branch' },
      activeBranchId: TANTA,
    });
    expect(await resolveWorkBranch(ctx, ...KEYS, loader([ALEX, TANTA]))).toEqual({
      branchId: ALEX,
      canWrite: true,
    });
  });

  it('a department grant reads its branch and never writes it', async () => {
    const ctx = context({
      departmentId: DEPT,
      permissions: { 'x.view': 'department', 'x.manage': 'department' },
    });
    expect(await resolveWorkBranch(ctx, ...KEYS, loader([ALEX, TANTA]))).toEqual({
      branchId: ALEX,
      canWrite: false,
    });
  });

  it('no reach → noBranch; own reads nothing', async () => {
    expect(await resolveWorkBranch(context({}), ...KEYS, loader([ALEX]))).toEqual({
      branchId: null,
      blocked: 'noBranch',
    });
    const own = context({ permissions: { 'x.view': 'own' } });
    expect(await resolveWorkBranch(own, ...KEYS, loader([ALEX]))).toEqual({
      branchId: null,
      blocked: 'noBranch',
    });
  });
});
