// Navigation is DERIVED from effective permissions, over real HTTP and real RBAC.
//
//     visible = { application | application.permissionKey ∈ effective permissions }
//
// One source, no second record. Assigning a role is the whole action: no administrator grants an
// application by hand, and nothing outside RBAC can put a row in a sidebar or keep one out. This
// suite exists to hold that — every claim below is one somebody could plausibly undo by "restoring"
// the grant tables or by making a missing `permissionKey` mean "open to all".
//
// The two grant tables still exist and are still writable through their endpoints; the cases here
// write to BOTH and prove the sidebar does not move, which is the difference between "we stopped
// reading them" and "we believe we stopped reading them".
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { SettingKeys, platformPermissions, type MyApplicationCategoryDto } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { roleRepository } from '../../src/platform/rbac/rbac.repository';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { ApplicationModel } from '../../src/platform/applications/application.model';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { getCache } from '../../src/infrastructure/redis/cache';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let adminId: string;

// The catalog this suite administers.
let CATEGORY = '';
let APP_BRANCH = ''; // permissionKey: branch.view
let APP_DEPARTMENT = ''; // permissionKey: department.view
let APP_SECTION = ''; // permissionKey: section.view — used for the grant-has-no-effect cases
// Two more carry jobTitle.view — one permission entitling two applications. Only their routes are
// asserted, so their ids are not kept.
let APP_NO_KEY = ''; // a pre-field row: permissionKey null
let DEPARTMENT = '';
let BRANCH = '';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-nav-derive-test-${Date.now()}`;
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

/** An activated account with a password, optionally placed in the department. */
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

/** Give an account a role carrying exactly these keys. Returns the role id, so it can be edited. */
const giveRole = async (userId: string, keys: string[]): Promise<string> => {
  const role = await rbacService.createRole(
    { name: { en: `R${String(nextSeq())}`, ar: 'دور' }, permissionKeys: keys },
    adminId,
  );
  await rbacService.ensureAssignment(userId, String(role._id), 'organization');
  return String(role._id);
};

/** Replace a role's permission keys — the "administrator edits the role" path. */
const setRoleKeys = async (roleId: string, keys: string[]): Promise<void> => {
  const current = await roleRepository.getById(roleId);
  await rbacService.updateRole(roleId, { permissionKeys: keys, version: current.__v }, adminId);
};

const grantToUser = (userId: string, applicationId: string): request.Test =>
  asAdmin('post', `/platform/users/${userId}/applications`).send({ applicationId });

const grantToDepartment = (departmentId: string, applicationId: string): request.Test =>
  asAdmin('post', `/platform/departments/${departmentId}/applications`).send({ applicationId });

/** Every route the caller's sidebar offers, flattened — in order, duplicates included if any. */
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
  APP_BRANCH = await mkApp('/nav-branch', 'branch.view');
  APP_DEPARTMENT = await mkApp('/nav-department', 'department.view');
  APP_SECTION = await mkApp('/nav-section', 'section.view');
  await mkApp('/nav-shared-a', 'jobTitle.view');
  await mkApp('/nav-shared-b', 'jobTitle.view');

  // A row from before `permissionKey` existed. The API refuses to create one now, so it is written
  // straight to the collection — which is exactly how such a row got there on a real database.
  const legacy = await ApplicationModel.create({
    name: { ar: '/nav-legacy', en: '/nav-legacy' },
    icon: 'x',
    route: '/nav-legacy',
    categoryId: CATEGORY,
    sortOrder: 1,
    permissionKey: null,
    status: 'active',
  });
  APP_NO_KEY = String(legacy._id);
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  await getCache().close();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

// ── The rule ────────────────────────────────────────────────────────────────

describe('a role carrying the permission is the whole action', () => {
  it('shows the application with no grant of any kind', async () => {
    const id = await account('derive-1@ecms.local');
    await giveRole(id, ['branch.view']);
    expect(await navigationOf(await tokenOf('derive-1@ecms.local'))).toContain('/nav-branch');
  });

  it('does not show an application whose permission the role omits', async () => {
    const id = await account('derive-2@ecms.local');
    await giveRole(id, ['branch.view']);
    const routes = await navigationOf(await tokenOf('derive-2@ecms.local'));
    expect(routes).toContain('/nav-branch');
    expect(routes).not.toContain('/nav-department');
    expect(routes).not.toContain('/nav-section');
  });

  it('shows nothing at all to an account whose role carries no permission', async () => {
    // A role can legitimately carry none — `createRole` accepts an empty set — and such an account
    // must land on an empty sidebar rather than on everything.
    const id = await account('derive-3@ecms.local');
    await giveRole(id, []);
    expect(await navigationOf(await tokenOf('derive-3@ecms.local'))).toEqual([]);
  });

  it('shows every application a single permission entitles, without duplicating either', async () => {
    const id = await account('derive-4@ecms.local');
    await giveRole(id, ['jobTitle.view']);
    const routes = await navigationOf(await tokenOf('derive-4@ecms.local'));
    expect(routes.filter((r) => r === '/nav-shared-a')).toEqual(['/nav-shared-a']);
    expect(routes.filter((r) => r === '/nav-shared-b')).toEqual(['/nav-shared-b']);
  });

  it('never repeats an application, however many permissions the role carries', async () => {
    const id = await account('derive-5@ecms.local');
    await giveRole(id, ['branch.view', 'department.view', 'jobTitle.view']);
    const routes = await navigationOf(await tokenOf('derive-5@ecms.local'));
    expect(routes.length, routes.join(', ')).toBe(new Set(routes).size);
  });
});

// ── A permission change moves the sidebar, on the next request ──────────────

describe('the sidebar follows the permission set', () => {
  it('adds the application when the permission is added to the role', async () => {
    const id = await account('derive-add@ecms.local');
    const roleId = await giveRole(id, ['branch.view']);
    const token = await tokenOf('derive-add@ecms.local');
    expect(await navigationOf(token)).not.toContain('/nav-department');

    await setRoleKeys(roleId, ['branch.view', 'department.view']);

    // The SAME access token: permissions are cached, and only `invalidateUser` bumping the version
    // makes the next request recompute. Without it this would stay stale for up to the cache TTL.
    expect(await navigationOf(token)).toContain('/nav-department');
  });

  it('removes the application when the permission is removed from the role', async () => {
    const id = await account('derive-remove@ecms.local');
    const roleId = await giveRole(id, ['branch.view', 'department.view']);
    const token = await tokenOf('derive-remove@ecms.local');
    expect(await navigationOf(token)).toContain('/nav-department');

    await setRoleKeys(roleId, ['branch.view']);

    const routes = await navigationOf(token);
    expect(routes).not.toContain('/nav-department');
    expect(routes).toContain('/nav-branch');
  });

  it('empties the sidebar when the role assignment is revoked', async () => {
    const id = await account('derive-revoke@ecms.local');
    await giveRole(id, ['branch.view']);
    const token = await tokenOf('derive-revoke@ecms.local');
    expect(await navigationOf(token)).toContain('/nav-branch');

    const assignments = await rbacService.listAssignments({
      userId: id,
      page: 1,
      pageSize: 50,
      sortDir: 'asc',
    });
    for (const assignment of assignments.items) {
      await rbacService.revokeAssignment(String(assignment._id), adminId);
    }

    expect(await navigationOf(token)).toEqual([]);
  });
});

// ── The grant tables have no say ────────────────────────────────────────────

describe('an application grant cannot put a row in a sidebar', () => {
  it('ignores a direct user grant for an application the account cannot enter', async () => {
    const id = await account('grant-user@ecms.local');
    await giveRole(id, ['branch.view']);
    expect((await grantToUser(id, APP_SECTION)).status).toBe(201);

    const routes = await navigationOf(await tokenOf('grant-user@ecms.local'));
    expect(routes, 'a direct grant added a row').not.toContain('/nav-section');
    expect(routes).toEqual(['/nav-branch']);
  });

  it('ignores a department grant for an application the account cannot enter', async () => {
    const id = await account('grant-dept@ecms.local', DEPARTMENT);
    await giveRole(id, ['branch.view']);
    expect((await grantToDepartment(DEPARTMENT, APP_SECTION)).status).toBe(201);

    const routes = await navigationOf(await tokenOf('grant-dept@ecms.local'));
    expect(routes, 'a department grant added a row').not.toContain('/nav-section');
    expect(routes).toEqual(['/nav-branch']);
  });

  it('shows the application to an account with the permission and NO grant, beside one with a grant', async () => {
    // The pair that would look identical under the old model and must not now: the granted account
    // and the ungranted one see the same thing, because the grant is not part of the answer.
    const granted = await account('grant-both@ecms.local');
    await giveRole(granted, ['department.view']);
    expect((await grantToUser(granted, APP_DEPARTMENT)).status).toBe(201);

    const ungranted = await account('grant-none@ecms.local');
    await giveRole(ungranted, ['department.view']);

    expect(await navigationOf(await tokenOf('grant-both@ecms.local'))).toEqual(['/nav-department']);
    expect(await navigationOf(await tokenOf('grant-none@ecms.local'))).toEqual(['/nav-department']);
  });
});

// ── Fail-closed, and no way around the permission ───────────────────────────

describe('an application nobody declared a permission for is entitled to nobody', () => {
  it('hides a null-key application from an ordinary account', async () => {
    const id = await account('nokey-1@ecms.local');
    await giveRole(id, ['branch.view']);
    expect(await navigationOf(await tokenOf('nokey-1@ecms.local'))).not.toContain('/nav-legacy');
  });

  it('hides it from the Super Admin too — it is not a permission question', async () => {
    // The account holding every permission there is still does not see it, which is what makes
    // "null entitles nobody" a rule rather than a filter that happens to match.
    expect(await navigationOf(adminToken)).not.toContain('/nav-legacy');
  });

  it('shows it to nobody even when it is granted directly', async () => {
    const id = await account('nokey-2@ecms.local');
    await giveRole(id, ['branch.view']);
    expect((await grantToUser(id, APP_NO_KEY)).status).toBe(201);
    expect(await navigationOf(await tokenOf('nokey-2@ecms.local'))).not.toContain('/nav-legacy');
  });

  it('refuses to catalogue a new application without a permission', async () => {
    const res = await asAdmin('post', '/platform/applications').send({
      name: { ar: 'بلا مفتاح', en: 'No key' },
      icon: 'x',
      route: '/nav-refused',
      categoryId: CATEGORY,
      sortOrder: 1,
    });
    expect(res.status).toBe(400);
  });

  it('refuses to clear the permission on an existing application', async () => {
    const current = await asAdmin('get', `/platform/applications/${APP_BRANCH}`);
    const version = data<{ version: number }>(current).version;
    const patch = await request(app)
      .patch(`/api/v1/platform/applications/${APP_BRANCH}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissionKey: null, version });
    expect(patch.status).toBe(400);
  });
});

describe('the sidebar never contradicts the server', () => {
  it('offers no route the account is refused at the API', async () => {
    // The tie between the two surfaces: what is absent from navigation is also refused on call, and
    // what is present is not. A row the caller cannot use would be the bypass this rule prevents.
    const id = await account('bypass@ecms.local');
    await giveRole(id, ['branch.view']);
    const token = await tokenOf('bypass@ecms.local');

    expect(await navigationOf(token)).toEqual(['/nav-branch']);

    const allowed = await request(app)
      .get('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${token}`);
    expect(allowed.status).toBe(200);

    for (const path of ['/platform/departments', '/platform/sections', '/platform/job-titles']) {
      const refused = await request(app)
        .get(`/api/v1${path}`)
        .set('Authorization', `Bearer ${token}`);
      expect(refused.status, `${path} should be refused`).toBe(403);
    }
  });
});
