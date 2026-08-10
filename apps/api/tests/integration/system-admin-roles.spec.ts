// SA-3 integration suite: roles, the permission registry and role assignments — over real HTTP with
// real RBAC.
//
// The rules this file exists to hold down are all of one kind: **the authorization system is the one
// thing an administration screen must not be able to talk its way past.** Before SA-3, `role.create`
// was effectively `*` — an administrator could mint a role carrying every key in the registry and
// assign it to themselves — and nothing in the code said otherwise.
//
// Every security test here asserts the REASON, not merely the status. A 422 that arrives because
// some unrelated guard fired first proves nothing about the guard under test, and that failure mode
// is invisible when only the status code is checked. So each one pins the message or the error code
// the intended guard produces, and several first prove the same request succeeds once the one thing
// being tested is changed.
//
// Error mapping: 400 = the body could not be READ, 403 = the grant is missing, 404 = out of scope or
// absent, 409 = a conflict with stored state, 422 = a rule about state refused it.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  ErrorCodes,
  SettingKeys,
  platformPermissions,
  type PermissionDto,
  type RoleAssignmentDto,
  type RoleDto,
  type UserDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { roleRepository } from '../../src/platform/rbac/rbac.repository';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { getCache } from '../../src/infrastructure/redis/cache';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;

let adminToken = ''; // super-admin: everything, at organization scope
let adminId = '';
let superAdminRoleId = '';

let granterToken = ''; // role.* + user.view + a NARROW slice of grantable authority
let granterId = '';
let branchGranterToken = ''; // the same keys, but only at BRANCH scope, placed in branch B
let readerToken = ''; // role.view only — the negative control for every write

let BRANCH_A = '';
let BRANCH_B = '';
let DEPT_A = ''; // belongs to branch A
let DEPT_B = ''; // belongs to branch B
let SECTION_A = ''; // belongs to department A

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-sa-roles-test-${Date.now()}`;
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

const login = (identifier: string): request.Test =>
  request(app).post('/api/v1/auth/login').send({ identifier, password: PASSWORD });

let seq = 0;
const seedUser = async (
  email: string,
  placement: { branchId?: string | null; departmentId?: string | null; sectionId?: string | null } = {},
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
        sectionId: placement.sectionId ?? null,
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
  const res = await login(email);
  expect(res.status).toBe(200);
  return data<{ accessToken: string }>(res).accessToken;
};

// ── HTTP helpers ────────────────────────────────────────────────────────────

const postRole = (body: Record<string, unknown>, token = adminToken): request.Test =>
  request(app).post('/api/v1/platform/roles').set('Authorization', `Bearer ${token}`).send(body);

const patchRole = (
  id: string,
  body: Record<string, unknown>,
  token = adminToken,
): request.Test =>
  request(app)
    .patch(`/api/v1/platform/roles/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

const deleteRole = (id: string, token = adminToken): request.Test =>
  request(app).delete(`/api/v1/platform/roles/${id}`).set('Authorization', `Bearer ${token}`);

const listRoles = (query: string, token = adminToken): request.Test =>
  request(app).get(`/api/v1/platform/roles${query}`).set('Authorization', `Bearer ${token}`);

const postAssignment = (body: Record<string, unknown>, token = adminToken): request.Test =>
  request(app)
    .post('/api/v1/platform/role-assignments')
    .set('Authorization', `Bearer ${token}`)
    .send(body);

