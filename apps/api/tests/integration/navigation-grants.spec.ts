// FIX-1 — why a role alone produces an empty sidebar, pinned as behaviour rather than left to be
// rediscovered.
//
// Navigation is **not** derived from permissions. It is the union of two GRANTS — the account's own
// and its department's — intersected with the permissions RBAC gives it:
//
//     visible = ( user_applications ∪ department_applications )  ∩  permissions
//
// Both halves are load-bearing and neither implies the other. A grant is an administrator saying
// "this is on offer to you"; a permission is RBAC saying whether you may enter it. That is the model
// the platform has always had, and this suite exists so that it stays the model: the reported
// symptom — "I gave the user a role and they see nothing" — is this intersection working correctly
// against an empty left-hand side, and the fix was a place to fill it in, not a change of rule.
//
// Every case here uses applications carrying a REAL `permissionKey`, which is what `platform.spec.ts`
// (union / dedupe / ordering / inactive) deliberately does not exercise.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  platformPermissions,
  type MyApplicationCategoryDto,
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
let adminToken: string;
let adminId: string;

/** The catalog this suite administers. Both applications need a permission to enter. */
let CATEGORY = '';
let APP_WITH_PERM = ''; // requires `branch.view`
let APP_OTHER = ''; // requires `department.view`
let DEPARTMENT = '';
let BRANCH = '';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-nav-grants-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

