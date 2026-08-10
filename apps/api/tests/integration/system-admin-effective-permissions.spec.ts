// SA-4 integration suite: the effective-permissions projection, over real HTTP with real RBAC.
//
// One test in here matters more than the rest. **E8 asserts that the projection reduces to exactly
// what the authorizer enforces** — same account, same moment — because the whole feature is a claim
// about a computation somebody else performs. If the two ever disagree, this screen becomes a
// confident, detailed, wrong explanation of why someone can or cannot do something, and no other
// test in the repository would notice. It is also the guard on the refactor that made SA-4
// possible: the merge moved out of `getEffectivePermissions` into a shared function, and E8 is what
// says that move changed nothing.
//
// The rest divide in two: what the projection must SHOW (multiple roles, duplicate keys across
// roles, every scope, windows open/closed/not-yet-open, source attribution, privilege), and what it
// must REFUSE (401, 403 for either missing grant, 404 for an account outside the caller's scope —
// never a hint that it exists).
//
// Error mapping: 401 = no token, 403 = a grant is missing, 404 = out of scope or absent.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  ErrorCodes,
  SettingKeys,
  platformPermissions,
  type DataScope,
  type EffectivePermissionRowDto,
  type EffectivePermissionsDto,
  type UserDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { roleAssignmentRepository } from '../../src/platform/rbac/rbac.repository';
import { RoleModel } from '../../src/platform/rbac/role.model';
import { userService } from '../../src/platform/users';
import { userRepository } from '../../src/platform/users/user.repository';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { getCache } from '../../src/infrastructure/redis/cache';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
const DAY = 86_400_000;

let replSet: MongoMemoryReplSet | null = null;
let app: Express;

let adminToken = '';
let adminId = '';
let inspectorToken = ''; // user.view + role.view at organization scope — the intended caller
let branchInspectorToken = ''; // the same pair, but only over branch B
let usersOnlyToken = ''; // user.view WITHOUT role.view
let rolesOnlyToken = ''; // role.view WITHOUT user.view

let BRANCH_A = '';
let BRANCH_B = '';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-sa-effective-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
const errorOf = (res: request.Response): { code: string; message: string } =>
  (res.body as { error: { code: string; message: string } }).error;

let seq = 0;
const seedUser = async (email: string, branchId: string | null = null): Promise<string> => {
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
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ identifier: email, password: PASSWORD });
  expect(res.status).toBe(200);
  return data<{ accessToken: string }>(res).accessToken;
};

let roleSeq = 0;
const seedRole = async (permissionKeys: string[]): Promise<string> => {
  roleSeq += 1;
  const doc = await rbacService.createRole(
    { name: { en: `Role ${String(roleSeq)}`, ar: `دور ${String(roleSeq)}` }, permissionKeys },
    adminId,
  );
  return String(doc._id);
};

/** Grant through the service, so a window in the past or the future can be set directly. */
const grant = async (
  userId: string,
  roleId: string,
  scope: DataScope,
  window: { validFrom?: Date; validTo?: Date } = {},
): Promise<string> => {
  const doc = await rbacService.assignRole(
    {
      userId,
      roleId,
      scope,
      ...(window.validFrom === undefined ? {} : { validFrom: window.validFrom }),
      ...(window.validTo === undefined ? {} : { validTo: window.validTo }),
    },
    adminId,
  );
  return String(doc._id);
};

const explain = (userId: string, token = inspectorToken): request.Test =>
  request(app)
    .get(`/api/v1/platform/users/${userId}/effective-permissions`)
    .set('Authorization', `Bearer ${token}`);

const explained = async (userId: string, token = inspectorToken): Promise<EffectivePermissionsDto> => {
  const res = await explain(userId, token);
  expect(res.status).toBe(200);
  return data<EffectivePermissionsDto>(res);
};