const patchAssignment = (
  id: string,
  body: Record<string, unknown>,
  token = adminToken,
): request.Test =>
  request(app)
    .patch(`/api/v1/platform/role-assignments/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

const revoke = (id: string, token = adminToken): request.Test =>
  request(app)
    .delete(`/api/v1/platform/role-assignments/${id}`)
    .set('Authorization', `Bearer ${token}`);

const listAssignments = (query: string, token = adminToken): request.Test =>
  request(app)
    .get(`/api/v1/platform/role-assignments${query}`)
    .set('Authorization', `Bearer ${token}`);

const patchUser = (id: string, body: Record<string, unknown>, token = adminToken): request.Test =>
  request(app)
    .patch(`/api/v1/platform/users/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

const getUser = async (id: string, token = adminToken): Promise<UserDto> => {
  const res = await request(app)
    .get(`/api/v1/platform/users/${id}`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return data<UserDto>(res);
};

/** A role created as the SYSTEM (no actor), so the escalation guards do not apply to the fixture. */
const seedRole = async (en: string, permissionKeys: string[]): Promise<string> => {
  const doc = await rbacService.createRole({ name: { en, ar: en }, permissionKeys }, adminId);
  return String(doc._id);
};

const auditActions = async (entityType: string, entityId: string): Promise<string[]> => {
  const rows = await AuditLogModel.find({
    'entityRef.entityType': entityType,
    'entityRef.entityId': entityId,
  })
    .lean<{ action: string }[]>()
    .exec();
  return rows.map((row) => row.action);
};

let roleSeq = 0;
const roleName = (): { ar: string; en: string } => {
  roleSeq += 1;
  return { ar: `دور ${String(roleSeq)}`, en: `Role ${String(roleSeq)}` };
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  superAdminRoleId = String(superAdmin._id);
  adminId = await seedUser('roles-admin@ecms.local');
  await rbacService.ensureAssignment(adminId, superAdminRoleId, 'organization');

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
  adminToken = await tokenOf('roles-admin@ecms.local');

  const mkBranch = async (code: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar: en, en } });
    expect(res.status).toBe(201);
    return data<{ id: string }>(res).id;
  };
  const mkDepartment = async (code: string, en: string, branchId: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar: en, en }, branchId });
    expect(res.status).toBe(201);
    return data<{ id: string }>(res).id;
  };

  BRANCH_A = await mkBranch('001', 'HQ');
  BRANCH_B = await mkBranch('002', 'Branch B');
  DEPT_A = await mkDepartment('OPS', 'Operations', BRANCH_A);
  DEPT_B = await mkDepartment('FIN', 'Finance', BRANCH_B);
  const section = await request(app)
    .post('/api/v1/platform/sections')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'TILL', name: { ar: 'الخزينة', en: 'Till' }, branchId: BRANCH_A, departmentId: DEPT_A });
  expect(section.status).toBe(201);
  SECTION_A = data<{ id: string }>(section).id;

  // The three principals every test below is written against. The granter deliberately holds a
  // NARROW slice: `role.*` plus exactly two grantable keys, so "a key I do not hold" is an ordinary
  // catalog key rather than something exotic.
  const mkPrincipal = async (
    en: string,
    permissionKeys: string[],
    email: string,
    placement: { branchId?: string | null } = {},
    scope: 'organization' | 'branch' = 'organization',
  ): Promise<{ id: string; token: string }> => {
    const roleId = await seedRole(en, permissionKeys);
    const id = await seedUser(email, placement);
    await rbacService.ensureAssignment(id, roleId, scope);
    return { id, token: await tokenOf(email) };
  };

  const granter = await mkPrincipal(
    'Role administrator',
    [
      'role.view',
      'role.create',
      'role.edit',
      'role.delete',
      'role.assign',
      'permission.view',
      'user.view',
      'branch.view',
    ],
    'roles-granter@ecms.local',
  );
  granterId = granter.id;
  granterToken = granter.token;

  const branchGranter = await mkPrincipal(
    'Branch role administrator',
    ['role.view', 'role.create', 'role.edit', 'role.assign', 'user.view', 'branch.view'],
    'roles-branch@ecms.local',
    { branchId: BRANCH_B },
    'branch',
  );
  branchGranterToken = branchGranter.token;

  readerToken = (await mkPrincipal('Role reader', ['role.view'], 'roles-reader@ecms.local')).token;
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  await getCache().close();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

// ── T1–T4. Nobody hands out an authority they do not hold ───────────────────

