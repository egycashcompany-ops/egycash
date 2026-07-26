// Auth & Employee Account Lifecycle suite (frozen design docs/12-planning/
// auth-account-lifecycle-design.md, Revisions 4–6). Covers what the adapted employee/leave
// suites don't: activation-link provisioning with per-channel delivery outcomes (§14),
// one-time/expiring links + admin reset and resend semantics, the no-credential-in-any-API
// rule (R11/R12), the §15 hardening (dedicated not-activated error, derived accountStatus,
// exit/disable link revocation, invitation audit trail + expiry sweep), the §16 enterprise
// invariants (session policy, panel fields, enumeration parity), TOTP force-on (D6),
// username change with permanent employee-code login, email-optional accounts, backfill
// idempotency (D2), and legacy-user non-impact.
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

/** The setup token is DELIVERED, never echoed (§12 R11/§14) — capture it at the source. */
const captureToken = (): MockInstance<() => string> =>
  vi.spyOn(userService, 'generateActivationToken');
const lastToken = (spy: { mock: { results: { type: string; value: unknown }[] } }): string => {
  const result = spy.mock.results[spy.mock.results.length - 1];
  if (result === undefined || result.type !== 'return') throw new Error('no token generated');
  return result.value as string;
};

/** Complete the setup link: the employee chooses their own password (§14). */
const activate = (token: string, password: string = PASSWORD) =>
  request(app).post('/api/v1/auth/activate').send({ token, password });

interface ProvisionShape {
  provisionedLogin: {
    username: string;
    delivery: { channel: string; ok: boolean; detail: string | null }[];
  } | null;
}