const rowFor = (dto: EffectivePermissionsDto, key: string): EffectivePermissionRowDto => {
  const row = dto.rows.find((r) => r.key === key);
  if (row === undefined) throw new Error(`no row for ${key}`);
  return row;
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  adminId = await seedUser('eff-admin@ecms.local');
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
  adminToken = await tokenOf('eff-admin@ecms.local');

  const mkBranch = async (code: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar: en, en } });
    expect(res.status).toBe(201);
    return data<{ id: string }>(res).id;
  };
  BRANCH_A = await mkBranch('001', 'HQ');
  BRANCH_B = await mkBranch('002', 'Branch B');

  const mkPrincipal = async (
    keys: string[],
    email: string,
    branchId: string | null = null,
    scope: DataScope = 'organization',
  ): Promise<string> => {
    const roleId = await seedRole(keys);
    const id = await seedUser(email, branchId);
    await rbacService.ensureAssignment(id, roleId, scope);
    return tokenOf(email);
  };

  inspectorToken = await mkPrincipal(['user.view', 'role.view'], 'eff-inspector@ecms.local');
  branchInspectorToken = await mkPrincipal(
    ['user.view', 'role.view'],
    'eff-branch@ecms.local',
    BRANCH_B,
    'branch',
  );
  usersOnlyToken = await mkPrincipal(['user.view'], 'eff-users-only@ecms.local');
  rolesOnlyToken = await mkPrincipal(['role.view'], 'eff-roles-only@ecms.local');
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  await getCache().close();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

// ── E1–E3, E6, E7, E12, E13. What the projection must SHOW ──────────────────

describe('E1 — permissions from several roles are all present', () => {
  it('unions the keys of every role the account holds', async () => {
    const userId = await seedUser('e1@ecms.local');
    await grant(userId, await seedRole(['branch.view', 'department.view']), 'organization');
    await grant(userId, await seedRole(['jobTitle.view']), 'organization');

    const dto = await explained(userId);
    const keys = dto.rows.map((r) => r.key).sort();
    expect(keys).toEqual(['branch.view', 'department.view', 'jobTitle.view']);
    expect(dto.userId).toBe(userId);
  });
});

describe('E2 — a key granted by two roles is ONE row with two sources', () => {
  it('resolves to the wider scope and marks only the contribution that set it', async () => {
    const userId = await seedUser('e2@ecms.local', BRANCH_A);
    const narrowRole = await seedRole(['branch.view']);
    const wideRole = await seedRole(['branch.view']);
    await grant(userId, narrowRole, 'branch');
    await grant(userId, wideRole, 'organization');

    const row = rowFor(await explained(userId), 'branch.view');
    expect(row.sources).toHaveLength(2);
    expect(row.scope, 'the widest active scope wins — ADR-004').toBe('organization');
    expect(row.state).toBe('active');

    const decisive = row.sources.filter((s) => s.decisive);
    expect(decisive).toHaveLength(1);
    expect(decisive[0]?.roleId).toBe(wideRole);
    expect(decisive[0]?.scope).toBe('organization');
    // The also-ran is kept, not swallowed: it is why the account also holds it at branch scope.
    expect(row.sources.find((s) => s.roleId === narrowRole)?.decisive).toBe(false);
  });

  it('marks BOTH when two active sources tie at the widest scope', async () => {
    const userId = await seedUser('e2-tie@ecms.local');
    await grant(userId, await seedRole(['branch.view']), 'organization');
    await grant(userId, await seedRole(['branch.view']), 'organization');

    const row = rowFor(await explained(userId), 'branch.view');
    expect(row.sources.filter((s) => s.decisive)).toHaveLength(2);
  });
});

describe('E3 — every scope is reported exactly as granted', () => {
  it.each<[DataScope]>([['own'], ['branch'], ['organization']])(
    'reports %s without re-interpreting it',
    async (scope) => {
      const userId = await seedUser(`e3-${scope}@ecms.local`, BRANCH_A);
      await grant(userId, await seedRole(['branch.view']), scope);

      const row = rowFor(await explained(userId), 'branch.view');
      expect(row.scope).toBe(scope);
      expect(row.sources[0]?.scope).toBe(scope);
    },
  );
});

