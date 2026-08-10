// SA-5 integration suite: retiring an account, and deleting a role.
//
// Retirement is the one part of System Administration with no undo. `archived` is a TERMINAL status
// — `archived: []` in the transition map — so an archived account cannot be brought back by any API
// this platform offers, and a deleted one is invisible to every read. That asymmetry is why the two
// refusals matter more here than anywhere else: an administrator who archives their own account, or
// the last Super Admin, has not made a mistake they can correct from the screen they were on.
//
// The suite therefore proves three separate things, which are easy to confuse:
//   • the RULES that refuse (self, last Super Admin) — new in SA-5;
//   • the SEMANTICS that were already there and must not have drifted (archive is terminal, archive
//     keeps the grants, delete is soft, the audit trail survives);
//   • that an archived account genuinely cannot sign in — asserted against the real login endpoint
//     rather than inferred from a status field.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { ErrorCodes, SettingKeys, platformPermissions, type UserDto } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { roleAssignmentRepository } from '../../src/platform/rbac/rbac.repository';
import { userService } from '../../src/platform/users';
import { userRepository } from '../../src/platform/users/user.repository';
import { UserModel } from '../../src/platform/users/user.model';
import { settingsService } from '../../src/platform/settings';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { getCache } from '../../src/infrastructure/redis/cache';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;

let adminToken = '';
let adminId = '';
let superAdminRoleId = '';
let retirerToken = ''; // user.view/edit/delete + role.* — the intended caller
let retirerId = '';
let branchRetirerToken = ''; // the same, scoped to branch B
let readerToken = ''; // user.view only — the negative control

