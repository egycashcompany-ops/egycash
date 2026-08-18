// The Operations sidebar, end to end over real HTTP and real RBAC (B7).
//
// The unit spec beside the seed (src/seed-navigation-operations.spec.ts) proves the three SOURCE
// files agree. This one proves the running chain does what those files describe:
//
//   syncNavigationCatalog()  →  applications collection  →  GET /platform/me/applications
//     →  useMyApplications()  →  Sidebar  →  the Operations module  →  an Operations page
//
// The web half of that chain is asserted by the frontend specs; everything up to and including the
// payload the sidebar renders is asserted here, against a real database.
//
// WHAT THIS EXISTS TO CATCH. B1-B6 shipped thirteen Operations screens and appended no navigation
// rows, so `/platform/me/applications` returned nothing for the module and the sidebar had nothing
// to draw. Every gate was green. The assertions below are the ones that were missing.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { SettingKeys, platformPermissions, type MyApplicationCategoryDto } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { operationsPermissions } from '../../src/modules/operations/operations.module';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { fleetPermissions } from '../../src/modules/fleet/fleet.module';
import { syncNavigationCatalog } from '../../src/seed-navigation';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { ApplicationModel } from '../../src/platform/applications/application.model';
import { ApplicationCategoryModel } from '../../src/platform/application-categories/application-category.model';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId = '';
let seq = 0;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-ops-nav-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

/** An activated account holding a role with exactly these permission keys. */
const accountWith = async (keys: string[]): Promise<string> => {
  seq += 1;
  const email = `ops-nav-${String(seq)}@ecms.local`;
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'أ', en: 'A' },
      lastName: { ar: 'ب', en: 'B' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  const id = String(user._id);
  await userService.setPassword(id, PASSWORD, 'passwordReset');
  await userService.forceActivate(id);
  if (keys.length > 0) {
    const role = await rbacService.createRole(
      { name: { en: `OpsNav${String(seq)}`, ar: 'دور' }, permissionKeys: keys },
      adminId,
    );
    await rbacService.ensureAssignment(id, String(role._id), 'organization');
  }
  const login = await request(app).post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD });
  expect(login.status, `login failed for ${email}`).toBe(200);
  return data<{ accessToken: string }>(login).accessToken;
};

/** The caller's whole sidebar payload. */
const sidebarOf = async (token: string): Promise<MyApplicationCategoryDto[]> => {
  const res = await request(app)
    .get('/api/v1/platform/me/applications')
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return data<MyApplicationCategoryDto[]>(res);
};

/** Every route the caller's sidebar offers, sections included. */
const routesOf = async (token: string): Promise<string[]> =>
  (await sidebarOf(token)).flatMap((group) => [
    ...group.applications.map((a) => a.route),
    ...group.sections.flatMap((s) => s.applications.map((a) => a.route)),
  ]);

const opsRoutesOf = async (token: string): Promise<string[]> =>
  (await routesOf(token)).filter((r) => r === '/operations' || r.startsWith('/operations/'));

