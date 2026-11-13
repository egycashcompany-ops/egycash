// The active users page («المستخدمون النشطون») over real HTTP with real RBAC.
//
// What it proves, each against the store rather than only the response:
//
//   1. **A heartbeat is one minute, however often it is sent.** Two in the same minute leave one
//      entry in the day's set; the session it rode in on is neither renewed nor extended by it.
//   2. **Only staff are counted.** An external account is confined away from the endpoint and
//      writes nothing, and its live session never puts it on the page.
//   3. **The page is `activeUser.view`, scoped like the users list.** Without the key it is 403;
//      a branch-scoped holder sees their branch's people only.
//   4. **The statuses mean what they say.** A heartbeat makes a person `active` with their device
//      and the time they signed in; a session renewed longer ago than the idle window is not
//      `idle`; a past day shows everyone `offline` with that day's minutes.
//   5. **The totals ignore the filters**, so the counts beside each status hold still while the
//      reader clicks between them.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { type Express } from 'express';
import {
  PRESENCE_RETENTION_DAYS,
  SettingKeys,
  addDaysYmd,
  cairoDayStart,
  cairoYmd,
  platformPermissions,
  type ActiveUserRowDto,
  type ActiveUsersDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { UserModel } from '../../src/platform/users/user.model';
import { settingsService } from '../../src/platform/settings';
import { userSnapshotKey } from '../../src/platform/auth';
import { SessionModel } from '../../src/platform/auth/session.model';
import { presenceService } from '../../src/platform/presence';
import { UserActivityDayModel } from '../../src/platform/presence/presence.model';
import { minuteOfCairoDay } from '../../src/platform/presence/presence.logic';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;

let adminToken: string; // super-admin, organization-wide
let readerToken: string; // user.view only — no activeUser.view
let branchViewerToken: string; // activeUser.view at BRANCH scope, placed in branch B

let BRANCH_A = '';
let BRANCH_B = '';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-presence-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

const seedUser = async (
  email: string,
  name: { ar: string; en: string },
  branchId: string | null = null,
): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: name,
      lastName: { ar: 'الاختبار', en: 'Tester' },
      locale: 'en',
      organization: { branchId, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  await userService.setPassword(String(user._id), PASSWORD, 'passwordReset');
  await userService.forceActivate(String(user._id));
  return String(user._id);
};

const tokenOf = async (email: string, userAgent = CHROME_WINDOWS): Promise<string> => {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .set('User-Agent', userAgent)
    .send({ identifier: email, password: PASSWORD });
  expect(res.status, `login ${email}`).toBe(200);
  return data<{ accessToken: string }>(res).accessToken;
};

const beat = (token: string): request.Test =>
  request(app)
    .post('/api/v1/platform/presence/heartbeat')
    .set('Authorization', `Bearer ${token}`)
    .send({});

const activeUsers = (token: string, query: Record<string, string> = {}): request.Test =>
  request(app)
    .get('/api/v1/platform/presence/active-users')
    .query(query)
    .set('Authorization', `Bearer ${token}`);

const listAs = async (
  token: string,
  query: Record<string, string> = {},
): Promise<ActiveUsersDto> => {
  const res = await activeUsers(token, query);
  expect(res.status).toBe(200);
  return data<ActiveUsersDto>(res);
};

const rowOf = (page: ActiveUsersDto, userId: string): ActiveUserRowDto | undefined =>
  page.rows.find((row) => row.userId === userId);

const today = (): string => cairoYmd(new Date());

const activityOf = (userId: string, day = today()) =>
  UserActivityDayModel.findOne({ userId: new Types.ObjectId(userId), day })
    .lean<{ minutes: number[]; firstAt: Date; lastAt: Date; expiresAt: Date }>()
    .exec();

/**
 * Two heartbeats must land in the SAME minute for "one minute, however often" to be the question
 * asked. Near the end of a minute, wait for the next one to begin — Cairo's minutes turn over with
 * UTC's, its offset being whole hours.
 */
const earlyInAMinute = async (): Promise<void> => {
  const into = Date.now() % 60_000;
  if (into > 45_000) await new Promise((resolve) => setTimeout(resolve, 60_000 - into + 100));
};

/**
 * A filtered page beside the unfiltered totals of the same moment.
 *
 * A status is "now", so a person can turn from active to idle between two requests; the totals are
 * compared only when the unfiltered read gives the same answer before and after the filtered one.
 */
const filteredBesideTotals = async (
  query: Record<string, string>,
): Promise<{ page: ActiveUsersDto; unfiltered: ActiveUsersDto['totals'] }> => {
  for (let attempt = 1; ; attempt += 1) {
    const before = await listAs(adminToken);
    const page = await listAs(adminToken, query);
    const after = await listAs(adminToken);
    const settled = JSON.stringify(before.totals) === JSON.stringify(after.totals);
    if (settled || attempt === 3) return { page, unfiltered: before.totals };
  }
};

let seq = 0;
const nextEmail = (): string => `presence-${String((seq += 1))}@ecms.local`;

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    platformPermissions.map((p) => p.key),
  );
  const adminId = await seedUser('presence-admin@ecms.local', { ar: 'مدير', en: 'Admin' });
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
  adminToken = await tokenOf('presence-admin@ecms.local');

  const branchA = await request(app)
    .post('/api/v1/platform/branches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: '011', name: { ar: 'فرع أ', en: 'Branch A' } });
  expect(branchA.status).toBe(201);
  BRANCH_A = data<{ id: string }>(branchA).id;
  const branchB = await request(app)
    .post('/api/v1/platform/branches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: '012', name: { ar: 'فرع ب', en: 'Branch B' } });
  expect(branchB.status).toBe(201);
  BRANCH_B = data<{ id: string }>(branchB).id;

  const reader = await rbacService.createRole(
    { name: { en: 'Account reader', ar: 'قارئ الحسابات' }, permissionKeys: ['user.view'] },
    adminId,
  );
  const readerId = await seedUser('presence-reader@ecms.local', { ar: 'قارئ', en: 'Reader' });
  await rbacService.ensureAssignment(readerId, String(reader._id), 'organization');
  readerToken = await tokenOf('presence-reader@ecms.local');

  const viewer = await rbacService.createRole(
    { name: { en: 'Branch presence', ar: 'حضور الفرع' }, permissionKeys: ['activeUser.view'] },
    adminId,
  );
  const viewerId = await seedUser(
    'presence-branch@ecms.local',
    { ar: 'مشرف', en: 'Supervisor' },
    BRANCH_B,
  );
  await rbacService.ensureAssignment(viewerId, String(viewer._id), 'branch');
  branchViewerToken = await tokenOf('presence-branch@ecms.local');
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  await getCache().close();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

// ── 1. The heartbeat ────────────────────────────────────────────────────────

describe('POST /platform/presence/heartbeat', () => {
  it('answers 204 and marks ONE minute however many times it is sent in it', async () => {
    const email = nextEmail();
    const userId = await seedUser(email, { ar: 'نبض', en: 'Pulse' });
    const token = await tokenOf(email);

    await earlyInAMinute();
    const sentAt = new Date();
    expect((await beat(token)).status).toBe(204);
    expect((await beat(token)).status).toBe(204);

    const doc = await activityOf(userId);
    expect(doc).not.toBeNull();
    expect(doc?.minutes).toEqual([minuteOfCairoDay(sentAt)]);
    expect(doc?.firstAt.getTime()).toBeLessThanOrEqual(doc?.lastAt.getTime() ?? 0);
    // Kept for the retention after the Cairo day ends, then removed by the TTL index.
    expect(doc?.expiresAt.toISOString()).toBe(
      cairoDayStart(addDaysYmd(today(), 1 + PRESENCE_RETENTION_DAYS)).toISOString(),
    );
    expect(await UserActivityDayModel.countDocuments({ userId: new Types.ObjectId(userId) })).toBe(
      1,
    );
  });

  it('does not renew or extend the session it rides in on', async () => {
    const email = nextEmail();
    const userId = await seedUser(email, { ar: 'جلسة', en: 'Session' });
    const token = await tokenOf(email);
    const sessionBefore = await SessionModel.findOne({ userId: new Types.ObjectId(userId) })
      .lean<{ lastUsedAt: Date; expiresAt: Date }>()
      .exec();
    expect(sessionBefore).not.toBeNull();

    expect((await beat(token)).status).toBe(204);

    const sessionAfter = await SessionModel.findOne({ userId: new Types.ObjectId(userId) })
      .lean<{ lastUsedAt: Date; expiresAt: Date }>()
      .exec();
    expect(sessionAfter?.lastUsedAt.getTime()).toBe(sessionBefore?.lastUsedAt.getTime());
    expect(sessionAfter?.expiresAt.getTime()).toBe(sessionBefore?.expiresAt.getTime());
  });

  it('requires a session', async () => {
    const res = await request(app).post('/api/v1/platform/presence/heartbeat').send({});
    expect(res.status).toBe(401);
  });

  it('is limited per person, well above once a minute', async () => {
    const email = nextEmail();
    await seedUser(email, { ar: 'حد', en: 'Limit' });
    const token = await tokenOf(email);
    for (let i = 0; i < 10; i += 1) expect((await beat(token)).status).toBe(204);
    expect((await beat(token)).status).toBe(429);
  });

  it('writes nothing for an external account, and never lists one', async () => {
    const email = nextEmail();
    const userId = await seedUser(email, { ar: 'عميل', en: 'Customer' });
    await UserModel.updateOne(
      { _id: new Types.ObjectId(userId) },
      {
        $set: {
          externalSubject: {
            moduleId: 'gold',
            subjectType: 'goldCompany',
            subjectId: new Types.ObjectId(),
          },
        },
      },
    ).exec();
    await getCache().del(userSnapshotKey(userId));
    const token = await tokenOf(email);

    // Confined away from `/platform/*` before the handler is reached — and the handler would not
    // write for them either.
    const res = await beat(token);
    expect(res.status).toBe(403);
    expect(await activityOf(userId)).toBeNull();

    // A live session of their own does not put them on the page: staff only.
    expect(rowOf(await listAs(adminToken), userId)).toBeUndefined();
  });
});

// ── 2. The page ─────────────────────────────────────────────────────────────

describe('GET /platform/presence/active-users', () => {
  it('requires activeUser.view', async () => {
    expect((await activeUsers(readerToken)).status).toBe(403);
    expect((await request(app).get('/api/v1/platform/presence/active-users')).status).toBe(401);
  });

  it('refuses a query it cannot read', async () => {
    expect((await activeUsers(adminToken, { day: '03-11-2026' })).status).toBe(400);
    expect((await activeUsers(adminToken, { day: '2026-02-30' })).status).toBe(400);
    expect((await activeUsers(adminToken, { status: 'away' })).status).toBe(400);
    expect((await activeUsers(adminToken, { branchId: 'nope' })).status).toBe(400);
    expect((await activeUsers(adminToken, { page: '2' })).status).toBe(400);
  });

  it('shows a signed-in person with a heartbeat as active, with their devices', async () => {
    const email = nextEmail();
    const userId = await seedUser(email, { ar: 'عامل', en: 'Worker' }, BRANCH_A);
    const desktop = await tokenOf(email, CHROME_WINDOWS);
    await tokenOf(email, SAFARI_IPHONE);
    expect((await beat(desktop)).status).toBe(204);

    const page = await listAs(adminToken);
    expect(page.day).toBe(today());
    expect(page.today).toBe(true);
    expect(page.idleMinutes).toBe(presenceService.windowMinutes());

    const row = rowOf(page, userId);
    expect(row).toBeDefined();
    expect(row?.status).toBe('active');
    expect(row?.email).toBe(email);
    expect(row?.branch).toEqual({ ar: 'فرع أ', en: 'Branch A' });
    expect(row?.activeMinutes).toBe(1);
    expect(row?.lastActivityAt).not.toBeNull();
    expect(row?.devices).toHaveLength(2);
    expect(row?.devices.map((d) => `${String(d.browser)}/${String(d.os)}`).sort()).toEqual([
      'Chrome/Windows',
      'Safari/iOS',
    ]);
    expect(row?.devices.find((d) => d.os === 'iOS')?.mobile).toBe(true);

    const sessions = await SessionModel.find({ userId: new Types.ObjectId(userId) })
      .lean<{ createdAt: Date }[]>()
      .exec();
    const earliest = Math.min(...sessions.map((s) => s.createdAt.getTime()));
    expect(row?.signedInAt).toBe(new Date(earliest).toISOString());

    // Neither the address nor the raw user agent ever leaves the server.
    const text = JSON.stringify(row);
    expect(text).not.toContain('Mozilla');
    expect(text).not.toContain('"ip"');
  });

  it('a signed-in person without a heartbeat is idle', async () => {
    const email = nextEmail();
    const userId = await seedUser(email, { ar: 'منتظر', en: 'Waiting' });
    await tokenOf(email);
    const row = rowOf(await listAs(adminToken), userId);
    expect(row?.status).toBe('idle');
    expect(row?.activeMinutes).toBe(0);
    expect(row?.devices).toHaveLength(1);
  });

  it('a session renewed longer ago than the idle window is not idle', async () => {
    const email = nextEmail();
    const userId = await seedUser(email, { ar: 'غائب', en: 'Away' });
    await tokenOf(email);
    const stale = new Date(Date.now() - (presenceService.windowMinutes() + 1) * 60_000);
    await SessionModel.updateMany(
      { userId: new Types.ObjectId(userId) },
      { $set: { lastUsedAt: stale } },
    ).exec();

    // No activity today and no open session: not on the page at all.
    expect(rowOf(await listAs(adminToken), userId)).toBeUndefined();

    // With minutes earlier today it is listed — as offline, with no device and no sign-in time.
    const day = today();
    const lastAt = new Date(Date.now() - 30 * 60_000);
    await UserActivityDayModel.create({
      userId: new Types.ObjectId(userId),
      day,
      minutes: [minuteOfCairoDay(lastAt)],
      firstAt: lastAt,
      lastAt,
      expiresAt: cairoDayStart(addDaysYmd(day, 1 + PRESENCE_RETENTION_DAYS)),
    });
    const row = rowOf(await listAs(adminToken), userId);
    expect(row?.status).toBe('offline');
    expect(row?.devices).toEqual([]);
    expect(row?.signedInAt).toBeNull();
    expect(row?.activeMinutes).toBe(1);
  });

  it('a past day shows everyone offline, with that day’s minutes', async () => {
    const email = nextEmail();
    const userId = await seedUser(email, { ar: 'أمس', en: 'Yesterday' });
    const token = await tokenOf(email);
    expect((await beat(token)).status).toBe(204);

    const yesterday = addDaysYmd(today(), -1);
    const start = cairoDayStart(yesterday);
    await UserActivityDayModel.create({
      userId: new Types.ObjectId(userId),
      day: yesterday,
      minutes: [600, 601, 602],
      firstAt: new Date(start.getTime() + 600 * 60_000),
      lastAt: new Date(start.getTime() + 602 * 60_000),
      expiresAt: cairoDayStart(addDaysYmd(yesterday, 1 + PRESENCE_RETENTION_DAYS)),
    });

    const page = await listAs(adminToken, { day: yesterday });
    expect(page.day).toBe(yesterday);
    expect(page.today).toBe(false);
    expect(page.rows.every((row) => row.status === 'offline')).toBe(true);
    expect(page.totals.active).toBe(0);
    expect(page.totals.idle).toBe(0);
    const row = rowOf(page, userId);
    expect(row).toMatchObject({
      status: 'offline',
      activeMinutes: 3,
      devices: [],
      signedInAt: null,
      firstActivityAt: new Date(start.getTime() + 600 * 60_000).toISOString(),
      lastActivityAt: new Date(start.getTime() + 602 * 60_000).toISOString(),
    });
  });

  it('filters by status and by search, and the totals do not move', async () => {
    const email = nextEmail();
    const userId = await seedUser(email, { ar: 'زينب', en: 'Zeinab' });
    const token = await tokenOf(email);
    expect((await beat(token)).status).toBe(204);

    const all = await listAs(adminToken);
    expect(all.totals.active + all.totals.idle + all.totals.offline).toBe(all.rows.length);
    expect(all.totals.activeMinutes).toBe(
      all.rows.reduce((sum, row) => sum + row.activeMinutes, 0),
    );

    const active = await filteredBesideTotals({ status: 'active' });
    expect(active.page.rows.length).toBeGreaterThan(0);
    expect(active.page.rows.every((row) => row.status === 'active')).toBe(true);
    expect(active.page.totals).toEqual(active.unfiltered);

    const offline = await listAs(adminToken, { status: 'offline' });
    expect(rowOf(offline, userId)).toBeUndefined();

    // By name — Arabic, and English in another case — and by email.
    for (const search of ['زينب', 'ZEINAB', email.toUpperCase()]) {
      const found = await filteredBesideTotals({ search });
      expect(
        found.page.rows.map((row) => row.userId),
        search,
      ).toEqual([userId]);
      expect(found.page.totals).toEqual(found.unfiltered);
    }
  });

  it('orders working people first', async () => {
    const page = await listAs(adminToken);
    const rank = { active: 0, idle: 1, offline: 2 } as const;
    const ranks = page.rows.map((row) => rank[row.status]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('a branch-scoped holder sees their branch only; the branch filter narrows the totals', async () => {
    const inA = nextEmail();
    const inB = nextEmail();
    const userA = await seedUser(inA, { ar: 'فرعأ', en: 'InA' }, BRANCH_A);
    const userB = await seedUser(inB, { ar: 'فرعب', en: 'InB' }, BRANCH_B);
    expect((await beat(await tokenOf(inA))).status).toBe(204);
    expect((await beat(await tokenOf(inB))).status).toBe(204);

    const scoped = await listAs(branchViewerToken);
    expect(rowOf(scoped, userB)?.status).toBe('active');
    expect(rowOf(scoped, userA)).toBeUndefined();
    expect(scoped.rows.every((row) => row.branch?.en === 'Branch B')).toBe(true);

    // Asking for another branch cannot widen a branch-scoped grant.
    const widened = await listAs(branchViewerToken, { branchId: BRANCH_A });
    expect(widened.rows).toEqual([]);

    // An organization-wide holder may narrow to one branch; the totals follow the narrowing.
    const narrowed = await listAs(adminToken, { branchId: BRANCH_B });
    expect(rowOf(narrowed, userB)).toBeDefined();
    expect(rowOf(narrowed, userA)).toBeUndefined();
    expect(narrowed.totals.active + narrowed.totals.idle + narrowed.totals.offline).toBe(
      narrowed.rows.length,
    );
  });
});
