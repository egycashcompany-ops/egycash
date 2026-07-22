// Phase 2.1 golden path (Architecture Review 01, R2):
//   login → permission → scoped data → audit trail
// plus refresh rotation with reuse detection (ADR-006), lockout, TOTP enforcement
// for privileged accounts (R13), time-bound assignments (R14) and settings-driven
// password policy. Runs against a real in-memory Mongo REPLICA SET (transactions).
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { authenticator } from 'otplib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { platformPermissions, SettingKeys, type JobTitleDto, type MeDto } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';
import { type Express } from 'express';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId: string;

/**
 * Default: in-memory Mongo replica set (downloads a binary — works in CI).
 * Set MONGO_TEST_URI (e.g. mongodb://localhost:27017?replicaSet=rs0&directConnection=true,
 * from docker-compose) to run against an external server; a unique database name is
 * generated per run so repeated runs stay independent.
 */
const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const adminCtx = (): AuthContext => ({
  userId: adminId,
  sessionId: 'test-session',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'en',
  permissions: { 'setting.edit': 'organization', 'setting.view': 'organization' },
  permissionVersion: 1,
  isPrivileged: true,
});

const seedAdmin = async (): Promise<void> => {
  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    platformPermissions.map((p) => p.key),
  );
  const { user } = await userService.create(
    {
      email: 'admin@ecms.local',
      firstName: { ar: 'مدير', en: 'System' },
      lastName: { ar: 'النظام', en: 'Admin' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  adminId = String(user._id);
  await userService.setPassword(adminId, PASSWORD, 'passwordReset');
  await userService.forceActivate(adminId);
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');
};

const setTotpEnforcement = async (enabled: boolean): Promise<void> => {
  await settingsService.set(adminCtx(), {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: enabled,
  });
};

interface LoginResult {
  status: number;
  body: {
    success: boolean;
    data?: {
      totpRequired: boolean;
      accessToken?: string;
      me?: MeDto;
      challengeToken?: string;
      enrollmentRequired?: boolean;
    };
    error?: { code: string };
  };
  cookie: string | null;
}

const doLogin = async (email: string, password: string): Promise<LoginResult> => {
  const response = await request(app).post('/api/v1/auth/login').send({ email, password });
  const setCookie = response.headers['set-cookie'];
  const cookie =
    setCookie === undefined
      ? null
      : ([setCookie].flat().find((c: string) => c.startsWith('ecms_refresh=')) ?? null);
  return { status: response.status, body: response.body as LoginResult['body'], cookie };
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri() });
  app = buildApp();
  await seedAdmin();
  await setTotpEnforcement(false);
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  // Keep the strict auth rate limits out of the way between tests.
  await getCache().delByPrefix('rl:');
});

