// The ATM write-branch rule (GM-20 for ATM, 2026-10-28) and the link lookups. The owner's report: a
// machine added while the top bar said «المهندسين» showed only under «كل الشركة» — an
// organization-wide holder placed elsewhere filed it under their HOME branch. What is pinned: an
// organization-wide holder of the WRITE's key files where the top bar points, on «كل الشركة» in the
// only active branch or nowhere (asked to choose) — never home; every other caller keeps
// `currentBranchId` exactly, a crafted header included.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { branchRepository } from '../../../platform/organization';
import { type AuthContext } from '../../../shared/types';
import {
  CHOOSE_ATM_BRANCH_MESSAGE,
  actingAtmBranchId,
  atmWriteBranchOf,
  branchesFiledAs,
  linkedBranchOf,
  resolveAtmBranchId,
} from './atm-context';

const MOH = '650000000000000000000001';
const OCT = '650000000000000000000005';
const ALEX = '650000000000000000000004';
const TANTA = '650000000000000000000002';
const KEY = 'atmReplenishment.create';

const ctx = (over: Partial<AuthContext> = {}): AuthContext => ({
  userId: '650000000000000000000099',
  sessionId: 's',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions: {},
  permissionVersion: 1,
  isPrivileged: false,
  reach: { branchIds: [], departments: [] },
  keyReach: {},
  ...over,
});
const orgWide = (over: Partial<AuthContext> = {}): AuthContext =>
  ctx({ permissions: { [KEY]: 'organization' }, ...over });

/** The company's branches as `branchRepository.list` pages them (active and retired). */
const branchesAre = (rows: { id: string; status: 'active' | 'inactive' }[]): void => {
  vi.spyOn(branchRepository, 'list').mockResolvedValue({
    items: rows.map((row) => ({ _id: row.id, status: row.status })),
    meta: { page: 1, pageSize: 200, totalItems: rows.length, totalPages: 1 },
  } as never);
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('atmWriteBranchOf — the pure rule', () => {
  it('an organization-wide holder files where the top bar points, never at home', () => {
    expect(atmWriteBranchOf(orgWide({ branchId: ALEX, activeBranchId: MOH }), KEY)).toEqual({
      orgWide: true,
      branchId: MOH,
    });
    // «كل الشركة»: nothing chosen — the home placement does not answer for it.
    expect(atmWriteBranchOf(orgWide({ branchId: ALEX, activeBranchId: null }), KEY)).toEqual({
      orgWide: true,
      branchId: null,
    });
  });

  it('the key is the WRITE’s own: organization-wide on another key changes nothing', () => {
    const mixed = ctx({
      branchId: ALEX,
      activeBranchId: TANTA,
      permissions: { 'hr.employee.view': 'organization', [KEY]: 'branch' },
    });
    expect(atmWriteBranchOf(mixed, KEY)).toEqual({ orgWide: false, branchId: ALEX });
  });

  it('a branch-scoped caller keeps `currentBranchId` — a header naming another branch files at home', () => {
    const placed = ctx({ branchId: ALEX, activeBranchId: TANTA, permissions: { [KEY]: 'branch' } });
    expect(atmWriteBranchOf(placed, KEY)).toEqual({ orgWide: false, branchId: ALEX });
  });

  it('a caller with a reach list keeps today’s rule: the top bar within the reach, else home', () => {
    const reach = { branchIds: [ALEX, TANTA], departments: [] };
    const multi = (activeBranchId: string | null) =>
      ctx({ branchId: ALEX, activeBranchId, reach, permissions: { [KEY]: 'branch' } });
    expect(atmWriteBranchOf(multi(TANTA), KEY).branchId).toBe(TANTA);
    expect(atmWriteBranchOf(multi(MOH), KEY).branchId).toBe(ALEX);
    expect(atmWriteBranchOf(multi(null), KEY).branchId).toBe(ALEX);
    // Organization-wide on the key, but other grants list units: today's rule, exactly (SPEC §C).
    const listed = ctx({
      branchId: ALEX,
      activeBranchId: null,
      reach,
      permissions: { [KEY]: 'organization', 'atmMachine.view': 'branch' },
    });
    expect(atmWriteBranchOf(listed, KEY)).toEqual({ orgWide: false, branchId: ALEX });
  });
});

describe('actingAtmBranchId / resolveAtmBranchId', () => {
  it('«كل الشركة» with several active branches: none — and the write is refused, asking for one', async () => {
    branchesAre([
      { id: MOH, status: 'active' },
      { id: ALEX, status: 'active' },
    ]);
    const caller = orgWide({ branchId: ALEX, activeBranchId: null });
    expect(await actingAtmBranchId(caller, KEY)).toBeNull();
    await expect(resolveAtmBranchId(caller, KEY)).rejects.toThrow(CHOOSE_ATM_BRANCH_MESSAGE);
  });

  it('«كل الشركة» with ONE active branch: that branch (a retired one does not count)', async () => {
    branchesAre([
      { id: MOH, status: 'active' },
      { id: TANTA, status: 'inactive' },
    ]);
    expect(await resolveAtmBranchId(orgWide({ activeBranchId: null }), KEY)).toBe(MOH);
  });

  it('a top-bar branch needs no lookup at all', async () => {
    const list = vi.spyOn(branchRepository, 'list');
    expect(await resolveAtmBranchId(orgWide({ branchId: ALEX, activeBranchId: MOH }), KEY)).toBe(
      MOH,
    );
    expect(list).not.toHaveBeenCalled();
  });

  it('a caller with no branch and no top bar is refused as before', async () => {
    branchesAre([
      { id: MOH, status: 'active' },
      { id: ALEX, status: 'active' },
    ]);
    const lost = ctx({ permissions: { [KEY]: 'branch' } });
    await expect(actingAtmBranchId(lost, KEY)).rejects.toThrow('حسابك غير مرتبط بفرع');
    await expect(resolveAtmBranchId({ ...lost, isPrivileged: true }, KEY)).rejects.toThrow(
      CHOOSE_ATM_BRANCH_MESSAGE,
    );
  });
});

describe('link lookups', () => {
  const LINKS = new Map([[OCT, MOH]]);

  it('linkedBranchOf: a source is its target, anything else itself, in one lookup', () => {
    expect(linkedBranchOf(LINKS, OCT)).toBe(MOH);
    expect(linkedBranchOf(LINKS, MOH)).toBe(MOH);
    expect(linkedBranchOf(LINKS, ALEX)).toBe(ALEX);
    expect(linkedBranchOf(LINKS, OCT.toUpperCase())).toBe(MOH);
  });

  it('branchesFiledAs: the target and every source working as it', () => {
    const many = new Map([
      [OCT, MOH],
      [TANTA, MOH],
    ]);
    expect(branchesFiledAs(many, MOH)).toEqual([MOH, OCT, TANTA]);
    expect(branchesFiledAs(many, OCT)).toEqual([MOH, OCT, TANTA]);
    expect(branchesFiledAs(many, ALEX)).toEqual([ALEX]);
  });
});
