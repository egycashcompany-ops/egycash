// Who stands on a rung, asked from both ends: only grants in force put the reader on one (R3), and
// only active accounts staff one (R8). PX-1.3 of docs/12-planning/administration-module-phase-px1.md
// §6.3, §6.4 and §7; ADR-041 decisions 5 and 8.
//
// Both defects are quiet. A grant that ended last month still decides, under a real name, on a rung
// somebody in force also holds; a suspended manager's account keeps a rung staffed, so the chain
// waits on it, notifies it and never steps over it, although nobody can sign in as it. Neither
// shows on the trail.
//
// The repositories are faked over a few rows in memory, each read answering as its own query does
// (`rbac.repository.ts`, `delegation.repository.ts`, `user.repository.ts`), so what this file pins
// is which read the lookup asks and what it does with the answer. The queries themselves run
// against a database in `tests/integration/approvals.spec.ts`. `approver-level` runs for real.
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ApprovalLevel, type UserStatus } from '@ecms/contracts';
import { type DelegatedGrantDoc } from '../rbac/delegation.model';
import { type RoleAssignmentDoc } from '../rbac/role-assignment.model';
import { type RoleDoc } from '../rbac/role.model';
import { type Unit } from './approver-level';

interface Account {
  status: UserStatus;
  isDeleted: boolean;
}

/** The rows the fakes answer from; each case writes its own. */
const world = vi.hoisted(() => ({
  roles: [] as RoleDoc[],
  assignments: [] as RoleAssignmentDoc[],
  delegations: [] as DelegatedGrantDoc[],
  accounts: new Map<string, Account>(),
}));

const inForce = (a: RoleAssignmentDoc, now: Date): boolean =>
  (a.validFrom === null || a.validFrom <= now) && (a.validTo === null || a.validTo > now);
const ids = (list: readonly Types.ObjectId[]): Set<string> => new Set(list.map(String));

const mocks = vi.hoisted(() => ({
  findGrantingPermission: vi.fn(),
  findByIds: vi.fn(),
  findActiveForRoles: vi.fn(),
  findActiveForUser: vi.fn(),
  findInForceForUsers: vi.fn(),
  findForUser: vi.fn(),
  findByKeyInBranch: vi.fn(),
  findByKeyForDepartmentEverywhere: vi.fn(),
  activeIdsAmong: vi.fn(),
}));

vi.mock('../rbac/rbac.repository', () => ({
  roleRepository: {
    findGrantingPermission: mocks.findGrantingPermission,
    findByIds: mocks.findByIds,
  },
  roleAssignmentRepository: {
    findActiveForRoles: mocks.findActiveForRoles,
    findActiveForUser: mocks.findActiveForUser,
    findInForceForUsers: mocks.findInForceForUsers,
  },
}));
vi.mock('../rbac/delegation.repository', () => ({
  delegatedGrantRepository: {
    findForUser: mocks.findForUser,
    findByKeyInBranch: mocks.findByKeyInBranch,
    findByKeyForDepartmentEverywhere: mocks.findByKeyForDepartmentEverywhere,
  },
}));
vi.mock('../users/user.repository', () => ({
  userRepository: { activeIdsAmong: mocks.activeIdsAmong },
}));