describe('T1–T4 — a role may only carry permissions its author holds', () => {
  it('T1 — creates a role from keys the actor holds', async () => {
    const res = await postRole(
      { name: roleName(), permissionKeys: ['user.view', 'branch.view'] },
      granterToken,
    );
    expect(res.status).toBe(201);
    const role = data<RoleDto>(res);
    expect(role.permissionKeys.sort()).toEqual(['branch.view', 'user.view']);
    // Derived, never stored: an administrator-created role is editable and has no key.
    expect(role.managed).toBe('none');
    expect(role.key).toBeNull();
    expect(role.isSystem).toBe(false);
  });

  it('T2 — refuses a key the actor does NOT hold, naming it, and creates nothing', async () => {
    const before = await roleRepository.list({
      filter: {},
      page: 1,
      pageSize: 1,
      sortBy: 'createdAt',
      sortDir: 'desc',
      sortableFields: ['createdAt'],
    });
    const res = await postRole(
      { name: roleName(), permissionKeys: ['user.view', 'user.delete'] },
      granterToken,
    );
    expect(res.status).toBe(422);
    // The REASON matters: this must be the escalation guard, not the unknown-key check and not a
    // missing `role.create` grant (the granter holds it — T1 just used it).
    expect(errorOf(res).message).toContain('user.delete');
    expect(errorOf(res).message).toContain('do not hold');

    const after = await roleRepository.list({
      filter: {},
      page: 1,
      pageSize: 1,
      sortBy: 'createdAt',
      sortDir: 'desc',
      sortableFields: ['createdAt'],
    });
    expect(after.meta.totalItems).toBe(before.meta.totalItems);
  });

  it('T3 — re-sending an untouched list is allowed even when it carries a key the actor lacks', async () => {
    // Seeded as the admin, so it legitimately carries something the granter cannot hand out.
    const id = await seedRole('Carries user.delete', ['user.view', 'user.delete']);
    const current = data<RoleDto>(
      await request(app)
        .get(`/api/v1/platform/roles/${id}`)
        .set('Authorization', `Bearer ${granterToken}`),
    );

    const res = await patchRole(
      id,
      { name: roleName(), permissionKeys: current.permissionKeys, version: current.version },
      granterToken,
    );
    expect(res.status).toBe(200);
    expect(data<RoleDto>(res).permissionKeys.sort()).toEqual(['user.delete', 'user.view']);
  });

  it('T4 — narrowing is always allowed; only what the edit ADDS is checked', async () => {
    const id = await seedRole('To be narrowed', ['user.view', 'user.delete']);
    const before = data<RoleDto>(
      await request(app)
        .get(`/api/v1/platform/roles/${id}`)
        .set('Authorization', `Bearer ${granterToken}`),
    );

    // Removing the key the actor lacks: a narrowing, and permitted.
    const narrowed = await patchRole(
      id,
      { permissionKeys: ['user.view'], version: before.version },
      granterToken,
    );
    expect(narrowed.status).toBe(200);
    expect(data<RoleDto>(narrowed).permissionKeys).toEqual(['user.view']);

    // Putting it back is an ADDITION, and refused for the same reason T2 was.
    const widened = await patchRole(
      id,
      {
        permissionKeys: ['user.view', 'user.delete'],
        version: data<RoleDto>(narrowed).version,
      },
      granterToken,
    );
    expect(widened.status).toBe(422);
    expect(errorOf(widened).message).toContain('user.delete');
  });
});

// ── T5–T7. Managed roles, and what "managed" is derived from ────────────────

describe('T5–T7 — a managed role refuses edits, for the reason that applies to it', () => {
  it('T5 — a system role cannot be edited or deleted', async () => {
    const current = data<RoleDto>(
      await request(app)
        .get(`/api/v1/platform/roles/${superAdminRoleId}`)
        .set('Authorization', `Bearer ${adminToken}`),
    );
    expect(current.managed).toBe('system');
    expect(current.isSystem).toBe(true);

    // As the SUPER ADMIN — so the refusal cannot be mistaken for a missing grant.
    const edited = await patchRole(superAdminRoleId, {
      name: roleName(),
      version: current.version,
    });
    expect(edited.status).toBe(422);
    expect(errorOf(edited).code).toBe(ErrorCodes.ROLE_PROTECTED);

    const removed = await deleteRole(superAdminRoleId);
    expect(removed.status).toBe(422);
    expect(errorOf(removed).code).toBe(ErrorCodes.ROLE_PROTECTED);
  });

  it('T6 — an hr-only:* derivative is protected too, and is deliberately NOT isSystem', async () => {
    // Minted the way the confinement reconciliation mints it: keyed, not flagged.
    const doc = await roleRepository.create(
      {
        key: 'hr-only:test-derivative',
        name: { ar: 'مشتق', en: 'Derivative' },
        description: null,
        isSystem: false,
        permissionKeys: ['user.view'],
      },
      { by: null },
    );
    const id = String(doc._id);

    const read = data<RoleDto>(
      await request(app)
        .get(`/api/v1/platform/roles/${id}`)
        .set('Authorization', `Bearer ${adminToken}`),
    );
    // The distinction that matters: `isSystem` would make its holders PRIVILEGED, which is why the
    // confinement does not set it — so `isSystem` alone cannot tell an administrator that editing
    // this role is pointless. `managed` can.
    expect(read.isSystem).toBe(false);
    expect(read.managed).toBe('derived');

    const edited = await patchRole(id, { name: roleName(), version: read.version });
    expect(edited.status).toBe(422);
    expect(errorOf(edited).code).toBe(ErrorCodes.ROLE_PROTECTED);
    expect(errorOf(edited).message).toContain('HR-only');

    const removed = await deleteRole(id);
    expect(removed.status).toBe(422);
    expect(errorOf(removed).code).toBe(ErrorCodes.ROLE_PROTECTED);
  });

  it('T7 — `managed` is derived from the stored role, and the list filters on it', async () => {
    const system = data<{ items: RoleDto[] }>(await listRoles('?managed=system&pageSize=50'));
    expect(system.items.length).toBeGreaterThan(0);
    expect(system.items.every((role) => role.isSystem && role.managed === 'system')).toBe(true);

    const derived = data<{ items: RoleDto[] }>(await listRoles('?managed=derived&pageSize=50'));
    expect(derived.items.every((role) => role.managed === 'derived')).toBe(true);
    expect(derived.items.every((role) => role.key?.startsWith('hr-only:') === true)).toBe(true);

    const ordinary = data<{ items: RoleDto[] }>(await listRoles('?managed=none&pageSize=50'));
    expect(ordinary.items.length).toBeGreaterThan(0);
    expect(ordinary.items.every((role) => role.managed === 'none' && !role.isSystem)).toBe(true);
    expect(ordinary.items.some((role) => role.key?.startsWith('hr-only:') === true)).toBe(false);
  });
});

