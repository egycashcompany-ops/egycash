// What the Administrative Affairs suites share (design §19.8): a real mongo booted with every
// module, as production boots; two branches; and signed-in people with exactly the grants a case
// needs — the master-data desk at organization scope, the same keys held only in branch A (which
// OD-04 A turns away from every master-data write), a catalog manager and an item reader each with
// nothing else, and someone holding no key of this module. Written once, so each suite states its
// cases and not its plumbing; the warehouse and supplier suites add their people here as they ship
// — the warehouses' (P1a.3) in `bootWarehouseWorld`: one person per row of §7.2's table, a
// department and its copies, and employees planted as HR stores them, one at work and one who left.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import { expect } from 'vitest';
import { SettingKeys, platformPermissions, type DataScope } from '@ecms/contracts';
import { bootPlatform } from '../../../src/platform/kernel/bootstrap';
import { buildApp } from '../../../src/app';
import { moduleManifests } from '../../../src/modules';
import { administrationPermissions } from '../../../src/modules/administration/administration.module';
import { rbacService } from '../../../src/platform/rbac';
import { userService } from '../../../src/platform/users';
import { settingsService } from '../../../src/platform/settings';
import { disconnectMongo } from '../../../src/infrastructure/database/mongo';
import { EmployeeModel } from '../../../src/modules/hr/employee-management/employees/employee.model';
import { BranchModel } from '../../../src/platform/organization/branches/branch.model';
import { type AuthContext } from '../../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';

/** Where a person sits, as their account says. */
export interface Placement {
  branchId?: string | null;
  departmentId?: string | null;
}

/** A role assignment's reach beyond its holder's home (ADR-032 copies, by role). */
export interface Reach {
  departmentCatalogId: string;
  branchIds: string[];
}

export interface AdministrationWorld {
  app: Express;
  adminId: string;
  branchAId: string;
  branchBId: string;
  /** Super-admin: every key, organization-wide. */
  adminToken: string;
  /** The catalog key and the item keys at organization scope — the master-data desk. */
  managerToken: string;
  /** The same keys at BRANCH scope, placed in branch A. */
  branchManagerToken: string;
  /** `administrationCatalog.manage` alone, at organization scope: the catalogs screen's own key. */
  catalogManagerToken: string;
  /** `administrationItem.view` alone, at organization scope. */
  itemViewerToken: string;
  /** Signed in, with a key of another module only. */
  outsiderToken: string;
  /** One more signed-in person, holding exactly `keys` at `scope` — for a suite's own people. */
  person: (
    who: string,
    keys: string[],
    scope: DataScope,
    placement?: Placement,
    reach?: Reach,
  ) => Promise<{ id: string; email: string; token: string }>;
  /** A fresh session — after a grant changed under the last one. */
  login: (email: string) => Promise<string>;
}

let replSet: MongoMemoryReplSet | null = null;

const resolveMongoUri = async (label: string): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-administration-${label}-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

/** One response's `data`. */
export const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

/** One refusal's code and details, as the error handler sends them. */
export const refusal = (
  res: request.Response,
): { code: string; details?: { field?: string; code: string }[] } =>
  (res.body as { error: { code: string; details?: { field?: string; code: string }[] } }).error;

/**
 * The module's routes, as one person calls them — with the top bar's branch when `activeBranchId`
 * is given (the `X-Active-Branch` header, ADR-028).
 */
export const administrationApi = (app: Express, token: string, activeBranchId?: string) => {
  const as = (req: request.Test): request.Test => {
    const signed = req.set('Authorization', `Bearer ${token}`);
    return activeBranchId === undefined ? signed : signed.set('X-Active-Branch', activeBranchId);
  };
  return {
    get: (path: string) => as(request(app).get(`/api/v1/administration${path}`)),
    post: (path: string, body: Record<string, unknown>) =>
      as(request(app).post(`/api/v1/administration${path}`)).send(body),
    patch: (path: string, body: Record<string, unknown>) =>
      as(request(app).patch(`/api/v1/administration${path}`)).send(body),
  };
};

