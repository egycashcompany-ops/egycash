// Auth & Employee Account Lifecycle suite (frozen design docs/12-planning/
// auth-account-lifecycle-design.md, Revision 2). Covers what the adapted employee/leave
// suites don't: random temp provisioning with per-channel delivery outcomes (§12 R1/R3),
// temp-password expiry + admin re-issue (R10), the no-password-in-any-API rule (R11),
// TOTP force-on (D6), username change with permanent employee-code login, email-optional
// accounts, backfill idempotency (D2), and legacy-user non-impact.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
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
import { UserModel } from '../../src/platform/users/user.model';
import { notificationTemplateRepository } from '../../src/platform/notifications/notification-template.repository';
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
  over: { nationalId?: string | null; email?: string } = {},
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
        contact: {
          primaryPhone: nextPhone(),
          ...(over.email === undefined ? {} : { email: over.email }),
        },
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

/** The next temp password is DELIVERED, never echoed (§12 R11) — capture it at the source. */
const captureTemp = (): MockInstance<(length?: number) => string> =>
  vi.spyOn(userService, 'generateTempPassword');
const lastTemp = (spy: { mock: { results: { type: string; value: unknown }[] } }): string => {
  const result = spy.mock.results[spy.mock.results.length - 1];
  if (result === undefined || result.type !== 'return') throw new Error('no temp generated');
  return result.value as string;
};

interface ProvisionShape {
  provisionedLogin: {
    username: string;
    delivery: { channel: string; ok: boolean; detail: string | null }[];
  } | null;
}