// Each fake is its repository's query, read off the code: the same filters, nothing more.
mocks.findGrantingPermission.mockImplementation((key: string) =>
  Promise.resolve(world.roles.filter((r) => !r.isDeleted && r.permissionKeys.includes(key))),
);
mocks.findByIds.mockImplementation((roleIds: Types.ObjectId[]) =>
  Promise.resolve(world.roles.filter((r) => !r.isDeleted && ids(roleIds).has(String(r._id)))),
);
mocks.findActiveForRoles.mockImplementation((roleIds: Types.ObjectId[]) =>
  Promise.resolve(
    world.assignments.filter(
      (a) => !a.isDeleted && ids(roleIds).has(String(a.roleId)) && inForce(a, new Date()),
    ),
  ),
);
mocks.findActiveForUser.mockImplementation((userId: string) =>
  Promise.resolve(world.assignments.filter((a) => !a.isDeleted && String(a.userId) === userId)),
);
mocks.findInForceForUsers.mockImplementation((userIds: readonly Types.ObjectId[]) =>
  Promise.resolve(
    world.assignments.filter(
      (a) => !a.isDeleted && ids(userIds).has(String(a.userId)) && inForce(a, new Date()),
    ),
  ),
);
mocks.findForUser.mockImplementation((userId: string) =>
  Promise.resolve(world.delegations.filter((g) => !g.isDeleted && String(g.userId) === userId)),
);
mocks.findByKeyInBranch.mockImplementation((key: string, branchId: string) =>
  Promise.resolve(
    world.delegations.filter(
      (g) => !g.isDeleted && String(g.branchId) === branchId && g.permissionKeys.includes(key),
    ),
  ),
);
mocks.findByKeyForDepartmentEverywhere.mockImplementation((key: string, catalogId: string) =>
  Promise.resolve(
    world.delegations.filter(
      (g) =>
        !g.isDeleted &&
        g.allBranches &&
        String(g.departmentCatalogId) === catalogId &&
        g.permissionKeys.includes(key),
    ),
  ),
);
mocks.activeIdsAmong.mockImplementation((userIds: readonly string[]) =>
  Promise.resolve(
    userIds.filter((id) => {
      const account = world.accounts.get(id);
      return account !== undefined && account.status === 'active' && !account.isDeleted;
    }),
  ),
);

const { approversFor, hasApprovers, ownStepsOf } = await import('./approver-lookup');

const DAY = 86_400_000;
const KEY = 'leave.approve';
const BRANCH = new Types.ObjectId();
const CATALOG = new Types.ObjectId();
/** This branch's copy of the company department: where the request is judged. */
const COPY_HERE = new Types.ObjectId();
const UNIT: Unit = {
  branchId: String(BRANCH),
  departmentCatalogId: String(CATALOG),
  departmentId: String(COPY_HERE),
};

/** One rung per level, lowest first: 0 unit · 1 department · 2 branch · 3 organization. */
const LADDER: readonly { permissionKey: string; level: ApprovalLevel }[] = (
  ['unit', 'department', 'branch', 'organization'] as const
).map((level) => ({ permissionKey: KEY, level }));

/** The one role behind every grant here, carrying the rung's key. */
const APPROVER_ROLE = new Types.ObjectId();

/** An account with this status. */
const account = (status: UserStatus = 'active', isDeleted = false): string => {
  const id = String(new Types.ObjectId());
  world.accounts.set(id, { status, isDeleted });
  return id;
};

/** The grant shape each level reads (`approver-level.ts`). */
const SHAPES: Record<ApprovalLevel, Partial<RoleAssignmentDoc>> = {
  unit: { scope: 'department', departmentCatalogId: CATALOG, branchId: BRANCH },
  department: { scope: 'department', departmentCatalogId: CATALOG, allBranches: true },
  branch: { scope: 'branch', branchId: BRANCH },
  organization: { scope: 'organization' },
};

/** A role assignment of the approver role at `level`, open now unless the window says otherwise. */
const grant = (
  userId: string,
  level: ApprovalLevel,
  window: { validFrom?: Date | null; validTo?: Date | null } = {},
): void => {
  world.assignments.push({
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(userId),
    roleId: APPROVER_ROLE,
    branchId: null,
    departmentId: null,
    sectionId: null,
    branchIds: [],
    departmentCatalogId: null,
    allBranches: false,
    validFrom: null,
    validTo: null,
    isDeleted: false,
    ...SHAPES[level],
    ...window,
  } as unknown as RoleAssignmentDoc);
};

/** A delegation of the key over the department's copy in this branch: the `unit` shape. */
const delegate = (userId: string): void => {
  world.delegations.push({
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(userId),
    branchId: BRANCH,
    departmentId: COPY_HERE,
    departmentCatalogId: null,
    allBranches: false,
    permissionKeys: [KEY],
    grantedBy: null,
    isDeleted: false,
  } as unknown as DelegatedGrantDoc);
};

const yesterday = (): Date => new Date(Date.now() - DAY);
const tomorrow = (): Date => new Date(Date.now() + DAY);