// ── T8–T13. Granting: keys, reach, visibility, placement ────────────────────

describe('T8–T13 — a grant can never exceed the granter', () => {
  it('T8 — refuses to assign a role carrying a key the actor does not hold', async () => {
    const roleId = await seedRole('Holds user.delete', ['user.delete']);
    const target = await seedUser('t8-target@ecms.local');

    const res = await postAssignment(
      { userId: target, roleId, scope: 'own' },
      granterToken,
    );
    expect(res.status).toBe(422);
    expect(errorOf(res).message).toContain('user.delete');
    expect(errorOf(res).message).toContain('do not hold');
  });

  it('T9 — a branch-scoped granter cannot grant the same key at organization scope', async () => {
    const roleId = await seedRole('Branch grantable', ['user.view']);
    const target = await seedUser('t9-target@ecms.local', { branchId: BRANCH_B });

    // First prove the ONLY thing wrong is the reach: the same grant at branch scope succeeds.
    const narrow = await postAssignment(
      { userId: target, roleId, scope: 'branch' },
      branchGranterToken,
    );
    expect(narrow.status).toBe(201);

    const wide = await postAssignment(
      { userId: target, roleId, scope: 'organization' },
      branchGranterToken,
    );
    expect(wide.status).toBe(422);
    expect(errorOf(wide).message).toContain('user.view');
    expect(errorOf(wide).message).toContain('more narrowly');
  });

  it('T10 — an equal-or-narrower reach is allowed', async () => {
    const roleId = await seedRole('Equal reach', ['user.view']);
    const target = await seedUser('t10-target@ecms.local', { branchId: BRANCH_B });
    const res = await postAssignment({ userId: target, roleId, scope: 'own' }, branchGranterToken);
    expect(res.status).toBe(201);
    expect(data<RoleAssignmentDto>(res).scope).toBe('own');
  });

  it('T11 — a target outside the granter’s scope is 404, not a hint that it exists', async () => {
    const roleId = await seedRole('For an unseen target', ['user.view']);
    const unseen = await seedUser('t11-target@ecms.local', { branchId: BRANCH_A });

    const res = await postAssignment(
      { userId: unseen, roleId, scope: 'own' },
      branchGranterToken, // placed in branch B, scoped to branch B
    );
    expect(res.status).toBe(404);

    // Same request as the organization-scoped granter: the account is real and grantable.
    const seen = await postAssignment({ userId: unseen, roleId, scope: 'own' }, granterToken);
    expect(seen.status).toBe(201);
  });

  it('T12 — a hierarchical scope with no placement at that level is refused', async () => {
    const roleId = await seedRole('Needs a branch', ['user.view']);
    const unplaced = await seedUser('t12-target@ecms.local');

    const res = await postAssignment({ userId: unplaced, roleId, scope: 'branch' }, granterToken);
    expect(res.status).toBe(422);
    expect(errorOf(res).message).toContain('requires the user to have a branch');

    // The same account with a placement takes the same grant.
    const placed = await seedUser('t12-placed@ecms.local', { branchId: BRANCH_A });
    const ok = await postAssignment({ userId: placed, roleId, scope: 'branch' }, granterToken);
    expect(ok.status).toBe(201);
    expect(data<RoleAssignmentDto>(ok).branchId).toBe(BRANCH_A);
  });

  it('T13 — a supplied unit that is not the account’s home placement is refused', async () => {
    const roleId = await seedRole('Home placement only', ['user.view']);
    const target = await seedUser('t13-target@ecms.local', { branchId: BRANCH_A });

    const res = await postAssignment(
      { userId: target, roleId, scope: 'branch', branchId: BRANCH_B },
      granterToken,
    );
    expect(res.status).toBe(422);
    expect(errorOf(res).message).toContain("must target the user's home branch");

    // Supplying the RIGHT one is accepted — the input is checked, not ignored.
    const ok = await postAssignment(
      { userId: target, roleId, scope: 'branch', branchId: BRANCH_A },
      granterToken,
    );
    expect(ok.status).toBe(201);
  });
});