export const bootAdministration = async (label: string): Promise<AdministrationWorld> => {
  await bootPlatform({ mongoUri: await resolveMongoUri(label), modules: moduleManifests });
  const app = buildApp();

  const mkUser = async (email: string, placement: Placement = {}): Promise<string> => {
    const { user } = await userService.create(
      {
        email,
        firstName: { ar: 'م', en: 'T' },
        lastName: { ar: 'م', en: 'T' },
        locale: 'en',
        organization: {
          branchId: placement.branchId ?? null,
          departmentId: placement.departmentId ?? null,
          sectionId: null,
          jobTitleId: null,
        },
      },
      null,
    );
    await userService.setPassword(String(user._id), PASSWORD, 'passwordReset');
    await userService.forceActivate(String(user._id));
    return String(user._id);
  };
  const login = async (email: string): Promise<string> => {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    return (res.body as { data: { accessToken: string } }).data.accessToken;
  };

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...administrationPermissions].map((p) => p.key),
  );
  const adminId = await mkUser(`administration-${label}-admin@ecms.local`);
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');

  // The seeded admin is privileged; a second factor is not what these suites test.
  const ctx: AuthContext = {
    userId: adminId,
    sessionId: 'seed',
    branchId: null,
    departmentId: null,
    sectionId: null,
    locale: 'en',
    permissions: { 'setting.edit': 'organization' },
    permissionVersion: 1,
    isPrivileged: true,
  };
  await settingsService.set(ctx, {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });
  const adminToken = await login(`administration-${label}-admin@ecms.local`);

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  const branchAId = await mkBranch('80', 'فرع أ', 'Branch A');
  const branchBId = await mkBranch('81', 'فرع ب', 'Branch B');

  const signIn: AdministrationWorld['person'] = async (
    who,
    permissionKeys,
    scope,
    placement = {},
    reach,
  ) => {
    const role = await rbacService.createRole(
      { name: { en: `Administration ${who}`, ar: `الشئون الإدارية ${who}` }, permissionKeys },
      adminId,
    );
    const email = `administration-${label}-${who}@ecms.local`;
    const id = await mkUser(email, placement);
    if (reach === undefined) {
      await rbacService.ensureAssignment(id, String(role._id), scope);
    } else {
      await rbacService.assignRole(
        { userId: id, roleId: String(role._id), scope, ...reach },
        adminId,
      );
    }
    return { id, email, token: await login(email) };
  };
  const person = async (
    who: string,
    permissionKeys: string[],
    scope: 'organization' | 'branch',
    branchId: string | null,
  ): Promise<string> => (await signIn(who, permissionKeys, scope, { branchId })).token;

  const masterDataKeys = [
    'administrationCatalog.manage',
    'administrationItem.view',
    'administrationItem.create',
    'administrationItem.edit',
  ];
  return {
    app,
    adminId,
    branchAId,
    branchBId,
    adminToken,
    managerToken: await person('manager', masterDataKeys, 'organization', null),
    branchManagerToken: await person('branch-manager', masterDataKeys, 'branch', branchAId),
    catalogManagerToken: await person(
      'catalog-manager',
      ['administrationCatalog.manage'],
      'organization',
      null,
    ),
    itemViewerToken: await person('item-viewer', ['administrationItem.view'], 'organization', null),
    outsiderToken: await person('outsider', ['itVendor.view'], 'organization', null),
    person: signIn,
    login,
  };
};

// ── Warehouses (P1a.3) ──────────────────────────────────────────────────────

export const WAREHOUSE_KEYS = [
  'administrationWarehouse.view',
  'administrationWarehouse.create',
  'administrationWarehouse.edit',
];

export interface WarehouseWorld {
  /** A third branch, closed: never offered, never a warehouse's. */
  closedBranchId: string;
  /** «المخازن والمشتريات» in A, a copy of the company-wide department whose other copy is in B. */
  departmentAId: string;
  departmentBId: string;
  /** Employees HR places in A — one at work, one who left — and one at work in B. */
  keeperAId: string;
  leaverAId: string;
  keeperBId: string;
  /** One person per row of §7.2's table, each holding the three warehouse keys at that scope. */
  orgToken: string;
  branchAToken: string;
  /** Home-only, placed in A's department: reads A, writes nothing. */
  departmentToken: string;
  /** The department's copies in A and B, by role reach: read both, write nothing. */
  copiesToken: string;
  /** B's department copy, delegated (ADR-032) to somebody placed in A: reads B, writes nothing. */
  delegateToken: string;
  ownToken: string;
  /** `administrationWarehouse.view` alone, organization-wide: reads, and names no keeper. */
  viewerToken: string;
  /** View organization-wide, create in branch A only: the branch options tell the two apart. */
  creatorAToken: string;
}

