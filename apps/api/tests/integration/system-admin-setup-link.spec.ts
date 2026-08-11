// P9-A — the setup link an administrator reads and delivers by hand.
//
// This is the only endpoint in ECMS that returns a credential-shaped secret, so the suite is
// mostly about what it REFUSES. Four properties carry it:
//
//   1. **Its own key.** `user.setupLink` is not `user.resetPassword`, and holding the second must
//      not open the first. Resetting delivers a link the actor never sees; reading one is account
//      takeover. Proven by a principal holding reset and nothing else being refused.
//   2. **Never for an account that has a password.** `POST /auth/activate` accepts an `active`
//      account holding a valid token (§14.4), so a link issued for one would let its holder replace
//      somebody's password. The refusal is on `passwordHash`, not on the derived `accountStatus` —
//      which answers `locked` first for a temporary lockout and would have let exactly that case
//      through. That state has its own case below.
//   3. **Single use, and a new link kills the old one.** Both proven by activating, not by reading
//      fields: the token is put through `/auth/activate` and the outcome observed.
//   4. **Hash-only at rest.** The raw token is never stored. Asserted against the document, so a
//      future change that "helpfully" kept it fails here.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { SettingKeys, platformPermissions, type SetupLinkDto } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { userRepository } from '../../src/platform/users/user.repository';
import { settingsService } from '../../src/platform/settings';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { getCache } from '../../src/infrastructure/redis/cache';
import { sha256 } from '../../src/shared/utils/crypto';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
const CHOSEN = 'Ch0sen#Pass!';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;

let adminToken: string; // everything, including user.setupLink
let adminId: string;
let resetterToken: string; // user.view + user.resetPassword — may deliver, may NOT read
let readerToken: string; // user.view only

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-sa-setup-link-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

const login = async (identifier: string): Promise<request.Response> =>
  request(app).post('/api/v1/auth/login').send({ identifier, password: PASSWORD });

const tokenOf = async (email: string): Promise<string> => {
  const res = await login(email);
  expect(res.status).toBe(200);
  return data<{ accessToken: string }>(res).accessToken;
};

let seq = 0;
const names = (): { firstName: { ar: string; en: string }; lastName: { ar: string; en: string } } => {
  seq += 1;
  return {
    firstName: { ar: `أ${String(seq)}`, en: `A${String(seq)}` },
    lastName: { ar: `ب${String(seq)}`, en: `B${String(seq)}` },
  };
};

/** An account exactly as creation leaves it: invited, no password, a link outstanding. */
const invitedAccount = async (email: string): Promise<string> => {
  const { user } = await userService.create(
    { email, ...names(), locale: 'en', organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null } },
    null,
  );
  return String(user._id);
};

/** A fully activated account — the state the endpoint must refuse. */
const activatedAccount = async (email: string): Promise<string> => {
  const id = await invitedAccount(email);
  await userService.setPassword(id, PASSWORD, 'passwordReset');
  await userService.forceActivate(id);
  return id;
};

const seedPrincipal = async (email: string): Promise<string> => {
  const id = await activatedAccount(email);
  return id;
};

const issueLink = (userId: string, token: string): request.Test =>
  request(app)
    .post(`/api/v1/platform/users/${userId}/setup-link`)
    .set('Authorization', `Bearer ${token}`)
    .send({});

/** `POST /auth/activate` answers **204** — it completes the activation and returns no body. */
const ACTIVATED = 204;
const activate = (setupToken: string, password = CHOSEN): request.Test =>
  request(app).post('/api/v1/auth/activate').send({ token: setupToken, password });

/** Status changes are version-checked (optimistic concurrency), so the current one is read first. */
const setStatus = async (userId: string, status: 'suspended' | 'archived'): Promise<number> => {
  // Mongoose keeps the optimistic-concurrency counter in `__v`; `UserDto.version` is that field.
  const current = await userRepository.getById(userId);
  const res = await request(app)
    .post(`/api/v1/platform/users/${userId}/status`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ status, version: current.__v });
  return res.status;
};

const tokenFromUrl = (url: string): string => new URL(url).searchParams.get('token') ?? '';

