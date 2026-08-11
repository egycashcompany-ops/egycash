// FIX-2 — the policy endpoint, and the guard it describes.
//
// The screens now list the password rules while somebody types. That is an AID, and this suite is
// the proof that it is only an aid: every request below bypasses the UI entirely and goes straight
// at the API, which refuses exactly what it always refused. If the client were ever wrong — a stale
// policy, a bug in the checklist, a user with scripting open — nothing gets through that would not
// have got through before.
//
// The endpoint is public because `/activate` has no session. It answers the two configurable values
// and nothing else, both organization-level, so there is no per-account fact in it.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  ErrorCodes,
  SettingKeys,
  evaluatePasswordPolicy,
  platformPermissions,
  type PasswordPolicyDto,
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
let adminId: string;
let adminToken: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-password-policy-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

let seq = 0;
/** An invited account with a live activation token — the state `/activate` consumes. */
const invited = async (email: string): Promise<string> => {
  seq += 1;
  const { activationToken } = await userService.create(
    {
      email,
      firstName: { ar: `أ${String(seq)}`, en: `A${String(seq)}` },
      lastName: { ar: `ب${String(seq)}`, en: `B${String(seq)}` },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  return activationToken;
};

const activate = (token: string, password: string): request.Test =>
  request(app).post('/api/v1/auth/activate').send({ token, password });

const readPolicy = (): request.Test => request(app).get('/api/v1/auth/password-policy');

let ctx: AuthContext;
const setPolicy = async (minLength: number, requireComplexity: boolean): Promise<void> => {
  await settingsService.set(ctx, {
    key: SettingKeys.PasswordMinLength,
    scope: 'organization',
    value: minLength,
  });
  await settingsService.set(ctx, {
    key: SettingKeys.PasswordRequireComplexity,
    scope: 'organization',
    value: requireComplexity,
  });
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
      email: 'pp-admin@ecms.local',
      firstName: { ar: 'م', en: 'Admin' },
      lastName: { ar: 'م', en: 'Admin' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  adminId = String(user._id);
  await userService.setPassword(adminId, PASSWORD, 'passwordReset');
  await userService.forceActivate(adminId);
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');

  ctx = {
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
    .send({ identifier: 'pp-admin@ecms.local', password: PASSWORD });
  expect(login.status).toBe(200);
  adminToken = data<{ accessToken: string }>(login).accessToken;
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  await getCache().close();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

afterEach(async () => {
  // Back to the shipped defaults, so one case cannot set the policy for the next.
  await setPolicy(10, true);
  await getCache().delByPrefix('rl:');
});

// ── The endpoint ────────────────────────────────────────────────────────────

describe('GET /auth/password-policy', () => {
  // The whole reason it exists: `/activate` is public and has no token to send.
  it('answers without a session', async () => {
    const res = await readPolicy();
    expect(res.status).toBe(200);
    const policy = data<PasswordPolicyDto>(res);
    expect(typeof policy.minLength).toBe('number');
    expect(typeof policy.requireComplexity).toBe('boolean');
  });

  it('answers the values an administrator set, not the code defaults', async () => {
    await setPolicy(14, false);
    const policy = data<PasswordPolicyDto>(await readPolicy());
    expect(policy).toEqual({ minLength: 14, requireComplexity: false });
  });

  it('answers only those two values — nothing else about the deployment', async () => {
    expect(Object.keys(data<PasswordPolicyDto>(await readPolicy())).sort()).toEqual([
      'minLength',
      'requireComplexity',
    ]);
  });

  it('says the same thing to a signed-in caller as to an anonymous one', async () => {
    await setPolicy(11, true);
    const anonymous = data<PasswordPolicyDto>(await readPolicy());
    const signedIn = data<PasswordPolicyDto>(
      await readPolicy().set('Authorization', `Bearer ${adminToken}`),
    );
    expect(signedIn).toEqual(anonymous);
  });
});

// ── The guard, reached with no screen in the way ────────────────────────────

describe('the server refuses a bad password however it arrives', () => {
  it.each([
    ['too short', 'Ab1!efgh'],
    ['no lower case', 'AB1!EFGHIJ'],
    ['no upper case', 'ab1!efghij'],
    ['no digit', 'Abc!efghij'],
    ['no symbol', 'Abc1efghij'],
  ])('refuses activation with a password that has %s', async (_why, password) => {
    const token = await invited(`pp-${_why.replace(/\s+/g, '-')}@ecms.local`);
    const res = await activate(token, password);
    expect(res.status).toBe(422);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      ErrorCodes.AUTH_PASSWORD_POLICY,
    );
  });

  it('accepts one that satisfies every rule', async () => {
    const token = await invited('pp-good@ecms.local');
    expect((await activate(token, 'Ab1!efghij')).status).toBe(204);
  });

  // The client is not consulted, so a wrong client changes nothing.
  it('refuses on password CHANGE too, with no screen involved', async () => {
    const res = await request(app)
      .post('/api/v1/auth/password/change')
      .set('Authorization', `Bearer ${adminToken}`)
      // Eight characters, so it clears the SCHEMA floor below and is judged by the policy.
      .send({ currentPassword: PASSWORD, newPassword: 'nocomplex' });
    expect(res.status).toBe(422);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      ErrorCodes.AUTH_PASSWORD_POLICY,
    );
  });

  /**
   * There are TWO layers in front of a new password, and they answer differently.
   *
   * `ActivateAccountSchema` and `ChangePasswordSchema` both declare `z.string().min(8)`, which is a
   * fixed floor enforced by validation — it answers **400**, before the configurable policy is ever
   * consulted. The policy answers **422**. They cannot disagree in a way that matters, because
   * `auth.password.minLength` itself declares `.min(8)`: the configurable minimum can never be set
   * below the schema's.
   *
   * Worth pinning because a checklist showing "at least 8 characters" and a request refused with a
   * validation error rather than a policy one would otherwise look like a bug in the policy.
   */
  it('rejects a password under the schema floor with 400, before the policy is reached', async () => {
    const token = await invited('pp-floor@ecms.local');
    const res = await activate(token, 'Ab1!efg'); // seven characters
    expect(res.status).toBe(400);
  });
});

// ── The endpoint and the guard describe the SAME policy ─────────────────────

describe('what the endpoint says is what the guard does', () => {
  it('follows a raised minimum on both surfaces', async () => {
    await setPolicy(16, true);
    expect(data<PasswordPolicyDto>(await readPolicy()).minLength).toBe(16);

    // 10 characters satisfied the previous policy and does not satisfy this one.
    const short = await invited('pp-raised-short@ecms.local');
    expect((await activate(short, 'Ab1!efghij')).status).toBe(422);

    const long = await invited('pp-raised-long@ecms.local');
    expect((await activate(long, 'Ab1!efghijklmnop')).status).toBe(204);
  });

  // The case the checklist must get right: complexity off means the four character rules are not
  // enforced, so a screen listing them would be lying about what the server accepts.
  it('accepts a length-only password when complexity is turned off', async () => {
    await setPolicy(12, false);
    expect(data<PasswordPolicyDto>(await readPolicy()).requireComplexity).toBe(false);

    const token = await invited('pp-nocomplexity@ecms.local');
    expect((await activate(token, 'aaaaaaaaaaaa')).status).toBe(204);
  });

  it('still enforces the length when complexity is off', async () => {
    await setPolicy(12, false);
    const token = await invited('pp-nocomplexity-short@ecms.local');
    // Nine characters: past the schema's fixed floor of eight, short of the policy's twelve — so
    // this is the POLICY refusing, not validation.
    expect((await activate(token, 'aaaaaaaaa')).status).toBe(422);
  });

  /**
   * The contract's evaluator and the server's refusal are the same rules — that is the point of
   * moving them into `@ecms/contracts`. This asserts they agree on the live policy rather than
   * trusting that they do: for each candidate, the evaluator's verdict must match the API's.
   */
  it('agrees with evaluatePasswordPolicy on every candidate', async () => {
    await setPolicy(10, true);
    const policy = data<PasswordPolicyDto>(await readPolicy());

    const candidates = ['Ab1!efghij', 'Ab1!efgh', 'abcdefghij', 'ABCDEFGHIJ', 'Abcdefghij1'];
    for (const [index, candidate] of candidates.entries()) {
      const expected = evaluatePasswordPolicy(candidate, policy).every((r) => r.met);
      const token = await invited(`pp-agree-${String(index)}@ecms.local`);
      const status = (await activate(token, candidate)).status;
      expect(status === 204, `${candidate} — client said ${String(expected)}`).toBe(expected);
    }
  });
});
