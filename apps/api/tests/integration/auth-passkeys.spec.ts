// Passkey sign-in over HTTP (ADR-035): the routes, the refresh cookie, the session method, and the
// account lifecycle that removes passkeys. The ceremonies themselves — every refusal — are unit
// tested against the real library in `passkey.service.spec.ts`; this suite proves the wiring with
// the same software authenticator, end to end through Express, Redis-shaped cache and MongoDB.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { authenticator } from 'otplib';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { type Express } from 'express';
import {
  ErrorCodes,
  SettingKeys,
  platformPermissions,
  type PasskeyAuthenticationOptionsDto,
  type PasskeyCreationOptionsDto,
  type PasskeyDto,
  type SessionDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { UserModel } from '../../src/platform/users/user.model';
import { settingsService } from '../../src/platform/settings';
import { userSnapshotKey } from '../../src/platform/auth';
import { PasskeyModel } from '../../src/platform/auth/passkey.model';
import { relyingParty } from '../../src/platform/auth/passkey.service';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';
import { goldPortalAccountService } from '../../src/modules/gold/portal-accounts/portal-account.service';
import { SoftAuthenticator } from './helpers/soft-authenticator';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken = '';
let settingsCtx: AuthContext;
const { origin } = relyingParty();

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-passkeys-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

let accountSeq = 0;
/** An active account with a password; external when a module subject is given. */
const makeAccount = async (external?: {
  moduleId: string;
  subjectType: string;
}): Promise<{ id: string; email: string }> => {
  accountSeq += 1;
  const email = `passkey-${accountSeq}@ecms.local`;
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'P' },
      lastName: { ar: 'ك', en: 'K' },
      locale: 'ar',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  const id = String(user._id);
  await userService.setPassword(id, PASSWORD, 'passwordReset');
  await userService.forceActivate(id);
  if (external !== undefined) {
    await UserModel.updateOne(
      { _id: user._id },
      { $set: { externalSubject: { ...external, subjectId: new Types.ObjectId() } } },
    ).exec();
    await getCache().del(userSnapshotKey(id));
  }
  return { id, email };
};

const passwordLogin = async (email: string) => {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ identifier: email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.data as { totpRequired: boolean; accessToken?: string };
};

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Add a passkey from the Security page: step-up, the device's prompt, verify. */
const addPasskey = async (
  token: string,
  device: SoftAuthenticator,
  proof: { totpCode?: string } = {},
) => {
  const options = await request(app)
    .post('/api/v1/auth/passkeys/registration/options')
    .set(bearer(token))
    .send({ password: PASSWORD, ...proof });
  expect(options.status).toBe(200);
  const created = await request(app)
    .post('/api/v1/auth/passkeys/registration/verify')
    .set(bearer(token))
    .send({ response: device.register(options.body.data as PasskeyCreationOptionsDto, origin) });
  expect(created.status).toBe(201);
  return created.body.data as PasskeyDto;
};

const passkeySignIn = async (device: SoftAuthenticator) => {
  const options = await request(app).post('/api/v1/auth/passkeys/authentication/options').send({});
  expect(options.status).toBe(200);
  const answer = device.authenticate(options.body.data as PasskeyAuthenticationOptionsDto, origin);
  const res = await request(app)
    .post('/api/v1/auth/passkeys/authentication/verify')
    .send({ response: answer });
  return { res, answer };
};

const passkeysOf = (userId: string) =>
  PasskeyModel.countDocuments({ userId: new Types.ObjectId(userId) }).exec();

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    platformPermissions.map((p) => p.key),
  );
  const admin = await makeAccount();
  await rbacService.ensureAssignment(admin.id, String(superAdmin._id), 'organization');
  settingsCtx = {
    userId: admin.id,
    sessionId: 'seed',
    branchId: null,
    departmentId: null,
    sectionId: null,
    locale: 'en',
    permissions: { 'setting.edit': 'organization' },
    permissionVersion: 1,
    isPrivileged: true,
  } as unknown as AuthContext;
  await settingsService.set(settingsCtx, {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });
  adminToken = (await passwordLogin(admin.email)).accessToken ?? '';
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  await getCache().close();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