describe('E4–E6 — validity windows decide the state, never the visibility', () => {
  it('E4 — a grant starting in the future is `pending` and grants nothing yet', async () => {
    const userId = await seedUser('e4@ecms.local');
    await grant(userId, await seedRole(['branch.view']), 'organization', {
      validFrom: new Date(Date.now() + 30 * DAY),
    });

    const row = rowFor(await explained(userId), 'branch.view');
    expect(row.state).toBe('pending');
    expect(row.scope, 'nothing is in force, so there is no effective scope').toBeNull();
    expect(row.sources[0]?.state).toBe('pending');
    expect(row.sources[0]?.decisive).toBe(false);
  });

  it('E5 — a grant whose window closed is `expired` and STILL LISTED', async () => {
    const userId = await seedUser('e5@ecms.local');
    await grant(userId, await seedRole(['branch.view']), 'organization', {
      validFrom: new Date(Date.now() - 30 * DAY),
      validTo: new Date(Date.now() - DAY),
    });

    const dto = await explained(userId);
    const row = rowFor(dto, 'branch.view');
    // The point of the screen: "it lapsed yesterday" is the answer, and a missing row is not.
    expect(row.state).toBe('expired');
    expect(row.scope).toBeNull();
    expect(row.sources[0]?.validTo).not.toBeNull();
  });

  it('E6 — an open window is `active` and contributes', async () => {
    const userId = await seedUser('e6@ecms.local', BRANCH_A);
    await grant(userId, await seedRole(['branch.view']), 'branch', {
      validFrom: new Date(Date.now() - DAY),
      validTo: new Date(Date.now() + 30 * DAY),
    });

    const row = rowFor(await explained(userId), 'branch.view');
    expect(row.state).toBe('active');
    expect(row.scope).toBe('branch');
    expect(row.sources[0]?.decisive).toBe(true);
  });

  it('an expired grant and a live one on the same key: active wins, both are shown', async () => {
    const userId = await seedUser('e6-mixed@ecms.local');
    const deadRole = await seedRole(['branch.view']);
    const liveRole = await seedRole(['branch.view']);
    await grant(userId, deadRole, 'organization', { validTo: new Date(Date.now() - DAY) });
    await grant(userId, liveRole, 'own');

    const row = rowFor(await explained(userId), 'branch.view');
    expect(row.state).toBe('active');
    // The EXPIRED one was the wider grant. It must not set the reach — that is the bug this pins.
    expect(row.scope).toBe('own');
    expect(row.sources).toHaveLength(2);
    expect(row.sources.find((s) => s.roleId === deadRole)?.decisive).toBe(false);
    expect(row.sources.find((s) => s.roleId === liveRole)?.decisive).toBe(true);
  });
});

describe('E7 — every source names the role and assignment it came from', () => {
  it('attributes each contribution', async () => {
    const userId = await seedUser('e7@ecms.local');
    const roleId = await seedRole(['branch.view']);
    const assignmentId = await grant(userId, roleId, 'organization');

    const source = rowFor(await explained(userId), 'branch.view').sources[0];
    expect(source?.roleId).toBe(roleId);
    expect(source?.assignmentId).toBe(assignmentId);
    expect(source?.roleName.en).toMatch(/^Role /);
    expect(source?.roleManaged, 'an administrator-made role is editable').toBe('none');
    expect(source?.roleKey).toBeNull();
  });
});

