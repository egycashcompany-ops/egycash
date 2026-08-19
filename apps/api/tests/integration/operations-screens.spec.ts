// Every Operations screen's opening request, over real HTTP, against a real database (B8).
//
// WHY THIS EXISTS. Every Operations table rendered "تعذّر التحميل" in the browser and
// `/operations/vault` crashed outright, while 2,788 API tests and 1,744 web tests were green.
// The suites tested the layers; nothing tested the REQUEST — the thing the browser actually sends.
//
// Two defects hid there:
//   A. Screens asked for `pageSize: 200` / `500`. The platform ceiling is 100 and the query
//      schemas are `.strict()`, so the API answered 400 and the table showed its error state.
//   B. Two list calls used `get<Paginated<T>>`, which type-checks and then returns the bare array,
//      so `meta` was undefined and the pager crashed destructuring it.
//
// So this file issues the exact URL each screen opens with — same path, same query string — and
// asserts the status AND the envelope. A 400 here is a broken screen there.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { MAX_PAGE_SIZE, SettingKeys, platformPermissions } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { operationsPermissions } from '../../src/modules/operations/operations.module';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { fleetPermissions } from '../../src/modules/fleet/fleet.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let token = '';
const TODAY = '2026-08-18';

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-ops-screens-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions, ...fleetPermissions, ...operationsPermissions].map(
      (p) => p.key,
    ),
  );
  const { user } = await userService.create(
    {
      email: 'ops-screens@ecms.local',
      firstName: { ar: 'م', en: 'S' },
      lastName: { ar: 'م', en: 'S' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  const id = String(user._id);
  await userService.setPassword(id, PASSWORD, 'passwordReset');
  await userService.forceActivate(id);
  await rbacService.ensureAssignment(id, String(superAdmin._id), 'organization');

  const ctx: AuthContext = {
    userId: id,
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
    .send({ identifier: 'ops-screens@ecms.local', password: PASSWORD });
  expect(login.status).toBe(200);
  token = data<{ accessToken: string }>(login).accessToken;
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  await replSet?.stop();
});

/** The URL each screen opens with — verbatim, including the query string `buildQuery` produces. */
const SCREEN_REQUESTS: { screen: string; url: string; paginated: boolean }[] = [
  // The three that carried `pageSize: 200` / `500` and answered 400 for every screen using them.
  { screen: 'bank picker (5 screens)', url: `/operations/banks?page=1&pageSize=${String(MAX_PAGE_SIZE)}&sortBy=code&sortDir=asc`, paginated: true },
  { screen: 'branch names (2 screens)', url: `/operations/bank-branches?page=1&pageSize=${String(MAX_PAGE_SIZE)}`, paginated: true },
  { screen: 'shipment form branch picker', url: `/operations/bank-branches?pageSize=${String(MAX_PAGE_SIZE)}&sortBy=name&sortDir=asc`, paginated: true },
  { screen: 'catalogs · areas tab', url: `/operations/areas?page=1&pageSize=${String(MAX_PAGE_SIZE)}&sortBy=name&sortDir=asc`, paginated: true },
  { screen: 'currency picker', url: `/operations/currencies?page=1&pageSize=${String(MAX_PAGE_SIZE)}`, paginated: true },
  // The rest of the module's opening requests.
  { screen: 'shipments list', url: '/operations/shipments?page=1&pageSize=25&sortDir=desc', paginated: true },
  { screen: 'daily operations board', url: `/operations/shipments/day-board?date=${TODAY}`, paginated: false },
  { screen: 'secured backlog', url: '/operations/secured/backlog?page=1&pageSize=25&sortDir=desc', paginated: true },
  { screen: 'vault receive queue', url: `/operations/secured/backlog?page=1&pageSize=${String(MAX_PAGE_SIZE)}&sortDir=desc&status=draft`, paginated: true },
  { screen: 'vault dispatch due list', url: `/operations/secured/due?date=${TODAY}`, paginated: false },
  { screen: 'vault inventory', url: '/operations/secured/vault?page=1&pageSize=25', paginated: true },
  { screen: 'vault roll-up', url: '/operations/reports/vault', paginated: false },
  { screen: 'crew board', url: `/operations/crew-board?date=${TODAY}`, paginated: false },
  { screen: 'crew pool', url: `/operations/crew-board/directory?date=${TODAY}`, paginated: false },
  { screen: 'requirements roster', url: '/operations/crew-board/requirements?page=1&pageSize=25&sortDir=desc', paginated: true },
  { screen: 'crew attendance', url: `/operations/crew-board/attendance?date=${TODAY}`, paginated: false },
  { screen: 'captain report', url: '/operations/reports/captains?from=2026-08-01&to=2026-08-31', paginated: false },
  { screen: 'bank report', url: '/operations/reports/banks?from=2026-08-01&to=2026-08-31', paginated: false },
];

describe('every Operations screen opens without an API error (B8)', () => {
  for (const { screen, url } of SCREEN_REQUESTS) {
    it(`${screen}: GET ${url}`, async () => {
      const res = await request(app)
        .get(`/api/v1${url}`)
        .set('Authorization', `Bearer ${token}`);
      // The message carries the API's own error, so a failure reads like the browser's console.
      const why = res.status === 200 ? '' : JSON.stringify(res.body);
      expect(res.status, why).toBe(200);
      expect((res.body as { success: boolean }).success).toBe(true);
    });
  }
});

describe('paginated screens get the envelope their pager destructures (B8)', () => {
  for (const { screen, url, paginated } of SCREEN_REQUESTS.filter((r) => r.paginated)) {
    it(`${screen} answers with data + meta`, async () => {
      expect(paginated).toBe(true);
      const res = await request(app).get(`/api/v1${url}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      const body = res.body as { data: unknown[]; meta?: Record<string, number> };
      // `data` is the ARRAY and `meta` is its sibling — which is precisely why a client that
      // unwraps to `data` and then reads `.items`/`.meta` gets undefined for both.
      expect(Array.isArray(body.data), 'data must be the array').toBe(true);
      expect(body.meta, 'meta must ride alongside, not inside').toBeDefined();
      for (const key of ['page', 'pageSize', 'totalItems', 'totalPages']) {
        expect(typeof body.meta?.[key], `meta.${key}`).toBe('number');
      }
    });
  }
});

describe('the ceiling that broke the screens (B8)', () => {
  it('refuses the page sizes the screens used to send, on the endpoints that got them', async () => {
    // Reproduces the exact 400 behind "تعذّر التحميل". Both endpoints, both old values.
    for (const [path, pageSize] of [
      ['/operations/banks', 200],
      ['/operations/bank-branches', 500],
      ['/operations/areas', 500],
    ] as const) {
      const res = await request(app)
        .get(`/api/v1${path}?page=1&pageSize=${String(pageSize)}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status, `${path} pageSize=${String(pageSize)}`).toBe(400);
    }
  });

  it('serves the ceiling itself', async () => {
    const res = await request(app)
      .get(`/api/v1/operations/banks?page=1&pageSize=${String(MAX_PAGE_SIZE)}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect((res.body as { meta: { pageSize: number } }).meta.pageSize).toBe(MAX_PAGE_SIZE);
  });
});

describe('an empty module still answers correctly (B8)', () => {
  it('returns an empty page with real meta, not an error and not a bare array', async () => {
    // The empty state the tables must render. `totalItems: 0` with `totalPages: 1` is a page that
    // exists and holds nothing — distinct from a failed request, which is what the screens showed.
    const res = await request(app)
      .get('/api/v1/operations/secured/vault?page=1&pageSize=25')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const body = res.body as { data: unknown[]; meta: { totalItems: number; totalPages: number } };
    expect(body.data).toEqual([]);
    expect(body.meta.totalItems).toBe(0);
    expect(body.meta.totalPages).toBeGreaterThanOrEqual(1);
  });
});

describe('an unauthorized caller gets a refusal, not a broken screen (B8)', () => {
  it('answers 401 without a token and 403 without the grant', async () => {
    expect((await request(app).get('/api/v1/operations/banks')).status).toBe(401);

    const { user } = await userService.create(
      {
        email: 'ops-screens-none@ecms.local',
        firstName: { ar: 'م', en: 'N' },
        lastName: { ar: 'م', en: 'N' },
        locale: 'en',
        organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
      },
      null,
    );
    await userService.setPassword(String(user._id), PASSWORD, 'passwordReset');
    await userService.forceActivate(String(user._id));
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'ops-screens-none@ecms.local', password: PASSWORD });
    const noneToken = data<{ accessToken: string }>(login).accessToken;

    const res = await request(app)
      .get('/api/v1/operations/banks')
      .set('Authorization', `Bearer ${noneToken}`);
    expect(res.status).toBe(403);
  });
});