const ALL_OPS_ROUTES = [
  '/operations',
  '/operations/shipments',
  '/operations/crew-board',
  '/operations/requirements',
  '/operations/attendance',
  '/operations/secured',
  '/operations/vault/receive',
  '/operations/vault/dispatch',
  '/operations/vault',
  '/operations/reports/vault',
  '/operations/reports/captains',
  '/operations/reports/banks',
  // C1 — the captain's phone surface, catalogued like any other app so it is reachable without
  // typing a URL. Its grant (`operationsExecution.own`) decides who may open it; whether the
  // holder is a captain TODAY is the day's crew row, which navigation does not consult.
  '/operations/my-day',
  '/operations/catalogs',
];

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  // `syncNavigationCatalog` needs a super-admin to attribute its writes to, and returns early
  // without one — so the role and the account come first, exactly as a real boot orders them.
  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions, ...fleetPermissions, ...operationsPermissions].map(
      (p) => p.key,
    ),
  );
  const { user: admin } = await userService.create(
    {
      email: 'ops-nav-admin@ecms.local',
      firstName: { ar: 'م', en: 'Admin' },
      lastName: { ar: 'م', en: 'Admin' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  adminId = String(admin._id);
  await userService.setPassword(adminId, PASSWORD, 'passwordReset');
  await userService.forceActivate(adminId);
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');

  // A privileged account cannot log in under TOTP enforcement, and every account below holds a
  // role. Turned off exactly as the navigation-derivation suite does — this suite is about which
  // rows a permission set yields, not about the second factor that guards the session.
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

  await syncNavigationCatalog();
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  await replSet?.stop();
});

describe('the catalog reaches the database (B7)', () => {
  it('1. creates the Operations category', async () => {
    const category = await ApplicationCategoryModel.findOne({ 'name.en': 'Operations' }).lean();
    expect(category, 'the Operations category').not.toBeNull();
    expect(category?.name.ar).toBe('العمليات');
  });

  it('2. seeds every shipped Operations screen as an application row', async () => {
    const rows = await ApplicationModel.find({ route: { $regex: '^/operations' } }).lean();
    expect(rows.map((r) => r.route).sort()).toEqual([...ALL_OPS_ROUTES].sort());
    // Each row carries a permission: one without a key is entitled to nobody and is invisible.
    for (const row of rows) {
      expect(row.permissionKey, row.route).toBeTruthy();
      expect(row.status, row.route).toBe('active');
    }
  });

  it('3. maps each row to the permission its route guard checks', async () => {
    const rows = await ApplicationModel.find({ route: { $regex: '^/operations' } }).lean();
    const byRoute = new Map(rows.map((r) => [r.route, r.permissionKey]));
    expect(byRoute.get('/operations')).toBe('operationsShipment.view');
    expect(byRoute.get('/operations/shipments')).toBe('operationsShipment.view');
    expect(byRoute.get('/operations/crew-board')).toBe('operationsCrew.view');
    expect(byRoute.get('/operations/requirements')).toBe('operationsCrew.view');
    expect(byRoute.get('/operations/attendance')).toBe('operationsCrew.view');
    expect(byRoute.get('/operations/secured')).toBe('operationsShipment.view');
    expect(byRoute.get('/operations/vault/receive')).toBe('operationsVault.view');
    expect(byRoute.get('/operations/vault/dispatch')).toBe('operationsVault.view');
    expect(byRoute.get('/operations/vault')).toBe('operationsVault.view');
    expect(byRoute.get('/operations/reports/vault')).toBe('operationsVault.view');
    expect(byRoute.get('/operations/reports/captains')).toBe('operationsShipment.view');
    expect(byRoute.get('/operations/reports/banks')).toBe('operationsShipment.view');
    expect(byRoute.get('/operations/catalogs')).toBe('operationsCatalog.manage');
  });

  it('4. uses the module\'s OWN permission keys — no parallel permission system', async () => {
    const declared = new Set(operationsPermissions.map((p) => p.key));
    const rows = await ApplicationModel.find({ route: { $regex: '^/operations' } }).lean();
    for (const row of rows) {
      expect(declared.has(String(row.permissionKey)), `${row.route} → ${String(row.permissionKey)}`).toBe(
        true,
      );
    }
  });
});

describe('the sidebar follows the permissions, not the catalog (B7)', () => {
  it('5. shows the whole module to an account holding every Operations grant', async () => {
    const token = await accountWith(operationsPermissions.map((p) => p.key));
    expect((await opsRoutesOf(token)).sort()).toEqual([...ALL_OPS_ROUTES].sort());

    const groups = await sidebarOf(token);
    const operations = groups.find((g) => g.name.en === 'Operations');
    expect(operations, 'the Operations group in the payload').toBeDefined();
    expect(operations?.name.ar).toBe('العمليات');
  });

  it('6. shows NOTHING to an account with no Operations grant — the catalog is not entitlement', async () => {
    // The rows exist in the database for everybody. Being catalogued is not being entitled.
    const token = await accountWith(['employee.view']);
    expect(await opsRoutesOf(token)).toEqual([]);
    const groups = await sidebarOf(token);
    expect(groups.map((g) => g.name.en)).not.toContain('Operations');
  });

  it('7. shows an account with NO role at all nothing whatsoever', async () => {
    const token = await accountWith([]);
    expect(await opsRoutesOf(token)).toEqual([]);
  });

  it('8. gives a vault-only account exactly the four vault rows', async () => {
    const token = await accountWith(['operationsVault.view']);
    expect((await opsRoutesOf(token)).sort()).toEqual(
      [
        '/operations/vault',
        '/operations/vault/dispatch',
        '/operations/vault/receive',
        '/operations/reports/vault',
      ].sort(),
    );
    // ...and not the module home, which rides the shipment grant it does not hold.
    expect(await opsRoutesOf(token)).not.toContain('/operations');
  });

  it('9. gives a crew-only account exactly the three crew rows', async () => {
    const token = await accountWith(['operationsCrew.view']);
    expect((await opsRoutesOf(token)).sort()).toEqual(
      ['/operations/attendance', '/operations/crew-board', '/operations/requirements'].sort(),
    );
  });

  it('10. gives a shipment-only account the home, the board, the backlog and the two reports', async () => {
    const token = await accountWith(['operationsShipment.view']);
    expect((await opsRoutesOf(token)).sort()).toEqual(
      [
        '/operations',
        '/operations/shipments',
        '/operations/secured',
        '/operations/reports/captains',
        '/operations/reports/banks',
      ].sort(),
    );
  });

  it('11. does not let an HR attendance grant open an Operations row', async () => {
    // The attendance page chains `operationsCrew.view` AND `attendance.view`; the catalog declares
    // the OPERATIONS half deliberately, so HR staff never see an Operations category they have no
    // business in — and the second guard still refuses them at the route and at the endpoint.
    const token = await accountWith(['attendance.view']);
    expect(await opsRoutesOf(token)).toEqual([]);
  });
});

describe('the sidebar never contradicts the server (B7)', () => {
  it('12. offers no Operations route the account is refused at the API', async () => {
    const token = await accountWith(['operationsVault.view']);
    const offered = await opsRoutesOf(token);
    expect(offered.length).toBeGreaterThan(0);

    // Every offered vault route has a live endpoint behind it that this account may actually call.
    const inventory = await request(app)
      .get('/api/v1/operations/secured/vault')
      .set('Authorization', `Bearer ${token}`);
    expect(inventory.status).toBe(200);
    const rollUp = await request(app)
      .get('/api/v1/operations/reports/vault')
      .set('Authorization', `Bearer ${token}`);
    expect(rollUp.status).toBe(200);

    // ...and a route it is NOT offered is refused at the API too, not merely hidden.
    const shipments = await request(app)
      .get('/api/v1/operations/shipments')
      .set('Authorization', `Bearer ${token}`);
    expect(shipments.status).toBe(403);
  });
});

describe('the sync is additive and idempotent (B7)', () => {
  it('13. re-running it writes no duplicate category and no duplicate rows', async () => {
    const before = await ApplicationModel.countDocuments({ route: { $regex: '^/operations' } });
    const categoriesBefore = await ApplicationCategoryModel.countDocuments({
      'name.en': 'Operations',
    });

    await syncNavigationCatalog();
    await syncNavigationCatalog();

    expect(await ApplicationModel.countDocuments({ route: { $regex: '^/operations' } })).toBe(before);
    expect(await ApplicationCategoryModel.countDocuments({ 'name.en': 'Operations' })).toBe(
      categoriesBefore,
    );
    expect(before).toBe(ALL_OPS_ROUTES.length);
  });

  it('14. leaves an administrator\'s own edit in place rather than re-imposing the seed', async () => {
    // The rule the whole catalog is built on: the seed creates what is absent and never rewrites
    // what somebody changed. A renamed row must survive the next boot.
    const row = await ApplicationModel.findOne({ route: '/operations/crew-board' });
    expect(row).not.toBeNull();
    const original = row?.name.en;
    await ApplicationModel.updateOne(
      { route: '/operations/crew-board' },
      { $set: { 'name.en': 'Renamed By Admin' } },
    );

    await syncNavigationCatalog();

    const after = await ApplicationModel.findOne({ route: '/operations/crew-board' }).lean();
    expect(after?.name.en).toBe('Renamed By Admin');

    await ApplicationModel.updateOne(
      { route: '/operations/crew-board' },
      { $set: { 'name.en': original } },
    );
  });
});