/** An HR employee placed in `branchId`, written as HR stores one; the employee's id. */
export const plantEmployee = async (
  code: string,
  fullNameAr: string,
  branchId: string,
  departmentId: string,
  status: 'active' | 'exited',
): Promise<string> => {
  const _id = new Types.ObjectId();
  const branch = new Types.ObjectId(branchId);
  const department = new Types.ObjectId(departmentId);
  await EmployeeModel.collection.insertOne({
    _id,
    employeeNumber: code.slice(-4),
    code,
    status,
    // The name only: the directory reads no identity fact, and a suite plants none.
    personal: { fullNameAr },
    employment: {
      jobTitleId: new Types.ObjectId(),
      departmentId: department,
      sectionId: null,
      branchId: branch,
    },
    branchId: branch,
    departmentId: department,
    sectionId: null,
    userId: null,
    exit: null,
    hiredAt: new Date('2024-01-01T00:00:00.000Z'),
    isDeleted: false,
    deletedAt: null,
    __v: 0,
  });
  return String(_id);
};

export const bootWarehouseWorld = async (world: AdministrationWorld): Promise<WarehouseWorld> => {
  const post = async (path: string, body: Record<string, unknown>): Promise<string> => {
    const res = await request(world.app)
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${world.adminToken}`)
      .send(body);
    expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(201);
    return data<{ id: string }>(res).id;
  };
  const closedBranchId = await post('/platform/branches', {
    code: '89',
    name: { ar: 'فرع مغلق', en: 'Closed branch' },
  });
  // Closed as an administrator would close it — the branch screen's status — without its UI.
  await BranchModel.updateOne({ _id: closedBranchId }, { $set: { status: 'inactive' } }).exec();

  const catalogId = await post('/platform/department-catalog', {
    code: 'ADM-STORES',
    name: { ar: 'المخازن والمشتريات', en: 'Stores and purchasing' },
  });
  const departmentAId = await post('/platform/departments', {
    code: 'ADM-ST-A',
    branchId: world.branchAId,
    catalogId,
  });
  const departmentBId = await post('/platform/departments', {
    code: 'ADM-ST-B',
    branchId: world.branchBId,
    catalogId,
  });

  const keeperAId = await plantEmployee(
    'ADM-K-01',
    'أمين مخزن الفرع',
    world.branchAId,
    departmentAId,
    'active',
  );
  const leaverAId = await plantEmployee(
    'ADM-K-02',
    'أمين مخزن سابق',
    world.branchAId,
    departmentAId,
    'exited',
  );
  const keeperBId = await plantEmployee(
    'ADM-K-03',
    'أمين مخزن ب',
    world.branchBId,
    departmentBId,
    'active',
  );

  const signIn = async (
    who: string,
    scope: DataScope,
    placement: Placement = {},
    reach?: Reach,
  ): Promise<string> => (await world.person(who, WAREHOUSE_KEYS, scope, placement, reach)).token;

  // The delegate holds no role: the grant is the delegation alone, over B's department copy. They
  // sign in again once it is written, so their session carries it.
  const delegate = await world.person('wh-delegate', [], 'own', { branchId: world.branchAId });
  const delegated = await request(world.app)
    .put(`/api/v1/platform/delegations/users/${delegate.id}/grants`)
    .set('Authorization', `Bearer ${world.adminToken}`)
    .send({
      branchId: world.branchBId,
      departmentId: departmentBId,
      permissionKeys: WAREHOUSE_KEYS,
    });
  expect(delegated.status, JSON.stringify(delegated.body)).toBe(200);

  // Two grants, two scopes: the register read company-wide, the create in A alone.
  const creatorA = await world.person(
    'wh-creator-a',
    ['administrationWarehouse.view'],
    'organization',
    {
      branchId: world.branchAId,
    },
  );
  const createRole = await rbacService.createRole(
    {
      name: { en: 'Warehouse creator A', ar: 'منشئ المخازن أ' },
      permissionKeys: ['administrationWarehouse.create'],
    },
    world.adminId,
  );
  await rbacService.ensureAssignment(creatorA.id, String(createRole._id), 'branch');

  return {
    closedBranchId,
    departmentAId,
    departmentBId,
    keeperAId,
    leaverAId,
    keeperBId,
    orgToken: await signIn('wh-org', 'organization'),
    branchAToken: await signIn('wh-branch-a', 'branch', { branchId: world.branchAId }),
    departmentToken: await signIn('wh-department', 'department', {
      branchId: world.branchAId,
      departmentId: departmentAId,
    }),
    copiesToken: await signIn(
      'wh-copies',
      'department',
      { branchId: world.branchAId, departmentId: departmentAId },
      { departmentCatalogId: catalogId, branchIds: [world.branchBId] },
    ),
    delegateToken: await world.login(delegate.email),
    ownToken: await signIn('wh-own', 'own', { branchId: world.branchAId }),
    viewerToken: (await world.person('wh-viewer', ['administrationWarehouse.view'], 'organization'))
      .token,
    creatorAToken: await world.login(creatorA.email),
  };
};

export const stopAdministration = async (): Promise<void> => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
  replSet = null;
};