describe('adding a passkey and signing in with it', () => {
  it('registers from a password session, then signs in with no password at all', async () => {
    const staff = await makeAccount();
    const token = (await passwordLogin(staff.email)).accessToken ?? '';
    const device = new SoftAuthenticator();

    const empty = await request(app).get('/api/v1/auth/passkeys').set(bearer(token));
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual([]);

    const added = await addPasskey(token, device);
    expect(added.backedUp).toBe(true);
    const listed = await request(app).get('/api/v1/auth/passkeys').set(bearer(token));
    expect((listed.body.data as PasskeyDto[]).map((p) => p.id)).toEqual([added.id]);
    // The unique index exists before the first write relied on it (production syncs in report mode).
    expect((await PasskeyModel.collection.indexes()).map((i) => i.name)).toContain(
      'ux_credentialId',
    );

    const { res, answer } = await passkeySignIn(device);
    expect(res.status).toBe(200);
    const data = res.body.data as { totpRequired: boolean; accessToken: string };
    expect(data.totpRequired).toBe(false);
    expect(data.accessToken).toBeTruthy();
    const cookie = [res.headers['set-cookie']].flat().find((c) => c?.startsWith('ecms_refresh='));
    expect(cookie).toContain('HttpOnly');

    // The session list says how each session signed in.
    const sessions = await request(app).get('/api/v1/auth/sessions').set(bearer(data.accessToken));
    const rows = sessions.body.data as SessionDto[];
    expect(rows.find((s) => s.current)?.method).toBe('passkey');
    expect(rows.some((s) => !s.current && s.method === 'password')).toBe(true);

    // The same answer again is a replay: its challenge was spent by the first.
    const replay = await request(app)
      .post('/api/v1/auth/passkeys/authentication/verify')
      .send({ response: answer });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe(ErrorCodes.AUTH_PASSKEY_EXPIRED);
  });

  it('a passkey sign-in clears the failed-password count, as a password sign-in does', async () => {
    const staff = await makeAccount();
    const token = (await passwordLogin(staff.email)).accessToken ?? '';
    const device = new SoftAuthenticator();
    await addPasskey(token, device);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const wrong = await request(app)
        .post('/api/v1/auth/login')
        .send({ identifier: staff.email, password: 'Wr0ng#Pass!' });
      expect(wrong.status).toBe(401);
    }
    const failedLogins = async () =>
      (await UserModel.findById(staff.id).lean().exec())?.security.failedLogins;
    expect(await failedLogins()).toBe(3);

    const { res } = await passkeySignIn(device);
    expect(res.status).toBe(200);
    // Without the reset, a passkey-only person's mistyped passwords added up until the account
    // locked — and the lock refuses the passkey too.
    expect(await failedLogins()).toBe(0);
  });

  it('refuses the step-up with a wrong password', async () => {
    const staff = await makeAccount();
    const token = (await passwordLogin(staff.email)).accessToken ?? '';
    const res = await request(app)
      .post('/api/v1/auth/passkeys/registration/options')
      .set(bearer(token))
      .send({ password: 'not-the-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ErrorCodes.AUTH_INVALID_CREDENTIALS);
  });

  it('skips the TOTP step after a passkey (owner decision), but asks for the code to add one', async () => {
    const staff = await makeAccount();
    const secret = authenticator.generateSecret();
    await userService.setTotp(staff.id, { enabled: true, secret, backupCodeHashes: [] });
    await getCache().del(userSnapshotKey(staff.id));
    // A password still leads to the TOTP step…
    expect((await passwordLogin(staff.email)).totpRequired).toBe(true);

    // …so to get a session for the step-up, complete it.
    const challenge = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: staff.email, password: PASSWORD });
    const totp = await request(app)
      .post('/api/v1/auth/totp/challenge')
      .send({
        challengeToken: challenge.body.data.challengeToken,
        code: authenticator.generate(secret),
      });
    expect(totp.status).toBe(200);
    const token = totp.body.data.accessToken as string;

    const withoutCode = await request(app)
      .post('/api/v1/auth/passkeys/registration/options')
      .set(bearer(token))
      .send({ password: PASSWORD });
    expect(withoutCode.body.error.code).toBe(ErrorCodes.AUTH_TOTP_INVALID);

    const device = new SoftAuthenticator();
    await addPasskey(token, device, { totpCode: authenticator.generate(secret) });
    const { res } = await passkeySignIn(device);
    expect(res.status).toBe(200);
    expect(res.body.data.totpRequired).toBe(false);
  });

  it('renames and removes a passkey', async () => {
    const staff = await makeAccount();
    const token = (await passwordLogin(staff.email)).accessToken ?? '';
    const added = await addPasskey(token, new SoftAuthenticator());
    const renamed = await request(app)
      .patch(`/api/v1/auth/passkeys/${added.id}`)
      .set(bearer(token))
      .send({ name: 'هاتف العمل' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe('هاتف العمل');
    const removed = await request(app)
      .delete(`/api/v1/auth/passkeys/${added.id}`)
      .set(bearer(token));
    expect(removed.status).toBe(204);
    expect(await passkeysOf(staff.id)).toBe(0);
  });
});

describe('the account lifecycle removes passkeys', () => {
  it('an administrator’s password reset removes them, and the key stops working', async () => {
    const staff = await makeAccount();
    const token = (await passwordLogin(staff.email)).accessToken ?? '';
    const device = new SoftAuthenticator();
    await addPasskey(token, device);

    const reset = await request(app)
      .post(`/api/v1/platform/users/${staff.id}/reset-password`)
      .set(bearer(adminToken))
      .send({});
    expect(reset.status).toBe(200);
    expect(await passkeysOf(staff.id)).toBe(0);
    const { res } = await passkeySignIn(device);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ErrorCodes.AUTH_PASSKEY_INVALID);
  });

  it('suspending the account removes them', async () => {
    const staff = await makeAccount();
    const token = (await passwordLogin(staff.email)).accessToken ?? '';
    await addPasskey(token, new SoftAuthenticator());
    const before = await userService.getById(staff.id);
    await userService.changeStatus(
      staff.id,
      { status: 'suspended', version: before.__v },
      settingsCtx.userId,
    );
    await vi.waitFor(async () => expect(await passkeysOf(staff.id)).toBe(0));
  });
});