describe('auto-provisioning (D1 + §12 R1/R3)', () => {
  it('provisions at creation: username = code, random temp, delivery attempted, gate armed, ESS granted', async () => {
    const spy = captureTemp();
    const emp = await regEmployee({});
    const temp = lastTemp(spy);
    spy.mockRestore();

    expect(emp.userId).not.toBeNull();
    const provision = (emp as EmployeeDto & ProvisionShape).provisionedLogin;
    expect(provision?.username).toBe(emp.code);
    // The response reports per-channel outcomes — never the password (§12 R11).
    expect(provision).not.toHaveProperty('temporaryPassword');
    const channels = (provision?.delivery ?? []).map((d) => d.channel).sort();
    expect(channels).toEqual(['email', 'whatsapp']);
    // Hermetic CI: the whatsapp transport is disabled and the fixture has no email.
    expect(provision?.delivery.every((d) => !d.ok)).toBe(true);

    // The generated temp is strong and never a public identifier (R1).
    expect(temp.length).toBeGreaterThanOrEqual(12);
    expect(temp).not.toBe(emp.code);

    // First sign-in with employee code + the delivered temp → gated.
    const gated = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: temp });
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
      .send({ currentPassword: temp, newPassword: PASSWORD });
    expect(changed.status).toBe(204);
    const unlocked = await request(app)
      .get('/api/v1/hr/leave-requests?page=1&pageSize=10')
      .set('Authorization', `Bearer ${body.accessToken}`);
    expect(unlocked.status).toBe(200);
  });

  it('a correct but EXPIRED temp password is refused; a re-issue restores access (§12 R10)', async () => {
    const spy = captureTemp();
    const emp = await regEmployee({});
    const expired = lastTemp(spy);

    await UserModel.updateOne(
      { _id: emp.userId },
      { $set: { 'security.tempPasswordExpiresAt': new Date(Date.now() - 60_000) } },
    ).exec();
    const refused = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: expired });
    expect(refused.status).toBe(401);
    expect((refused.body as { error: { code: string } }).error.code).toBe('AUTH_TEMP_PASSWORD_EXPIRED');

    // Admin re-issue: new random temp, new window, previous temp instantly invalid.
    const reissue = await request(app)
      .post(`/api/v1/platform/users/${String(emp.userId)}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(reissue.status).toBe(200);
    const fresh = lastTemp(spy);
    spy.mockRestore();
    expect(fresh).not.toBe(expired);

    const oldTemp = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: expired });
    expect(oldTemp.status).toBe(401);
    const gated = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: fresh });
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

describe('password management (§12 R6)', () => {
  it('admin reset: fresh random temp delivered, sessions revoked, gate re-armed, nothing echoed', async () => {
    const spy = captureTemp();
    const emp = await regEmployee({});
    const temp = lastTemp(spy);
    const userId = String(emp.userId);

    // establish a real session first (temp + forced change)
    const gated = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: temp });
    const token = (gated.body.data as { accessToken: string }).accessToken;
    await request(app)
      .post('/api/v1/auth/password/change')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: temp, newPassword: PASSWORD });

    const reset = await request(app)
      .post(`/api/v1/platform/users/${userId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(reset.status).toBe(200);
    const resetBody = reset.body.data as {
      delivery: { channel: string; ok: boolean }[];
    } & Record<string, unknown>;
    // Delivery outcomes only — the password NEVER appears in any API response (R11).
    expect(resetBody.temporaryPassword).toBeUndefined();
    expect(resetBody.delivery.map((d) => d.channel).sort()).toEqual(['email', 'whatsapp']);
    const reissued = lastTemp(spy);
    spy.mockRestore();

    const revoked = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(revoked.status).toBe(401);

    // The replaced password is dead; the delivered one signs in gated.
    const stale = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: PASSWORD });
    expect(stale.status).toBe(401);
    const relogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: reissued });
    expect(relogin.status).toBe(200);
    expect((relogin.body.data as { mustChangePassword: boolean }).mustChangePassword).toBe(true);
  });

  it('resend re-delivers to a gated account without reset side effects (§13 R13/R14)', async () => {
    const spy = captureTemp();
    const emp = await regEmployee({});
    const userId = String(emp.userId);
    const before = await UserModel.findById(userId).exec();
    const window = before?.security.tempPasswordExpiresAt ?? null;
    expect(window).not.toBeNull();

    const resend = await request(app)
      .post(`/api/v1/platform/users/${userId}/credentials/resend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(resend.status).toBe(200);
    expect((resend.body.data as { delivery: unknown[] }).delivery).toHaveLength(2);
    const fresh = lastTemp(spy);
    spy.mockRestore();

    // The still-valid window is PRESERVED — regenerate-only-when-necessary (R14).
    const after = await UserModel.findById(userId).exec();
    expect(after?.security.tempPasswordExpiresAt?.getTime()).toBe(window?.getTime());

    const gated = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: fresh });
    expect(gated.status).toBe(200);
    const gatedBody = gated.body.data as { accessToken: string; mustChangePassword: boolean };
    expect(gatedBody.mustChangePassword).toBe(true);

    // Once the user owns their password, resend refuses — that is a reset (R6).
    await request(app)
      .post('/api/v1/auth/password/change')
      .set('Authorization', `Bearer ${gatedBody.accessToken}`)
      .send({ currentPassword: fresh, newPassword: PASSWORD });
    const refused = await request(app)
      .post(`/api/v1/platform/users/${userId}/credentials/resend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(refused.status).toBe(422);
  });

  it('channels are independent: email alone delivers when WhatsApp is unavailable (§13 R16)', async () => {
    const emp = await regEmployee({ email: `ess-${String(Date.now())}@ecms.local` });
    const provision = (emp as EmployeeDto & ProvisionShape).provisionedLogin;
    const byChannel = new Map((provision?.delivery ?? []).map((d) => [d.channel, d]));
    expect(byChannel.get('whatsapp')?.ok).toBe(false); // transport disabled in CI
    expect(byChannel.get('email')?.ok).toBe(true); // email alone suffices — no dual-channel dependency
  });

  it('the credential message template is seeded and admin-editable (§13 R15)', async () => {
    const template = await notificationTemplateRepository.findLatestByKey(
      'platform.credentialsDelivery',
    );
    expect(template).not.toBeNull();
    expect(template?.body.en).toContain('{{temporaryPassword}}');
    expect(template?.variables).toContain('loginUrl');
  });
});

describe('username management + identifiers (4.3/4.3b)', () => {
  it('an admin-changed username works, and the employee CODE still logs in', async () => {
    const spy = captureTemp();
    const emp = await regEmployee({});
    const temp = lastTemp(spy);
    spy.mockRestore();
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
      .send({ identifier: `renamed-${emp.code}`, password: temp });
    expect(byNewUsername.status).toBe(200);

    // The printed employee code resolves through the HR seam — it can never break.
    const byCode = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: temp });
    expect(byCode.status).toBe(200);
  });
});

describe('TOTP administration (D6/4.5)', () => {
  it('force-on demands enrollment at the next login; force-off releases it', async () => {
    const spy = captureTemp();
    const emp = await regEmployee({});
    const temp = lastTemp(spy);
    spy.mockRestore();
    const userId = String(emp.userId);

    const forceOn = await request(app)
      .post(`/api/v1/platform/users/${userId}/totp/require`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ required: true });
    expect(forceOn.status).toBe(204);

    const challenge = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: temp });
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
      .send({ identifier: emp.code, password: temp });
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