const asAdmin = (method: 'post' | 'get' | 'delete', path: string): request.Test =>
  request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${adminToken}`);

const tokenOf = async (identifier: string): Promise<string> => {
  const res = await request(app).post('/api/v1/auth/login').send({ identifier, password: PASSWORD });
  expect(res.status, `login failed for ${identifier}`).toBe(200);
  return data<{ accessToken: string }>(res).accessToken;
};

let seq = 0;
const nextSeq = (): number => (seq += 1);

/**
 * An activated account with a password, optionally placed in the department. Placement matters:
 * the department half of the union is only reachable for an account that has one.
 */
const account = async (email: string, departmentId: string | null = null): Promise<string> => {
  const n = nextSeq();
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: `أ${String(n)}`, en: `A${String(n)}` },
      lastName: { ar: `ب${String(n)}`, en: `B${String(n)}` },
      locale: 'en',
      organization: { branchId: BRANCH, departmentId, sectionId: null, jobTitleId: null },
    },
    null,
  );
  const id = String(user._id);
  await userService.setPassword(id, PASSWORD, 'passwordReset');
  await userService.forceActivate(id);
  return id;
};

/** Give an account a role carrying exactly these permission keys. */
const giveRole = async (userId: string, keys: string[]): Promise<void> => {
  const role = await rbacService.createRole(
    { name: { en: `R${String(nextSeq())}`, ar: 'دور' }, permissionKeys: keys },
    adminId,
  );
  await rbacService.ensureAssignment(userId, String(role._id), 'organization');
};

const grantToUser = (userId: string, applicationId: string): request.Test =>
  asAdmin('post', `/platform/users/${userId}/applications`).send({ applicationId });

const grantToDepartment = (departmentId: string, applicationId: string): request.Test =>
  asAdmin('post', `/platform/departments/${departmentId}/applications`).send({ applicationId });

/** Every route the caller's sidebar offers, flattened. */
const navigationOf = async (token: string): Promise<string[]> => {
  const res = await request(app)
    .get('/api/v1/platform/me/applications')
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return data<MyApplicationCategoryDto[]>(res).flatMap((group) =>
    group.applications.map((entry) => entry.route),
  );
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  // Seeded before BRANCH exists, so it is created org-wide; that is fine for the administrator.
  const { user: admin } = await userService.create(
    {
      email: 'nav-admin@ecms.local',
      firstName: { ar: 'م', en: 'Admin' },
      lastName: { ar: 'م', en: 'Admin' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  adminId = String(admin._id);
  await userService.setPassword(adminId, PASSWORD, 'passwordReset');
  await userService.forceActivate(adminId);
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
  await settingsService.set(ctx, {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });
  adminToken = await tokenOf('nav-admin@ecms.local');

  const branch = await asAdmin('post', '/platform/branches').send({
    code: '900',
    name: { ar: 'فرع التنقل', en: 'Nav branch' },
  });
  expect(branch.status).toBe(201);
  BRANCH = data<{ id: string }>(branch).id;

  const dept = await asAdmin('post', '/platform/departments').send({
    code: 'NAV',
    name: { ar: 'إدارة التنقل', en: 'Nav department' },
    branchId: BRANCH,
  });
  expect(dept.status).toBe(201);
  DEPARTMENT = data<{ id: string }>(dept).id;

  const category = await asAdmin('post', '/platform/application-categories').send({
    name: { ar: 'فئة التنقل', en: 'Nav category' },
    sortOrder: 500,
  });
  expect(category.status).toBe(201);
  CATEGORY = data<{ id: string }>(category).id;

  const mkApp = async (route: string, permissionKey: string): Promise<string> => {
    const res = await asAdmin('post', '/platform/applications').send({
      name: { ar: route, en: route },
      icon: 'x',
      route,
      categoryId: CATEGORY,
      sortOrder: 1,
      permissionKey,
    });
    expect(res.status, `creating ${route}`).toBe(201);
    return data<{ id: string }>(res).id;
  };
  APP_WITH_PERM = await mkApp('/nav-a', 'branch.view');
  APP_OTHER = await mkApp('/nav-b', 'department.view');
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  await getCache().close();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

// ── The two halves, each proven necessary on its own ────────────────────────

describe('a grant and a permission are both required, and neither implies the other', () => {
  // The reported symptom, as a test. An account with a role full of the right permissions and no
  // grant sees NOTHING — correct behaviour, and the reason FIX-1 added a place to grant from.
  it('a role with the permission but NO grant shows nothing', async () => {
    const id = await account('nav-role-only@ecms.local');
    await giveRole(id, ['branch.view', 'department.view']);
    expect(await navigationOf(await tokenOf('nav-role-only@ecms.local'))).toEqual([]);
  });

  // The other half. A grant without the permission is an offer the caller could not accept, and
  // advertising it would produce a row that 403s on click.
  it('a grant with NO permission shows nothing', async () => {
    const id = await account('nav-grant-only@ecms.local');
    expect((await grantToUser(id, APP_WITH_PERM)).status).toBe(201);
    expect(await navigationOf(await tokenOf('nav-grant-only@ecms.local'))).toEqual([]);
  });

  // Both halves present: the row appears. This is the path an administrator now has in one screen.
  it('a role WITH the permission and a direct grant shows the application', async () => {
    const id = await account('nav-both@ecms.local');
    await giveRole(id, ['branch.view']);
    expect((await grantToUser(id, APP_WITH_PERM)).status).toBe(201);
    expect(await navigationOf(await tokenOf('nav-both@ecms.local'))).toEqual(['/nav-a']);
  });

  // The intersection is per-application, not all-or-nothing: holding one permission reveals one
  // row out of two granted, rather than both or neither.
  it('reveals only the granted applications the caller may actually enter', async () => {
    const id = await account('nav-partial@ecms.local');
    await giveRole(id, ['branch.view']);
    expect((await grantToUser(id, APP_WITH_PERM)).status).toBe(201);
    expect((await grantToUser(id, APP_OTHER)).status).toBe(201);
    expect(await navigationOf(await tokenOf('nav-partial@ecms.local'))).toEqual(['/nav-a']);
  });

  // The department half of the union, with the same rule applied to it.
  it('honours a grant made to the account’s department', async () => {
    const id = await account('nav-dept@ecms.local', DEPARTMENT);
    await giveRole(id, ['branch.view']);
    expect((await grantToDepartment(DEPARTMENT, APP_WITH_PERM)).status).toBe(201);
    expect(await navigationOf(await tokenOf('nav-dept@ecms.local'))).toEqual(['/nav-a']);
  });

  // …and an account outside that department is unaffected by it, so the department grant is not a
  // global one wearing a costume.
  it('does not leak a department grant to an account outside the department', async () => {
    const id = await account('nav-outside@ecms.local');
    await giveRole(id, ['branch.view']);
    expect(await navigationOf(await tokenOf('nav-outside@ecms.local'))).toEqual([]);
    void id;
  });
});

// ── Invalidation: the answer changes on the next request, not on the next TTL ─

describe('a change is visible on the very next request', () => {
  it('granting an application the caller may enter adds the row immediately', async () => {
    const id = await account('nav-live-grant@ecms.local');
    await giveRole(id, ['branch.view']);
    const token = await tokenOf('nav-live-grant@ecms.local');

    expect(await navigationOf(token)).toEqual([]);
    expect((await grantToUser(id, APP_WITH_PERM)).status).toBe(201);
    // No waiting: grants are read per request and are not cached at all.
    expect(await navigationOf(token)).toEqual(['/nav-a']);
  });

  /**
   * The one that could plausibly be stale, and is not.
   *
   * Permissions ARE cached — `perms:<user>:v<version>` — and the auth context reads its
   * `permissionVersion` from the 60-second `auth:user:<id>` snapshot. `assignRole` calls
   * `invalidateUser`, which bumps the version AND drops that snapshot, so the next request rebuilds
   * both. Without either half this assertion would fail for up to a minute.
   */
  it('assigning the role adds the row immediately, on the SAME access token', async () => {
    const id = await account('nav-live-role@ecms.local');
    expect((await grantToUser(id, APP_WITH_PERM)).status).toBe(201);
    const token = await tokenOf('nav-live-role@ecms.local');

    expect(await navigationOf(token)).toEqual([]);
    await giveRole(id, ['branch.view']);
    expect(await navigationOf(token)).toEqual(['/nav-a']);
  });

  it('removing the grant takes the row away again', async () => {
    const id = await account('nav-live-remove@ecms.local');
    await giveRole(id, ['branch.view']);
    expect((await grantToUser(id, APP_WITH_PERM)).status).toBe(201);
    const token = await tokenOf('nav-live-remove@ecms.local');
    expect(await navigationOf(token)).toEqual(['/nav-a']);

    const removed = await asAdmin(
      'delete',
      `/platform/users/${id}/applications/${APP_WITH_PERM}`,
    ).send();
    expect(removed.status).toBeLessThan(300);
    expect(await navigationOf(token)).toEqual([]);
  });
});

// ── The grant endpoints the new card calls ──────────────────────────────────

describe('the endpoints the System Administration card uses', () => {
  it('lists an account’s direct grants behind user.view', async () => {
    const id = await account('nav-list@ecms.local');
    expect((await grantToUser(id, APP_WITH_PERM)).status).toBe(201);
    const res = await asAdmin('get', `/platform/users/${id}/applications`);
    expect(res.status).toBe(200);
    expect(data<{ route: string }[]>(res).map((a) => a.route)).toEqual(['/nav-a']);
  });

  it('refuses a caller without user.edit to grant', async () => {
    const target = await account('nav-target@ecms.local');
    const readerId = await account('nav-reader@ecms.local');
    await giveRole(readerId, ['user.view']);
    const readerToken = await tokenOf('nav-reader@ecms.local');

    const res = await request(app)
      .post(`/api/v1/platform/users/${target}/applications`)
      .set('Authorization', `Bearer ${readerToken}`)
      .send({ applicationId: APP_WITH_PERM });
    expect(res.status).toBe(403);
  });

  it('refuses granting the same application twice', async () => {
    const id = await account('nav-dup@ecms.local');
    expect((await grantToUser(id, APP_WITH_PERM)).status).toBe(201);
    expect((await grantToUser(id, APP_WITH_PERM)).status).toBe(409);
  });
});