describe('auto-provisioning (D1 + §14)', () => {
  it('provisions at creation: username = code, setup link delivered, employee activates and signs in', async () => {
    const spy = captureToken();
    const emp = await regEmployee({});
    const token = lastToken(spy);
    spy.mockRestore();

    expect(emp.userId).not.toBeNull();
    const provision = (emp as EmployeeDto & ProvisionShape).provisionedLogin;
    expect(provision?.username).toBe(emp.code);
    // The response reports per-channel outcomes — never a credential (§12 R11/§14).
    expect(provision).not.toHaveProperty('temporaryPassword');
    const channels = (provision?.delivery ?? []).map((d) => d.channel).sort();
    expect(channels).toEqual(['email', 'whatsapp']);
    // Hermetic CI: the whatsapp transport is disabled and the fixture has no email.
    expect(provision?.delivery.every((d) => !d.ok)).toBe(true);

    // Born INVITED — no password exists, so no password can sign in (§14.1).
    const account = await request(app)
      .get(`/api/v1/platform/users/${String(emp.userId)}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const accountBody = account.body.data as UserDto;
    expect(accountBody.status).toBe('invited');
    expect(accountBody.setupLinkPending).toBe(true);
    expect(accountBody.accountStatus).toBe('invitationSent'); // §15.4
    expect(accountBody.mustChangePassword).toBe(false); // the gate is dormant (§14.2)
    const early = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: PASSWORD });
    expect(early.status).toBe(401);
    // §15.3 — the DEDICATED code: the web can point the employee at their setup link.
    expect((early.body as { error: { code: string } }).error.code).toBe(
      'AUTH_ACCOUNT_NOT_ACTIVATED',
    );

    // The employee opens the link and chooses their OWN policy-checked password. A weak one
    // (passes the transport schema, fails the settings-driven policy) must NOT burn the token.
    const weak = await activate(token, 'weakpass');
    expect(weak.status).toBe(422);
    expect((weak.body as { error: { code: string } }).error.code).toBe('AUTH_PASSWORD_POLICY');
    expect((await activate(token)).status).toBe(204);

    // Sign in by employee code — no forced change; ESS arrived at link time (leave.view own).
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: PASSWORD });
    expect(login.status).toBe(200);
    const body = login.body.data as { accessToken: string; mustChangePassword: boolean };
    expect(body.mustChangePassword).toBe(false);
    const leave = await request(app)
      .get('/api/v1/hr/leave-requests?page=1&pageSize=10')
      .set('Authorization', `Bearer ${body.accessToken}`);
    expect(leave.status).toBe(200);

    // The link is ONE-TIME: a second use is refused.
    expect((await activate(token, `${PASSWORD}9`)).status).toBe(422);
  });

  it('an EXPIRED link is refused; an admin reset issues a fresh one (§14.5)', async () => {
    const spy = captureToken();
    const emp = await regEmployee({});
    const stale = lastToken(spy);

    await UserModel.updateOne(
      { _id: emp.userId },
      { $set: { 'activation.expiresAt': new Date(Date.now() - 60_000) } },
    ).exec();
    const refused = await activate(stale);
    expect(refused.status).toBe(422);
    expect((refused.body as { error: { code: string } }).error.code).toBe(
      'AUTH_ACTIVATION_TOKEN_INVALID',
    );
    // §15.4 — admins see the dead link as "expired".
    const expiredView = await request(app)
      .get(`/api/v1/platform/users/${String(emp.userId)}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect((expiredView.body.data as UserDto).accountStatus).toBe('expired');

    // Admin reset: fresh token + fresh window; the stale link stays dead.
    const reissue = await request(app)
      .post(`/api/v1/platform/users/${String(emp.userId)}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(reissue.status).toBe(200);
    const fresh = lastToken(spy);
    spy.mockRestore();
    expect(fresh).not.toBe(stale);

    expect((await activate(stale)).status).toBe(422);
    expect((await activate(fresh)).status).toBe(204);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: PASSWORD });
    expect(login.status).toBe(200);
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

describe('password management (§14.3/§14.4)', () => {
  it('admin reset: account locked out, sessions revoked, fresh setup link delivered, nothing echoed', async () => {
    const spy = captureToken();
    const emp = await regEmployee({});
    const first = lastToken(spy);
    const userId = String(emp.userId);

    // establish a real session first (activate + sign in)
    expect((await activate(first)).status).toBe(204);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: PASSWORD });
    const token = (login.body.data as { accessToken: string }).accessToken;

    const reset = await request(app)
      .post(`/api/v1/platform/users/${userId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(reset.status).toBe(200);
    const resetBody = reset.body.data as {
      delivery: { channel: string; ok: boolean }[];
    } & Record<string, unknown>;
    // Delivery outcomes only — no credential EVER appears in any API response (R11).
    expect(resetBody.temporaryPassword).toBeUndefined();
    expect(resetBody.delivery.map((d) => d.channel).sort()).toEqual(['email', 'whatsapp']);
    const reissued = lastToken(spy);
    spy.mockRestore();

    // Locked out: session revoked AND the old password is gone (§14.4).
    const revoked = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(revoked.status).toBe(401);
    const stale = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: PASSWORD });
    expect(stale.status).toBe(401);

    // The fresh link re-establishes the user's OWN password.
    expect((await activate(reissued, `${PASSWORD}9`)).status).toBe(204);
    const relogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: `${PASSWORD}9` });
    expect(relogin.status).toBe(200);
  });

  it('resend issues a new link and invalidates the previous one (§14.3)', async () => {
    const spy = captureToken();
    const emp = await regEmployee({});
    const userId = String(emp.userId);
    const original = lastToken(spy);

    const resend = await request(app)
      .post(`/api/v1/platform/users/${userId}/credentials/resend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(resend.status).toBe(200);
    expect((resend.body.data as { delivery: unknown[] }).delivery).toHaveLength(2);
    const replacement = lastToken(spy);
    spy.mockRestore();
    expect(replacement).not.toBe(original);

    // The approver's rule: the OLD link is instantly dead, the NEW one works.
    expect((await activate(original)).status).toBe(422);
    expect((await activate(replacement)).status).toBe(204);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: PASSWORD });
    expect(login.status).toBe(200);

    // With no link pending (account fully set up), resend refuses — that is a reset.
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
    expect(template?.body.en).toContain('{{setupLink}}');
    expect(template?.variables).toContain('setupLink');
  });
});

describe('username management + identifiers (4.3/4.3b)', () => {
  it('an admin-changed username works, and the employee CODE still logs in', async () => {
    const spy = captureToken();
    const emp = await regEmployee({});
    expect((await activate(lastToken(spy))).status).toBe(204);
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
      .send({ identifier: `renamed-${emp.code}`, password: PASSWORD });
    expect(byNewUsername.status).toBe(200);

    // The printed employee code resolves through the HR seam — it can never break.
    const byCode = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: PASSWORD });
    expect(byCode.status).toBe(200);
  });
});

describe('TOTP administration (D6/4.5)', () => {
  it('force-on demands enrollment at the next login; force-off releases it', async () => {
    const spy = captureToken();
    const emp = await regEmployee({});
    expect((await activate(lastToken(spy))).status).toBe(204);
    spy.mockRestore();
    const userId = String(emp.userId);

    const forceOn = await request(app)
      .post(`/api/v1/platform/users/${userId}/totp/require`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ required: true });
    expect(forceOn.status).toBe(204);

    const challenge = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: PASSWORD });
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
      .send({ identifier: emp.code, password: PASSWORD });
    expect((plain.body.data as { totpRequired: boolean }).totpRequired).toBe(false);
  });
});

const rereadEmp = async (id: string): Promise<EmployeeDto> =>
  (await request(app).get(`/api/v1/hr/employees/${id}`).set('Authorization', `Bearer ${adminToken}`))
    .body.data as EmployeeDto;

const getUser = async (userId: string): Promise<UserDto> =>
  (
    await request(app)
      .get(`/api/v1/platform/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
  ).body.data as UserDto;

const auditActionsOf = async (userId: string): Promise<string[]> => {
  const res = await request(app)
    .get(`/api/v1/platform/audit-logs?entityType=user&entityId=${userId}&pageSize=100`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  return (res.body.data as { action: string }[]).map((entry) => entry.action);
};

describe('activation hardening + enterprise completeness (§15/§16)', () => {
  it('answers login attempts without leaking accounts: unknown identifier ≡ wrong password (§16.6)', async () => {
    const spy = captureToken();
    const emp = await regEmployee({});
    expect((await activate(lastToken(spy))).status).toBe(204);
    spy.mockRestore();

    const unknown = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'no-such-user-xyz', password: PASSWORD });
    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: `${PASSWORD}nope` });
    expect(unknown.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect((unknown.body as { error: { code: string } }).error.code).toBe(
      'AUTH_INVALID_CREDENTIALS',
    );
    expect((wrongPassword.body as { error: { code: string } }).error.code).toBe(
      'AUTH_INVALID_CREDENTIALS',
    );
  });

  it('an employee EXIT kills the never-used setup link and locks the account (§15.5)', async () => {
    const spy = captureToken();
    const emp = await regEmployee({});
    const token = lastToken(spy);
    spy.mockRestore();

    const fresh = await rereadEmp(emp.id);
    const exit = await request(app)
      .post(`/api/v1/hr/employees/${emp.id}/actions/exit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'resignation', eligibleForRehire: true, version: fresh.version });
    expect(exit.status).toBe(201);

    // The invited login was suspended and its pending link revoked in the same operation.
    const account = await getUser(String(emp.userId));
    expect(account.status).toBe('suspended');
    expect(account.accountStatus).toBe('locked');
    expect(account.setupLinkPending).toBe(false);
    expect((await activate(token)).status).toBe(422);
    expect(await auditActionsOf(String(emp.userId))).toContain('invitationRevoked');
  });

  it('the hourly sweep revokes expired links, audits once, and stays idempotent (§15.7)', async () => {
    const spy = captureToken();
    const emp = await regEmployee({});
    const token = lastToken(spy);
    spy.mockRestore();
    const userId = String(emp.userId);

    await UserModel.updateOne(
      { _id: emp.userId },
      { $set: { 'activation.expiresAt': new Date(Date.now() - 60_000) } },
    ).exec();

    expect(await userService.sweepExpiredInvitations()).toBeGreaterThanOrEqual(1);
    const swept = await getUser(userId);
    expect(swept.setupLinkPending).toBe(false); // the stale secret no longer lingers
    expect(swept.accountStatus).toBe('expired');
    expect(swept.invitationSentAt).not.toBeNull(); // §16.1 — metadata survives expiry
    expect(await auditActionsOf(userId)).toContain('invitationExpired');
    expect((await activate(token)).status).toBe(422);
    expect(await userService.sweepExpiredInvitations()).toBe(0); // idempotent

    // After the sweep, resend refuses (nothing pending) — re-issue is an admin RESET.
    const resend = await request(app)
      .post(`/api/v1/platform/users/${userId}/credentials/resend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(resend.status).toBe(422);
    const tokenSpy = captureToken();
    const reset = await request(app)
      .post(`/api/v1/platform/users/${userId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(reset.status).toBe(200);
    expect((await activate(lastToken(tokenSpy))).status).toBe(204);
    tokenSpy.mockRestore();
  });

  it('audits the complete invitation lifecycle (§15.7/§16.1)', async () => {
    const spy = captureToken();
    const emp = await regEmployee({});
    const userId = String(emp.userId);

    // resend (supersedes) → expired ATTEMPT (attributable) → reset → activate (used).
    await request(app)
      .post(`/api/v1/platform/users/${userId}/credentials/resend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    await UserModel.updateOne(
      { _id: emp.userId },
      { $set: { 'activation.expiresAt': new Date(Date.now() - 60_000) } },
    ).exec();
    expect((await activate(lastToken(spy))).status).toBe(422);
    await request(app)
      .post(`/api/v1/platform/users/${userId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect((await activate(lastToken(spy))).status).toBe(204);
    spy.mockRestore();

    const actions = await auditActionsOf(userId);
    for (const expected of [
      'invitationCreated',
      'invitationResent',
      'invitationAttemptInvalid',
      'invitationUsed',
      'firstLogin',
    ]) {
      expect(actions).toContain(expected);
    }
  });

  it('activation never mints a session, and the panel fields fill in (§16.2/§16.5)', async () => {
    const spy = captureToken();
    const emp = await regEmployee({ email: `panel-${String(Date.now())}@ecms.local` });
    const userId = String(emp.userId);

    const before = await getUser(userId);
    expect(before.invitationSentAt).not.toBeNull();
    expect(before.invitationExpiresAt).not.toBeNull();
    expect(before.activatedAt).toBeNull();
    expect(before.lastDelivery?.find((d) => d.channel === 'email')?.ok).toBe(true);

    const activated = await activate(lastToken(spy));
    spy.mockRestore();
    expect(activated.status).toBe(204);
    expect(activated.body).toEqual({}); // §16.2 — no tokens: login is the only session mint
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: PASSWORD });
    expect(login.status).toBe(200);

    const after = await getUser(userId);
    expect(after.accountStatus).toBe('activated');
    expect(after.invitationExpiresAt).toBeNull(); // consumed
    expect(after.invitationSentAt).not.toBeNull(); // §16.1 — history survives consumption
    expect(after.activatedAt).not.toBeNull();
    expect(after.lastLoginAt).not.toBeNull();
    expect(after.passwordChangedAt).not.toBeNull();
  });

  it('activation is MFA-independent: a pre-required TOTP account activates, then enrolls at login (§15.8)', async () => {
    const spy = captureToken();
    const emp = await regEmployee({});
    const userId = String(emp.userId);
    // Admin forces TOTP BEFORE the employee ever activates.
    const forceOn = await request(app)
      .post(`/api/v1/platform/users/${userId}/totp/require`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ required: true });
    expect(forceOn.status).toBe(204);

    expect((await activate(lastToken(spy))).status).toBe(204);
    spy.mockRestore();
    const challenge = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: emp.code, password: PASSWORD });
    expect(challenge.status).toBe(200);
    const body = challenge.body.data as { totpRequired: boolean; enrollmentRequired?: boolean };
    expect(body.totpRequired).toBe(true);
    expect(body.enrollmentRequired).toBe(true);
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
