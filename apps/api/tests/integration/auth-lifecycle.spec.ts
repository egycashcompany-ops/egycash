// Auth & Employee Account Lifecycle suite (frozen design docs/12-planning/
// auth-account-lifecycle-design.md). Covers what the adapted employee/leave suites don't:
// the NID temp-password path, the no-NID one-time password (D3), the policy-based admin
// reset, TOTP force-on (D6), username change with permanent employee-code login,
// email-optional accounts, backfill idempotency (D2), and legacy-user non-impact.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { platformPermissions, SettingKeys, type EmployeeDto, type UserDto } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { employeeService } from '../../src/modules/hr/employee-management/employees/employee.service';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId: string;
let adminToken: string;
let BRANCH_ID = '';
let DEPARTMENT_ID = '';
let JOB_TITLE_ID = '';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-authlc-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

// Structurally-valid Egyptian NID: century 2 + 1990-01-01 + Cairo + unique serial.
let nidSeq = 20_000;
const nextNid = (): string => `290010101${String((nidSeq += 1)).padStart(5, '0')}`;
let phoneSeq = 7000;
const nextPhone = (): string => `010123${String((phoneSeq += 1)).padStart(5, '0')}`;

const regEmployee = async (
  over: { nationalId?: string | null } = {},
): Promise<EmployeeDto> => {
  const nationalId = over.nationalId === undefined ? nextNid() : over.nationalId;
  const res = await request(app)
    .post('/api/v1/hr/employees/direct')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      personal: {
        identity: {
          fullNameAr: 'موظف الحسابات',
          ...(nationalId === null ? {} : { nationalId }),
          nationality: 'Egyptian',
        },
        contact: { primaryPhone: nextPhone() },
        experience: [],
        drivingLicenses: [],
        certifications: [],
        references: [],
      },
      employment: {
        jobTitleId: JOB_TITLE_ID,
        departmentId: DEPARTMENT_ID,
        branchId: BRANCH_ID,
        employmentType: 'fullTime',
        probationMonths: 3,
        startDate: '2024-01-01T00:00:00.000Z',
      },
      hiringDate: '2024-01-01T00:00:00.000Z',
    });
  expect(res.status).toBe(201);
  return res.body.data as EmployeeDto;
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  const { user } = await userService.create(
    {
      email: 'admin@ecms.local',
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  adminId = String(user._id);
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

  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ identifier: 'admin@ecms.local', password: PASSWORD });
  expect(login.status).toBe(200);
  adminToken = (login.body.data as { accessToken: string }).accessToken;
  // The admin is a LEGACY-style account: the gate must never fire for it.
  expect((login.body.data as { mustChangePassword: boolean }).mustChangePassword).toBe(false);

  const branch = await request(app)
    .post('/api/v1/platform/branches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: '001', name: { ar: 'الرئيسي', en: 'HQ' } });
  expect(branch.status).toBe(201);
  BRANCH_ID = (branch.body.data as { id: string }).id;
  const dept = await request(app)
    .post('/api/v1/platform/departments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'OPS', name: { ar: 'العمليات', en: 'Operations' }, branchId: BRANCH_ID });
  expect(dept.status).toBe(201);
  DEPARTMENT_ID = (dept.body.data as { id: string }).id;
  const title = await request(app)
    .post('/api/v1/platform/job-titles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'CASHIER', name: { ar: 'صراف', en: 'Cashier' }, jobGrade: 'G3' });
  expect(title.status).toBe(201);
  JOB_TITLE_ID = (title.body.data as { id: string }).id;
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  await getCache().close();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

describe('auto-provisioning (D1/D3)', () => {
  it('NID employees: username = code, temp password = NID, gate armed, ESS granted', async () => {
    const nid = nextNid();
    const emp = await regEmployee({ nationalId: nid });
    expect(emp.userId).not.toBeNull();
    expect((emp as EmployeeDto & { provisionedLogin: unknown }).provisionedLogin).toEqual({
      username: emp.code,
      temporaryPassword: null, // NID path — nothing to show, HR already knows it (D3)
    });

    // First sign-in with employee code + NID → gated.
    const gated = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: nid });
    expect(gated.status).toBe(200);
    const body = gated.body.data as { accessToken: string; mustChangePassword: boolean };
    expect(body.mustChangePassword).toBe(true);

    // Gate lets `me` through but blocks everything else.
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`);
    expect(me.status).toBe(200);
    expect((me.body.data as { mustChangePassword: boolean }).mustChangePassword).toBe(true);
    const blocked = await request(app)
      .get('/api/v1/hr/leave-requests?page=1&pageSize=10')
      .set('Authorization', `Bearer ${body.accessToken}`);
    expect(blocked.status).toBe(403);
    expect((blocked.body as { error: { code: string } }).error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    // Forced change clears the gate; the ESS role arrived at link time (leave.view own).
    const changed = await request(app)
      .post('/api/v1/auth/password/change')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .send({ currentPassword: nid, newPassword: PASSWORD });
    expect(changed.status).toBe(204);
    const unlocked = await request(app)
      .get('/api/v1/hr/leave-requests?page=1&pageSize=10')
      .set('Authorization', `Bearer ${body.accessToken}`);
    expect(unlocked.status).toBe(200);
  });

  it('no-NID employees: a strong one-time password is returned exactly once (D3)', async () => {
    const emp = await regEmployee({ nationalId: null });
    const provision = (emp as EmployeeDto & {
      provisionedLogin: { username: string; temporaryPassword: string | null } | null;
    }).provisionedLogin;
    expect(provision).not.toBeNull();
    expect(provision?.temporaryPassword).not.toBeNull();
    const oneTime = String(provision?.temporaryPassword);
    expect(oneTime.length).toBeGreaterThanOrEqual(12);
    // The employee code is NEVER the password (D3 amendment).
    expect(oneTime).not.toBe(emp.code);

    const gated = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: oneTime });
    expect(gated.status).toBe(200);
    expect((gated.body.data as { mustChangePassword: boolean }).mustChangePassword).toBe(true);
  });

  it('provisioning + backfill are idempotent (D2): a re-run creates nothing', async () => {
    const before = await userService.list(
      { page: 1, pageSize: 1, sortDir: 'desc' },
      { scope: 'organization', userId: adminId, branchId: null, departmentId: null, sectionId: null },
    );
    const provisioned = await employeeService.provisionMissingLogins();
    expect(provisioned).toBe(0); // everyone employed already has an account
    const after = await userService.list(
      { page: 1, pageSize: 1, sortDir: 'desc' },
      { scope: 'organization', userId: adminId, branchId: null, departmentId: null, sectionId: null },
    );
    expect(after.meta.totalItems).toBe(before.meta.totalItems);
  });
});

describe('password management (4.4)', () => {
  it('policy reset without a body derives the NID temp password and revokes sessions', async () => {
    const nid = nextNid();
    const emp = await regEmployee({ nationalId: nid });
    const userId = String(emp.userId);

    // establish a real session first (via NID + change)
    const gated = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: nid });
    const token = (gated.body.data as { accessToken: string }).accessToken;
    await request(app)
      .post('/api/v1/auth/password/change')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: nid, newPassword: PASSWORD });

    // POLICY reset (empty body): NID again, nothing echoed, gate re-armed, session dead.
    const reset = await request(app)
      .post(`/api/v1/platform/users/${userId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(reset.status).toBe(200);
    expect((reset.body.data as { temporaryPassword: string | null }).temporaryPassword).toBeNull();

    const revoked = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(revoked.status).toBe(401);

    const relogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: nid });
    expect(relogin.status).toBe(200);
    expect((relogin.body.data as { mustChangePassword: boolean }).mustChangePassword).toBe(true);
  });

  it('policy reset for an employee WITHOUT a NID returns a one-time password', async () => {
    const emp = await regEmployee({ nationalId: null });
    const reset = await request(app)
      .post(`/api/v1/platform/users/${String(emp.userId)}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(reset.status).toBe(200);
    const temp = (reset.body.data as { temporaryPassword: string | null }).temporaryPassword;
    expect(temp).not.toBeNull();
    const gated = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: String(temp) });
    expect(gated.status).toBe(200);
  });
});

describe('username management + identifiers (4.3/4.3b)', () => {
  it('an admin-changed username works, and the employee CODE still logs in', async () => {
    const nid = nextNid();
    const emp = await regEmployee({ nationalId: nid });
    const userId = String(emp.userId);
    const userRes = await request(app)
      .get(`/api/v1/platform/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const version = (userRes.body.data as UserDto).version;

    const renamed = await request(app)
      .patch(`/api/v1/platform/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: `renamed-${emp.code}`, version });
    expect(renamed.status).toBe(200);

    const byNewUsername = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: `renamed-${emp.code}`, password: nid });
    expect(byNewUsername.status).toBe(200);

    // The printed employee code resolves through the HR seam — it can never break.
    const byCode = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: nid });
    expect(byCode.status).toBe(200);
  });
});

describe('TOTP administration (D6/4.5)', () => {
  it('force-on demands enrollment at the next login; force-off releases it', async () => {
    const nid = nextNid();
    const emp = await regEmployee({ nationalId: nid });
    const userId = String(emp.userId);

    const forceOn = await request(app)
      .post(`/api/v1/platform/users/${userId}/totp/require`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ required: true });
    expect(forceOn.status).toBe(204);

    const challenge = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: nid });
    expect(challenge.status).toBe(200);
    const body = challenge.body.data as { totpRequired: boolean; enrollmentRequired?: boolean };
    expect(body.totpRequired).toBe(true);
    expect(body.enrollmentRequired).toBe(true);

    const forceOff = await request(app)
      .post(`/api/v1/platform/users/${userId}/totp/require`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ required: false });
    expect(forceOff.status).toBe(204);
    const plain = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: nid });
    expect((plain.body.data as { totpRequired: boolean }).totpRequired).toBe(false);
  });
});

describe('backward compatibility', () => {
  it('email-only platform accounts are untouched: no gate, email login, invite flow intact', async () => {
    const { user, activationToken } = await userService.create(
      {
        email: 'legacy@ecms.local',
        firstName: { ar: 'ق', en: 'L' },
        lastName: { ar: 'د', en: 'U' },
        locale: 'en',
        organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
      },
      adminId,
    );
    const activated = await request(app)
      .post('/api/v1/auth/activate')
      .send({ token: activationToken, password: PASSWORD });
    expect(activated.status).toBe(204);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'legacy@ecms.local', password: PASSWORD });
    expect(login.status).toBe(200);
    expect((login.body.data as { mustChangePassword: boolean }).mustChangePassword).toBe(false);
    void user;
  });

  it('users can be created WITHOUT an email (optional per §3)', async () => {
    const created = await userService.create(
      {
        firstName: { ar: 'ب', en: 'N' },
        lastName: { ar: 'ب', en: 'E' },
        locale: 'en',
        organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
      },
      adminId,
      { username: 'no-email-user' },
    );
    expect(created.user.email).toBeNull();
    expect(created.user.username).toBe('no-email-user');
  });
});