// ── T14–T15. The two grants that must never be removable ────────────────────

describe('T14–T15 — an administrator cannot lock the system (or themselves) out', () => {
  it('T14 — you cannot revoke or re-window your OWN assignment', async () => {
    const mine = data<{ items: RoleAssignmentDto[] }>(
      await listAssignments(`?userId=${granterId}`, granterToken),
    ).items;
    expect(mine.length).toBeGreaterThan(0);
    const own = mine[0];
    if (own === undefined) throw new Error('the granter holds no assignment to test with');

    const revoked = await revoke(own.id, granterToken);
    expect(revoked.status).toBe(422);
    expect(errorOf(revoked).message).toContain('your own role assignment');

    const rewindowed = await patchAssignment(
      own.id,
      { validTo: '2030-01-01T00:00:00.000Z', version: own.version },
      granterToken,
    );
    expect(rewindowed.status).toBe(422);
    expect(errorOf(rewindowed).message).toContain('your own role assignment');

    // Another administrator can: the rule is about SELF, not about the grant.
    const byAnother = await patchAssignment(
      own.id,
      { validTo: '2030-01-01T00:00:00.000Z', version: own.version },
      adminToken,
    );
    expect(byAnother.status).toBe(200);
  });

  it('T15 — the last Super Admin assignment cannot be revoked; a second holder unlocks it', async () => {
    const holders = data<{ items: RoleAssignmentDto[] }>(
      await listAssignments(`?roleId=${superAdminRoleId}&pageSize=50`),
    ).items;
    expect(holders, 'the fixture starts with exactly one Super Admin').toHaveLength(1);
    const only = holders[0];
    if (only === undefined) throw new Error('no super-admin assignment');

    // Attempted by the GRANTER, not the holder: the self-assignment guard runs first, so using the
    // admin's own token here would prove nothing about the last-holder rule. The granter holds
    // `role.assign` at organization scope and can read the admin account, so both earlier guards
    // pass and the refusal can only be the one under test.
    const refused = await revoke(only.id, granterToken);
    expect(refused.status).toBe(422);
    expect(errorOf(refused).message).toContain('last Super Admin');

    // Grant the role to a second account. The identical call is now allowed — which is what makes
    // the refusal above a rule about the LAST holder rather than about the role.
    const second = await seedUser('t15-second-admin@ecms.local');
    await rbacService.ensureAssignment(second, superAdminRoleId, 'organization');
    const secondAssignment = data<{ items: RoleAssignmentDto[] }>(
      await listAssignments(`?roleId=${superAdminRoleId}&pageSize=50`),
    ).items.find((a) => a.userId === second);
    if (secondAssignment === undefined) throw new Error('the second grant was not created');

    const allowed = await revoke(secondAssignment.id, granterToken);
    expect(allowed.status).toBe(204);

    // The fixture is back to one Super Admin — the rest of the file depends on it.
    const after = data<{ items: RoleAssignmentDto[] }>(
      await listAssignments(`?roleId=${superAdminRoleId}&pageSize=50`),
    ).items;
    expect(after).toHaveLength(1);
    expect(after[0]?.userId).toBe(adminId);
  });
});

// ── T16–T17. The validity window, and only the validity window ──────────────