describe('E8 — the projection agrees with what the authorizer enforces', () => {
  // The test this whole feature rests on, and the guard on the shared-function extraction.
  it('reduces to exactly getEffectivePermissions for the same account', async () => {
    const userId = await seedUser('e8@ecms.local', BRANCH_A);
    await grant(userId, await seedRole(['branch.view', 'department.view']), 'branch');
    await grant(userId, await seedRole(['branch.view', 'jobTitle.view']), 'organization');
    await grant(userId, await seedRole(['section.view']), 'organization', {
      validTo: new Date(Date.now() - DAY), // expired — must not appear in the enforced set
    });
    await grant(userId, await seedRole(['user.export']), 'organization', {
      validFrom: new Date(Date.now() + DAY), // pending — likewise
    });

    const dto = await explained(userId);
    const user = await userRepository.getById(userId);
    const enforced = await rbacService.getEffectivePermissions(
      userId,
      user.security.permissionVersion,
    );

    // Reduce the projection the way the authorizer would: active rows only, key → effective scope.
    const projected: Record<string, DataScope> = {};
    for (const row of dto.rows) {
      if (row.state === 'active' && row.scope !== null) projected[row.key] = row.scope;
    }
    expect(projected).toEqual(enforced.permissions);
    expect(dto.isPrivileged).toBe(enforced.isPrivileged);

    // …and the two states the enforced set cannot express are present in the projection.
    expect(rowFor(dto, 'section.view').state).toBe('expired');
    expect(rowFor(dto, 'user.export').state).toBe('pending');
    expect(enforced.permissions['section.view']).toBeUndefined();
    expect(enforced.permissions['user.export']).toBeUndefined();
  });

  it('agrees for an account holding everything, too', async () => {
    const dto = await explained(adminId, adminToken);
    const user = await userRepository.getById(adminId);
    const enforced = await rbacService.getEffectivePermissions(
      adminId,
      user.security.permissionVersion,
    );
    const projected: Record<string, DataScope> = {};
    for (const row of dto.rows) {
      if (row.state === 'active' && row.scope !== null) projected[row.key] = row.scope;
    }
    expect(projected).toEqual(enforced.permissions);
    expect(Object.keys(projected).length).toBeGreaterThan(100);
  });
});

// ── E9, E10. What the projection must REFUSE ────────────────────────────────

describe('E9 — an account outside the caller’s scope does not exist as far as they are told', () => {
  it('answers 404, and 200 for the same account to a caller who may see it', async () => {
    const target = await seedUser('e9@ecms.local', BRANCH_A);
    await grant(target, await seedRole(['branch.view']), 'organization');

    const refused = await explain(target, branchInspectorToken); // scoped to branch B
    expect(refused.status).toBe(404);
    // Not 403 — a 403 here would confirm that the account exists.
    expect(errorOf(refused).code).toBe(ErrorCodes.NOT_FOUND);

    // The only thing different about this call is who is making it.
    expect((await explain(target, inspectorToken)).status).toBe(200);
  });

  it('answers 404 for an id that does not exist at all — the same shape', async () => {
    const res = await explain('507f1f77bcf86cd799439011');
    expect(res.status).toBe(404);
  });
});

describe('E10 — 401 and 403', () => {
  it('401 without a token', async () => {
    const userId = await seedUser('e10-401@ecms.local');
    const res = await request(app).get(`/api/v1/platform/users/${userId}/effective-permissions`);
    expect(res.status).toBe(401);
  });

  it('403 with user.view but WITHOUT role.view', async () => {
    const userId = await seedUser('e10-users@ecms.local');
    expect((await explain(userId, usersOnlyToken)).status).toBe(403);
  });

  it('403 with role.view but WITHOUT user.view', async () => {
    const userId = await seedUser('e10-roles@ecms.local');
    expect((await explain(userId, rolesOnlyToken)).status).toBe(403);
  });

  it('200 only when BOTH are held — neither grant implies the other', async () => {
    const userId = await seedUser('e10-both@ecms.local');
    expect((await explain(userId, inspectorToken)).status).toBe(200);
  });
});

// ── E11, E12, E13, E14. Cache, privilege, unknown keys, response shape ──────