describe('login → permission → scoped data → audit trail', () => {
  let adminToken: string;

  it('logs in with valid credentials and returns the identity + effective permissions', async () => {
    const result = await doLogin('admin@ecms.local', PASSWORD);
    expect(result.status).toBe(200);
    expect(result.body.data?.totpRequired).toBe(false);
    expect(result.body.data?.accessToken).toBeTruthy();
    expect(result.body.data?.me?.permissions['user.view']).toBe('organization');
    // The super-admin identity carries the privileged flag (used by the UI to gate super-admin-only actions).
    expect(result.body.data?.me?.isPrivileged).toBe(true);
    expect(result.cookie).toContain('HttpOnly');
    adminToken = result.body.data?.accessToken ?? '';
  });

  it('rejects invalid credentials with a stable error code', async () => {
    const result = await doLogin('admin@ecms.local', 'Wrong#Pass1x');
    expect(result.status).toBe(401);
    expect(result.body.error?.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('rejects unauthenticated access to protected routes', async () => {
    const response = await request(app).get('/api/v1/platform/users');
    expect(response.status).toBe(401);
  });

  let branchAId: string;
  let branchBId: string;
  let bobId: string;
  let bobToken: string;

  it('creates org structure and users (admin, organization scope)', async () => {
    const branchA = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'BR-CAI-1', name: { ar: 'فرع القاهرة ١', en: 'Cairo Branch 1' } });
    expect(branchA.status).toBe(201);
    branchAId = (branchA.body as { data: { id: string } }).data.id;

    const branchB = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'BR-ALX-1', name: { ar: 'فرع الإسكندرية', en: 'Alexandria Branch' } });
    expect(branchB.status).toBe(201);
    branchBId = (branchB.body as { data: { id: string } }).data.id;

    // duplicate code → 409 DUPLICATE
    const dup = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'BR-CAI-1', name: { ar: 'مكرر', en: 'Duplicate' } });
    expect(dup.status).toBe(409);

    // duplicate NAME (case-insensitive, different code) → also 409
    const dupName = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'BR-CAI-2', name: { ar: 'فرع القاهرة ١', en: 'cairo branch 1' } });
    expect(dupName.status).toBe(409);

    const createUser = (email: string, branchId: string) =>
      request(app)
        .post('/api/v1/platform/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email,
          firstName: { ar: 'مستخدم', en: 'User' },
          lastName: { ar: 'اختبار', en: 'Test' },
          organization: { branchId, departmentId: null, sectionId: null, jobTitleId: null },
        });

    const bob = await createUser('bob@ecms.local', branchAId);
    expect(bob.status).toBe(201);
    const bobBody = (bob.body as { data: { id: string; activationToken: string } }).data;
    bobId = bobBody.id;

    const carol = await createUser('carol@ecms.local', branchBId);
    expect(carol.status).toBe(201);

    // Bob activates his invited account (password policy enforced).
    const weak = await request(app)
      .post('/api/v1/auth/activate')
      .send({ token: bobBody.activationToken, password: 'weakpass' });
    expect(weak.status).toBe(422);
    expect((weak.body as { error: { code: string } }).error.code).toBe('AUTH_PASSWORD_POLICY');

    const activated = await request(app)
      .post('/api/v1/auth/activate')
      .send({ token: bobBody.activationToken, password: PASSWORD });
    expect(activated.status).toBe(204);
  });

  it('grants Bob user.view @ branch and enforces the scope in queries (ADR-015)', async () => {
    const role = await request(app)
      .post('/api/v1/platform/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: { ar: 'مشاهد المستخدمين', en: 'User Viewer' },
        permissionKeys: ['user.view'],
      });
    expect(role.status).toBe(201);
    const roleId = (role.body as { data: { id: string } }).data.id;

    const assignment = await request(app)
      .post('/api/v1/platform/role-assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: bobId, roleId, scope: 'branch' });
    expect(assignment.status).toBe(201);

    const login = await doLogin('bob@ecms.local', PASSWORD);
    expect(login.status).toBe(200);
    bobToken = login.body.data?.accessToken ?? '';
    expect(login.body.data?.me?.permissions['user.view']).toBe('branch');

    // Branch scope: Bob sees only branch-A users.
    const list = await request(app)
      .get('/api/v1/platform/users')
      .set('Authorization', `Bearer ${bobToken}`);
    expect(list.status).toBe(200);
    const emails = (
      list.body as { data: { email: string; organization: { branchId: string | null } }[] }
    ).data;
    expect(emails.some((u) => u.email === 'bob@ecms.local')).toBe(true);
    expect(emails.every((u) => u.organization.branchId === branchAId)).toBe(true);
    expect(emails.some((u) => u.email === 'carol@ecms.local')).toBe(false);
    expect(emails.some((u) => u.email === 'admin@ecms.local')).toBe(false);
  });

  it('denies actions without the permission and audits the denial', async () => {
    const denied = await request(app)
      .post('/api/v1/platform/users')
      .set('Authorization', `Bearer ${bobToken}`)
      .send({
        email: 'mallory@ecms.local',
        firstName: { ar: 'م', en: 'M' },
        lastName: { ar: 'م', en: 'M' },
      });
    expect(denied.status).toBe(403);

    const audit = await request(app)
      .get('/api/v1/platform/audit-logs')
      .query({ action: 'permissionDenied', entityType: 'user', entityId: bobId })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(audit.status).toBe(200);
    const rows = (audit.body as { data: { action: string }[] }).data;
    expect(rows.length).toBeGreaterThan(0);
  });

  it('exposes the full audit trail of the flow (ADR-012)', async () => {
    const audit = await request(app)
      .get('/api/v1/platform/audit-logs')
      .query({ entityType: 'branch', entityId: branchAId })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(audit.status).toBe(200);
    const rows = (
      audit.body as {
        data: {
          action: string;
          changes: { field: string; new: unknown }[];
          actor: { userId: string | null };
        }[];
      }
    ).data;
    expect(rows.some((r) => r.action === 'create' && r.actor.userId === adminId)).toBe(true);
    const create = rows.find((r) => r.action === 'create');
    expect(create?.changes.some((c) => c.field === 'code' && c.new === 'BR-CAI-1')).toBe(true);

    // Bob (audit-log permission missing) cannot read audit logs.
    const forbidden = await request(app)
      .get('/api/v1/platform/audit-logs')
      .set('Authorization', `Bearer ${bobToken}`);
    expect(forbidden.status).toBe(403);
  });

  it('supports optimistic concurrency on updates (STALE_DOCUMENT)', async () => {
    const branch = await request(app)
      .get(`/api/v1/platform/branches/${branchAId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const version = (branch.body as { data: { version: number } }).data.version;

    const ok1 = await request(app)
      .patch(`/api/v1/platform/branches/${branchAId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version, name: { ar: 'فرع القاهرة الأول', en: 'Cairo First Branch' } });
    expect(ok1.status).toBe(200);

    const stale = await request(app)
      .patch(`/api/v1/platform/branches/${branchAId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version, name: { ar: 'قديم', en: 'Stale' } });
    expect(stale.status).toBe(409);
    expect((stale.body as { error: { code: string } }).error.code).toBe('STALE_DOCUMENT');
  });

  it('enforces the fixed hierarchy: department needs an active branch; delete guards children', async () => {
    const department = await request(app)
      .post('/api/v1/platform/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'DEP-OPS', name: { ar: 'العمليات', en: 'Operations' }, branchId: branchAId });
    expect(department.status).toBe(201);
    expect((department.body as { data: { path: string } }).data.path).toContain(branchAId);

    const blocked = await request(app)
      .delete(`/api/v1/platform/branches/${branchAId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(blocked.status).toBe(422);
    expect((blocked.body as { error: { code: string } }).error.code).toBe('ORG_UNIT_HAS_CHILDREN');

    const orphanDept = await request(app)
      .post('/api/v1/platform/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'DEP-X', name: { ar: 'س', en: 'X' }, branchId: '000000000000000000000001' });
    expect(orphanDept.status).toBe(422);
  });

  it('enforces DEPARTMENT scope: a department-scoped user sees only same-department users (ADR-017)', async () => {
    const dept = await request(app)
      .post('/api/v1/platform/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'DEP-FIN', name: { ar: 'المالية', en: 'Finance' }, branchId: branchAId });
    expect(dept.status).toBe(201);
    const deptId = (dept.body as { data: { id: string } }).data.id;

    const mkScopedUser = async (
      email: string,
      departmentId: string | null,
    ): Promise<{ id: string; activationToken: string }> => {
      const res = await request(app)
        .post('/api/v1/platform/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email,
          firstName: { ar: 'م', en: 'U' },
          lastName: { ar: 'م', en: 'U' },
          organization: { branchId: branchAId, departmentId, sectionId: null, jobTitleId: null },
        });
      expect(res.status).toBe(201);
      return (res.body as { data: { id: string; activationToken: string } }).data;
    };
    const dan = await mkScopedUser('dan@ecms.local', deptId);
    await mkScopedUser('dina@ecms.local', deptId);
    await mkScopedUser('evan@ecms.local', null); // same branch, no department

    const role = await request(app)
      .post('/api/v1/platform/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: { ar: 'مشاهد الإدارة', en: 'Dept Viewer' }, permissionKeys: ['user.view'] });
    const roleId = (role.body as { data: { id: string } }).data.id;
    const assignment = await request(app)
      .post('/api/v1/platform/role-assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: dan.id, roleId, scope: 'department' });
    expect(assignment.status).toBe(201);
    // The hierarchical scope resolved to Dan's home department.
    expect((assignment.body as { data: { departmentId: string | null } }).data.departmentId).toBe(deptId);

    await request(app).post('/api/v1/auth/activate').send({ token: dan.activationToken, password: PASSWORD });
    const login = await doLogin('dan@ecms.local', PASSWORD);
    expect(login.status).toBe(200);
    expect(login.body.data?.me?.permissions['user.view']).toBe('department');
    const danToken = login.body.data?.accessToken ?? '';

    const list = await request(app).get('/api/v1/platform/users').set('Authorization', `Bearer ${danToken}`);
    expect(list.status).toBe(200);
    const emails = (list.body as { data: { email: string }[] }).data.map((u) => u.email);
    expect(emails).toContain('dan@ecms.local');
    expect(emails).toContain('dina@ecms.local');
    expect(emails).not.toContain('evan@ecms.local'); // same branch, different (no) department
    expect(emails).not.toContain('carol@ecms.local'); // branch B
    expect(emails).not.toContain('admin@ecms.local'); // no department
  });

  it('job titles are an enriched org-wide catalog (grade required; salary band coherent)', async () => {
    // Full create with every enriched field — the title carries the role definition, not a location.
    const created = await request(app)
      .post('/api/v1/platform/job-titles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: 'JT-CASH-OFFICER',
        name: { ar: 'أمين خزينة', en: 'Cash Officer' },
        jobGrade: 'G5',
        description: { ar: 'مسؤول عن العهدة النقدية', en: 'Responsible for cash custody' },
        salaryMin: 6000,
        salaryMax: 9000,
        requiredQualifications: { ar: 'بكالوريوس تجارة', en: 'B.Sc. Commerce' },
        requiredExperienceYears: 2,
      });
    expect(created.status).toBe(201);
    const jt = (created.body as { data: JobTitleDto }).data;
    expect(jt.jobGrade).toBe('G5');
    expect(jt.salaryMin).toBe(6000);
    expect(jt.salaryMax).toBe(9000);
    expect(jt.requiredExperienceYears).toBe(2);
    expect(jt.description?.en).toBe('Responsible for cash custody');
    const jobTitleId = jt.id;

    // jobGrade is the only required rich field (schema validation → 400).
    const noGrade = await request(app)
      .post('/api/v1/platform/job-titles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'JT-NOGRADE', name: { ar: 'س', en: 'X' } });
    expect(noGrade.status).toBe(400);

    // Salary band must be coherent on create (schema refine → 400).
    const badBand = await request(app)
      .post('/api/v1/platform/job-titles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: 'JT-BADBAND',
        name: { ar: 'س', en: 'X' },
        jobGrade: 'G1',
        salaryMin: 9000,
        salaryMax: 6000,
      });
    expect(badBand.status).toBe(400);

    // Minimal create (grade only) is allowed — everything else is optional (Talent-Pool friendly).
    const minimal = await request(app)
      .post('/api/v1/platform/job-titles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'JT-MIN', name: { ar: 'بسيط', en: 'Minimal' }, jobGrade: 'G1' });
    expect(minimal.status).toBe(201);
    const min = (minimal.body as { data: JobTitleDto }).data;
    expect(min.salaryMin).toBeNull();
    expect(min.description).toBeNull();
    expect(min.requiredExperienceYears).toBeNull();

    // Merged-state salary check: lowering max below the *stored* min is rejected as a business rule.
    const incoherent = await request(app)
      .patch(`/api/v1/platform/job-titles/${jobTitleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: jt.version, salaryMax: 5000 });
    expect(incoherent.status).toBe(422);
    expect((incoherent.body as { error: { code: string } }).error.code).toBe(
      'BUSINESS_RULE_VIOLATION',
    );

    // A coherent enrich-update succeeds and bumps the version.
    const updated = await request(app)
      .patch(`/api/v1/platform/job-titles/${jobTitleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: jt.version, jobGrade: 'G6', salaryMin: 6500, requiredExperienceYears: 3 });
    expect(updated.status).toBe(200);
    const after = (updated.body as { data: JobTitleDto }).data;
    expect(after.jobGrade).toBe('G6');
    expect(after.salaryMin).toBe(6500);
    expect(after.requiredExperienceYears).toBe(3);
    expect(after.version).toBe(jt.version + 1);

    // Free-text search still hits the code/name.
    const search = await request(app)
      .get('/api/v1/platform/job-titles')
      .query({ search: 'Cash' })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(search.status).toBe(200);
    const rows = (search.body as { data: JobTitleDto[] }).data;
    expect(rows.some((r) => r.code === 'JT-CASH-OFFICER')).toBe(true);
  });

  it('expires time-bound role assignments at computation time (Review R14)', async () => {
    const role = await rbacService.createRole(
      { name: { ar: 'مؤقت', en: 'Temporary' }, permissionKeys: ['auditLog.view'] },
      adminId,
    );
    // Grant valid only in the PAST.
    const { user } = await userService.create(
      {
        email: 'temp@ecms.local',
        firstName: { ar: 'م', en: 'T' },
        lastName: { ar: 'م', en: 'T' },
        locale: 'en',
        organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
      },
      adminId,
    );
    const tempId = String(user._id);
    await rbacService.assignRole(
      {
        userId: tempId,
        roleId: String(role._id),
        scope: 'organization',
        validFrom: new Date(Date.now() - 2 * 86_400_000),
        validTo: new Date(Date.now() - 86_400_000),
      },
      adminId,
    );
    const expired = await rbacService.getEffectivePermissions(tempId, 99);
    expect(expired.permissions['auditLog.view']).toBeUndefined();

    // A future-window grant is also not yet effective.
    await rbacService
      .assignRole(
        {
          userId: tempId,
          roleId: String(role._id),
          scope: 'branch' as const,
          validFrom: new Date(Date.now() + 86_400_000),
        },
        adminId,
      )
      .catch(() => undefined); // branch scope requires home branch — expected rejection
    const future = await rbacService.getEffectivePermissions(tempId, 100);
    expect(Object.keys(future.permissions)).toHaveLength(0);
  });
});

describe('refresh rotation with reuse detection (ADR-006)', () => {
  it('rotates the refresh token and revokes the family on replay', async () => {
    const login = await doLogin('admin@ecms.local', PASSWORD);
    expect(login.cookie).not.toBeNull();
    const firstCookie = (login.cookie ?? '').split(';')[0] ?? '';

    // Legitimate refresh: new cookie issued.
    const refresh1 = await request(app).post('/api/v1/auth/refresh').set('Cookie', firstCookie);
    expect(refresh1.status).toBe(200);
    const rotated = [refresh1.headers['set-cookie']]
      .flat()
      .find((c) => typeof c === 'string' && c.startsWith('ecms_refresh='));
    const secondCookie = (rotated ?? '').split(';')[0] ?? '';
    expect(secondCookie).not.toBe(firstCookie);

    // Replaying the OLD token proves theft → whole family revoked.
    const replay = await request(app).post('/api/v1/auth/refresh').set('Cookie', firstCookie);
    expect(replay.status).toBe(401);
    expect((replay.body as { error: { code: string } }).error.code).toBe('AUTH_SESSION_REVOKED');

    // The rotated (newest) token is dead too.
    const afterRevoke = await request(app).post('/api/v1/auth/refresh').set('Cookie', secondCookie);
    expect(afterRevoke.status).toBe(401);
  });
});

describe('account lockout (settings-driven policy)', () => {
  it('locks the account after repeated failures', async () => {
    // Fresh victim account so other tests keep their sessions.
    const { user } = await userService.create(
      {
        email: 'victim@ecms.local',
        firstName: { ar: 'ض', en: 'V' },
        lastName: { ar: 'ض', en: 'V' },
        locale: 'en',
        organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
      },
      adminId,
    );
    await userService.setPassword(String(user._id), PASSWORD, 'passwordReset');
    await userService.forceActivate(String(user._id));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await doLogin('victim@ecms.local', 'Wrong#Pass1x');
      expect(failed.status).toBe(401);
      await getCache().delByPrefix('rl:');
    }
    const locked = await doLogin('victim@ecms.local', PASSWORD);
    expect(locked.status).toBe(401);
    expect(locked.body.error?.code).toBe('AUTH_ACCOUNT_LOCKED');
  });
});

describe('TOTP 2FA enforced for privileged accounts (Review R13)', () => {
  it('forces enrollment at login, completes it, then requires the code on the next login', async () => {
    await setTotpEnforcement(true);

    // 1. Privileged login → enrollment challenge (no tokens yet).
    const first = await doLogin('admin@ecms.local', PASSWORD);
    expect(first.status).toBe(200);
    expect(first.body.data?.totpRequired).toBe(true);
    expect(first.body.data?.enrollmentRequired).toBe(true);
    expect(first.cookie).toBeNull();
    const enrollToken = first.body.data?.challengeToken ?? '';

    // 2. Fetch the secret via the enrollment challenge.
    const enrollment = await request(app)
      .post('/api/v1/auth/totp/enroll-challenge')
      .send({ challengeToken: enrollToken });
    expect(enrollment.status).toBe(200);
    const secret = (enrollment.body as { data: { secret: string } }).data.secret;

    // 3. Verify with a live code → login completes, backup codes issued once.
    const verify = await request(app)
      .post('/api/v1/auth/totp/challenge')
      .send({ challengeToken: enrollToken, code: authenticator.generate(secret) });
    expect(verify.status).toBe(200);
    const verifyData = (
      verify.body as {
        data: { totpRequired: boolean; accessToken: string; backupCodes: string[] };
      }
    ).data;
    expect(verifyData.totpRequired).toBe(false);
    expect(verifyData.backupCodes).toHaveLength(10);

    // 4. Next login: enrolled → code required (no enrollment).
    const second = await doLogin('admin@ecms.local', PASSWORD);
    expect(second.body.data?.totpRequired).toBe(true);
    expect(second.body.data?.enrollmentRequired).toBe(false);
    const challenge = second.body.data?.challengeToken ?? '';

    const badCode = await request(app)
      .post('/api/v1/auth/totp/challenge')
      .send({ challengeToken: challenge, code: '000000' });
    expect(badCode.status).toBe(401);

    const goodCode = await request(app)
      .post('/api/v1/auth/totp/challenge')
      .send({ challengeToken: challenge, code: authenticator.generate(secret) });
    expect(goodCode.status).toBe(200);

    // 5. Backup codes are single-use.
    const third = await doLogin('admin@ecms.local', PASSWORD);
    const backupChallenge = third.body.data?.challengeToken ?? '';
    const backupCode = verifyData.backupCodes[0] ?? '';
    const backupOk = await request(app)
      .post('/api/v1/auth/totp/challenge')
      .send({ challengeToken: backupChallenge, code: backupCode });
    expect(backupOk.status).toBe(200);

    const fourth = await doLogin('admin@ecms.local', PASSWORD);
    const reuseChallenge = fourth.body.data?.challengeToken ?? '';
    const backupReuse = await request(app)
      .post('/api/v1/auth/totp/challenge')
      .send({ challengeToken: reuseChallenge, code: backupCode });
    expect(backupReuse.status).toBe(401);

    await setTotpEnforcement(false);
  });
});

describe('rate limiting (API Standards §9)', () => {
  it('throttles repeated login attempts per IP', async () => {
    let lastStatus = 200;
    for (let i = 0; i < 12; i += 1) {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@ecms.local', password: 'Wrong#Pass1x' });
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });
});