describe('T16–T17 — moving a grant’s window is an edit; everything else is a new grant', () => {
  const grant = async (email: string): Promise<RoleAssignmentDto> => {
    const roleId = await seedRole(`Windowed ${email}`, ['user.view']);
    const userId = await seedUser(email);
    const res = await postAssignment({ userId, roleId, scope: 'own' }, granterToken);
    expect(res.status).toBe(201);
    return data<RoleAssignmentDto>(res);
  };

  it('T16 — the PATCH accepts a window and refuses the role, the user and the scope', async () => {
    const assignment = await grant('t16-target@ecms.local');

    const moved = await patchAssignment(
      assignment.id,
      { validTo: '2031-06-30T00:00:00.000Z', version: assignment.version },
      granterToken,
    );
    expect(moved.status).toBe(200);
    const after = data<RoleAssignmentDto>(moved);
    expect(after.validTo?.slice(0, 10)).toBe('2031-06-30');
    // Untouched — and the row is the SAME grant, so the trail keeps when it was first made.
    expect(after.id).toBe(assignment.id);
    expect(after.roleId).toBe(assignment.roleId);
    expect(after.scope).toBe(assignment.scope);
    expect(after.createdAt).toBe(assignment.createdAt);

    // `.strict()` is what turns "not declared" into "rejected" rather than "ignored".
    for (const forbidden of [{ scope: 'organization' }, { roleId: assignment.roleId }, { userId: assignment.userId }]) {
      const res = await patchAssignment(
        assignment.id,
        { ...forbidden, validTo: '2032-01-01T00:00:00.000Z', version: after.version },
        granterToken,
      );
      expect(res.status, `${JSON.stringify(forbidden)} was not rejected`).toBe(400);
    }
    // And a body with no window at all says so rather than being a silent no-op.
    const empty = await patchAssignment(assignment.id, { version: after.version }, granterToken);
    expect(empty.status).toBe(400);
  });

  it('T17 — a stale version is refused with 409 and changes nothing', async () => {
    const assignment = await grant('t17-target@ecms.local');

    const first = await patchAssignment(
      assignment.id,
      { validTo: '2030-01-01T00:00:00.000Z', version: assignment.version },
      granterToken,
    );
    expect(first.status).toBe(200);
    const current = data<RoleAssignmentDto>(first);
    expect(current.version).toBeGreaterThan(assignment.version);

    // The second administrator is still holding the version they read before the first write.
    const stale = await patchAssignment(
      assignment.id,
      { validTo: '2029-01-01T00:00:00.000Z', version: assignment.version },
      granterToken,
    );
    expect(stale.status).toBe(409);
    expect(errorOf(stale).code).toBe(ErrorCodes.STALE_DOCUMENT);

    // The first administrator's window survived — which is the whole point of the check.
    const reread = data<{ items: RoleAssignmentDto[] }>(
      await listAssignments(`?userId=${assignment.userId}`, granterToken),
    ).items.find((a) => a.id === assignment.id);
    expect(reread?.validTo?.slice(0, 10)).toBe('2030-01-01');
  });
});

// ── T18. Assignments are scoped through the holder ──────────────────────────

describe('T18 — who may see a grant is decided by where its HOLDER sits', () => {
  it('lists only assignments whose holder the caller may read, and totals agree with rows', async () => {
    const roleId = await seedRole('Visible or not', ['user.view']);
    const inScope = await seedUser('t18-inscope@ecms.local', { branchId: BRANCH_B });
    const outOfScope = await seedUser('t18-outscope@ecms.local', { branchId: BRANCH_A });
    expect((await postAssignment({ userId: inScope, roleId, scope: 'own' })).status).toBe(201);
    expect((await postAssignment({ userId: outOfScope, roleId, scope: 'own' })).status).toBe(201);

    const seenByBranch = data<{ items: RoleAssignmentDto[]; meta: { totalItems: number } }>(
      await listAssignments(`?roleId=${roleId}&pageSize=50`, branchGranterToken),
    );
    const holders = seenByBranch.items.map((a) => a.userId);
    expect(holders).toContain(inScope);
    expect(holders).not.toContain(outOfScope);
    // `$facet` returns the page and its total from one pass, so the count cannot disagree.
    expect(seenByBranch.meta.totalItems).toBe(seenByBranch.items.length);

    const seenByAdmin = data<{ items: RoleAssignmentDto[]; meta: { totalItems: number } }>(
      await listAssignments(`?roleId=${roleId}&pageSize=50`),
    );
    expect(seenByAdmin.meta.totalItems).toBe(2);
    // The role is resolved server-side for the page — one batched read, never one per row.
    expect(seenByAdmin.items.every((a) => a.role !== null)).toBe(true);
  });
});

// ── T19. A placement must be a real path down the tree ──────────────────────

