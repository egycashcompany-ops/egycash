// `GET /fleet/dashboard/now` and `/period` end to end — the doors, the readers, the clock and the
// old book's rows (plan P1-07, P1-08, P1-13; §8.11).
//
// The figure-by-figure parity lives in `fleet-dashboard-parity.spec.ts`. This file asks what only a
// real database WITH REAL ROLES can answer:
//   1. one Cairo day per request: the clock pinned at 2026-10-31T23:30Z reads 2026-11-01, and the
//      period presets resolve on it; the period query is refused when it is not a real period;
//   2. who gets what: a caller with no key is turned away (403 + the audit row); a caller with one
//      key gets exactly the sections that key opens — and NOT a section whose data key they hold
//      without the linked screen's guard; a branch-scoped reader sees their branch — every figure,
//      the company sources too — and a reader reaching two branches sees both («كل فروعي»); an `own`
//      grant never narrows a company source to what the reader created; the switcher
//      (X-Active-Branch) narrows the read inside the reader's branches and is echoed, a stale one is
//      ignored;
//   3. the old book's rows — an odometer row and a visit with only a code, an undated accident —
//      count in the company view exactly as on the unfiltered screens, and drop out once a set exists;
//   4. the old landing read (`GET /fleet/dashboard`) is gone;
//   5. «المخالفات المرورية والتسويات» and «الوقود والمصروفات»: each part opens with its own key (a
//      violations-only reader now reads the period), and under a branch the fuel cards follow their
//      CURRENT car (a deleted car's card counts in its last branch, a card on no car in the company
//      view only) and the old book's carless fines are named apart in the company view only;
//   6. «العهدة» and «التراخيص والتجديدات»: a licensing-only reader keeps R1 (the papers alone) and no
//      R2; a licence-expense-only reader reads R2 (`licenceSpend` alone) and no R1; the custody fund's
//      key adds «منها حتى الآن» (`custodyStates`) beside the receipts' and answers nothing alone;
//      under a branch the custody spend follows the receipt's car, the licence memos stay the
//      company's, and the cars' licence rows and months narrow to the branch's cars.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  platformPermissions,
  type FleetCatalogItemDto,
  type FleetDashboardNowDto,
  type FleetDashboardNowSection,
  type FleetDashboardPeriodDto,
  type FleetDashboardPeriodSection,
  type FleetVehicleDto,
  type FleetVehicleTypeDto,
} from '@ecms/contracts';
import mongoose, { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { fleetPermissions } from '../../src/modules/fleet/fleet.module';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { authService } from '../../src/platform/auth';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';
import { FleetAccidentModel } from '../../src/modules/fleet/accidents/accident.model';
import { FleetOdometerLogModel } from '../../src/modules/fleet/odometer/odometer.model';
import { FleetMaintenanceVisitModel } from '../../src/modules/fleet/maintenance/maintenance.model';
import { FleetFuelCardModel } from '../../src/modules/fleet/fuel-cards/fuel-card.model';
import { FleetViolationModel } from '../../src/modules/fleet/violations/violation.model';
import { FleetReceiptModel } from '../../src/modules/fleet/receipts/receipt.model';
import { FleetCustodyMemoModel } from '../../src/modules/fleet/custody/custody-memo.model';
import { FleetLicenseExpenseModel } from '../../src/modules/fleet/license-expenses/license-expense.model';

const NOW = new Date('2026-10-31T23:30:00.000Z');
/** No exit in the range under a vehicle set: zeros, no mean, and no «غير مسجّلة» line. */
const NO_EXITS_UNDER_A_SET = {
  count: 0,
  avgStayDays: null,
  byWorkType: [],
  byWorkshop: [],
  topVehicles: [],
  unregistered: null,
};
const TODAY = '2026-11-01';
const OCT = { preset: 'custom', from: '2026-10-01', to: '2026-10-31' } as const;

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let adminUserId: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-fleet-dashboard-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

/** The real clock, captured before the fake one is installed. */
const RealDate = globalThis.Date;

/**
 * Pin the clock for the rest of the suite — after the connection is up, and without breaking it.
 *
 * Mongoose stamps every heartbeat with the GLOBAL clock (faked here) but judges a connection stale
 * with its own snapshot of the REAL one (`readyState`: no heartbeat for two intervals ⇒
 * disconnected). With the clock pinned before today, the first heartbeat would make every later
 * query buffer and time out; so each heartbeat is re-stamped with the real clock. The app's own
 * reads all see the pinned instant.
 */
const pinClock = (at: Date): void => {
  const connection = mongoose.connection as unknown as { _lastHeartbeatAt: number | null };
  mongoose.connection.getClient().on('serverHeartbeatSucceeded', () => {
    connection._lastHeartbeatAt = RealDate.now();
  });
  vi.useFakeTimers({ toFake: ['Date'], now: at, shouldAdvanceTime: true });
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
const call = (
  path: string,
  token: string,
  query: Record<string, unknown> = {},
  branch?: string,
) => {
  const req = request(app)
    .get(`/api/v1${path}`)
    .query(query)
    .set('Authorization', `Bearer ${token}`);
  return branch === undefined ? req : req.set('X-Active-Branch', branch);
};
const send = (method: 'post' | 'delete', path: string, body: Record<string, unknown> = {}) =>
  request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${adminToken}`).send(body);
const ok = <T>(res: request.Response, status = 200): T => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return data<T>(res);
};
const nowOf = async (token: string, branch?: string) =>
  ok<FleetDashboardNowDto>(await call('/fleet/dashboard/now', token, {}, branch));
const periodOf = async (token: string, query: Record<string, unknown> = OCT, branch?: string) =>
  ok<FleetDashboardPeriodDto>(await call('/fleet/dashboard/period', token, query, branch));

const NOW_SECTIONS: readonly FleetDashboardNowSection[] = [
  'vehicles',
  'roster',
  'workshop',
  'maintenanceAlarm',
  'noReading',
  'distributionVehicles',
  'distributionDrivers',
  'licenceVehicles',
  'licenceDrivers',
  'papers',
  'fuelCards',
  'fuelCharging',
  'fuelCardList',
  'fuelSheets',
  'notices',
  'dealershipPending',
  'accidentsOpen',
  'violationsYear',
  'violationsOpen',
];
const PERIOD_SECTIONS: readonly FleetDashboardPeriodSection[] = [
  'km',
  'visits',
  'exits',
  'accidents',
  'accidentList',
  'violations',
  'violationList',
  'opex',
  'opexSeries',
  'custodyStates',
  'dealership',
  'dealershipList',
  'licenceSpend',
];
const present = (dto: object, keys: readonly string[]): string[] =>
  keys.filter((key) => (dto as Record<string, unknown>)[key] !== null);

let mailbox = 0;
/** A user holding exactly these keys, through a real role at a real scope. */
const reader = async (
  keys: string[],
  scope: 'organization' | 'branch' | 'own' = 'organization',
  branchId: string | null = null,
): Promise<{ id: string; token: string }> => {
  mailbox += 1;
  const { user } = await userService.create(
    {
      email: `dash-reader-${mailbox}@ecms.local`,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  const id = String(user._id);
  await userService.forceActivate(id);
  if (keys.length > 0) {
    const role = await rbacService.createRole(
      {
        name: { en: `Dashboard reader ${mailbox}`, ar: `قارئ اللوحة ${mailbox}` },
        permissionKeys: keys,
      },
      adminUserId,
    );
    await rbacService.ensureAssignment(id, String(role._id), scope);
  }
  return { id, token: await authService.signAccessToken(id, new Types.ObjectId().toString(), 0) };
};

/** A reader placed in B1 whose branch grant also lists B2 — «كل فروعي» (ADR-015 reach). */
const multiReader = async (keys: string[]): Promise<{ id: string; token: string }> => {
  const placed = await reader([], 'branch', B1);
  mailbox += 1;
  const role = await rbacService.createRole(
    {
      name: { en: `Dashboard reach ${mailbox}`, ar: `قارئ الفروع ${mailbox}` },
      permissionKeys: keys,
    },
    adminUserId,
  );
  await rbacService.assignRole(
    { userId: placed.id, roleId: String(role._id), scope: 'branch', branchIds: [B2] },
    adminUserId,
  );
  return placed;
};

let B1: string;
let B2: string;
let T1: string;
let car1: FleetVehicleDto; // B1
let car2: FleetVehicleDto; // B2
let car3: FleetVehicleDto; // B1, DELETED — a fuel card still sits on it

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();
  pinClock(NOW);
  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions, ...fleetPermissions].map((p) => p.key),
  );
  const { user } = await userService.create(
    {
      email: 'dash-admin@ecms.local',
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  adminUserId = String(user._id);
  await userService.forceActivate(adminUserId);
  await rbacService.ensureAssignment(adminUserId, String(superAdmin._id), 'organization');
  const ctx: AuthContext = {
    userId: adminUserId,
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
  adminToken = await authService.signAccessToken(adminUserId, new Types.ObjectId().toString(), 0);

  const mkBranch = async (code: string, ar: string) =>
    ok<{ id: string }>(
      await send('post', '/platform/branches', { code, name: { ar, en: ar } }),
      201,
    ).id;
  B1 = await mkBranch('73', 'فرع دمنهور');
  B2 = await mkBranch('74', 'فرع سوهاج');
  T1 = ok<FleetVehicleTypeDto>(
    await send('post', '/fleet/vehicle-types', {
      name: { ar: 'مصفحة', en: 'Armored' },
      maintenanceIntervalKm: 10_000,
    }),
    201,
  ).id;
  const catalog = async (kind: string, ar: string) =>
    ok<FleetCatalogItemDto[]>(
      await call('/fleet/catalog-items', adminToken, { kind, pageSize: 100 }),
    ).find((item) => item.name.ar === ar)?.id ??
    ok<FleetCatalogItemDto>(
      await send('post', '/fleet/catalog-items', { kind, name: { ar, en: ar } }),
      201,
    ).id;
  const workshopId = await catalog('workshop', 'ورشة الاختبار');
  const workTypeId = await catalog('workType', 'صيانة');

  let n = 0;
  const mkVehicle = async (branchId: string) => {
    n += 1;
    return ok<FleetVehicleDto>(
      await send('post', '/fleet/vehicles', {
        code: `${880 + n}`,
        typeId: T1,
        plateNumber: `ع ت ${n}`,
        chassisNumber: `ECH-${n}`,
        motorNumber: `EMO-${n}`,
        joinedAt: '2025-01-01T00:00:00.000Z',
        licenseExpiresAt: '2026-10-15T00:00:00.000Z',
        radio: { issi: `EISSI-${n}` },
        branchId,
      }),
      201,
    );
  };
  car1 = await mkVehicle(B1);
  car2 = await mkVehicle(B2);
  for (const [car, day, reading] of [
    [car1, '2026-10-05', 100],
    [car1, '2026-10-06', 160],
    [car2, '2026-10-05', 700],
    [car2, '2026-10-06', 790],
  ] as const) {
    ok(await send('post', '/fleet/odometer', { vehicleId: car.id, date: day, reading }), 201);
  }
  ok(
    await send('post', '/fleet/maintenance', {
      vehicleId: car2.id,
      inDate: '2026-10-20',
      workshopId,
      workTypeId,
    }),
    201,
  );
  ok(
    await send('post', '/fleet/accidents', {
      vehicleId: car1.id,
      occurredAt: '2026-10-18',
      culprit: 'طرف ثالث',
      statement: 'اصطدام',
      companyCost: 600,
      amountCollected: 0,
      paidAmount: 100,
    }),
    201,
  );

  // Two open notices, both still owed their cheque image: one on car1 (B1), dated, and one written
  // before a car was chosen — no car, no date.
  for (const body of [
    {
      template: 'misrInsurance',
      values: { driverName: 'سائق' },
      vehicleId: car1.id,
      noticeNumber: 'N-7',
      noticeDate: '2026-10-10',
    },
    { template: 'deltaInsurance', values: { driverName: 'سائق' }, vehicleId: null },
  ]) {
    ok(await send('post', '/fleet/notices', body), 201);
  }

  // The old book: a closed odometer row, a visit and an undated accident on cars the registry has no
  // record of (`vehicleId: null`, the book's code kept), as go-live imported them.
  const legacy = { isDeleted: false, schemaVersion: 1, createdBy: null, updatedBy: null };
  await FleetOdometerLogModel.create({
    ...legacy,
    vehicleId: null,
    vehicleCode: 'B-9',
    date: new Date('2026-10-10T00:00:00.000Z'),
    outReading: 100,
    inReading: 140,
    km: 40,
    driver1EmployeeId: null,
    driver2EmployeeId: null,
    driver1Name: null,
    driver2Name: null,
    notes: null,
  });
  await FleetMaintenanceVisitModel.create({
    ...legacy,
    vehicleId: null,
    vehicleCode: 'B-9',
    inDate: new Date('2026-10-12T00:00:00.000Z'),
    outDate: new Date('2026-10-13T00:00:00.000Z'),
    workshopId: new Types.ObjectId(workshopId),
    workTypeId: new Types.ObjectId(workTypeId),
  });
  await FleetAccidentModel.create({
    ...legacy,
    vehicleId: new Types.ObjectId(car1.id),
    vehicleCode: null,
    occurredAt: null,
    culprit: 'دفتر',
    culpritEmployeeId: null,
    statement: 'بلا تاريخ',
    companyCost: 5,
    amountCollected: 0,
    paidAmount: 0,
    status: 'open',
    notes: null,
  });

  // «الوقود والمصروفات»: four cards — car1's (B1: nearly empty, expiring on 10 November), car2's
  // (B2: nothing to follow), one on no car («سفر», expired), and one on car3, a B1 car deleted
  // since (a request waiting, a low balance). Written as the cards service stores them.
  car3 = await mkVehicle(B1);
  const deleted = await send('delete', `/fleet/vehicles/${car3.id}`);
  expect([200, 204]).toContain(deleted.status);
  const card = (n: number, over: Record<string, unknown>) => ({
    ...legacy,
    vehicleId: null,
    label: null,
    company: 'wataniya',
    name: `كارت ${n}`,
    number: `70459900${String(n).padStart(8, '0')}`,
    expiresAt: null,
    password: null,
    balance: 1000,
    requestedAmount: null,
    requestedAt: null,
    lastChargedAt: null,
    image: null,
    ...over,
  });
  await FleetFuelCardModel.create([
    card(1, {
      vehicleId: new Types.ObjectId(car1.id),
      balance: 50,
      expiresAt: new Date('2026-11-10T00:00:00.000Z'),
    }),
    card(2, { vehicleId: new Types.ObjectId(car2.id), company: 'chillout' }),
    card(3, { label: 'سفر', balance: 400, expiresAt: new Date('2026-10-20T00:00:00.000Z') }),
    card(4, {
      vehicleId: new Types.ObjectId(car3.id),
      company: 'chillout',
      balance: 200,
      requestedAmount: 300,
    }),
  ]);

  // «المخالفات المرورية والتسويات»: a «مجهول» fine on car1 (B1) and one from the old book on a car
  // the registry never had (code only), both owed, both October's; and car2's statement of 2026.
  const driverType = ok<FleetCatalogItemDto>(
    await send('post', '/fleet/catalog-items', {
      kind: 'violationType',
      name: { ar: 'سرعة الاختبار', en: 'Speed' },
      violationSide: 'driver',
    }),
    201,
  ).id;
  const companyType = ok<FleetCatalogItemDto>(
    await send('post', '/fleet/catalog-items', {
      kind: 'violationType',
      name: { ar: 'رسوم الاختبار', en: 'Fees' },
      violationSide: 'company',
    }),
    201,
  ).id;
  const fine = {
    ...legacy,
    kind: 'driver',
    violationTypeId: new Types.ObjectId(driverType),
    year: null,
    count: null,
    unitValue: null,
    driverEmployeeId: null,
    collected: false,
  };
  await FleetViolationModel.create([
    {
      ...fine,
      vehicleId: new Types.ObjectId(car1.id),
      vehicleCode: null,
      amount: 100,
      date: new Date('2026-10-10T00:00:00.000Z'),
      driverName: 'مجهول',
    },
    {
      ...fine,
      vehicleId: null,
      vehicleCode: 'B-9',
      amount: 60,
      date: new Date('2026-10-12T00:00:00.000Z'),
      driverName: 'سائق من الدفتر',
    },
    {
      ...fine,
      kind: 'vehicle',
      vehicleId: new Types.ObjectId(car2.id),
      vehicleCode: null,
      violationTypeId: new Types.ObjectId(companyType),
      year: 2026,
      count: 1,
      unitValue: 300,
      amount: 300,
      date: null,
      driverName: null,
    },
  ]);
}, 240_000);

afterAll(async () => {
  vi.useRealTimers();
  await getCache().close();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('the clock — one Cairo day per request (R-01)', () => {
  it('2026-10-31T23:30Z is 2026-11-01 on both reads; this month is that one day', async () => {
    const now = await nowOf(adminToken);
    expect(now.today).toBe(TODAY);
    expect(Date.parse(now.asOf)).toBeGreaterThanOrEqual(NOW.getTime());
    const period = await periodOf(adminToken, {});
    expect(period.today).toBe(TODAY);
    expect(period.range).toEqual({
      preset: 'thisMonth',
      from: TODAY,
      to: TODAY,
      days: 1,
      granularity: 'day',
    });
  });

  it.each([
    ['lastMonth', { from: '2026-10-01', to: '2026-10-31', days: 31, granularity: 'day' }],
    ['last30', { from: '2026-10-03', to: TODAY, days: 30, granularity: 'day' }],
    ['thisYear', { from: '2026-01-01', to: TODAY, days: 305, granularity: 'month' }],
  ] as const)('%s resolves on the Cairo day', async (preset, range) => {
    expect((await periodOf(adminToken, { preset })).range).toEqual({ preset, ...range });
  });

  it.each([
    ['custom without dates', { preset: 'custom' }],
    ['dates without custom', { from: '2026-10-01', to: '2026-10-02' }],
    ['from after to', { preset: 'custom', from: '2026-10-05', to: '2026-10-01' }],
    ['367 inclusive days', { preset: 'custom', from: '2025-10-31', to: '2026-11-01' }],
    ['an unknown parameter', { preset: 'thisMonth', branch: 'x' }],
    ['a date that does not exist', { preset: 'custom', from: '2026-02-30', to: '2026-03-01' }],
  ])('refuses %s with 400', async (_name, query) => {
    const res = await call('/fleet/dashboard/period', adminToken, query);
    expect(res.status).toBe(400);
  });

  it('accepts 366 inclusive days', async () => {
    const res = await call('/fleet/dashboard/period', adminToken, {
      preset: 'custom',
      from: '2025-11-01',
      to: '2026-11-01',
    });
    expect(res.status).toBe(200);
    expect(data<FleetDashboardPeriodDto>(res).range).toMatchObject({
      days: 366,
      granularity: 'month',
    });
  });
});

describe('the doors — real roles (R-28, §5.5)', () => {
  it('turns a caller with no fleet key away from both reads, and audits the denial', async () => {
    const nobody = await reader([]);
    expect((await call('/fleet/dashboard/now', nobody.token)).status).toBe(403);
    expect((await call('/fleet/dashboard/period', nobody.token)).status).toBe(403);
    let rows: unknown[] = [];
    for (let attempt = 0; attempt < 20 && rows.length === 0; attempt += 1) {
      const audit = await call('/platform/audit-logs', adminToken, {
        action: 'permissionDenied',
        entityType: 'user',
        entityId: nobody.id,
      });
      rows = data<unknown[]>(audit);
      if (rows.length === 0) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(rows.length).toBeGreaterThan(0);
  });

  it('a workshop clerk gets the workshop sections only — no alarm line without the alarms screen', async () => {
    const clerk = await reader(['fleetMaintenance.view']);
    const now = await nowOf(clerk.token);
    // «آخر ما سُجّل» is retired: the clerk's only R1 section is the workshop.
    expect(present(now, NOW_SECTIONS)).toEqual(['workshop']);
    expect(now).not.toHaveProperty('recentWorkshop');
    expect(now.alerts.map((a) => a.id)).not.toContain('maintenanceRed');
    expect(present(await periodOf(clerk.token), PERIOD_SECTIONS)).toEqual(['visits', 'exits']);
  });

  it('the cards reader gets the expired cards; the balances need the charging screen too', async () => {
    const cards = await reader(['fleetFuelCard.view']);
    expect(present(await nowOf(cards.token), NOW_SECTIONS)).toEqual(['fuelCards']);
    const charging = await reader(['fleetFuelCard.view', 'fleetFuelCharge.view']);
    expect(present(await nowOf(charging.token), NOW_SECTIONS)).toEqual([
      'fuelCards',
      'fuelCharging',
      'fuelCardList',
      'fuelSheets',
    ]);
    // The charging screen's key alone opens the door and nothing behind it — no 403, nothing shown.
    const guardOnly = await reader(['fleetFuelCharge.view']);
    const empty = await nowOf(guardOnly.token);
    expect(present(empty, NOW_SECTIONS)).toEqual([]);
    expect(empty.alerts).toEqual([]);
    expect((await call('/fleet/dashboard/period', guardOnly.token)).status).toBe(403);
  });

  it('a violations-only reader now reads the period: «مخالفات السائقين في الفترة» and nothing else', async () => {
    const fines = await reader(['fleetViolation.view']);
    expect(present(await nowOf(fines.token), NOW_SECTIONS)).toEqual([
      'violationsYear',
      'violationsOpen',
    ]);
    expect(present(await periodOf(fines.token), PERIOD_SECTIONS)).toEqual([
      'violations',
      'violationList',
    ]);
  });

  it('the receipts reader gets «مصروف التشغيل» and its days; the dealership reader its card and its rows', async () => {
    const receipts = await reader(['fleetReceipt.view']);
    expect((await call('/fleet/dashboard/now', receipts.token)).status).toBe(403);
    // «منها حتى الآن» (`custodyStates`) needs the custody fund's key beside the receipts'.
    expect(present(await periodOf(receipts.token), PERIOD_SECTIONS)).toEqual([
      'opex',
      'opexSeries',
    ]);
    const dealership = await reader(['fleetDealership.view']);
    expect(present(await nowOf(dealership.token), NOW_SECTIONS)).toEqual(['dealershipPending']);
    expect(present(await periodOf(dealership.token), PERIOD_SECTIONS)).toEqual([
      'dealership',
      'dealershipList',
    ]);
  });

  it('the odometer reader gets the alarm and no-reading lines now, and the kilometres of a period', async () => {
    const odo = await reader(['fleetOdometer.view']);
    expect(present(await nowOf(odo.token), NOW_SECTIONS)).toEqual([
      'maintenanceAlarm',
      'noReading',
    ]);
    expect(present(await periodOf(odo.token), PERIOD_SECTIONS)).toEqual(['km']);
  });

  it('a branch-scoped vehicles reader sees their branch: its cars, its column', async () => {
    const dispatcher = await reader(['fleetVehicle.view'], 'branch', B2);
    const now = await nowOf(dispatcher.token);
    expect(now.vehicles?.active).toBe(1);
    expect(now.distributionVehicles?.branches.map((b) => b.id)).toEqual([B2]);
    expect(now.distributionVehicles?.totals).toEqual({
      counts: { [B2]: 1 },
      noBranch: 0,
      total: 1,
    });
    // Its car runs no operation: «أخرى», in its own column; no «بلا فرع».
    expect(now.distributionVehicles?.kinds).toEqual({ [B2]: { cash: 0, atm: 0, other: 1 } });
    expect(now.distributionVehicles?.noBranchKinds).toEqual({ cash: 0, atm: 0, other: 0 });
    expect(now.distributionVehicles?.other).toEqual({ vehicles: 1 });
    expect(now.licenceVehicles?.list.map((row) => row.code)).toEqual([car2.code]);
  });

  it('an `own` grant never turns a company figure into «what I created»', async () => {
    const own = await reader(['fleetAccident.view'], 'own');
    const mine = await nowOf(own.token);
    const admin = await nowOf(adminToken);
    expect(mine.accidentsOpen).toEqual(admin.accidentsOpen);
    expect(mine.accidentsOpen?.count).toBe(2);
    const screen = ok<{ count: number }>(
      await call('/fleet/accidents/summary', own.token, { status: 'open' }),
    );
    expect(mine.accidentsOpen?.count).toBe(screen.count);
    const period = await periodOf(own.token);
    expect(period.accidents?.count).toBe(1);
  });

  it('the switcher narrows the read to its branch and says so', async () => {
    const now = await nowOf(adminToken, B1);
    expect(now.branchId).toBe(B1);
    expect(now.scopeBranches).toEqual([{ id: B1, name: { ar: 'فرع دمنهور', en: 'فرع دمنهور' } }]);
    expect(now.vehicles?.active).toBe(1);
    expect(now.vehicleScope).toMatchObject({
      branchId: B1,
      count: 1,
      scopeBranches: now.scopeBranches,
    });
    // Both open files are B1's car's — the undated one too: «open now» knows no period (R-23).
    expect(now.accidentsOpen?.count).toBe(2);
    const period = await periodOf(adminToken, OCT, B1);
    expect(period.vehicleScope).toMatchObject({
      branchId: B1,
      count: 1,
      scopeBranches: now.scopeBranches,
    });
    expect(period.km?.total).toBe(60);
    // One branch in scope: «حسب النوع» is drawn (D10).
    expect(period.km?.byType?.map((t) => t.km)).toEqual([60]);
    expect(period.visits).toEqual({ count: 0, closed: 0, open: 0 });
    expect(period.exits).toEqual(NO_EXITS_UNDER_A_SET);
    // A home branch is not a switch: the whole company.
    const homed = await reader(['fleetVehicle.view'], 'organization', B1);
    expect((await nowOf(homed.token)).vehicles?.active).toBe(2);
    expect((await nowOf(homed.token)).scopeBranches).toBeNull();
  });
});

describe('what the figures cover — one branch, «كل فروعي», a stale header (D9, D10)', () => {
  const KEYS = [
    'fleetVehicle.view',
    'fleetAccident.view',
    'fleetOdometer.view',
    'fleetMaintenance.view',
  ];
  const SOHAG = { id: '', name: { ar: 'فرع سوهاج', en: 'فرع سوهاج' } };

  it('a branch reader: the company sources narrow to the branch too, and the echo names it', async () => {
    const branch = await reader(KEYS, 'branch', B2);
    const now = await nowOf(branch.token);
    expect(now.scopeBranches).toEqual([{ ...SOHAG, id: B2 }]);
    // No switcher named: the branch is the reader's own, not a choice.
    expect(now.branchId).toBeNull();
    expect(now.vehicleScope).toMatchObject({
      branchId: null,
      count: 1,
      scopeBranches: now.scopeBranches,
    });
    // Both open accident files are car1's (B1): none is this branch's. The company says 2.
    expect(now.accidentsOpen?.count).toBe(0);
    expect((await nowOf(adminToken)).accidentsOpen?.count).toBe(2);
    // car2's open visit is the branch's — and its stay, the only one, the longest.
    expect(now.workshop?.open).toBe(1);
    expect(now.workshop?.longest).toHaveLength(1);
    expect(now.workshop?.longest[0]).toMatchObject({
      vehicleId: car2.id,
      code: car2.code,
      typeName: { ar: 'مصفحة', en: 'Armored' },
      inDate: '2026-10-20',
      days: 12,
      workshop: { ar: 'ورشة الاختبار' },
      workType: { ar: 'صيانة' },
    });
    expect(now.workshop?.oldest).toMatchObject({ code: car2.code, days: 12 });
    const period = await periodOf(branch.token);
    expect(period.km?.total).toBe(90);
    // The book's 40 km have no car, so no branch: not reported apart under a set.
    expect(period.km?.unregistered).toBeNull();
    // ONE branch in scope — the reader's only one — draws «حسب النوع», as a switcher would (D10).
    expect(period.km?.byType?.map((t) => t.km)).toEqual([90]);
    expect(period.vehicleScope.scopeBranches).toEqual(now.scopeBranches);
  });

  it('«كل فروعي» — a reader reaching B1 and B2 sees both, named, and never the book’s rows', async () => {
    const both = await multiReader(KEYS);
    const now = await nowOf(both.token);
    expect(new Set(now.scopeBranches?.map((b) => b.id))).toEqual(new Set([B1, B2]));
    expect(now.branchId).toBeNull();
    expect(now.vehicleScope).not.toBeNull();
    expect(now.vehicleScope?.count).toBe(2);
    expect(now.vehicles?.active).toBe(2);
    expect(now.accidentsOpen?.count).toBe(2);
    expect(now.workshop?.open).toBe(1);
    const period = await periodOf(both.token);
    expect(period.km?.total).toBe(150);
    expect(period.km?.unregistered).toBeNull();
    // Two branches are not «a branch»: by branch, never by type.
    expect(period.km?.byType).toBeNull();
    expect(new Set(period.km?.byBranch.map((b) => b.branchId))).toEqual(new Set([B1, B2]));
    // The book's visit (no car) is the company's only exit in October: not this reader's.
    expect(period.exits).toEqual(NO_EXITS_UNDER_A_SET);
    expect(new Set(period.vehicleScope.scopeBranches?.map((b) => b.id))).toEqual(new Set([B1, B2]));
  });

  it('«كل فروعي» with the switcher on one of them: that branch, honoured and echoed', async () => {
    const both = await multiReader(KEYS);
    const one = await nowOf(both.token, B2);
    expect(one.branchId).toBe(B2);
    expect(one.scopeBranches).toEqual([{ ...SOHAG, id: B2 }]);
    expect(one.accidentsOpen?.count).toBe(0);
    expect((await periodOf(both.token, OCT, B2)).km?.total).toBe(90);
  });

  it('a stale header (a branch outside a home-only reader’s grant) is ignored — the home branch stays', async () => {
    const home = await reader(KEYS, 'branch', B1);
    const now = await nowOf(home.token, B2);
    expect(now.branchId).toBeNull();
    expect(now.scopeBranches?.map((b) => b.id)).toEqual([B1]);
    expect(now.vehicles?.active).toBe(1);
    expect(now.accidentsOpen?.count).toBe(2);
    expect(now.workshop?.open).toBe(0);
    const period = await periodOf(home.token, OCT, B2);
    expect(period.km?.total).toBe(60);
    expect(period.vehicleScope.branchId).toBeNull();
  });
});

describe('the old book’s rows — counted as on the unfiltered screens (R-13, R-23)', () => {
  it('the company view counts the rows with no car, and names the undated accident', async () => {
    const dto = await periodOf(adminToken);
    expect(dto.km?.total).toBe(60 + 90 + 40);
    expect(dto.km?.unregistered).toBe(40);
    expect(
      (dto.km?.byBranch ?? []).reduce((a, b) => a + b.km, 0) + (dto.km?.unregistered ?? 0),
    ).toBe(dto.km?.total);
    // «أرقام الفترة» by CHECK-IN day: car2's (still open) and the book's (closed).
    expect(dto.visits).toEqual({ count: 2, closed: 1, open: 1 });
    // By EXIT day: only the book's visit left the workshop in October (car2's is still open). It
    // counts in the bars and as «غير مسجّلة», never in the car ranking; in 12 Oct, out 13 Oct.
    expect(dto.exits).toMatchObject({
      count: 1,
      avgStayDays: 1,
      byWorkType: [{ name: { ar: 'صيانة' }, count: 1 }],
      byWorkshop: [{ name: { ar: 'ورشة الاختبار' }, count: 1 }],
      topVehicles: [],
      unregistered: 1,
    });
    expect(
      ok<unknown[]>(
        await call('/fleet/maintenance', adminToken, { outFrom: OCT.from, outTo: OCT.to }),
      ).length,
    ).toBe(1);
    expect(dto.accidents).toMatchObject({ count: 1, undated: 1 });
    expect(dto.vehicleScope.scopeBranches).toBeNull();
    expect(dto.accidentList?.rows.map((row) => [row.code, row.date, row.remaining])).toEqual([
      [car1.code, '2026-10-18', 500],
    ]);
  });

  it('a set leaves them out: no car, no type', async () => {
    const dto = await periodOf(adminToken, { ...OCT, typeIds: T1 });
    expect(dto.vehicleScope).toMatchObject({ typeIds: [T1], count: 2 });
    expect(dto.km?.total).toBe(150);
    expect(dto.km?.unregistered).toBeNull();
    expect(dto.visits).toEqual({ count: 1, closed: 0, open: 1 });
    expect(dto.exits).toEqual(NO_EXITS_UNDER_A_SET);
    expect(dto.accidents?.undated).toBeNull();
  });
});

describe('«الحوادث ومطالبات التأمين» — the notices follow the car’s CURRENT branch (D9)', () => {
  const NOTICES = ['fleetNotice.view'];

  it('the company view counts the notice with no car and lists it last; a branch never does', async () => {
    const company = await nowOf(adminToken);
    expect(company.notices).toMatchObject({ open: 2, missingAny: 2, missingCheckImage: 2 });
    expect(company.notices?.rows.map((r) => [r.code, r.noticeNumber, r.noticeDate])).toEqual([
      [car1.code, 'N-7', '2026-10-10'],
      [null, null, null],
    ]);
    expect(company.notices?.rows[0]).toMatchObject({
      vehicleId: car1.id,
      template: 'misrInsurance',
      typeName: { ar: 'مصفحة', en: 'Armored' },
      missing: { checkImage: true },
    });
    expect(company.notices?.rows[1]).toMatchObject({
      vehicleId: null,
      typeName: null,
      template: 'deltaInsurance',
    });

    const b1 = await nowOf((await reader(NOTICES, 'branch', B1)).token);
    expect(b1.notices).toMatchObject({ open: 1, missingAny: 1 });
    expect(b1.notices?.rows.map((r) => r.code)).toEqual([car1.code]);
    const b2 = await nowOf((await reader(NOTICES, 'branch', B2)).token);
    expect(b2.notices).toMatchObject({ open: 0, missingAny: 0, rows: [] });
    expect(b2.alerts.map((a) => a.id)).not.toContain('noticesMissing');
    // «كل فروعي»: both branches — and still not the notice with no car.
    const both = await nowOf((await multiReader(NOTICES)).token);
    expect(both.notices).toMatchObject({ open: 1, missingAny: 1 });
  });

  it('the notices screen answers the same question with `branchIds`', async () => {
    const total = async (query: Record<string, unknown>) =>
      ok<{ open: number }>(await call('/fleet/notices/summary', adminToken, query)).open;
    expect(await total({ status: 'open' })).toBe(2);
    expect(await total({ status: 'open', branchIds: B1 })).toBe(1);
    expect(await total({ status: 'open', branchIds: B2 })).toBe(0);
    expect(await total({ status: 'open', branchIds: `${B1},${B2}` })).toBe(1);
  });

  it('a notices-only reader gets the notices and nothing of the period', async () => {
    const only = await reader(NOTICES);
    expect(present(await nowOf(only.token), NOW_SECTIONS)).toEqual(['notices']);
  });
});

describe('«الحوادث ومطالبات التأمين» and «العدادات والكيلومترات» — the period figures', () => {
  it('the period’s files: the four sums and the transfers, remaining = the formula', async () => {
    const dto = await periodOf(adminToken);
    const t = dto.accidents?.totals;
    expect(t).toEqual({
      amountCollected: 0,
      companyCost: 600,
      paidAmount: 100,
      transferredIn: 0,
      transferredOut: 0,
      remaining: 500,
    });
    expect(t?.remaining).toBe(
      (t?.amountCollected ?? 0) +
        (t?.companyCost ?? 0) -
        (t?.paidAmount ?? 0) +
        (t?.transferredIn ?? 0) -
        (t?.transferredOut ?? 0),
    );
    // The row: its «بيان» verbatim and the car's make.
    expect(dto.accidentList?.rows[0]).toMatchObject({
      code: car1.code,
      statement: 'اصطدام',
      typeName: { ar: 'مصفحة', en: 'Armored' },
      date: '2026-10-18',
    });
  });

  it('the coverage parts and the cars with no distance', async () => {
    const dto = await periodOf(adminToken);
    // car1 and car2 both drove on the 5th; car2's visit began on the 20th (not the whole month).
    expect(dto.km?.coverage).toEqual({
      withReadings: 2,
      of: 2,
      active: 2,
      inWorkshop: 0,
      joinedAfter: 0,
    });
    expect(dto.km?.noDistance).toEqual({ cars: 0, neverRead: 0, codes: [], neverReadCodes: [] });
    expect(dto.km?.invalidList).toEqual([]);
    expect(dto.km?.top5.map((r) => r.typeName)).toEqual([
      { ar: 'مصفحة', en: 'Armored' },
      { ar: 'مصفحة', en: 'Armored' },
    ]);
  });
});

describe('«الوقود والمصروفات» — the cards follow their CURRENT car’s branch (§0b, D10)', () => {
  it('the company view: every card, each company’s, and the card on no car named apart', async () => {
    const now = await nowOf(adminToken);
    expect(now.fuelCharging).toMatchObject({
      cards: 4,
      companyCards: { wataniya: 2, chillout: 2 },
      unassigned: { count: 1, balance: 400 },
      requested: { count: 1, amount: 300 },
    });
    expect(now.fuelCards).toEqual({ warnDays: 30, expired: 1, expiring: 1, nearest: '2026-11-10' });
    // Flagged: the expired card on no car, car1's (nearly empty, expiring), the deleted car3's
    // (a request, a low balance); car2's is fine.
    expect(
      now.fuelCardList?.rows.map((row) => [row.code, row.label, row.states, row.vehicleDeleted]),
    ).toEqual([
      [null, 'سفر', ['expired'], false],
      [car1.code, null, ['critical', 'expiring'], false],
      [car3.code, null, ['requested', 'low'], true],
    ]);
    expect(now.fuelCardList?.total).toBe(3);
    expect(now.fuelSheets).toEqual({ wataniya: null, chillout: null });
  });

  it('B1: its cars’ cards — the deleted car’s too — and never the card on no car', async () => {
    for (const now of [
      await nowOf(adminToken, B1),
      await nowOf(
        (await reader(['fleetFuelCard.view', 'fleetFuelCharge.view'], 'branch', B1)).token,
      ),
    ]) {
      expect(now.fuelCharging).toMatchObject({
        cards: 2,
        companyCards: { wataniya: 1, chillout: 1 },
        unassigned: null,
        requested: { count: 1, amount: 300 },
        wataniya: 50,
        chillout: 200,
      });
      expect(now.fuelCards).toMatchObject({ expired: 0, expiring: 1, nearest: '2026-11-10' });
      expect(now.fuelCardList?.rows.map((row) => [row.code, row.vehicleDeleted])).toEqual([
        [car1.code, false],
        [car3.code, true],
      ]);
      expect(now.fuelCardList?.total).toBe(2);
    }
    // B2: car2's card alone, nothing flagged; its expired line is not the company's.
    const b2 = await nowOf(adminToken, B2);
    expect(b2.fuelCharging).toMatchObject({ cards: 1, unassigned: null, chillout: 1000 });
    expect(b2.fuelCardList).toEqual({ rows: [], total: 0 });
    expect(b2.fuelCards).toMatchObject({ expired: 0, expiring: 0, nearest: null });
    expect(b2.alerts.map((a) => a.id)).not.toContain('fuelCardExpired');
  });

  it('the cards screen answers the same question with `branchIds`', async () => {
    const summary = ok<{ cardCount: number; noCarCards: number }>(
      await call('/fleet/fuel-cards/summary', adminToken, { branchIds: B1 }),
    );
    expect(summary).toMatchObject({ cardCount: 2, noCarCards: 0 });
    expect(
      ok<unknown[]>(await call('/fleet/fuel-cards', adminToken, { branchIds: B1 })).length,
    ).toBe(2);
  });
});

describe('«المخالفات المرورية والتسويات» — the drivers’ fines of a period; the book’s apart (§7)', () => {
  it('the company view: every year owed, the book’s carless fine named apart; October’s two fines', async () => {
    const now = await nowOf(adminToken);
    expect(now.violationsOpen).toEqual({
      company: { amount: 300, count: 1 },
      drivers: {
        total: { amount: 160, count: 2 },
        attributed: { amount: 0, count: 0, drivers: 0 },
        unknown: { amount: 100, count: 1 },
        unlinked: { amount: 60, count: 1 },
      },
      total: { amount: 460, count: 3 },
      bookOnly: { company: { amount: 0, count: 0 }, drivers: { amount: 60, count: 1 } },
    });
    const period = await periodOf(adminToken);
    // The statement (a year, no day) is never a period's.
    expect(period.violations).toMatchObject({ count: 2, amount: 160, owed: { count: 2 } });
    expect(period.violationList?.rows.map((row) => [row.code, row.vehicleId])).toEqual([
      ['B-9', null],
      [car1.code, car1.id],
    ]);
  });

  it('a branch: its cars’ fines; the book’s carless rows are in no branch, so nothing is named apart', async () => {
    const reach = await reader(['fleetViolation.view'], 'branch', B1);
    for (const [now, period] of [
      [await nowOf(adminToken, B1), await periodOf(adminToken, OCT, B1)],
      [await nowOf(reach.token), await periodOf(reach.token)],
    ] as const) {
      expect(now.violationsOpen?.drivers.total).toEqual({ amount: 100, count: 1 });
      expect(now.violationsOpen?.company).toEqual({ amount: 0, count: 0 });
      expect(now.violationsOpen?.bookOnly).toBeNull();
      expect(period.violations).toMatchObject({ count: 1, amount: 100 });
      expect(period.violationList?.rows.map((row) => row.code)).toEqual([car1.code]);
    }
  });
});

describe('the old landing read is retired (P1-13)', () => {
  it('GET /fleet/dashboard answers 404', async () => {
    expect((await call('/fleet/dashboard', adminToken)).status).toBe(404);
  });
});

describe('«العهدة» and «التراخيص والتجديدات» — their reads, their doors, their branch', () => {
  const day = (ymd: string): Date => new Date(`${ymd}T00:00:00.000Z`);
  const stamp = { isDeleted: false, schemaVersion: 1, createdBy: null, updatedBy: null };
  let boardCar: FleetVehicleDto; // B1, active, a «ت» licence running out on 20 December
  let barqashT: string;

  beforeAll(async () => {
    // Three custody memos — one transferred, one held, one waiting for its «استعاضة» — each a line
    // of its receipt (a receipt is on one memo at most: `ux_custody_memo_receipt`).
    const rDone = new Types.ObjectId();
    const rHeld = new Types.ObjectId();
    const rWaiting = new Types.ObjectId();
    const lineOf = (receiptId: Types.ObjectId) => [
      { receiptId, mission: '', statement: '', note: '' },
    ];
    const memo = (no: number, over: Record<string, unknown>) => ({
      ...stamp,
      _id: new Types.ObjectId(),
      no,
      kind: 'maintenance',
      name: '',
      date: day('2026-10-25'),
      from: day('2026-10-01'),
      to: day('2026-10-31'),
      lines: [],
      signatures: { blocks: [], note: '' },
      replenishmentId: null,
      replenishedAt: null,
      lockSeq: 0,
      deletedAt: null,
      createdAt: day('2026-10-25'),
      updatedAt: day('2026-10-25'),
      __v: 0,
      ...over,
    });
    const done = memo(901, {
      lines: lineOf(rDone),
      replenishmentId: new Types.ObjectId(),
      replenishedAt: day('2026-10-28'),
      replenishmentHeld: false,
    });
    const held = memo(902, {
      kind: 'fuel',
      lines: lineOf(rHeld),
      replenishmentId: new Types.ObjectId(),
      replenishedAt: day('2026-10-29'),
      replenishmentHeld: true,
    });
    const waiting = memo(903, { kind: 'tyres', lines: lineOf(rWaiting) });
    await FleetCustodyMemoModel.collection.insertMany([done, held, waiting]);
    const receipt = (
      car: FleetVehicleDto,
      over: {
        kind: string;
        amount: number;
        memoId?: Types.ObjectId;
        source?: string;
        _id?: Types.ObjectId;
      },
    ) => ({
      ...stamp,
      vehicleId: new Types.ObjectId(car.id),
      driverEmployeeId: null,
      driverName: 'سائق',
      cardId: null,
      fuelType: over.kind === 'fuel' ? 'diesel' : null,
      pricePerLitre: null,
      litres: null,
      odometer: null,
      company: null,
      image: null,
      deletedAt: null,
      date: day('2026-10-22'),
      source: 'custody',
      memoId: null,
      ...over,
    });
    await FleetReceiptModel.create([
      receipt(car1, { _id: rDone, kind: 'maintenance', amount: 100, memoId: done._id }),
      receipt(car1, { _id: rHeld, kind: 'fuel', amount: 40.5, memoId: held._id }),
      receipt(car2, { _id: rWaiting, kind: 'tyres', amount: 20, memoId: waiting._id }),
      receipt(car2, { kind: 'wash', amount: 9.5 }),
      // A card's fuel: in `opex`, never in the custody spend.
      receipt(car1, { kind: 'fuel', amount: 70, source: 'card' }),
    ]);
    // Licence-expense memos: two of October (one with both memos, a hand-typed plate) and one of
    // September — no branch, no car type, no operation reaches any of them.
    const line = (amount: number, paidBy: 'visa' | 'cash', count = 1) => ({
      itemId: null,
      label: 'بند',
      amount,
      count,
      paidBy,
      receipt: false,
    });
    const expense = (date: string, over: Record<string, unknown>) => ({
      ...stamp,
      date: day(date),
      renewal: null,
      extension: null,
      signatures: { agent: '', director: '', generalManager: '' },
      deletedAt: null,
      ...over,
    });
    await FleetLicenseExpenseModel.create([
      expense('2026-10-05', {
        renewal: {
          vehicles: [
            { vehicleId: new Types.ObjectId(car1.id), plate: '' },
            { vehicleId: null, plate: 'ب ح 12' },
          ],
          items: [line(100, 'visa'), line(50, 'cash', 2)],
        },
        extension: {
          vehicles: [{ vehicleId: new Types.ObjectId(car2.id), plate: '' }],
          items: [line(30, 'cash')],
        },
      }),
      expense('2026-09-30', {
        renewal: {
          vehicles: [{ vehicleId: new Types.ObjectId(car2.id), plate: '' }],
          items: [line(999, 'visa')],
        },
      }),
    ]);
    // A board car («ت») of B1 whose licence runs out on 20 December.
    barqashT = ok<FleetCatalogItemDto>(
      await send('post', '/fleet/catalog-items', {
        kind: 'licenseClass',
        name: { ar: 'برقاش ت', en: 'Barqash T' },
      }),
      201,
    ).id;
    boardCar = ok<FleetVehicleDto>(
      await send('post', '/fleet/vehicles', {
        code: '899',
        typeId: T1,
        plateNumber: 'ع ت 99',
        chassisNumber: 'ECH-99',
        motorNumber: 'EMO-99',
        joinedAt: '2025-01-01T00:00:00.000Z',
        licenseExpiresAt: '2026-12-20T00:00:00.000Z',
        licenseClassId: barqashT,
        radio: { issi: 'EISSI-99' },
        branchId: B1,
      }),
      201,
    );
  }, 120_000);

  it('a licensing-only reader keeps R1 — the papers alone — and has no R2', async () => {
    const board = await reader(['fleetLicensing.view']);
    expect(present(await nowOf(board.token), NOW_SECTIONS)).toEqual(['papers']);
    expect((await call('/fleet/dashboard/period', board.token)).status).toBe(403);
  });

  it('a licence-expense-only reader reads «مصروفات التراخيص» and nothing else; no R1', async () => {
    const spend = await reader(['fleetLicenseExpense.view']);
    expect((await call('/fleet/dashboard/now', spend.token)).status).toBe(403);
    const period = await periodOf(spend.token);
    expect(present(period, PERIOD_SECTIONS)).toEqual(['licenceSpend']);
    expect(period.licenceSpend).toEqual({
      count: 1,
      cars: 3,
      visa: 100,
      cash: 130,
      renewal: 200,
      extension: 30,
      total: 230,
    });
  });

  it('the custody fund’s key adds «منها حتى الآن» beside the receipts’, and answers nothing alone', async () => {
    const both = await reader(['fleetReceipt.view', 'fleetCustody.view']);
    expect((await call('/fleet/dashboard/now', both.token)).status).toBe(403);
    const period = await periodOf(both.token);
    expect(present(period, PERIOD_SECTIONS)).toEqual(['opex', 'opexSeries', 'custodyStates']);
    const fund = await reader(['fleetCustody.view']);
    expect((await call('/fleet/dashboard/now', fund.token)).status).toBe(403);
    // Admitted to R2 (its key is in the union), answered with nothing: the web sends it no R2.
    const alone = await periodOf(fund.token);
    expect(present(alone, PERIOD_SECTIONS)).toEqual([]);
    expect(alone.unavailable).toEqual([]);
  });

  it('the company: «مصروفات العهدة», its receipts and where they stand now — Σ = the custody spend', async () => {
    const period = await periodOf(adminToken);
    expect(period.opex?.custody).toBe(170);
    expect(period.opex?.custodyCount).toBe(4);
    // The held memo's money is not back yet: it waits, with the memo no «استعاضة» took.
    expect(period.custodyStates).toEqual({ replenished: 100, pending: 60.5, outside: 9.5 });
    const states = period.custodyStates;
    expect((states?.replenished ?? 0) + (states?.pending ?? 0) + (states?.outside ?? 0)).toBe(
      period.opex?.custody,
    );
    const screen = ok<{ count: number; custodyTotal: number }>(
      await call('/fleet/receipts/summary', adminToken, {
        from: OCT.from,
        to: OCT.to,
        source: 'custody',
      }),
    );
    expect(period.opex?.custodyCount).toBe(screen.count);
  });

  it('a branch: the custody spend follows the receipt’s car; the licence memos stay the company’s', async () => {
    const company = await periodOf(adminToken);
    for (const [branch, expected] of [
      [B1, { replenished: 100, pending: 40.5, outside: 0 }],
      [B2, { replenished: 0, pending: 20, outside: 9.5 }],
    ] as const) {
      const period = await periodOf(adminToken, OCT, branch);
      expect(period.custodyStates, branch).toEqual(expected);
      expect(expected.replenished + expected.pending + expected.outside).toBe(period.opex?.custody);
      expect(period.opex?.custodyCount).toBe(2);
      expect(period.licenceSpend).toEqual(company.licenceSpend);
    }
    // «كل فروعي»: both branches' custody receipts, the licence memos unchanged.
    const both = await multiReader([
      'fleetReceipt.view',
      'fleetCustody.view',
      'fleetLicenseExpense.view',
    ]);
    const reach = await periodOf(both.token);
    expect(reach.custodyStates).toEqual(company.custodyStates);
    expect(reach.licenceSpend).toEqual(company.licenceSpend);
  });

  it('the cars’ licences: each row named, the board’s papers on a «ت» car, 12 months from November', async () => {
    const now = await nowOf(adminToken);
    const row = now.licenceVehicles?.list.find((r) => r.vehicleId === boardCar.id);
    expect(row).toEqual({
      vehicleId: boardCar.id,
      code: '899',
      expiresAt: '2026-12-20',
      days: 49,
      typeName: { ar: 'مصفحة', en: 'Armored' },
      licenceClass: { ar: 'برقاش ت', en: 'Barqash T' },
      papers: { insurance: 'none', tax: 'none' },
    });
    // A car with no licence class is off the board: no papers, no class.
    const plain = now.licenceVehicles?.list.find((r) => r.vehicleId === car1.id);
    expect(plain).toMatchObject({ licenceClass: null, papers: null, expiresAt: '2026-10-15' });
    expect(now.licenceVehicles?.months.map((m) => m.key)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
      '2027-05',
      '2027-06',
      '2027-07',
      '2027-08',
      '2027-09',
      '2027-10',
    ]);
    expect(now.licenceVehicles?.months.find((m) => m.key === '2026-12')?.count).toBe(1);
    expect(now.licenceVehicles?.months.reduce((a, m) => a + m.count, 0)).toBe(1);
    // A reader of the registry alone: the row is named, its papers are not.
    const registry = await reader(['fleetVehicle.view']);
    const theirs = (await nowOf(registry.token)).licenceVehicles?.list.find(
      (r) => r.vehicleId === boardCar.id,
    );
    expect(theirs?.licenceClass).toEqual({ ar: 'برقاش ت', en: 'Barqash T' });
    expect(theirs?.papers).toBeNull();
  });

  it('under a branch the licence rows and months are that branch’s cars', async () => {
    const b1 = await nowOf(adminToken, B1);
    const b2 = await nowOf(adminToken, B2);
    expect(b1.licenceVehicles?.list.map((r) => r.code).sort()).toEqual([car1.code, '899'].sort());
    expect(b2.licenceVehicles?.list.map((r) => r.code)).toEqual([car2.code]);
    expect(b1.licenceVehicles?.months.find((m) => m.key === '2026-12')?.count).toBe(1);
    expect(b2.licenceVehicles?.months.every((m) => m.count === 0)).toBe(true);
    // A branch-scoped registry reader of B2 sees the same as the switcher.
    const dispatcher = await reader(['fleetVehicle.view'], 'branch', B2);
    expect((await nowOf(dispatcher.token)).licenceVehicles?.months).toEqual(
      b2.licenceVehicles?.months,
    );
  });
});
