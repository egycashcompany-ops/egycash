// `GET /fleet/dashboard/now` and `/period` end to end — the doors, the readers, the clock and the
// old book's rows (plan P1-07, P1-08, P1-13; §8.11).
//
// The figure-by-figure parity lives in `fleet-dashboard-parity.spec.ts`. This file asks what only a
// real database WITH REAL ROLES can answer:
//   1. one Cairo day per request: the clock pinned at 2026-10-31T23:30Z reads 2026-11-01, and the
//      period presets resolve on it; the period query is refused when it is not a real period;
//   2. who gets what: a caller with no key is turned away (403 + the audit row); a caller with one
//      key gets exactly the sections that key opens — and NOT a section whose data key they hold
//      without the linked screen's guard; a branch-scoped reader sees their branch; an `own` grant
//      never narrows a company source to what the reader created; the switcher (X-Active-Branch)
//      narrows the read and is echoed;
//   3. the old book's rows — an odometer row and a visit with only a code, an undated accident —
//      count in the company view exactly as on the unfiltered screens, and drop out once a set exists;
//   4. the old landing read (`GET /fleet/dashboard`) is gone.
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

const NOW = new Date('2026-10-31T23:30:00.000Z');
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
  'recentWorkshop',
  'recentAccidents',
  'notices',
  'dealershipPending',
  'accidentsOpen',
  'violationsYear',
];
const PERIOD_SECTIONS: readonly FleetDashboardPeriodSection[] = [
  'km',
  'visits',
  'accidents',
  'accidentList',
  'opex',
  'dealership',
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

let B1: string;
let B2: string;
let T1: string;
let car1: FleetVehicleDto; // B1
let car2: FleetVehicleDto; // B2

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
    expect(present(now, NOW_SECTIONS)).toEqual(['workshop', 'recentWorkshop']);
    expect(now.alerts.map((a) => a.id)).not.toContain('maintenanceRed');
    expect(present(await periodOf(clerk.token), PERIOD_SECTIONS)).toEqual(['visits']);
  });

  it('the cards reader gets the expired cards; the balances need the charging screen too', async () => {
    const cards = await reader(['fleetFuelCard.view']);
    expect(present(await nowOf(cards.token), NOW_SECTIONS)).toEqual(['fuelCards']);
    const charging = await reader(['fleetFuelCard.view', 'fleetFuelCharge.view']);
    expect(present(await nowOf(charging.token), NOW_SECTIONS)).toEqual([
      'fuelCards',
      'fuelCharging',
    ]);
    // The charging screen's key alone opens the door and nothing behind it — no 403, nothing shown.
    const guardOnly = await reader(['fleetFuelCharge.view']);
    const empty = await nowOf(guardOnly.token);
    expect(present(empty, NOW_SECTIONS)).toEqual([]);
    expect(empty.alerts).toEqual([]);
    expect((await call('/fleet/dashboard/period', guardOnly.token)).status).toBe(403);
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
    expect(now.vehicles?.active).toBe(1);
    expect(now.vehicleScope).toMatchObject({ branchId: B1, count: 1 });
    // Both open files are B1's car's — the undated one too: «open now» knows no period (R-23).
    expect(now.accidentsOpen?.count).toBe(2);
    const period = await periodOf(adminToken, OCT, B1);
    expect(period.vehicleScope).toMatchObject({ branchId: B1, count: 1 });
    expect(period.km?.total).toBe(60);
    expect(period.visits?.count).toBe(0);
    // A home branch is not a switch: the whole company.
    const homed = await reader(['fleetVehicle.view'], 'organization', B1);
    expect((await nowOf(homed.token)).vehicles?.active).toBe(2);
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
    expect(dto.visits).toMatchObject({ count: 2, unregistered: 1 });
    expect(dto.accidents).toMatchObject({ count: 1, undated: 1 });
    expect(dto.accidentList?.rows.map((row) => [row.code, row.date, row.remaining])).toEqual([
      [car1.code, '2026-10-18', 500],
    ]);
  });

  it('a set leaves them out: no car, no type', async () => {
    const dto = await periodOf(adminToken, { ...OCT, typeIds: T1 });
    expect(dto.vehicleScope).toMatchObject({ typeIds: [T1], count: 2 });
    expect(dto.km?.total).toBe(150);
    expect(dto.km?.unregistered).toBeNull();
    expect(dto.visits).toMatchObject({ count: 1, unregistered: null });
    expect(dto.accidents?.undated).toBeNull();
  });
});

describe('the old landing read is retired (P1-13)', () => {
  it('GET /fleet/dashboard answers 404', async () => {
    expect((await call('/fleet/dashboard', adminToken)).status).toBe(404);
  });
});