describe('T19 — an account cannot be placed in a department outside its branch', () => {
  it('refuses an inconsistent placement on create and on update, and accepts a real path', async () => {
    const bad = await request(app)
      .post('/api/v1/platform/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: { ar: 'ت', en: 'T' },
        lastName: { ar: 'ت', en: 'T' },
        username: 't19.mismatch',
        locale: 'en',
        organization: { branchId: BRANCH_A, departmentId: DEPT_B, sectionId: null, jobTitleId: null },
      });
    expect(bad.status).toBe(422);
    expect(errorOf(bad).message).toContain('does not belong to the selected branch');

    const good = await request(app)
      .post('/api/v1/platform/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: { ar: 'ت', en: 'T' },
        lastName: { ar: 'ت', en: 'T' },
        username: 't19.consistent',
        locale: 'en',
        organization: {
          branchId: BRANCH_A,
          departmentId: DEPT_A,
          sectionId: SECTION_A,
          jobTitleId: null,
        },
      });
    expect(good.status).toBe(201);
    const created = data<UserDto>(good);
    expect(created.organization.sectionId).toBe(SECTION_A);

    // The rule is about the RESULTING state, not about which fields the request happened to name:
    // moving the branch alone would leave a department belonging to somewhere else.
    const moved = await patchUser(created.id, {
      organization: { branchId: BRANCH_B },
      version: created.version,
    });
    expect(moved.status).toBe(422);
    expect(errorOf(moved).message).toContain('does not belong to the selected branch');

    // Moving the whole path together is fine.
    const together = await patchUser(created.id, {
      organization: { branchId: BRANCH_B, departmentId: DEPT_B, sectionId: null },
      version: created.version,
    });
    expect(together.status).toBe(200);
    expect((await getUser(created.id)).organization.departmentId).toBe(DEPT_B);
  });
});

// ── T20. The stored placement on a grant is not an authorization source ─────

describe('T20 — authorization reads the holder’s CURRENT placement, never the grant’s snapshot', () => {
  it('follows the account when it moves, while the grant keeps the placement it was made at', async () => {
    const roleId = await seedRole('Branch reader', ['user.view']);
    const holderId = await seedUser('t20-holder@ecms.local', { branchId: BRANCH_A });
    const granted = await postAssignment({ userId: holderId, roleId, scope: 'branch' });
    expect(granted.status).toBe(201);
    const assignment = data<RoleAssignmentDto>(granted);
    expect(assignment.branchId).toBe(BRANCH_A);

    // A neighbour in branch A — visible to the holder while the holder is in branch A.
    const neighbourA = await seedUser('t20-neighbour-a@ecms.local', { branchId: BRANCH_A });
    const neighbourB = await seedUser('t20-neighbour-b@ecms.local', { branchId: BRANCH_B });

    const holderToken = await tokenOf('t20-holder@ecms.local');
    const beforeMove = data<{ items: UserDto[] }>(
      await request(app)
        .get('/api/v1/platform/users?pageSize=50')
        .set('Authorization', `Bearer ${holderToken}`),
    ).items.map((u) => u.id);
    expect(beforeMove).toContain(neighbourA);
    expect(beforeMove).not.toContain(neighbourB);

    // Move the account to branch B. The GRANT row is untouched — it still records branch A.
    const holder = await getUser(holderId);
    const moved = await patchUser(holderId, {
      organization: { branchId: BRANCH_B },
      version: holder.version,
    });
    expect(moved.status).toBe(200);

    // The SAME token: a placement lives on the cached auth snapshot, which `update` drops, so the
    // move takes effect on the next request rather than when the snapshot's TTL happens to lapse.
    const afterMove = data<{ items: UserDto[] }>(
      await request(app)
        .get('/api/v1/platform/users?pageSize=50')
        .set('Authorization', `Bearer ${holderToken}`),
    ).items.map((u) => u.id);
    // What the holder may read followed the ACCOUNT, not the snapshot on the grant.
    expect(afterMove).toContain(neighbourB);
    expect(afterMove).not.toContain(neighbourA);

    const stored = data<{ items: RoleAssignmentDto[] }>(
      await listAssignments(`?userId=${holderId}`),
    ).items.find((a) => a.id === assignment.id);
    expect(stored?.branchId, 'the grant still records where it was made').toBe(BRANCH_A);
  });
});

// ── Regressions the phase must not break ────────────────────────────────────

