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
import {
  OPERATIONS_BANK_REPORT_KEYS,
  SettingKeys,
  platformPermissions,
  type MyApplicationCategoryDto,
} from '@ecms/contracts';
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
import { applicationRepository, applicationService } from '../../src/platform/applications';
import { applicationCategoryRepository } from '../../src/platform/application-categories';
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
  // «سجل الشحنات» — the day board over a range of days, on the board's own grant.
  '/operations/shipments/history',
  '/operations/crew-board',
  // الطاقم الثابت — the permanent crew each day's board is seeded from. No legacy equivalent, and
  // no permission of its own: deciding who crews which vehicle is one authority, said once here
  // instead of every morning.
  '/operations/standing-crew',
  '/operations/requirements',
  // Round 14 — «إدارات العمليات», a screen of its own beneath the roster: «شاشة لوحدها في القائمة».
  // On the platform's `setting.edit` (the grant that writes its setting), not an Operations key.
  '/operations/crew-departments',
  '/operations/attendance',
  '/operations/secured',
  // Round 12 — «توزيع المحصنات», the day's محصنات onto the day's vans, on the secured screen's grant.
  '/operations/secured/distribution',
  '/operations/vault/receive',
  // Round 12 — «تسليم المحصنات», the vault handing each van its load, on the vault screens' grant.
  '/operations/vault/handover',
  '/operations/vault/dispatch',
  '/operations/vault',
  // Round 14 — «تجميع الخزينة» (`/operations/reports/vault`) is gone: «تقرير البنوك» shows it now.
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
    expect(byRoute.get('/operations/standing-crew')).toBe('operationsCrew.view');
    expect(byRoute.get('/operations/requirements')).toBe('operationsCrew.view');
    expect(byRoute.get('/operations/crew-departments')).toBe('setting.edit');
    expect(byRoute.get('/operations/attendance')).toBe('operationsCrew.view');
    expect(byRoute.get('/operations/secured')).toBe('operationsShipment.view');
    expect(byRoute.get('/operations/secured/distribution')).toBe('operationsShipment.view');
    expect(byRoute.get('/operations/vault/receive')).toBe('operationsVault.view');
    expect(byRoute.get('/operations/vault/handover')).toBe('operationsVault.view');
    expect(byRoute.get('/operations/vault/dispatch')).toBe('operationsVault.view');
    expect(byRoute.get('/operations/vault')).toBe('operationsVault.view');
    expect(byRoute.get('/operations/reports/captains')).toBe('operationsShipment.view');
    expect(byRoute.get('/operations/reports/banks')).toBe('operationsShipment.view');
    expect(byRoute.get('/operations/catalogs')).toBe('operationsCatalog.manage');
  });

  it('4. uses the module\'s OWN permission keys — no parallel permission system', async () => {
    const declared = new Set(operationsPermissions.map((p) => p.key));
    const rows = await ApplicationModel.find({ route: { $regex: '^/operations' } }).lean();
    for (const row of rows) {
      // «إدارات العمليات» edits a platform setting, on the platform's grant that writes it.
      if (row.route === '/operations/crew-departments') {
        expect(row.permissionKey).toBe('setting.edit');
        continue;
      }
      expect(declared.has(String(row.permissionKey)), `${row.route} → ${String(row.permissionKey)}`).toBe(
        true,
      );
    }
  });
});