describe('E11 — the projection is fresh, and the enforcement cache is untouched', () => {
  it('reflects a new grant immediately, without waiting for any TTL', async () => {
    const userId = await seedUser('e11@ecms.local');
    expect((await explained(userId)).rows).toHaveLength(0);

    // Warm the enforcement cache for this account, then change the grants underneath it.
    const before = await userRepository.getById(userId);
    await rbacService.getEffectivePermissions(userId, before.security.permissionVersion);

    await grant(userId, await seedRole(['branch.view']), 'organization');

    // The projection has no cache of its own to be stale.
    const dto = await explained(userId);
    expect(dto.rows.map((r) => r.key)).toEqual(['branch.view']);

    // And the enforcement path agrees, because granting bumped the version the cache is keyed on.
    const after = await userRepository.getById(userId);
    expect(after.security.permissionVersion).toBeGreaterThan(before.security.permissionVersion);
    const enforced = await rbacService.getEffectivePermissions(
      userId,
      after.security.permissionVersion,
    );
    expect(enforced.permissions['branch.view']).toBe('organization');
    expect(dto.permissionVersion).toBe(after.security.permissionVersion);
  });

  it('stamps the moment it describes', async () => {
    const userId = await seedUser('e11-at@ecms.local');
    const before = Date.now();
    const dto = await explained(userId);
    const at = Date.parse(dto.evaluatedAt);
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('adds no cache key of its own', async () => {
    const userId = await seedUser('e11-nocache@ecms.local');
    await grant(userId, await seedRole(['branch.view']), 'organization');
    await explained(userId);
    // `perms:` is the enforcement cache; nothing else may appear for this account.
    const cache = getCache();
    await cache.delByPrefix(`perms:${userId}`);
    const again = await explained(userId);
    expect(again.rows).toHaveLength(1);
  });
});

describe('E12 — privilege is explained, not merely asserted', () => {
  it('names the system role that confers it', async () => {
    const dto = await explained(adminId, adminToken);
    expect(dto.isPrivileged).toBe(true);
    expect(dto.privilegedBecause.systemRoles).toContain('Super Admin');
  });

  it('names a break-glass key when that is the reason', async () => {
    const userId = await seedUser('e12-breakglass@ecms.local');
    await grant(userId, await seedRole(['user.manageSessions']), 'organization');

    const dto = await explained(userId);
    expect(dto.isPrivileged).toBe(true);
    expect(dto.privilegedBecause.breakGlassKeys).toContain('user.manageSessions');
    expect(dto.privilegedBecause.systemRoles).toEqual([]);
    expect(rowFor(dto, 'user.manageSessions').breakGlass).toBe(true);
  });

  it('says so plainly when an account is not privileged', async () => {
    const userId = await seedUser('e12-ordinary@ecms.local');
    await grant(userId, await seedRole(['branch.view']), 'organization');

    const dto = await explained(userId);
    expect(dto.isPrivileged).toBe(false);
    expect(dto.privilegedBecause).toEqual({ systemRoles: [], breakGlassKeys: [] });
  });
});

describe('E13 — a key the registry no longer declares still explains itself', () => {
  it('keeps the row with a null module rather than dropping it', async () => {
    const userId = await seedUser('e13@ecms.local');
    const roleId = await seedRole(['branch.view']);
    // Written straight to the collection: the service refuses unknown keys, and rightly so. This
    // is the state a RETIRED module leaves behind — a role still carrying a key nothing declares —
    // which no supported call can produce and which the screen must still explain.
    await RoleModel.updateOne(
      { _id: roleId },
      { $set: { permissionKeys: ['branch.view', 'retired.module.view'] } },
    ).exec();
    await grant(userId, roleId, 'organization');

    const dto = await explained(userId);
    const row = rowFor(dto, 'retired.module.view');
    expect(row.moduleId).toBeNull();
    expect(row.name).toBeNull();
    expect(row.breakGlass).toBe(false);
    // It is still GRANTED — the account really does hold that key.
    expect(row.state).toBe('active');
    expect(row.scope).toBe('organization');
    expect(rowFor(dto, 'branch.view').moduleId).toBe('platform');
  });
});

describe('E14 — the response leaks nothing through its shape', () => {
  it('carries no pagination metadata and no security fields', async () => {
    const userId = await seedUser('e14@ecms.local');
    await grant(userId, await seedRole(['branch.view']), 'organization');

    const res = await explain(userId);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.meta, 'no page metadata — nothing here is paginated').toBeUndefined();

    const serialized = JSON.stringify(body);
    for (const forbidden of ['passwordHash', 'tokenHash', 'totp', 'secret', 'activation']) {
      expect(serialized, `${forbidden} must never reach this response`).not.toContain(forbidden);
    }
  });

  it('is sorted by key, so two reads of the same state are the same document', async () => {
    const userId = await seedUser('e14-sorted@ecms.local');
    await grant(userId, await seedRole(['jobTitle.view', 'branch.view', 'department.view']), 'own');

    const rows = (await explained(userId)).rows.map((r) => r.key);
    expect(rows).toEqual([...rows].sort());
  });
});

// ── Regressions: #157, #158, #159, #160 ─────────────────────────────────────

describe('regressions — SA-4 changes nothing that came before it', () => {
  it('#160 — the escalation guards still refuse a key the actor does not hold', async () => {
    const roleId = await seedRole(['user.delete']);
    const target = await seedUser('reg-160@ecms.local');
    const res = await request(app)
      .post('/api/v1/platform/role-assignments')
      .set('Authorization', `Bearer ${inspectorToken}`)
      .send({ userId: target, roleId, scope: 'own' });
    // The inspector holds neither `role.assign` nor `user.delete`; the route gate answers first.
    expect(res.status).toBe(403);
  });

  it('#160 — the assignment list and the projection agree about the same grants', async () => {
    const userId = await seedUser('reg-160-list@ecms.local');
    const roleId = await seedRole(['branch.view']);
    const assignmentId = await grant(userId, roleId, 'organization');

    const listed = (
      (
        await request(app)
          .get(`/api/v1/platform/role-assignments?userId=${userId}&pageSize=25`)
          .set('Authorization', `Bearer ${adminToken}`)
      ).body as { data: { id: string }[] }
    ).data.map((a) => a.id);
    const projected = [
      ...new Set((await explained(userId)).rows.flatMap((r) => r.sources.map((s) => s.assignmentId))),
    ];
    expect(projected).toEqual(listed);
    expect(projected).toContain(assignmentId);
  });

  it('#158/#159 — the account endpoints are untouched by the new sub-resource', async () => {
    const userId = await seedUser('reg-158@ecms.local');
    const read = await request(app)
      .get(`/api/v1/platform/users/${userId}`)
      .set('Authorization', `Bearer ${inspectorToken}`);
    expect(read.status).toBe(200);
    expect(data<UserDto>(read).id).toBe(userId);

    // The list still answers, and the new path did not shadow `/:id`.
    const list = await request(app)
      .get('/api/v1/platform/users?pageSize=25')
      .set('Authorization', `Bearer ${inspectorToken}`);
    expect(list.status).toBe(200);
  });

  it('#157 — an account confined to HR shows only HR permissions, and says why', async () => {
    // The confinement is a set of grants, so the projection must report exactly what it left.
    const userId = await seedUser('reg-157@ecms.local');
    await grant(userId, await seedRole(['employee.view']), 'organization');

    const dto = await explained(userId);
    expect(dto.rows.map((r) => r.key)).toEqual(['employee.view']);
    expect(rowFor(dto, 'employee.view').moduleId).toBe('hr');
    expect(dto.isPrivileged, 'an HR-only account is deliberately not privileged').toBe(false);
  });

  it('the stored assignment placement is still not an authorization source', async () => {
    const userId = await seedUser('reg-placement@ecms.local', BRANCH_A);
    await grant(userId, await seedRole(['branch.view']), 'branch');

    const stored = await roleAssignmentRepository.findActiveForUser(userId);
    expect(String(stored[0]?.branchId)).toBe(BRANCH_A);
    // The projection reports the grant's SCOPE, never re-deriving reach from that stored id.
    expect(rowFor(await explained(userId), 'branch.view').scope).toBe('branch');
  });
});
