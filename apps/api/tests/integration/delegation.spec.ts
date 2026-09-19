// Delegated grants (ADR-032), end to end: a manager hands out, per site, what they hold there.
//
// The rule under test is ADR-026's one level down — nobody hands out an authority they do not
// hold — read PER SITE. The manager here («GM») is placed in branch B and reaches branch A through
// a role grant; branch C is a site they never touch. Every refusal is asserted as the 422 the
// service raises, and every success is asserted twice: on the record, and on what the target can
// then actually see.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  platformPermissions,
  type DelegationCatalogDto,
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
let gmToken = '';
let gmId = '';
let adminId = '';

let BRANCH_A = '';
let BRANCH_B = '';
let BRANCH_C = '';
let mohamed = ''; // placed in B, the GM's home — the person being delegated to
let inA = ''; // a plain account in A: what «user.view in A» would show
let inC = ''; // a plain account in C: outside the GM's reach

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
const seedUser = async (email: string, branchId: string | null): Promise<string> => {
  seq += 1;
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: `م${String(seq)}`, en: `U${String(seq)}` },
      lastName: { ar: `ن${String(seq)}`, en: `N${String(seq)}` },
      locale: 'en',
      organization: { branchId, departmentId: null, sectionId: null, jobTitleId: null },
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

const putDelegation = (userId: string, branchId: string, keys: string[], token: string): request.Test =>
  request(app)
    .put(`/api/v1/platform/delegations/users/${userId}/branches/${branchId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ permissionKeys: keys });

const getDelegations = (userId: string, token: string): request.Test =>
  request(app).get(`/api/v1/platform/delegations/users/${userId}`).set('Authorization', `Bearer ${token}`);

const effectiveOf = async (userId: string) => {
  const user = await userService.getById(userId);
  return rbacService.getEffectivePermissions(userId, user.security.permissionVersion);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  adminId = await seedUser('delegation-admin@ecms.local', null);
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

  const mkBranch = async (code: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar: en, en } });
    expect(res.status).toBe(201);
    return data<{ id: string }>(res).id;
  };
  BRANCH_A = await mkBranch('001', 'Mohandessin');
  BRANCH_B = await mkBranch('002', 'October');
  BRANCH_C = await mkBranch('003', 'Tanta');

  // The GM: home B, reaching A through the role grant; holds two grantable keys at branch level,
  // one key at `own` only, and the delegation key itself.
  gmId = await seedUser('gm@ecms.local', BRANCH_B);
  const gmRole = await seedRole(['user.view', 'user.edit', 'delegation.manage']);
  await rbacService.assignRole(
    { userId: gmId, roleId: gmRole, scope: 'branch', branchIds: [BRANCH_A] },
    adminId,
  );
  const ownOnly = await seedRole(['setting.view']);
  await rbacService.ensureAssignment(gmId, ownOnly, 'own');
  gmToken = await tokenOf('gm@ecms.local');

  mohamed = await seedUser('mohamed@ecms.local', BRANCH_B);
  inA = await seedUser('in-a@ecms.local', BRANCH_A);
  inC = await seedUser('in-c@ecms.local', BRANCH_C);
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  await getCache().close();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

describe('D1 — the ceiling: what the GM may hand out, and where', () => {
  it('lists the sites the GM delegates in, with only the keys held there at branch level', async () => {
    const res = await request(app).get('/api/v1/platform/delegations/me').set('Authorization', `Bearer ${gmToken}`);
    expect(res.status).toBe(200);
    const catalog = data<DelegationCatalogDto>(res);
    expect(catalog.branches.map((b) => b.id).sort()).toEqual([BRANCH_A, BRANCH_B].sort());
    for (const b of catalog.branches) {
      expect(b.permissionKeys).toEqual(['delegation.manage', 'user.edit', 'user.view']);
    }
    expect(catalog.permissions.map((p) => p.key).sort()).toEqual(['delegation.manage', 'user.edit', 'user.view']);
    expect(catalog.pages.map((p) => p.id).sort()).toEqual(['platform.delegation', 'platform.users']);
  });

  it('refuses a key the GM does not hold, a key held only at own scope, and a site out of reach', async () => {
    const lacks = await putDelegation(mohamed, BRANCH_A, ['user.view', 'user.delete'], gmToken);
    expect(lacks.status).toBe(422);
    expect(errorOf(lacks).message).toContain('do not hold: user.delete');

    const tooNarrow = await putDelegation(mohamed, BRANCH_A, ['setting.view'], gmToken);
    expect(tooNarrow.status).toBe(422);
    expect(errorOf(tooNarrow).message).toContain('in this site: setting.view');

    const elsewhere = await putDelegation(mohamed, BRANCH_C, ['user.view'], gmToken);
    expect(elsewhere.status).toBe(422);
    expect(errorOf(elsewhere).message).toContain('do not delegate in this site');

    // Somebody outside the GM's reach is not there to be delegated to.
    const outsider = await putDelegation(inC, BRANCH_A, ['user.view'], gmToken);
    expect(outsider.status).toBe(404);
  });

  it('a caller without the key is refused at the route', async () => {
    const res = await putDelegation(mohamed, BRANCH_A, ['user.view'], await tokenOf('in-a@ecms.local'));
    expect(res.status).toBe(403);
  });
});

describe('D2 — a grant in one site, and what it lets the person see', () => {
  it('records the site\'s table, and the target holds the keys in that site alone', async () => {
    const res = await putDelegation(mohamed, BRANCH_A, ['user.view', 'user.edit'], gmToken);
    expect(res.status).toBe(200);
    const dto = data<UserDelegationsDto>(res);
    expect(dto.grants).toHaveLength(1);
    expect(dto.grants[0]?.branch.id).toBe(BRANCH_A);
    expect(dto.grants[0]?.branch.name.en).toBe('Mohandessin');
    expect(dto.grants[0]?.permissionKeys).toEqual(['user.edit', 'user.view']);
    expect(dto.grants[0]?.grantedBy).toBe(gmId);

    const effective = await effectiveOf(mohamed);
    expect(effective.permissions).toEqual({ 'user.view': 'branch', 'user.edit': 'branch' });
    expect(effective.keyReach?.['user.view']?.branchIds).toEqual([BRANCH_A]);

    // Placed in B, granted in A: the users list shows A — not his own site, which nothing granted.
    const list = await request(app)
      .get('/api/v1/platform/users?pageSize=50')
      .set('Authorization', `Bearer ${await tokenOf('mohamed@ecms.local')}`);
    expect(list.status).toBe(200);
    const seen = rows<UserDto>(list).map((u) => u.id);
    expect(seen).toContain(inA);
    expect(seen).not.toContain(gmId);
    expect(seen).not.toContain(inC);
  });

  it('is found by the fan-out «everyone holding X in site A», and explained as a direct grant', async () => {
    expect(await rbacService.listUserIdsWithPermission('user.view', 'branch', BRANCH_A)).toContain(mohamed);
    expect(await rbacService.listUserIdsWithPermission('user.view', 'branch', BRANCH_B)).not.toContain(mohamed);

    const explained = await rbacService.explainEffectivePermissions(mohamed);
    const row = explained.rows.find((r) => r.key === 'user.view');
    expect(row?.scope).toBe('branch');
    expect(row?.sources[0]?.kind).toBe('delegation');
    expect(row?.sources[0]?.branch?.name.en).toBe('Mohandessin');
    expect(row?.sources[0]?.decisive).toBe(true);
  });

  it('each site is its own table: a second site says nothing about the first', async () => {
    const res = await putDelegation(mohamed, BRANCH_B, ['user.view'], gmToken);
    expect(res.status).toBe(200);
    expect(data<UserDelegationsDto>(res).grants.map((g) => g.branch.id).sort()).toEqual(
      [BRANCH_A, BRANCH_B].sort(),
    );
    const effective = await effectiveOf(mohamed);
    expect(effective.keyReach?.['user.view']?.branchIds.sort()).toEqual([BRANCH_A, BRANCH_B].sort());
    expect(effective.keyReach?.['user.edit']?.branchIds).toEqual([BRANCH_A]);
  });
});

describe('D3 — what was granted by somebody else, and removal', () => {
  it('keeps a key the GM could not grant, and lets the GM remove it', async () => {
    // The administrator hands out a key the GM lacks.
    const byAdmin = await putDelegation(mohamed, BRANCH_A, ['user.view', 'user.delete'], adminToken);
    expect(byAdmin.status).toBe(200);
    // Re-sending the same list plus a key the GM holds ADDS only that key: `user.delete` is kept,
    // not granted, so the rule has nothing to refuse.
    const kept = await putDelegation(mohamed, BRANCH_A, ['user.view', 'user.delete', 'user.edit'], gmToken);
    expect(kept.status).toBe(200);
    expect(data<UserDelegationsDto>(kept).grants.find((g) => g.branch.id === BRANCH_A)?.permissionKeys).toEqual(
      ['user.delete', 'user.edit', 'user.view'],
    );
    // Removing is a narrowing: always allowed, whoever granted it.
    const narrowed = await putDelegation(mohamed, BRANCH_A, ['user.view'], gmToken);
    expect(narrowed.status).toBe(200);
    expect((await effectiveOf(mohamed)).permissions['user.delete']).toBeUndefined();
  });

  it('an empty list removes the site\'s table', async () => {
    const res = await putDelegation(mohamed, BRANCH_A, [], gmToken);
    expect(res.status).toBe(200);
    expect(data<UserDelegationsDto>(res).grants.map((g) => g.branch.id)).toEqual([BRANCH_B]);
    const again = await getDelegations(mohamed, gmToken);
    expect(data<UserDelegationsDto>(again).grants).toHaveLength(1);
    expect((await effectiveOf(mohamed)).keyReach?.['user.view']?.branchIds).toEqual([BRANCH_B]);
  });
});

describe('D4 — delegation itself is delegable, and the chain keeps the ceiling', () => {
  it('a person given «يوزّع لغيره» in one site can staff that site, within what they hold there', async () => {
    const res = await putDelegation(mohamed, BRANCH_A, ['delegation.manage', 'user.view'], gmToken);
    expect(res.status).toBe(200);
    const mohamedToken = await tokenOf('mohamed@ecms.local');

    const staffed = await putDelegation(inA, BRANCH_A, ['user.view'], mohamedToken);
    expect(staffed.status).toBe(200);

    const beyondKeys = await putDelegation(inA, BRANCH_A, ['user.edit'], mohamedToken);
    expect(beyondKeys.status).toBe(422);
    expect(errorOf(beyondKeys).message).toContain('do not hold: user.edit');

    // In B mohamed holds user.view but not delegation.manage — so he delegates nothing there.
    const beyondSite = await putDelegation(inA, BRANCH_B, ['user.view'], mohamedToken);
    expect(beyondSite.status).toBe(422);
    expect(errorOf(beyondSite).message).toContain('do not delegate in this site');
  });
});
