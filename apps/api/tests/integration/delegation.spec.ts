// Delegated grants (ADR-032, Gap 1), end to end: a manager hands out, per UNIT, what they hold
// there — and nothing wider.
//
// Three shapes of authority are set up and told apart, because the rule under test is exactly the
// difference between them:
//   • the FLEET GENERAL MANAGER holds «الحركة» in every branch (department-wide);
//   • the FLEET BRANCH MANAGER holds «الحركة» in branch A only (department + branch);
//   • the BRANCH HOLDER holds the whole of branch A (branch scope), every department in it.
// Every refusal is asserted as the 422 the service raises, and every success is asserted twice:
// on the record, and on what the delegate can then actually see.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  platformPermissions,
  type DelegationCatalogDto,
  type SetDelegation,
  type UserDelegationsDto,
  type UserDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { getCache } from '../../src/infrastructure/redis/cache';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken = '';
let adminId = '';

let BRANCH_A = '';
let BRANCH_B = '';
let FLEET = ''; // company-wide «الحركة»
let FLEET_A = ''; // its copy in A
let FLEET_B = ''; // its copy in B
let SECURITY_A = ''; // «الأمن» in A — another department in the same branch

let gmToken = ''; // fleet general manager: «الحركة» everywhere
let gmId = '';
let fleetAToken = ''; // fleet branch manager: «الحركة» in A
let fleetAId = '';
let branchAToken = ''; // whole-branch holder: all of A

let mohamed = ''; // a fleet person in A — the one being delegated to
let fleetInA = ''; // another fleet account in A
let securityInA = ''; // a security account in A: what a whole-branch grant would reveal
let fleetInB = ''; // a fleet account in B

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-delegation-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
const rows = <T>(res: request.Response): T[] => (res.body as { data: T[] }).data;
const errorOf = (res: request.Response): { code: string; message: string } =>
  (res.body as { error: { code: string; message: string } }).error;

let seq = 0;
const seedUser = async (
  email: string,
  placement: { branchId?: string | null; departmentId?: string | null } = {},
): Promise<string> => {
  seq += 1;
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: `م${String(seq)}`, en: `U${String(seq)}` },
      lastName: { ar: `ن${String(seq)}`, en: `N${String(seq)}` },
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

const tokenOf = async (email: string): Promise<string> => {
  const res = await request(app).post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD });
  expect(res.status).toBe(200);
  return data<{ accessToken: string }>(res).accessToken;
};

let roleSeq = 0;
const seedRole = async (permissionKeys: string[]): Promise<string> => {
  roleSeq += 1;
  const role = await rbacService.createRole(
    { name: { ar: `دور ${String(roleSeq)}`, en: `Role ${String(roleSeq)}` }, permissionKeys },
    adminId,
  );
  return String(role._id);
};