const auditRows = async (
  userId: string,
): Promise<{ action: string; changes?: { field: string; new: unknown }[] }[]> =>
  AuditLogModel.find({ 'entityRef.entityType': 'user', 'entityRef.entityId': userId })
    .lean<{ action: string; changes?: { field: string; new: unknown }[] }[]>()
    .exec();

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  adminId = await seedPrincipal('sl-admin@ecms.local');
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
  // Break-glass keys arm mandatory 2FA (Review R13) and `user.setupLink` is one, so the seeded
  // administrators could not log in with a password alone while it is enforced.
  await settingsService.set(ctx, {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });
  adminToken = await tokenOf('sl-admin@ecms.local');

  const mkPrincipal = async (en: string, keys: string[], email: string): Promise<string> => {
    const role = await rbacService.createRole({ name: { en, ar: en }, permissionKeys: keys }, adminId);
    const userId = await seedPrincipal(email);
    await rbacService.ensureAssignment(userId, String(role._id), 'organization');
    return tokenOf(email);
  };

  resetterToken = await mkPrincipal(
    'Credential resetter',
    ['user.view', 'user.resetPassword'],
    'sl-resetter@ecms.local',
  );
  readerToken = await mkPrincipal('Account reader', ['user.view'], 'sl-reader@ecms.local');
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  await getCache().close();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

// ── 1. The permission is its own, and it is not implied by resetting ────────

describe('reading a setup link needs user.setupLink and nothing else will do', () => {
  it('refuses a reader outright', async () => {
    const target = await invitedAccount('sl-t1@ecms.local');
    const res = await issueLink(target, readerToken);
    expect(res.status).toBe(403);
  });

  // The heart of D2. This principal may reset the account — clearing its password and having a
  // fresh link DELIVERED — and must still not be able to read one.
  it('refuses a principal holding user.resetPassword', async () => {
    const target = await invitedAccount('sl-t2@ecms.local');
    const res = await issueLink(target, resetterToken);
    expect(res.status).toBe(403);

    // …and the same principal really can reset, so the refusal above is about the KEY and not
    // about some unrelated failure.
    const reset = await request(app)
      .post(`/api/v1/platform/users/${target}/reset-password`)
      .set('Authorization', `Bearer ${resetterToken}`)
      .send({});
    expect(reset.status).toBe(200);
  });

  it('refuses an anonymous caller', async () => {
    const target = await invitedAccount('sl-t3@ecms.local');
    const res = await request(app).post(`/api/v1/platform/users/${target}/setup-link`).send({});
    expect(res.status).toBe(401);
  });

  it('is declared break-glass, which is what arms mandatory 2FA for its holders', () => {
    const declared = platformPermissions.find((p) => p.key === 'user.setupLink');
    expect(declared, 'user.setupLink is not in the registry').toBeDefined();
    expect(declared?.breakGlass).toBe(true);
  });
});

// ── 2. What it returns, and what it stores ──────────────────────────────────