beforeEach(() => {
  world.roles = [
    {
      _id: APPROVER_ROLE,
      key: null,
      name: { ar: 'معتمد الإجازات', en: 'Leave approver' },
      description: null,
      isSystem: false,
      departmentCatalogId: null,
      permissionKeys: [KEY],
      isDeleted: false,
    } as unknown as RoleDoc,
  ];
});

afterEach(() => {
  world.roles = [];
  world.assignments = [];
  world.delegations = [];
  world.accounts.clear();
  vi.clearAllMocks();
});

describe('ownStepsOf: only grants in force put the reader on a rung (R3)', () => {
  it('reads the reader’s grants in force, by the account’s id, and not every assignment they hold', async () => {
    const reader = account();
    grant(reader, 'organization');

    expect(await ownStepsOf(reader, LADDER, UNIT)).toEqual([3]);
    expect(mocks.findInForceForUsers).toHaveBeenCalledTimes(1);
    const [asked] = mocks.findInForceForUsers.mock.calls[0] as [Types.ObjectId[]];
    expect(asked.map(String)).toEqual([reader]);
    expect(mocks.findActiveForUser).not.toHaveBeenCalled();
  });

  it('an expired grant stands on no rung, and the grant in force beside it still does', async () => {
    const reader = account();
    grant(reader, 'unit');
    grant(reader, 'organization', {
      validFrom: new Date(Date.now() - 2 * DAY),
      validTo: yesterday(),
    });

    expect(await ownStepsOf(reader, LADDER, UNIT)).toEqual([0]);
  });

  it('a grant that has not started yet stands on no rung', async () => {
    const reader = account();
    grant(reader, 'department', { validFrom: tomorrow() });

    expect(await ownStepsOf(reader, LADDER, UNIT)).toEqual([]);
  });

  it('a delegation still puts its holder on its rung, read as before, while their expired assignment does not', async () => {
    // Delegated grants carry no validity window (`delegation.model.ts`), so their read is unchanged.
    const reader = account();
    delegate(reader);
    grant(reader, 'branch', { validTo: yesterday() });

    expect(await ownStepsOf(reader, LADDER, UNIT)).toEqual([0]);
    expect(mocks.findForUser).toHaveBeenCalledWith(reader);
  });
});

describe('approversFor: only active accounts staff a rung (R8)', () => {
  it('keeps only the accounts activeIdsAmong returns, so invited, suspended, archived and deleted holders drop out', async () => {
    const active = account('active');
    const holders = [
      active,
      account('invited'),
      account('suspended'),
      account('archived'),
      account('active', true),
    ];
    for (const holder of holders) grant(holder, 'organization');

    expect(await approversFor(KEY, 'organization', UNIT)).toEqual([active]);
  });

  it('asks once, by id, about every holder it found, by role assignment and by delegation alike', async () => {
    const assigned = account('active');
    const deputy = account('active');
    const suspendedDeputy = account('suspended');
    grant(assigned, 'unit');
    delegate(deputy);
    delegate(suspendedDeputy);

    expect(new Set(await approversFor(KEY, 'unit', UNIT))).toEqual(new Set([assigned, deputy]));
    expect(mocks.activeIdsAmong).toHaveBeenCalledTimes(1);
    const [asked] = mocks.activeIdsAmong.mock.calls[0] as [string[]];
    expect(new Set(asked)).toEqual(new Set([assigned, deputy, suspendedDeputy]));
    // The delegation reads are the ones the lookup always asked.
    expect(mocks.findByKeyInBranch).toHaveBeenCalledWith(KEY, String(BRANCH));
  });
});

describe('hasApprovers: a rung held only by accounts that are not active is unstaffed (R8)', () => {
  it('is false when only suspended and archived accounts hold the rung, and true once an active one does', async () => {
    grant(account('suspended'), 'branch');
    grant(account('archived'), 'branch');
    expect(await hasApprovers(KEY, 'branch', UNIT)).toBe(false);

    grant(account('active'), 'branch');
    expect(await hasApprovers(KEY, 'branch', UNIT)).toBe(true);
  });
});
