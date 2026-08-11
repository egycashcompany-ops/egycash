// P9-B — the account is where a preference lives.
//
// Three of the claims this phase makes cannot be checked anywhere but here, against real HTTP, a
// real database and a real cache:
//
//   1. **A language change takes effect at once.** `AuthContext.locale` is served from a snapshot
//      cached for 60 seconds, and it decides the language the server WRITES in — the notification
//      email, the IT display names. So the test does not inspect a cache key and call it proof: it
//      builds a real auth context before and after the change and asserts the value moved, inside
//      the window where a stale snapshot would still have been served.
//   2. **It takes effect from BOTH paths.** The administrator's edit and the user's own change
//      write the same field, and until this phase only the placement fields dropped the snapshot —
//      so an administrator switching someone's language left it stale. Asserted for both.
//   3. **The audit trail is complete for `locale` and silent for the other two.** `locale` is in
//      `auditSnapshot`, so an admin edit was already recorded; a self-service write that skipped
//      the record would leave a partial trail on an audited field, which reads as "never changed".
//      `theme` and `navLayout` carry no entry — presentation is not an act on the record.
//
// The screens that call this are proven separately in `apps/web`; nothing here goes through them.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { platformPermissions, type MeDto } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { authService } from '../../src/platform/auth';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { getCache } from '../../src/infrastructure/redis/cache';

const PASSWORD = 'Str0ng#Pass!';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId: string;
let adminToken: string;
let subjectId: string;
let subjectEmail: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-user-preferences-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

const patch = (body: Record<string, unknown>): request.Test =>
  request(app)
    .patch('/api/v1/auth/me/preferences')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);