const putGrant = (userId: string, body: SetDelegation, token: string): request.Test =>
  request(app)
    .put(`/api/v1/platform/delegations/users/${userId}/grants`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

const getDelegations = (userId: string, token: string): request.Test =>
  request(app).get(`/api/v1/platform/delegations/users/${userId}`).set('Authorization', `Bearer ${token}`);

const catalogOf = async (token: string): Promise<DelegationCatalogDto> => {
  const res = await request(app).get('/api/v1/platform/delegations/me').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return data<DelegationCatalogDto>(res);
};

const effectiveOf = async (userId: string) => {
  const user = await userService.getById(userId);
  return rbacService.getEffectivePermissions(userId, user.security.permissionVersion);
};

const usersSeenBy = async (email: string): Promise<string[]> => {
  const list = await request(app)
    .get('/api/v1/platform/users?pageSize=50')
    .set('Authorization', `Bearer ${await tokenOf(email)}`);
  expect(list.status).toBe(200);
  return rows<UserDto>(list).map((u) => u.id);
};

const KEYS = ['user.view', 'user.edit'];

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  adminId = await seedUser('delegation-admin@ecms.local');
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');
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
  await settingsService.set(ctx, { key: SettingKeys.TotpEnforcedForPrivileged, scope: 'organization', value: false });
  adminToken = await tokenOf('delegation-admin@ecms.local');

  const post = async (path: string, body: Record<string, unknown>): Promise<string> => {
    const res = await request(app).post(`/api/v1${path}`).set('Authorization', `Bearer ${adminToken}`).send(body);
    expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(201);
    return data<{ id: string }>(res).id;
  };
  BRANCH_A = await post('/platform/branches', { code: '001', name: { ar: 'المهندسين', en: 'Mohandessin' } });
  BRANCH_B = await post('/platform/branches', { code: '002', name: { ar: 'أكتوبر', en: 'October' } });
  FLEET = await post('/platform/department-catalog', { code: 'FLT', name: { ar: 'الحركة', en: 'Fleet' } });
  FLEET_A = await post('/platform/departments', { code: 'FLT-A', branchId: BRANCH_A, catalogId: FLEET });
  FLEET_B = await post('/platform/departments', { code: 'FLT-B', branchId: BRANCH_B, catalogId: FLEET });
  SECURITY_A = await post('/platform/departments', { code: 'SEC-A', name: { ar: 'الأمن', en: 'Security' }, branchId: BRANCH_A });

  const managerRole = await seedRole([...KEYS, 'delegation.manage']);

  // Fleet general manager: «الحركة» in every branch; placed nowhere in particular.
  gmId = await seedUser('fleet-gm@ecms.local');
  await rbacService.assignRole(
    { userId: gmId, roleId: managerRole, scope: 'department', departmentCatalogId: FLEET, allBranches: true },
    adminId,
  );
  gmToken = await tokenOf('fleet-gm@ecms.local');

  // Fleet branch manager: «الحركة» in A only — the department grant at home.
  fleetAId = await seedUser('fleet-a@ecms.local', { branchId: BRANCH_A, departmentId: FLEET_A });
  await rbacService.ensureAssignment(fleetAId, managerRole, 'department');
  fleetAToken = await tokenOf('fleet-a@ecms.local');

  // Whole-branch holder: all of A.
  const branchAId = await seedUser('branch-a@ecms.local', { branchId: BRANCH_A });
  await rbacService.ensureAssignment(branchAId, managerRole, 'branch');
  branchAToken = await tokenOf('branch-a@ecms.local');

  mohamed = await seedUser('mohamed@ecms.local', { branchId: BRANCH_A, departmentId: FLEET_A });
  fleetInA = await seedUser('fleet-in-a@ecms.local', { branchId: BRANCH_A, departmentId: FLEET_A });
  securityInA = await seedUser('security-in-a@ecms.local', { branchId: BRANCH_A, departmentId: SECURITY_A });
  fleetInB = await seedUser('fleet-in-b@ecms.local', { branchId: BRANCH_B, departmentId: FLEET_B });
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  await getCache().close();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

describe('G1 — the ceiling is read per unit, and the catalog says so', () => {
  it('the fleet GM may hand out «الحركة» in any branch, and no branch as a whole', async () => {
    const catalog = await catalogOf(gmToken);
    expect(catalog.branches.map((b) => b.id).sort()).toEqual([BRANCH_A, BRANCH_B].sort());
    for (const b of catalog.branches) {
      expect(b.permissionKeys).toEqual([]);
      expect(b.departments.map((d) => d.id)).toEqual([b.id === BRANCH_A ? FLEET_A : FLEET_B]);
      expect(b.departments[0]?.permissionKeys).toEqual(['delegation.manage', 'user.edit', 'user.view']);
    }
  });

  it('the fleet branch manager may hand out «الحركة» in A only', async () => {
    const catalog = await catalogOf(fleetAToken);
    expect(catalog.branches.map((b) => b.id)).toEqual([BRANCH_A]);
    expect(catalog.branches[0]?.permissionKeys).toEqual([]);
    expect(catalog.branches[0]?.departments.map((d) => d.id)).toEqual([FLEET_A]);
  });

  it('the whole-branch holder may hand out the whole of A, or any department in it', async () => {
    const catalog = await catalogOf(branchAToken);
    expect(catalog.branches.map((b) => b.id)).toEqual([BRANCH_A]);
    const a = catalog.branches[0];
    expect(a?.permissionKeys).toEqual(['delegation.manage', 'user.edit', 'user.view']);
    expect(a?.departments.map((d) => d.id).sort()).toEqual([FLEET_A, SECURITY_A].sort());
    // Nothing beyond the whole-branch keys per department: the branch's keys apply to every unit.
    expect(a?.departments.every((d) => d.permissionKeys.length === 0)).toBe(true);
  });
});

describe('G2 — nobody hands out a unit wider than their own', () => {
  it('a department-wide GM cannot grant a whole branch', async () => {
    const res = await putGrant(mohamed, { branchId: BRANCH_A, departmentId: null, permissionKeys: ['user.view'] }, gmToken);
    expect(res.status).toBe(422);
    expect(errorOf(res).message).toContain('whole branch');
  });

  it('a department manager cannot grant another department of his branch, nor the branch', async () => {
    const other = await putGrant(mohamed, { branchId: BRANCH_A, departmentId: SECURITY_A, permissionKeys: ['user.view'] }, fleetAToken);
    expect(other.status).toBe(422);
    expect(errorOf(other).message).toContain('do not delegate in this department');

    const whole = await putGrant(mohamed, { branchId: BRANCH_A, departmentId: null, permissionKeys: ['user.view'] }, fleetAToken);
    expect(whole.status).toBe(422);

    // Nor his department in a branch he does not reach.
    const elsewhere = await putGrant(mohamed, { branchId: BRANCH_B, departmentId: FLEET_B, permissionKeys: ['user.view'] }, fleetAToken);
    expect(elsewhere.status).toBe(422);
  });

  it('a key held for one department cannot be granted over the whole branch, even by a whole-branch delegator', async () => {
    // The branch holder delegates over all of A, but holds `setting.view` nowhere: a key they lack.
    const lacks = await putGrant(mohamed, { branchId: BRANCH_A, departmentId: null, permissionKeys: ['setting.view'] }, branchAToken);
    expect(lacks.status).toBe(422);
    expect(errorOf(lacks).message).toContain('do not hold: setting.view');
  });

  it('a delegate cannot re-delegate wider than what they were given', async () => {
    // The GM gives mohamed «الحركة · A» including the delegation key.
    const given = await putGrant(mohamed, { branchId: BRANCH_A, departmentId: FLEET_A, permissionKeys: ['delegation.manage', 'user.view'] }, gmToken);
    expect(given.status).toBe(200);
    const mohamedToken = await tokenOf('mohamed@ecms.local');
    // He may staff his own unit within what he holds …
    expect((await putGrant(fleetInA, { branchId: BRANCH_A, departmentId: FLEET_A, permissionKeys: ['user.view'] }, mohamedToken)).status).toBe(200);
    // … and not the whole branch, another department, another branch, or a key he lacks.
    expect((await putGrant(fleetInA, { branchId: BRANCH_A, departmentId: null, permissionKeys: ['user.view'] }, mohamedToken)).status).toBe(422);
    expect((await putGrant(securityInA, { branchId: BRANCH_A, departmentId: SECURITY_A, permissionKeys: ['user.view'] }, mohamedToken)).status).not.toBe(200);
    expect((await putGrant(fleetInA, { branchId: BRANCH_A, departmentId: FLEET_A, permissionKeys: ['user.edit'] }, mohamedToken)).status).toBe(422);
    // Clean up for the cases below.
    expect((await putGrant(fleetInA, { branchId: BRANCH_A, departmentId: FLEET_A, permissionKeys: [] }, mohamedToken)).status).toBe(200);
    expect((await putGrant(mohamed, { branchId: BRANCH_A, departmentId: FLEET_A, permissionKeys: [] }, gmToken)).status).toBe(200);
  });
});

describe('G3 — a granted permission stays confined to its unit', () => {
  it('the fleet GM grants «الحركة» in A: the delegate sees fleet people in A, not security, not B', async () => {
    const res = await putGrant(fleetInB, { branchId: BRANCH_A, departmentId: FLEET_A, permissionKeys: ['user.view'] }, gmToken);
    expect(res.status).toBe(200);
    const dto = data<UserDelegationsDto>(res);
    expect(dto.grants).toHaveLength(1);
    expect(dto.grants[0]?.branch.name.en).toBe('Mohandessin');
    expect(dto.grants[0]?.department?.id).toBe(FLEET_A);
    expect(dto.grants[0]?.department?.name.en).toBe('Fleet');

    const effective = await effectiveOf(fleetInB);
    expect(effective.permissions['user.view']).toBe('department');
    expect(effective.keyReach['user.view']).toEqual({ branchIds: [], departments: [{ id: FLEET_A, branchId: BRANCH_A }] });

    // Placed in fleet B, granted fleet A: the users list shows fleet A — and only fleet A.
    const seen = await usersSeenBy('fleet-in-b@ecms.local');
    expect(seen).toContain(mohamed);
    expect(seen).toContain(fleetInA);
    expect(seen).not.toContain(securityInA);
    expect(seen).not.toContain(gmId);
  });

  it('a whole-branch grant, from a whole-branch holder, is the branch: every department in A', async () => {
    // First the department row, from the GM; then the whole-branch row beside it, from the holder
    // of all of A — who can only delegate to people placed in A, which is why the target is here.
    expect((await putGrant(fleetInA, { branchId: BRANCH_A, departmentId: FLEET_A, permissionKeys: ['user.view'] }, gmToken)).status).toBe(200);
    const res = await putGrant(fleetInA, { branchId: BRANCH_A, departmentId: null, permissionKeys: ['user.view'] }, branchAToken);
    expect(res.status).toBe(200);
    // Two units in one branch: the department row and the whole-branch row, side by side.
    expect(data<UserDelegationsDto>(res).grants.map((g) => g.department?.id ?? null).sort()).toEqual([FLEET_A, null].sort());
    const effective = await effectiveOf(fleetInA);
    expect(effective.permissions['user.view']).toBe('branch');
    expect(effective.keyReach['user.view']?.branchIds).toEqual([BRANCH_A]);
    const seen = await usersSeenBy('fleet-in-a@ecms.local');
    expect(seen).toContain(securityInA);
    expect(seen).not.toContain(fleetInB); // still nothing in B: the grant is A
  });

  it('removing the whole-branch row leaves the department row, and the view shrinks back', async () => {
    expect((await putGrant(fleetInA, { branchId: BRANCH_A, departmentId: null, permissionKeys: [] }, branchAToken)).status).toBe(200);
    const seen = await usersSeenBy('fleet-in-a@ecms.local');
    expect(seen).toContain(mohamed);
    expect(seen).not.toContain(securityInA);
    const again = await getDelegations(fleetInA, gmToken);
    expect(data<UserDelegationsDto>(again).grants.map((g) => g.department?.id)).toEqual([FLEET_A]);
  });

  it('is explained as a direct grant over its unit, and found by the branch fan-out', async () => {
    const explained = await rbacService.explainEffectivePermissions(fleetInB);
    const row = explained.rows.find((r) => r.key === 'user.view');
    expect(row?.sources[0]?.kind).toBe('delegation');
    expect(row?.sources[0]?.scope).toBe('department');
    expect(row?.sources[0]?.department?.name.en).toBe('Fleet');
    expect(await rbacService.listUserIdsWithPermission('user.view', 'branch', BRANCH_A)).toContain(fleetInB);
  });
});

describe('G4 — what somebody else granted, and who may be delegated to', () => {
  it('keeps a key the GM could not grant, and lets the GM remove it', async () => {
    const byAdmin = await putGrant(mohamed, { branchId: BRANCH_A, departmentId: FLEET_A, permissionKeys: ['user.view', 'user.delete'] }, adminToken);
    expect(byAdmin.status).toBe(200);
    const kept = await putGrant(mohamed, { branchId: BRANCH_A, departmentId: FLEET_A, permissionKeys: ['user.view', 'user.delete', 'user.edit'] }, gmToken);
    expect(kept.status).toBe(200);
    const narrowed = await putGrant(mohamed, { branchId: BRANCH_A, departmentId: FLEET_A, permissionKeys: ['user.view'] }, gmToken);
    expect(narrowed.status).toBe(200);
    expect((await effectiveOf(mohamed)).permissions['user.delete']).toBeUndefined();
  });

  it("an account outside the delegator's reach answers 404; a caller without the key, 403", async () => {
    expect((await putGrant(securityInA, { branchId: BRANCH_A, departmentId: FLEET_A, permissionKeys: ['user.view'] }, fleetAToken)).status).toBe(404);
    expect((await putGrant(mohamed, { branchId: BRANCH_A, departmentId: FLEET_A, permissionKeys: ['user.view'] }, await tokenOf('fleet-in-a@ecms.local'))).status).toBe(403);
  });
});
