// The ATM branch links on a request — the owner's «أكتوبر هيشوف شغل المهندسين ويشتغل معاهم عادى»
// as a rewrite of the caller: placed in October, read as placed in Mohandessin. What is pinned is
// that EVERY place a branch hides in a context moves (placement, switcher, reach, per-key reach,
// department copies), that it moves to one target only once, and that the context it was given is
// never edited — its reach comes from the permission cache.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsService } from '../../../platform/settings';
import { type AuthContext } from '../../../shared/types';
import { actAsLinkedBranch, refineAtmAuthContext } from './link-context';

const OCTOBER = '650000000000000000000001';
const MOHANDESSIN = '650000000000000000000002';
const TANTA = '650000000000000000000003';
const DEPT_OCTOBER = '6500000000000000000000d1';

const LINKS = new Map([[OCTOBER, MOHANDESSIN]]);

const ctx = (over: Partial<AuthContext> = {}): AuthContext => ({
  userId: 'u1',
  sessionId: 's1',
  branchId: OCTOBER,
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions: { 'atmMachine.view': 'branch' },
  permissionVersion: 1,
  isPrivileged: false,
  ...over,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('actAsLinkedBranch', () => {
  it('reads a caller placed in October as placed in Mohandessin', () => {
    expect(actAsLinkedBranch(ctx(), LINKS).branchId).toBe(MOHANDESSIN);
  });

  it('moves the switcher’s choice, and leaves "the whole company" as it is', () => {
    expect(actAsLinkedBranch(ctx({ activeBranchId: OCTOBER }), LINKS).activeBranchId).toBe(
      MOHANDESSIN,
    );
    expect(actAsLinkedBranch(ctx({ activeBranchId: null }), LINKS).activeBranchId).toBeNull();
    expect('activeBranchId' in actAsLinkedBranch(ctx(), LINKS)).toBe(false);
  });

  it('moves every reached branch — whole, through a department copy, per key — once', () => {
    const refined = actAsLinkedBranch(
      ctx({
        reach: {
          branchIds: [OCTOBER, MOHANDESSIN, TANTA],
          departments: [{ id: DEPT_OCTOBER, branchId: OCTOBER }],
        },
        keyReach: {
          'atmMachine.view': { branchIds: [OCTOBER], departments: [] },
          'atmMaintenance.view': {
            branchIds: [],
            departments: [{ id: DEPT_OCTOBER, branchId: OCTOBER }],
          },
        },
      }),
      LINKS,
    );
    expect(refined.reach?.branchIds).toEqual([MOHANDESSIN, TANTA]);
    expect(refined.reach?.departments).toEqual([{ id: DEPT_OCTOBER, branchId: MOHANDESSIN }]);
    expect(refined.keyReach?.['atmMachine.view']?.branchIds).toEqual([MOHANDESSIN]);
    expect(refined.keyReach?.['atmMaintenance.view']?.departments).toEqual([
      { id: DEPT_OCTOBER, branchId: MOHANDESSIN },
    ]);
  });

  it('never edits the context it was given', () => {
    const given = ctx({
      activeBranchId: OCTOBER,
      reach: { branchIds: [OCTOBER], departments: [{ id: DEPT_OCTOBER, branchId: OCTOBER }] },
      keyReach: { 'atmMachine.view': { branchIds: [OCTOBER], departments: [] } },
    });
    const before = structuredClone(given);
    const refined = actAsLinkedBranch(given, LINKS);
    expect(given).toEqual(before);
    expect(refined).not.toBe(given);
    expect(refined.reach).not.toBe(given.reach);
  });

  it('leaves a caller of an unlinked branch where they are — the target’s own people too', () => {
    expect(actAsLinkedBranch(ctx({ branchId: TANTA }), LINKS).branchId).toBe(TANTA);
    expect(actAsLinkedBranch(ctx({ branchId: MOHANDESSIN }), LINKS).branchId).toBe(MOHANDESSIN);
    expect(actAsLinkedBranch(ctx({ branchId: null }), LINKS).branchId).toBeNull();
  });

  it('is the context itself when nothing is linked', () => {
    const given = ctx();
    expect(actAsLinkedBranch(given, new Map())).toBe(given);
  });

  it('changes nothing else — the grants are the caller’s own', () => {
    const given = ctx({ permissions: { 'atmMachine.manage': 'branch' }, isPrivileged: true });
    const refined = actAsLinkedBranch(given, LINKS);
    expect(refined.permissions).toEqual(given.permissions);
    expect(refined.userId).toBe(given.userId);
    expect(refined.isPrivileged).toBe(true);
  });
});

describe('refineAtmAuthContext', () => {
  it('applies the stored links, read through the settings at organization scope', async () => {
    const resolve = vi
      .spyOn(settingsService, 'resolve')
      .mockResolvedValue([{ branchId: OCTOBER, actsAsBranchId: MOHANDESSIN }] as never);
    expect((await refineAtmAuthContext(ctx())).branchId).toBe(MOHANDESSIN);
    expect(resolve).toHaveBeenCalledWith('atm.branchLinks', { userId: null, branchId: null });
  });

  it('changes nothing while no link is stored', async () => {
    vi.spyOn(settingsService, 'resolve').mockResolvedValue([] as never);
    const given = ctx();
    expect(await refineAtmAuthContext(given)).toBe(given);
  });
});