describe('regressions', () => {
  it('every mutating role path refuses a caller without the grant (403, not 404 or 422)', async () => {
    const roleId = await seedRole('Untouchable by the reader', ['user.view']);
    const target = await seedUser('reg-target@ecms.local');

    expect((await postRole({ name: roleName(), permissionKeys: ['user.view'] }, readerToken)).status).toBe(403);
    expect((await patchRole(roleId, { name: roleName(), version: 0 }, readerToken)).status).toBe(403);
    expect((await deleteRole(roleId, readerToken)).status).toBe(403);
    expect((await postAssignment({ userId: target, roleId, scope: 'own' }, readerToken)).status).toBe(403);
  });

  it('the permission registry is readable with permission.view and refused without it', async () => {
    const allowed = await request(app)
      .get('/api/v1/platform/permissions')
      .set('Authorization', `Bearer ${granterToken}`);
    expect(allowed.status).toBe(200);
    const registry = data<PermissionDto[]>(allowed);
    expect(registry.some((p) => p.key === 'role.assign')).toBe(true);
    expect(registry.some((p) => p.breakGlass)).toBe(true);

    const refused = await request(app)
      .get('/api/v1/platform/permissions')
      .set('Authorization', `Bearer ${readerToken}`);
    expect(refused.status).toBe(403);
  });

  it('the roles list searches names AND permission keys, and finds the unassigned ones', async () => {
    const id = await seedRole('Findable by its key', ['fleet.vehicle.view']);
    const byKey = data<{ items: RoleDto[] }>(
      await listRoles('?search=fleet.vehicle.view&pageSize=50'),
    ).items;
    expect(byKey.map((r) => r.id)).toContain(id);

    const unassigned = data<{ items: RoleDto[] }>(await listRoles('?unassigned=true&pageSize=50')).items;
    expect(unassigned.map((r) => r.id), 'a role nobody holds is unassigned').toContain(id);
    expect(
      unassigned.map((r) => r.id),
      'super-admin is held, so it is not unassigned',
    ).not.toContain(superAdminRoleId);
  });

  it('offers no bulk revoke endpoint — each revocation stays independently authorized', async () => {
    const roleId = await seedRole('No bulk path', ['user.view']);
    for (const res of [
      await request(app)
        .delete(`/api/v1/platform/roles/${roleId}/assignments`)
        .set('Authorization', `Bearer ${adminToken}`),
      await request(app)
        .post(`/api/v1/platform/roles/${roleId}/revoke-all`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({}),
    ]) {
      expect(res.status).toBe(404);
    }
  });

  it('records the grant, the window change and the revocation on the ACCOUNT’s trail', async () => {
    const roleId = await seedRole('Audited', ['user.view']);
    const userId = await seedUser('reg-audit@ecms.local');
    const granted = await postAssignment({ userId, roleId, scope: 'own' }, granterToken);
    expect(granted.status).toBe(201);
    const assignment = data<RoleAssignmentDto>(granted);

    const moved = await patchAssignment(
      assignment.id,
      { validTo: '2030-03-01T00:00:00.000Z', version: assignment.version },
      granterToken,
    );
    expect(moved.status).toBe(200);
    expect((await revoke(assignment.id, granterToken)).status).toBe(204);

    const actions = await auditActions('user', userId);
    expect(actions).toContain('roleAssigned');
    expect(actions).toContain('roleAssignmentUpdated');
    expect(actions).toContain('roleRevoked');
  });

  it('a role with assignments cannot be deleted out from under its holders', async () => {
    const roleId = await seedRole('Held', ['user.view']);
    const userId = await seedUser('reg-held@ecms.local');
    expect((await postAssignment({ userId, roleId, scope: 'own' }, granterToken)).status).toBe(201);

    const res = await deleteRole(roleId, granterToken);
    expect(res.status).toBe(422);
    expect(errorOf(res).message).toContain('revoke them first');
  });

  it('a granted role takes effect, and revoking it takes it away', async () => {
    const roleId = await seedRole('Grants branch.view', ['branch.view']);
    const userId = await seedUser('reg-effect@ecms.local');
    const token = await tokenOf('reg-effect@ecms.local');

    const before = await request(app)
      .get('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(403);

    const granted = await postAssignment({ userId, roleId, scope: 'organization' });
    expect(granted.status).toBe(201);
    const withRole = await tokenOf('reg-effect@ecms.local');
    expect(
      (
        await request(app)
          .get('/api/v1/platform/branches')
          .set('Authorization', `Bearer ${withRole}`)
      ).status,
    ).toBe(200);

    expect((await revoke(data<RoleAssignmentDto>(granted).id)).status).toBe(204);
    const withoutRole = await tokenOf('reg-effect@ecms.local');
    expect(
      (
        await request(app)
          .get('/api/v1/platform/branches')
          .set('Authorization', `Bearer ${withoutRole}`)
      ).status,
    ).toBe(403);
  });
});