describe('the link it returns', () => {
  it('is the same /activate link the delivery channels would have sent', async () => {
    const target = await invitedAccount('sl-t4@ecms.local');
    const res = await issueLink(target, adminToken);
    expect(res.status).toBe(200);
    const link = data<SetupLinkDto>(res);
    expect(link.url).toContain('/activate?token=');
    expect(tokenFromUrl(link.url).length).toBeGreaterThan(20);
    expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  // The invariant the whole design rests on: returned once, stored as a hash, unreadable after.
  it('stores the token as a hash and never in the clear', async () => {
    const target = await invitedAccount('sl-t5@ecms.local');
    const link = data<SetupLinkDto>(await issueLink(target, adminToken));
    const raw = tokenFromUrl(link.url);

    const doc = await userRepository.getById(target);
    expect(doc.activation.tokenHash).toBe(sha256(raw));
    expect(doc.activation.tokenHash).not.toBe(raw);
    expect(JSON.stringify(doc)).not.toContain(raw);
  });

  it('expires according to auth.activationLink.ttlHours', async () => {
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
      key: SettingKeys.ActivationLinkTtlHours,
      scope: 'organization',
      value: 1,
    });
    const target = await invitedAccount('sl-t6@ecms.local');
    const link = data<SetupLinkDto>(await issueLink(target, adminToken));
    const hours = (new Date(link.expiresAt).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(0.9);
    expect(hours).toBeLessThan(1.1);

    await settingsService.set(ctx, {
      key: SettingKeys.ActivationLinkTtlHours,
      scope: 'organization',
      value: 48,
    });
  });

  it('sends nothing, and says so by clearing the delivery outcomes', async () => {
    const target = await invitedAccount('sl-t7@ecms.local');
    // A real delivery first, so there are outcomes to clear.
    await request(app)
      .post(`/api/v1/platform/users/${target}/credentials/resend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect((await userRepository.getById(target)).activation.delivery).not.toEqual([]);

    await issueLink(target, adminToken);
    expect((await userRepository.getById(target)).activation.delivery).toEqual([]);
  });
});

// ── 3. Single use, and supersession ─────────────────────────────────────────

describe('the link works once', () => {
  it('activates the account, and then will not do it again', async () => {
    const target = await invitedAccount('sl-t8@ecms.local');
    const link = data<SetupLinkDto>(await issueLink(target, adminToken));
    const raw = tokenFromUrl(link.url);

    const first = await activate(raw);
    expect(first.status).toBe(ACTIVATED);

    const second = await activate(raw, 'An0ther#Pass!');
    expect(second.status).not.toBe(ACTIVATED);

    // And the password that was chosen is the one that signs in.
    const signIn = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'sl-t8@ecms.local', password: CHOSEN });
    expect(signIn.status).toBe(200);
  });

  it('kills the previous link when a new one is issued', async () => {
    const target = await invitedAccount('sl-t9@ecms.local');
    const first = tokenFromUrl(data<SetupLinkDto>(await issueLink(target, adminToken)).url);
    const second = tokenFromUrl(data<SetupLinkDto>(await issueLink(target, adminToken)).url);
    expect(second).not.toBe(first);

    expect((await activate(first)).status).not.toBe(ACTIVATED);
    expect((await activate(second)).status).toBe(ACTIVATED);
  });
});

// ── 4. The refusal that keeps this from being account takeover ──────────────

describe('an account that already has a password is refused', () => {
  it('refuses an activated account with 422, not 403', async () => {
    const target = await activatedAccount('sl-t10@ecms.local');
    const res = await issueLink(target, adminToken);
    // The actor holds the key and is still told no: this is a rule about the account's state.
    expect(res.status).toBe(422);
  });

  /**
   * The case the first implementation of this guard would have let through.
   *
   * `accountStatusOf` reports `locked` before it reports `activated`, so an activated account whose
   * failed-login counter has just tripped does not read as activated. A guard written against that
   * derived value would have issued a link for an account that HAS a password — and
   * `POST /auth/activate` accepts an `active` account holding a valid token, so the holder could
   * have replaced that password. The guard tests `passwordHash` for exactly this reason.
   */
  it('refuses an activated account that is also locked out', async () => {
    const target = await activatedAccount('sl-t11@ecms.local');
    await userRepository.updateSecurity(target, {
      $set: { 'security.lockedUntil': new Date(Date.now() + 3_600_000) },
    });
    const res = await issueLink(target, adminToken);
    expect(res.status).toBe(422);
  });

  it('refuses a suspended account and an archived one', async () => {
    for (const status of ['suspended', 'archived'] as const) {
      const target = await invitedAccount(`sl-retired-${status}@ecms.local`);
      expect(await setStatus(target, status), status).toBe(200);
      const res = await issueLink(target, adminToken);
      expect(res.status, status).toBe(422);
    }
  });

  // The complement of the first case: an account that was activated and then RESET has no
  // password, so it is awaiting activation again and a link is exactly the right answer.
  it('allows an account whose password an admin has cleared', async () => {
    const target = await activatedAccount('sl-t12@ecms.local');
    const reset = await request(app)
      .post(`/api/v1/platform/users/${target}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(reset.status).toBe(200);

    const res = await issueLink(target, adminToken);
    expect(res.status).toBe(200);
  });
});

// ── 5. Both kinds of account, and the trail ─────────────────────────────────

describe('it serves every account the platform can create', () => {
  it('works for an account with no employee behind it', async () => {
    const target = await invitedAccount('sl-plain@ecms.local');
    expect((await userRepository.getById(target)).employeeId).toBeNull();
    const res = await issueLink(target, adminToken);
    expect(res.status).toBe(200);
    expect((await activate(tokenFromUrl(data<SetupLinkDto>(res).url))).status).toBe(ACTIVATED);
  });

  it('records who took the link, distinguishable from a delivery', async () => {
    const target = await invitedAccount('sl-audit@ecms.local');
    await issueLink(target, adminToken);

    const rows = await auditRows(target);
    const invitations = rows.filter((row) => row.action === 'invitationCreated');
    const modes = invitations.flatMap((row) =>
      (row.changes ?? []).filter((c) => c.field === 'mode').map((c) => c.new),
    );
    // `invite` from creation, `copied` from this endpoint — the same action, told apart by mode.
    expect(modes).toContain('invite');
    expect(modes).toContain('copied');
  });
});