describe('the sidebar follows the permissions, not the catalog (B7)', () => {
  it('5. shows the whole module to an account holding every Operations grant', async () => {
    // …and `setting.edit`, which «إدارات العمليات» rides; without it, every row but that one.
    const without = await accountWith(operationsPermissions.map((p) => p.key));
    expect((await opsRoutesOf(without)).sort()).toEqual(
      ALL_OPS_ROUTES.filter((r) => r !== '/operations/crew-departments').sort(),
    );
    const token = await accountWith([...operationsPermissions.map((p) => p.key), 'setting.edit']);
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

  it('8. gives a vault-only account exactly the four vault rows and «تقرير البنوك»', async () => {
    const token = await accountWith(['operationsVault.view']);
    expect((await opsRoutesOf(token)).sort()).toEqual(
      [
        '/operations/vault',
        '/operations/vault/dispatch',
        // Round 12 — «تسليم المحصنات» is the vault's, like the receive screen above it.
        '/operations/vault/handover',
        '/operations/vault/receive',
        // Round 14 — the screen «تجميع الخزينة» was, so the vault keeps it: its stored key is the
        // shipments' read, and `SHARED_NAVIGATION_ROWS` opens it for the vault's.
        '/operations/reports/banks',
      ].sort(),
    );
    // …but not the captain report, which stays the shipments'.
    expect(await opsRoutesOf(token)).not.toContain('/operations/reports/captains');
    // ...and not the module home, which rides the shipment grant it does not hold.
    expect(await opsRoutesOf(token)).not.toContain('/operations');
  });

  it('9. gives a crew-only account exactly the four crew rows', async () => {
    const token = await accountWith(['operationsCrew.view']);
    expect((await opsRoutesOf(token)).sort()).toEqual(
      [
        '/operations/attendance',
        '/operations/crew-board',
        '/operations/requirements',
        // The standing crew rides this same grant, which is the whole point of not giving it one
        // of its own: whoever plans crews maintains the standing crew, with nothing to re-grant.
        '/operations/standing-crew',
      ].sort(),
    );
  });

  it('10. gives a shipment-only account the home, the board and its history, the backlog, its distribution and the two reports', async () => {
    const token = await accountWith(['operationsShipment.view']);
    expect((await opsRoutesOf(token)).sort()).toEqual(
      [
        '/operations',
        '/operations/shipments',
        '/operations/shipments/history',
        '/operations/secured',
        // Round 12 — «توزيع المحصنات» reads on the secured screen's own grant.
        '/operations/secured/distribution',
        '/operations/reports/captains',
        '/operations/reports/banks',
      ].sort(),
    );
  });

  it('10b. gives a settings administrator «إدارات العمليات» and no other Operations row', async () => {
    // Round 14 — the screen's guard is the setting's own write grant; it opens nothing else here.
    const token = await accountWith(['setting.edit']);
    expect(await opsRoutesOf(token)).toEqual(['/operations/crew-departments']);
    // A crew planner without the grant does not get it: it would open onto a card he cannot save.
    const planner = await accountWith(['operationsCrew.view', 'operationsCrew.plan']);
    expect(await opsRoutesOf(planner)).not.toContain('/operations/crew-departments');
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
    // Round 14 — «تقرير البنوك», offered to the vault through the shared row, answers it too.
    const banks = await request(app)
      .get('/api/v1/operations/reports/banks')
      .set('Authorization', `Bearer ${token}`);
    expect(banks.status).toBe(200);
    // Round 12 — «سجل الخزينة»'s report on top, and «تسليم المحصنات»'s read: both the vault's.
    const held = await request(app)
      .get('/api/v1/operations/reports/vault/held')
      .set('Authorization', `Bearer ${token}`);
    expect(held.status).toBe(200);
    const handover = await request(app)
      .get('/api/v1/operations/secured/distribution')
      .set('Authorization', `Bearer ${token}`);
    expect(handover.status).toBe(200);

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

  it('15. renames the two vault rows on a live installation still wearing the old names (Round 12)', async () => {
    // «وعاوز اغير اسم صرف الخزينة ل محصنات الخزينة», and «جرد الخزينة» became «سجل الخزينة». An
    // installation seeded before Round 12 holds the old names; the boot renames them while they are
    // still the old defaults — and leaves a language an administrator renamed alone.
    await ApplicationModel.updateOne(
      { route: '/operations/vault/dispatch' },
      { $set: { name: { ar: 'صرف الخزينة', en: 'Vault Dispatch' } } },
    );
    await ApplicationModel.updateOne(
      { route: '/operations/vault' },
      { $set: { name: { ar: 'جرد الخزينة', en: 'Our Vault' } } },
    );

    await syncNavigationCatalog();

    const dispatch = await ApplicationModel.findOne({ route: '/operations/vault/dispatch' }).lean();
    expect(dispatch?.name).toEqual({ ar: 'محصنات الخزينة', en: 'Vault Shipments' });
    const history = await ApplicationModel.findOne({ route: '/operations/vault' }).lean();
    // Arabic was the old default → renamed; English was the administrator's → kept.
    expect(history?.name).toEqual({ ar: 'سجل الخزينة', en: 'Our Vault' });

    // An administrator's Arabic name survives the next boot too.
    await ApplicationModel.updateOne(
      { route: '/operations/vault/dispatch' },
      { $set: { 'name.ar': 'خزنتنا' } },
    );
    await syncNavigationCatalog();
    expect(
      (await ApplicationModel.findOne({ route: '/operations/vault/dispatch' }).lean())?.name.ar,
    ).toBe('خزنتنا');

    await ApplicationModel.updateOne(
      { route: '/operations/vault/dispatch' },
      { $set: { name: { ar: 'محصنات الخزينة', en: 'Vault Shipments' } } },
    );
    await ApplicationModel.updateOne(
      { route: '/operations/vault' },
      { $set: { name: { ar: 'سجل الخزينة', en: 'Vault History' } } },
    );
  });

  it('16. retires «تجميع الخزينة» on a live installation, once (Round 14)', async () => {
    // «تجميع خزينه كشاشه مفيش حاجه اسمها تجميع خزينه، شيلها خالص». An installation seeded before
    // Round 14 still holds the row, and the sync never deletes — so the catalog retires it: inactive,
    // ONCE, recorded on the module tile, and gone from the sidebar of everybody who had it.
    const route = '/operations/reports/vault';
    const operations = await applicationCategoryRepository.findOne({ 'name.en': 'Operations' });
    expect(operations).not.toBeNull();
    await applicationService.create(
      {
        name: { ar: 'تجميع الخزينة', en: 'Vault Roll-up' },
        icon: 'chart',
        route,
        categoryId: String(operations?._id),
        sortOrder: 995,
        permissionKey: 'operationsVault.view',
      },
      adminId,
    );
    const tile = await applicationCategoryRepository.findOne({ 'name.en': 'Operations' });
    await applicationCategoryRepository.updateById(
      String(tile?._id),
      { retiredRevision: 0 },
      { by: adminId, version: tile?.__v ?? 0 },
    );
    const vault = await accountWith(['operationsVault.view']);
    // Before the boot: the pre-Round-14 sidebar, which still offers it.
    expect(await opsRoutesOf(vault)).toContain(route);

    await syncNavigationCatalog();
    expect((await applicationRepository.findOne({ route }))?.status).toBe('inactive');
    expect(
      (await applicationCategoryRepository.findOne({ 'name.en': 'Operations' }))?.retiredRevision,
    ).toBe(1);
    const after = await opsRoutesOf(vault);
    expect(after).not.toContain(route);
    // The vault's reader keeps the report itself, under its new name.
    expect(after).toContain('/operations/reports/banks');
    for (const key of OPERATIONS_BANK_REPORT_KEYS) {
      expect(await opsRoutesOf(await accountWith([key])), key).toContain('/operations/reports/banks');
    }

    // An administrator who switches it back on is not overruled by the next boot.
    const row = await applicationRepository.findOne({ route });
    await applicationService.update(String(row?._id), { status: 'active', version: row?.__v ?? 0 }, adminId);
    await syncNavigationCatalog();
    expect((await applicationRepository.findOne({ route }))?.status).toBe('active');
    // Leave the suite as the catalog seeds it: the stray row out of the way.
    await ApplicationModel.deleteOne({ route });
  });
});