let BRANCH_A = '';
let BRANCH_B = '';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-sa-retirement-test-${Date.now()}`;
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
  const res = await login(email);
  expect(res.status).toBe(200);
  return data<{ accessToken: string }>(res).accessToken;
};

// ── HTTP helpers ────────────────────────────────────────────────────────────

const setStatus = (
  id: string,
  status: string,
  version: number,
  token = retirerToken,
): request.Test =>
  request(app)
    .post(`/api/v1/platform/users/${id}/status`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status, version });

const deleteUser = (id: string, token = retirerToken): request.Test =>
  request(app).delete(`/api/v1/platform/users/${id}`).set('Authorization', `Bearer ${token}`);

const deleteRole = (id: string, token = retirerToken): request.Test =>
  request(app).delete(`/api/v1/platform/roles/${id}`).set('Authorization', `Bearer ${token}`);

const readUser = async (id: string, token = retirerToken): Promise<request.Response> =>
  request(app).get(`/api/v1/platform/users/${id}`).set('Authorization', `Bearer ${token}`);

const versionOf = async (id: string): Promise<number> =>
  data<UserDto>(await readUser(id, adminToken)).version;

const auditActions = async (entityId: string): Promise<string[]> => {
  const rows = await AuditLogModel.find({
    'entityRef.entityType': 'user',
    'entityRef.entityId': entityId,
  })
    .lean<{ action: string }[]>()
    .exec();
  return rows.map((row) => row.action);
};

let roleSeq = 0;
const seedRole = async (permissionKeys: string[] = ['branch.view']): Promise<string> => {
  roleSeq += 1;
  const doc = await rbacService.createRole(
    { name: { en: `Role ${String(roleSeq)}`, ar: `دور ${String(roleSeq)}` }, permissionKeys },
    adminId,
  );
  return String(doc._id);
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
  adminId = await seedUser('ret-admin@ecms.local');
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
  adminToken = await tokenOf('ret-admin@ecms.local');

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
    scope: 'organization' | 'branch' = 'organization',
  ): Promise<{ id: string; token: string }> => {
    const roleId = await seedRole(keys);
    const id = await seedUser(email, branchId);
    await rbacService.ensureAssignment(id, roleId, scope);
    return { id, token: await tokenOf(email) };
  };

  const retirer = await mkPrincipal(
    ['user.view', 'user.edit', 'user.delete', 'role.view', 'role.delete', 'role.assign'],
    'ret-retirer@ecms.local',
  );
  retirerId = retirer.id;
  retirerToken = retirer.token;

  branchRetirerToken = (
    await mkPrincipal(
      ['user.view', 'user.edit', 'user.delete'],
      'ret-branch@ecms.local',
      BRANCH_B,
      'branch',
    )
  ).token;

  readerToken = (await mkPrincipal(['user.view'], 'ret-reader@ecms.local')).token;
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  await getCache().close();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

// ── Archive: the semantics that already existed, now reachable ──────────────

describe('archiving an account', () => {
  it('is terminal — no transition leads out of it', async () => {
    const id = await seedUser('arch-terminal@ecms.local');
    expect((await setStatus(id, 'archived', await versionOf(id))).status).toBe(200);

    for (const attempt of ['active', 'suspended']) {
      const res = await setStatus(id, attempt, await versionOf(id));
      expect(res.status, `${attempt} must be refused`).toBe(422);
      expect(errorOf(res).message).toContain('archived →');
    }
  });

  it('stops the account signing in — asserted against the real login', async () => {
    const id = await seedUser('arch-login@ecms.local');
    expect((await login('arch-login@ecms.local')).status, 'signs in before').toBe(200);

    expect((await setStatus(id, 'archived', await versionOf(id))).status).toBe(200);

    const after = await login('arch-login@ecms.local');
    expect(after.status).toBe(401);
    expect(errorOf(after).code).toBe(ErrorCodes.AUTH_ACCOUNT_NOT_ACTIVE);
  });

  it('KEEPS the role assignments — they are the record of what this account could do', async () => {
    const id = await seedUser('arch-grants@ecms.local');
    const roleId = await seedRole();
    await rbacService.assignRole({ userId: id, roleId, scope: 'organization' }, adminId);

    expect((await setStatus(id, 'archived', await versionOf(id))).status).toBe(200);

    const grants = await roleAssignmentRepository.findActiveForUser(id);
    expect(grants, 'archiving is not a revocation').toHaveLength(1);
    expect(String(grants[0]?.roleId)).toBe(roleId);
  });

  it('refuses your OWN account', async () => {
    const res = await setStatus(retirerId, 'archived', await versionOf(retirerId));
    expect(res.status).toBe(422);
    expect(errorOf(res).message).toContain('your own account');
  });

  it('refuses the last Super Admin, and allows it once a second one exists', async () => {
    const refused = await setStatus(adminId, 'archived', await versionOf(adminId));
    expect(refused.status).toBe(422);
    expect(errorOf(refused).message).toContain('last Super Admin');

    // A second holder, and the identical call is allowed — which is what makes the refusal a rule
    // about the LAST one rather than about Super Admins in general.
    const second = await seedUser('arch-second-admin@ecms.local');
    await rbacService.ensureAssignment(second, superAdminRoleId, 'organization');
    expect((await setStatus(second, 'archived', await versionOf(second))).status).toBe(200);

    // The fixture's own admin is still active and still the last one.
    expect(data<UserDto>(await readUser(adminId, adminToken)).status).toBe('active');
  });
});

// ── Delete: soft, guarded, and audited ──────────────────────────────────────

describe('deleting an account', () => {
  it('is a SOFT delete — the row survives, every read stops seeing it', async () => {
    const id = await seedUser('del-soft@ecms.local');
    expect((await deleteUser(id)).status).toBe(204);

    // Gone from the API entirely…
    expect((await readUser(id)).status).toBe(404);
    const listed = (
      (
        await request(app)
          .get('/api/v1/platform/users?pageSize=50')
          .set('Authorization', `Bearer ${adminToken}`)
      ).body as { data: { id: string }[] }
    ).data.map((u) => u.id);
    expect(listed).not.toContain(id);

    // …but still there, marked, which is what makes the deletion itself reviewable.
    const raw = await UserModel.findById(id).lean<{ isDeleted: boolean; deletedAt: Date | null }>();
    expect(raw?.isDeleted).toBe(true);
    expect(raw?.deletedAt).not.toBeNull();
  });

  it('keeps the audit trail intact, including the deletion', async () => {
    const id = await seedUser('del-audit@ecms.local');
    const before = await auditActions(id);
    expect(before).toContain('create');

    expect((await deleteUser(id)).status).toBe(204);

    const after = await auditActions(id);
    // Nothing was removed, and the act itself was recorded.
    for (const action of before) expect(after).toContain(action);
    expect(after).toContain('delete');
  });

  it('ends the account’s ability to sign in', async () => {
    const id = await seedUser('del-login@ecms.local');
    expect((await login('del-login@ecms.local')).status).toBe(200);
    expect((await deleteUser(id)).status).toBe(204);
    expect((await login('del-login@ecms.local')).status).toBe(401);
  });

  it('refuses your OWN account', async () => {
    const res = await deleteUser(retirerId);
    expect(res.status).toBe(422);
    expect(errorOf(res).message).toContain('your own account');
  });

  it('refuses the last Super Admin', async () => {
    const res = await deleteUser(adminId);
    expect(res.status).toBe(422);
    expect(errorOf(res).message).toContain('last Super Admin');
    // Still readable, still active — the refusal changed nothing.
    expect(data<UserDto>(await readUser(adminId, adminToken)).status).toBe('active');
  });

  // The subtle one, and the reason the guard counts ACTIVE accounts rather than assignment holders.
  // Archiving keeps the grants, so a retired Super Admin still "holds" the role — and a guard that
  // counted holders would happily let the last one who can actually sign in be retired next.
  it('does not count a retired Super Admin as cover for retiring the last usable one', async () => {
    const ghost = await seedUser('del-ghost-admin@ecms.local');
    await rbacService.ensureAssignment(ghost, superAdminRoleId, 'organization');
    // Two holders now — so archiving this one is allowed.
    expect((await setStatus(ghost, 'archived', await versionOf(ghost))).status).toBe(200);
    // …and it still holds the role.
    const stillHolds = await roleAssignmentRepository.findActiveForUser(ghost);
    expect(stillHolds.some((a) => String(a.roleId) === superAdminRoleId)).toBe(true);

    // The admin is once again the only Super Admin who can sign in. Both doors must refuse.
    const deleted = await deleteUser(adminId);
    expect(deleted.status).toBe(422);
    expect(errorOf(deleted).message).toContain('last Super Admin');

    const archived = await setStatus(adminId, 'archived', await versionOf(adminId));
    expect(archived.status).toBe(422);
    expect(errorOf(archived).message).toContain('last Super Admin');
  });

  it('answers 404 for an account outside the caller’s scope, never a rule violation', async () => {
    const outOfScope = await seedUser('del-outscope@ecms.local', BRANCH_A);
    const refused = await deleteUser(outOfScope, branchRetirerToken); // scoped to branch B
    expect(refused.status).toBe(404);
    expect(errorOf(refused).code).toBe(ErrorCodes.NOT_FOUND);
    // The account is real, and a caller who can see it may delete it.
    expect((await deleteUser(outOfScope, retirerToken)).status).toBe(204);
  });

  it('refuses a caller without user.delete', async () => {
    const id = await seedUser('del-forbidden@ecms.local');
    expect((await deleteUser(id, readerToken)).status).toBe(403);
    // …and the account is untouched.
    expect((await readUser(id, adminToken)).status).toBe(200);
  });
});

// ── Delete a role ───────────────────────────────────────────────────────────

describe('deleting a role', () => {
  it('deletes one nobody holds', async () => {
    const roleId = await seedRole();
    expect((await deleteRole(roleId)).status).toBe(204);
    const read = await request(app)
      .get(`/api/v1/platform/roles/${roleId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(read.status).toBe(404);
  });

  it('refuses one that still has assignments', async () => {
    const roleId = await seedRole();
    const holder = await seedUser('role-held@ecms.local');
    await rbacService.assignRole({ userId: holder, roleId, scope: 'own' }, adminId);

    const res = await deleteRole(roleId);
    expect(res.status).toBe(422);
    expect(errorOf(res).message).toContain('revoke them first');
  });

  it('refuses a system role and an hr-only derivative, for their own reasons', async () => {
    const system = await deleteRole(superAdminRoleId, adminToken);
    expect(system.status).toBe(422);
    expect(errorOf(system).code).toBe(ErrorCodes.ROLE_PROTECTED);

    const { roleRepository } = await import('../../src/platform/rbac/rbac.repository');
    const derived = await roleRepository.create(
      {
        key: 'hr-only:retirement-test',
        name: { ar: 'مشتق', en: 'Derivative' },
        description: null,
        isSystem: false,
        permissionKeys: ['employee.view'],
      },
      { by: null },
    );
    const res = await deleteRole(String(derived._id), adminToken);
    expect(res.status).toBe(422);
    expect(errorOf(res).code).toBe(ErrorCodes.ROLE_PROTECTED);
    expect(errorOf(res).message).toContain('HR-only');
  });

  it('refuses a caller without role.delete', async () => {
    const roleId = await seedRole();
    expect((await deleteRole(roleId, readerToken)).status).toBe(403);
  });
});