const readMe = async (): Promise<MeDto> =>
  data<MeDto>(
    await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${adminToken}`),
  );

/** The locale the SERVER would write in for this token, right now. */
const contextLocale = async (token: string): Promise<string> =>
  (await authService.buildAuthContext(token)).locale;

const localeAudits = async (userId: string): Promise<number> =>
  AuditLogModel.countDocuments({
    'entityRef.entityType': 'user',
    'entityRef.entityId': userId,
    'changes.field': 'locale',
  }).exec();

let seq = 0;
const account = async (prefix: string): Promise<{ id: string; email: string }> => {
  seq += 1;
  const email = `${prefix}-${String(seq)}@ecms.local`;
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: `أ${String(seq)}`, en: `A${String(seq)}` },
      lastName: { ar: `ب${String(seq)}`, en: `B${String(seq)}` },
      locale: 'ar',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  return { id: String(user._id), email };
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    platformPermissions.map((p) => p.key),
  );
  const admin = await account('prefs-admin');
  adminId = admin.id;
  await userService.setPassword(adminId, PASSWORD, 'passwordReset');
  await userService.forceActivate(adminId);
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');

  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ identifier: admin.email, password: PASSWORD });
  expect(login.status).toBe(200);
  adminToken = data<{ accessToken: string }>(login).accessToken;

  const subject = await account('prefs-subject');
  subjectId = subject.id;
  subjectEmail = subject.email;
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  await getCache().close();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

describe('the account carries all three preferences', () => {
  it('answers the shipped defaults for an account that predates them', async () => {
    const me = await readMe();
    expect(me.navLayout).toBe('launchpad');
    expect(me.theme).toBe('system');
    expect(me.locale).toBe('ar');
  });

  it('saves one preference without disturbing the other two', async () => {
    expect((await patch({ theme: 'dark' })).status).toBe(200);
    let me = await readMe();
    expect(me.theme).toBe('dark');
    expect(me.navLayout).toBe('launchpad');
    expect(me.locale).toBe('ar');

    expect((await patch({ navLayout: 'rail' })).status).toBe(200);
    me = await readMe();
    expect(me.navLayout).toBe('rail');
    expect(me.theme).toBe('dark'); // still there — the second write did not clear the first
  });

  it('saves all three in one call and survives a fresh /me', async () => {
    const response = await patch({ navLayout: 'launchpad', theme: 'light', locale: 'en' });
    expect(response.status).toBe(200);
    // The response is the whole `me`, so the client never has to guess what else moved.
    const returned = data<MeDto>(response);
    expect([returned.navLayout, returned.theme, returned.locale]).toEqual([
      'launchpad',
      'light',
      'en',
    ]);
    const me = await readMe();
    expect([me.navLayout, me.theme, me.locale]).toEqual(['launchpad', 'light', 'en']);
  });

  it('stores `system` rather than resolving it', async () => {
    expect((await patch({ theme: 'system' })).status).toBe(200);
    expect((await readMe()).theme).toBe('system');
  });
});

describe('a language change reaches the server immediately', () => {
  it('moves AuthContext.locale inside the snapshot TTL', async () => {
    expect((await patch({ locale: 'ar' })).status).toBe(200);
    // Warm the snapshot the way a normal request would, so the cached value is genuinely present.
    await readMe();
    expect(await contextLocale(adminToken)).toBe('ar');

    expect((await patch({ locale: 'en' })).status).toBe(200);
    // No waiting: a snapshot left in place would still answer `ar` for up to 60 seconds.
    expect(await contextLocale(adminToken)).toBe('en');
  });

  // The other two are not in the snapshot, so dropping it for them would be cache churn for
  // nothing. This is the negative control that says the invalidation is targeted.
  it('does not drop the snapshot for theme or navLayout', async () => {
    await readMe();
    expect(await getCache().get(`auth:user:${adminId}`)).not.toBeNull();
    expect((await patch({ theme: 'dark' })).status).toBe(200);
    expect((await patch({ navLayout: 'rail' })).status).toBe(200);
    expect(await getCache().get(`auth:user:${adminId}`)).not.toBeNull();
  });

  // The path that was broken before this phase: an administrator editing someone else's language.
  it('moves it for an administrator’s edit too', async () => {
    await userService.setPassword(subjectId, PASSWORD, 'passwordReset');
    await userService.forceActivate(subjectId);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: subjectEmail, password: PASSWORD });
    expect(login.status).toBe(200);
    const subjectToken = data<{ accessToken: string }>(login).accessToken;

    await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${subjectToken}`);
    expect(await contextLocale(subjectToken)).toBe('ar');

    const edit = await request(app)
      .patch(`/api/v1/platform/users/${subjectId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ locale: 'en', version: (await userService.getById(subjectId)).__v });
    expect(edit.status).toBe(200);

    expect(await contextLocale(subjectToken)).toBe('en');
  });
});

describe('what lands in the audit trail', () => {
  it('records a language change made by the user themselves', async () => {
    await patch({ locale: 'ar' });
    const before = await localeAudits(adminId);
    expect((await patch({ locale: 'en' })).status).toBe(200);
    expect(await localeAudits(adminId)).toBe(before + 1);

    const entry = await AuditLogModel.findOne({
      'entityRef.entityId': adminId,
      'changes.field': 'locale',
    })
      .sort({ at: -1 })
      .lean()
      .exec();
    expect(entry).not.toBeNull();
    // Only the field that moved: the rest of the record is not this call's business.
    expect((entry as { changes: { field: string }[] }).changes.map((c) => c.field)).toEqual([
      'locale',
    ]);
    expect((entry as { changes: { old: unknown; new: unknown }[] }).changes[0]).toMatchObject({
      old: 'ar',
      new: 'en',
    });
  });

  it('records nothing when the language did not actually change', async () => {
    await patch({ locale: 'en' });
    const before = await localeAudits(adminId);
    expect((await patch({ locale: 'en' })).status).toBe(200);
    expect(await localeAudits(adminId)).toBe(before);
  });

  // Presentation is not an act on the business record — the same reasoning
  // `notification-preference.service` already applies to its own self-scoped writes.
  it('records nothing for theme or navLayout', async () => {
    const before = await AuditLogModel.countDocuments({ 'entityRef.entityId': adminId }).exec();
    expect((await patch({ theme: 'light' })).status).toBe(200);
    expect((await patch({ navLayout: 'rail' })).status).toBe(200);
    expect((await patch({ theme: 'dark', navLayout: 'launchpad' })).status).toBe(200);
    expect(await AuditLogModel.countDocuments({ 'entityRef.entityId': adminId }).exec()).toBe(
      before,
    );
  });
});

describe('what the endpoint refuses', () => {
  it('refuses an empty body rather than answering 200 to a no-op', async () => {
    expect((await patch({})).status).toBe(400);
  });

  it.each([
    ['an unknown shell', { navLayout: 'metro' }],
    ['an unknown theme', { theme: 'solarized' }],
    ['an unknown locale', { locale: 'fr' }],
  ])('refuses %s', async (_why, body) => {
    expect((await patch(body)).status).toBe(400);
  });

  // The reason this endpoint needs no permission: the subject is always the caller, and nothing
  // outside the three named fields can ride along.
  it('refuses a field that would reach past the three preferences', async () => {
    expect((await patch({ locale: 'en', isPrivileged: true })).status).toBe(400);
    expect((await patch({ theme: 'dark', permissions: {} })).status).toBe(400);
    expect((await patch({ navLayout: 'rail', passwordHash: 'x' })).status).toBe(400);
  });

  it('refuses an unauthenticated caller', async () => {
    expect(
      (await request(app).patch('/api/v1/auth/me/preferences').send({ theme: 'dark' })).status,
    ).toBe(401);
  });
});