describe('who may use passkeys, and the switch', () => {
  it('the gold portal’s «new setup link» removes the customer’s passkeys, as the staff reset does', async () => {
    const customer = await makeAccount({ moduleId: 'gold', subjectType: 'goldCompany' });
    const token = (await passwordLogin(customer.email)).accessToken ?? '';
    const device = new SoftAuthenticator();
    await addPasskey(token, device);
    await goldPortalAccountService.resendSetupLink(customer.id);
    expect(await passkeysOf(customer.id)).toBe(0);
    const { res } = await passkeySignIn(device);
    expect(res.body.error.code).toBe(ErrorCodes.AUTH_PASSKEY_INVALID);
  });

  it('a gold-portal customer may add one and sign in with it', async () => {
    const customer = await makeAccount({ moduleId: 'gold', subjectType: 'goldCompany' });
    const token = (await passwordLogin(customer.email)).accessToken ?? '';
    const device = new SoftAuthenticator();
    await addPasskey(token, device);
    const { res } = await passkeySignIn(device);
    expect(res.status).toBe(200);
  });

  it('switched off, the passkeys are still listed — with the switch reported — and can be removed', async () => {
    const staff = await makeAccount();
    const token = (await passwordLogin(staff.email)).accessToken ?? '';
    const added = await addPasskey(token, new SoftAuthenticator());
    await settingsService.set(settingsCtx, {
      key: SettingKeys.PasskeysEnabled,
      scope: 'organization',
      value: false,
    });
    try {
      const listed = await request(app).get('/api/v1/auth/passkeys').set(bearer(token));
      expect(listed.status).toBe(200);
      expect((listed.body.data as PasskeyDto[]).map((p) => p.id)).toEqual([added.id]);
      expect(listed.body.meta).toEqual({ enabled: false });

      const renamed = await request(app)
        .patch(`/api/v1/auth/passkeys/${added.id}`)
        .set(bearer(token))
        .send({ name: 'هاتفي' });
      expect(renamed.status).toBe(403);
      expect(renamed.body.error.code).toBe(ErrorCodes.AUTH_PASSKEYS_DISABLED);

      const removed = await request(app)
        .delete(`/api/v1/auth/passkeys/${added.id}`)
        .set(bearer(token));
      expect(removed.status).toBe(204);
      expect(await passkeysOf(staff.id)).toBe(0);
    } finally {
      await settingsService.set(settingsCtx, {
        key: SettingKeys.PasskeysEnabled,
        scope: 'organization',
        value: true,
      });
    }
    const after = await request(app).get('/api/v1/auth/passkeys').set(bearer(token));
    expect(after.body.meta).toEqual({ enabled: true });
  });

  it('switched off, the sign-in challenge is refused', async () => {
    await settingsService.set(settingsCtx, {
      key: SettingKeys.PasskeysEnabled,
      scope: 'organization',
      value: false,
    });
    try {
      const res = await request(app).post('/api/v1/auth/passkeys/authentication/options').send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ErrorCodes.AUTH_PASSKEYS_DISABLED);
    } finally {
      await settingsService.set(settingsCtx, {
        key: SettingKeys.PasskeysEnabled,
        scope: 'organization',
        value: true,
      });
    }
  });
});