// ── Regressions: #157 … #162 ────────────────────────────────────────────────

describe('regressions — SA-5 changes nothing that came before it', () => {
  it('#158/#159 — suspend and re-enable still work, and are not terminal', async () => {
    const id = await seedUser('reg-suspend@ecms.local');
    expect((await setStatus(id, 'suspended', await versionOf(id))).status).toBe(200);
    expect((await setStatus(id, 'active', await versionOf(id))).status).toBe(200);
    expect(data<UserDto>(await readUser(id, adminToken)).status).toBe('active');
  });

  it('#159 — the status change is still version-checked', async () => {
    const id = await seedUser('reg-version@ecms.local');
    const stale = await versionOf(id);
    expect((await setStatus(id, 'suspended', stale)).status).toBe(200);
    const again = await setStatus(id, 'archived', stale);
    expect(again.status).toBe(409);
    expect(errorOf(again).code).toBe(ErrorCodes.STALE_DOCUMENT);
  });

  /**
   * #160's rule — the last Super Admin ASSIGNMENT cannot be revoked — held only as long as no
   * Super Admin was ever retired: it counted assignment ROWS, and archiving keeps the grants
   * (decision 1), so an archived Super Admin was accepted as cover and the live one could then be
   * revoked, leaving a system with zero usable administrators. SA-5 made that reachable from the
   * screen, so the guard now counts accounts that can still sign in. The middle assertion is the
   * one that fails against the pre-SA-5 implementation.
   */
  it('#160 — revoking the last USABLE Super Admin assignment is refused', async () => {
    const superAdminGrants = async (userId: string): Promise<string[]> =>
      (
        (
          await request(app)
            .get(`/api/v1/platform/role-assignments?roleId=${superAdminRoleId}&pageSize=50`)
            .set('Authorization', `Bearer ${adminToken}`)
        ).body as { data: { id: string; userId: string }[] }
      ).data
        .filter((a) => a.userId === userId)
        .map((a) => a.id);
    const revoke = (assignmentId: string): request.Test =>
      request(app)
        .delete(`/api/v1/platform/role-assignments/${assignmentId}`)
        .set('Authorization', `Bearer ${retirerToken}`);

    const [adminGrant = ''] = await superAdminGrants(adminId);
    const refused = await revoke(adminGrant);
    expect(refused.status).toBe(422);
    expect(errorOf(refused).message).toContain('last Super Admin');

    // A RETIRED Super Admin is not cover for revoking the live one.
    const retired = await seedUser('reg-160-retired@ecms.local');
    await rbacService.ensureAssignment(retired, superAdminRoleId, 'organization');
    expect((await setStatus(retired, 'archived', await versionOf(retired))).status).toBe(200);
    const stillRefused = await revoke(adminGrant);
    expect(stillRefused.status).toBe(422);
    expect(errorOf(stillRefused).message).toContain('last Super Admin');

    // …and the guard refuses the LAST one only: with a second usable Super Admin in place, the
    // retired account's now-redundant grant comes off. Revoking that one rather than the admin's
    // keeps the account the rest of this suite authenticates as intact.
    const spare = await seedUser('reg-160-spare@ecms.local');
    await rbacService.ensureAssignment(spare, superAdminRoleId, 'organization');
    const [retiredGrant = ''] = await superAdminGrants(retired);
    expect((await revoke(retiredGrant)).status).toBe(204);
  });

  it('#161 — the effective-permissions projection still answers', async () => {
    const id = await seedUser('reg-effective@ecms.local');
    await rbacService.assignRole(
      { userId: id, roleId: await seedRole(['branch.view']), scope: 'organization' },
      adminId,
    );
    const res = await request(app)
      .get(`/api/v1/platform/users/${id}/effective-permissions`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(data<{ rows: { key: string }[] }>(res).rows.map((r) => r.key)).toEqual(['branch.view']);
  });

  it('#157 — an archived account keeps its grants, so the confinement report stays truthful', async () => {
    const id = await seedUser('reg-157@ecms.local');
    await rbacService.assignRole(
      { userId: id, roleId: await seedRole(['employee.view']), scope: 'organization' },
      adminId,
    );
    expect((await setStatus(id, 'archived', await versionOf(id))).status).toBe(200);
    expect(await roleAssignmentRepository.findActiveForUser(id)).toHaveLength(1);
  });

  it('a soft-deleted account no longer resolves through the repository either', async () => {
    const id = await seedUser('reg-repo@ecms.local');
    expect((await deleteUser(id)).status).toBe(204);
    await expect(userRepository.getById(id)).rejects.toThrow();
  });
});
