// The odometer's period figures (fleet dashboard P1-04), against a real database.
//
//   1. `GET /fleet/odometer/summary` = Σ the valid km of every row `GET /fleet/odometer` lists for
//      the same filters — with the vehicle set «النوع / التشغيل / الفرع» on a fixture WITH A DELETED
//      CAR, a negative row («قراءة تحتاج مراجعة»), an open row, a day without a counter and a row
//      kept from the old book;
//   2. `kmBreakdown`: Σ confirmed + Σ span = the summary's km = Σ by branch + the rows without a car,
//      and a car out of service since the 5th does not keep the 5th pending on the 9th (N = 3);
//   3. `noReadingDigest` (R-07): on 2026-11-01 with N = 3 a last chain date of 2026-10-28 fires and
//      2026-10-29 does not, a workshop car never fires, a never-read car has its own line;
//   4. `explain()`: neither period read nor either no-reading step scans the collection.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  platformPermissions,
  type FleetCatalogItemDto,
  type FleetOdometerLogDto,
  type FleetOdometerSummaryDto,
  type FleetVehicleDto,
  type FleetVehicleTypeDto,
} from '@ecms/contracts';
import { Types } from 'mongoose';
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
import { FleetOdometerLogModel } from '../../src/modules/fleet/odometer/odometer.model';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import { fleetOdometerRepository } from '../../src/modules/fleet/odometer/odometer.repository';
import { fleetOdometerService } from '../../src/modules/fleet/odometer/odometer.service';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let strangerToken: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-fleet-odometer-summary-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
const get = (path: string, query: Record<string, unknown> = {}, token = adminToken) =>
  request(app).get(`/api/v1${path}`).query(query).set('Authorization', `Bearer ${token}`);
const post = (path: string, body: Record<string, unknown>) =>
  request(app).post(`/api/v1${path}`).set('Authorization', `Bearer ${adminToken}`).send(body);
const ok = <T>(res: request.Response, status = 200): T => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return data<T>(res);
};
/** What a query looks like in a URL: lists comma-joined, as the browser sends them. */
const wire = (query: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(query).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join(',') : String(value),
    ]),
  );

const mkUser = async (email: string): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  await userService.setPassword(String(user._id), PASSWORD, 'passwordReset');
  await userService.forceActivate(String(user._id));
  return String(user._id);
};

/** Every row the register lists for a filter, all pages. */
const listed = async (query: Record<string, unknown>): Promise<FleetOdometerLogDto[]> => {
  const out: FleetOdometerLogDto[] = [];
  for (let page = 1; ; page += 1) {
    const res = await get('/fleet/odometer', wire({ ...query, page, pageSize: 100 }));
    const items = ok<FleetOdometerLogDto[]>(res);
    out.push(...items);
    if (items.length < 100) return out;
  }
};
/** The register's km column over its valid rows (R-14) — what the total must equal. */
const validKm = (rows: readonly FleetOdometerLogDto[]) =>
  rows
    .filter((r) => r.outReading !== null && r.km !== null && r.km >= 0)
    .reduce((sum, r) => sum + (r.km ?? 0), 0);

// ── the world ─────────────────────────────────────────────────────────────────────────────────

let B1: string;
let B2: string;
let T1: string;
let T2: string;
let O1: string;
let O2: string;

let counter = 0;
const mkVehicle = async (over: Record<string, unknown>): Promise<FleetVehicleDto> => {
  counter += 1;
  return ok<FleetVehicleDto>(
    await post('/fleet/vehicles', {
      code: `${400 + counter}`,
      typeId: T1,
      plateNumber: `ع د ${counter}`,
      chassisNumber: `OCH-${counter}`,
      motorNumber: `OMO-${counter}`,
      joinedAt: '2025-01-01T00:00:00.000Z',
      licenseExpiresAt: '2028-01-01T00:00:00.000Z',
      radio: { issi: `OISSI-${counter}` },
      branchId: B1,
      ...over,
    }),
    201,
  );
};

/** Readings recorded through the register, oldest first — each one closes the one before it. */
const read = async (
  car: FleetVehicleDto,
  readings: readonly (readonly [string, number | null])[],
) => {
  for (const [date, reading] of readings) {
    ok(await post('/fleet/odometer', { vehicleId: car.id, date, reading }), 201);
  }
};

let a1: FleetVehicleDto; // T1 · B1 · O1 — read every day, 1–9 October
let a2: FleetVehicleDto; // T2 · B2 · O2 — read on the 1st, 3rd (a day without a counter between), 4th, 9th
let oos: FleetVehicleDto; // T1 · B1 · O2 — read on the 4th and 5th, then out of service
let gone: FleetVehicleDto; // T2 · B1 · O1 — read on the 2nd and 3rd, then DELETED
let neg: FleetVehicleDto; // T1 · B2 · O2 — a book row with negative km on the 6th
let shop: FleetVehicleDto; // in the workshop since the 20th, last read that day
let stale28: FleetVehicleDto; // last read 2026-10-28
let fresh29: FleetVehicleDto; // last read 2026-10-29
let never: FleetVehicleDto; // never read

const legacy = { isDeleted: false, schemaVersion: 1, createdBy: null, updatedBy: null };
const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const bookRow = (over: Record<string, unknown>) => ({
  ...legacy,
  vehicleId: null,
  vehicleCode: null,
  driver1EmployeeId: null,
  driver2EmployeeId: null,
  driver1Name: null,
  driver2Name: null,
  notes: null,
  ...over,
});

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();
  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions, ...fleetPermissions].map((p) => p.key),
  );
  const adminUserId = await mkUser('odometer-summary@ecms.local');
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
  const strangerId = await mkUser('odometer-stranger@ecms.local');
  strangerToken = await authService.signAccessToken(strangerId, new Types.ObjectId().toString(), 0);

  const mkBranch = async (code: string, ar: string): Promise<string> =>
    ok<{ id: string }>(await post('/platform/branches', { code, name: { ar, en: ar } }), 201).id;
  B1 = await mkBranch('91', 'فرع العداد الأول');
  B2 = await mkBranch('92', 'فرع العداد الثاني');
  const mkType = async (ar: string): Promise<string> =>
    ok<FleetVehicleTypeDto>(
      await post('/fleet/vehicle-types', { name: { ar, en: ar }, maintenanceIntervalKm: 10_000 }),
      201,
    ).id;
  T1 = await mkType('مصفحة العداد');
  T2 = await mkType('ميكروباص العداد');
  const mkCatalog = async (kind: string, ar: string): Promise<string> => {
    const seeded = ok<FleetCatalogItemDto[]>(
      await get('/fleet/catalog-items', { kind, pageSize: 100 }),
    ).find((item) => item.name.ar === ar);
    if (seeded !== undefined) return seeded.id;
    return ok<FleetCatalogItemDto>(
      await post('/fleet/catalog-items', { kind, name: { ar, en: ar } }),
      201,
    ).id;
  };
  O1 = await mkCatalog('operation', 'نقل أموال');
  O2 = await mkCatalog('operation', 'ATM');
  const workshopId = await mkCatalog('workshop', 'ورشة العداد');
  const workTypeId = await mkCatalog('workType', 'صيانة العداد');

  a1 = await mkVehicle({ typeId: T1, branchId: B1, operationId: O1 });
  a2 = await mkVehicle({ typeId: T2, branchId: B2, operationId: O2 });
  oos = await mkVehicle({ typeId: T1, branchId: B1, operationId: O2 });
  gone = await mkVehicle({ typeId: T2, branchId: B1, operationId: O1 });
  neg = await mkVehicle({ typeId: T1, branchId: B2, operationId: O2 });
  shop = await mkVehicle({ typeId: T1, branchId: B2, operationId: O1 });
  stale28 = await mkVehicle({ typeId: T1, branchId: B1, operationId: O1 });
  fresh29 = await mkVehicle({ typeId: T1, branchId: B1, operationId: O1 });
  never = await mkVehicle({ typeId: T2, branchId: B2, operationId: O2 });

  await read(
    a1,
    ['01', '02', '03', '04', '05', '06', '07', '08', '09'].map(
      (d, i) => [`2026-10-${d}`, 10_000 + 100 * i] as const,
    ),
  );
  await read(a2, [
    ['2026-10-01', 20_000],
    ['2026-10-03', 20_500],
    ['2026-10-04', 20_600],
    ['2026-10-09', 21_100],
  ]);
  // A day recorded WITHOUT a counter inside a2's span: it splits nothing.
  await read(a2, [['2026-10-02', null]]);
  await read(oos, [
    ['2026-10-04', 30_000],
    ['2026-10-05', 30_150],
  ]);
  await read(gone, [
    ['2026-10-02', 40_000],
    ['2026-10-03', 40_080],
  ]);
  await read(shop, [['2026-10-20', 50_000]]);
  await read(stale28, [
    ['2026-10-27', 60_000],
    ['2026-10-28', 60_100],
  ]);
  // A day recorded WITHOUT a counter after the last reading: who drove, not a reading.
  await read(stale28, [['2026-10-30', null]]);
  await read(fresh29, [['2026-10-29', 70_000]]);

  // Out of service since the 5th: its last row, dated the 5th, stays open for ever.
  ok(
    await post(`/fleet/vehicles/${oos.id}/status`, {
      status: 'outOfService',
      reason: 'حادث',
      version: oos.version,
    }),
  );
  // In the workshop since the 20th.
  ok(
    await post('/fleet/maintenance', {
      vehicleId: shop.id,
      inDate: '2026-10-20',
      workshopId,
      workTypeId,
    }),
    201,
  );
  // Rows the API cannot write: a book's negative period on a registry car, and two readings kept
  // from the old book for a car the registry never had.
  await FleetOdometerLogModel.create([
    bookRow({
      vehicleId: new Types.ObjectId(neg.id),
      date: day('2026-10-06'),
      outReading: 9_000,
      inReading: 8_950,
      km: -50,
    }),
    bookRow({
      vehicleId: new Types.ObjectId(neg.id),
      date: day('2026-10-09'),
      outReading: 8_950,
      inReading: null,
      km: null,
    }),
    bookRow({
      vehicleCode: 'كوستر',
      date: day('2026-10-07'),
      outReading: 500,
      inReading: 540,
      km: 40,
    }),
    bookRow({
      vehicleCode: 'كوستر',
      date: day('2026-10-08'),
      outReading: 540,
      inReading: 570,
      km: 30,
    }),
  ]);

  // The deleted car: its readings were taken while it was live, then it left the registry.
  const del = await request(app)
    .delete(`/api/v1/fleet/vehicles/${gone.id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect([200, 204]).toContain(del.status);

  await FleetOdometerLogModel.createIndexes();
}, 300_000);

afterAll(async () => {
  await getCache().close();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

const OCTOBER = { from: '2026-10-01', to: '2026-10-31' };

describe('GET /fleet/odometer/summary — the register’s total (R-14)', () => {
  it('= Σ the valid km of every row the list shows, the negative row counted apart', async () => {
    const rows = await listed(OCTOBER);
    const summary = ok<FleetOdometerSummaryDto>(await get('/fleet/odometer/summary', OCTOBER));
    expect(summary.km).toBe(validKm(rows));
    expect(summary.validRows).toBe(
      rows.filter((r) => r.outReading !== null && (r.km ?? -1) >= 0).length,
    );
    expect(summary.invalidRows).toBe(1);
    expect(summary.openRows).toBe(
      rows.filter((r) => r.outReading !== null && r.km === null).length,
    );
    // a1 800 + a2 1100 + oos 150 + gone 80 + stale28 100 + the book's 70.
    expect(summary.km).toBe(2_300);
  });

  for (const [name, filter] of [
    ['a type', () => ({ typeIds: [T2] })],
    [
      'an operation and a branch (the deleted car included)',
      () => ({ operationIds: [O1], branchIds: [B1] }),
    ],
    ['codes and a type', () => ({ vehicleCodes: [a1.code, a2.code], typeIds: [T1] })],
    ['the old book’s code alone', () => ({ vehicleCodes: ['كوستر'] })],
  ] as const) {
    it(`with ${name}: the total = the list’s valid km, over the same rows`, async () => {
      const query = { ...OCTOBER, ...filter() };
      const rows = await listed(query);
      const summary = ok<FleetOdometerSummaryDto>(
        await get('/fleet/odometer/summary', wire(query)),
      );
      expect(summary.km).toBe(validKm(rows));
      expect(rows.length).toBeGreaterThan(0);
    });
  }

  it('the vehicle set reaches a deleted car’s history and stops the book’s codes standing alone', async () => {
    const byType = await listed({ ...OCTOBER, typeIds: [T2], operationIds: [O1] });
    expect(new Set(byType.map((r) => r.vehicleId))).toEqual(new Set([gone.id]));
    const codesAndType = await listed({
      ...OCTOBER,
      vehicleCodes: ['كوستر', a1.code],
      typeIds: [T1],
    });
    expect(new Set(codesAndType.map((r) => r.vehicleCode))).toEqual(new Set([a1.code]));
    const bookAlone = await listed({ ...OCTOBER, vehicleCodes: ['كوستر'] });
    expect(bookAlone.map((r) => r.km)).toEqual(expect.arrayContaining([40, 30]));
  });

  it('refuses paging (it is not a page) and a reader without `fleetOdometer.view`', async () => {
    expect((await get('/fleet/odometer/summary', { page: 1 })).status).toBe(400);
    expect((await get('/fleet/odometer/summary', OCTOBER, strangerToken)).status).toBe(403);
  });
});

describe('kmBreakdown — tabs 6–8 over the same rows (R-15, R-16)', () => {
  const RANGE = { from: '2026-10-01', to: '2026-10-09' };

  it('Σ confirmed + Σ span = the summary’s km = Σ by branch + the rows without a car', async () => {
    const km = await fleetOdometerService.kmBreakdown(RANGE, {
      today: '2026-10-09',
      staleDays: 3,
      branchId: null,
      setNarrows: false,
    });
    const summary = ok<FleetOdometerSummaryDto>(await get('/fleet/odometer/summary', RANGE));
    const drawn = km.buckets.reduce((sum, b) => sum + b.confirmedKm + b.spanKm, 0);
    const branches = km.byBranch.reduce((sum, b) => sum + b.km, 0);
    expect(km.total).toBe(summary.km);
    expect(drawn).toBe(summary.km);
    expect(branches + (km.unregistered ?? 0)).toBe(summary.km);
    expect(km.unregistered).toBe(70);
    expect(km.invalidRows).toBe(summary.invalidRows);
    // a2's 1st → 3rd and 4th → 9th, and the book's 8th (its next reading never came).
    expect(km.spans).toEqual({ km: 500 + 500 + 30, count: 3 });
  });

  it('a car out of service since the 5th does not keep the 5th pending on the 9th: confirmed through the 8th', async () => {
    const km = await fleetOdometerService.kmBreakdown(RANGE, {
      today: '2026-10-09',
      staleDays: 3,
      branchId: null,
      setNarrows: false,
    });
    expect(km.buckets.find((b) => b.key === '2026-10-05')).toMatchObject({
      confirmed: true,
      stale: 1,
      pending: 0,
    });
    expect(km.confirmedThrough).toBe('2026-10-08');
    expect(km.closedDays).toBe(8);
    expect(km.buckets.find((b) => b.key === '2026-10-09')).toMatchObject({ confirmed: false });
    expect(km.withoutReadings).toEqual(
      expect.arrayContaining([
        { vehicleId: never.id, code: never.code, reason: 'noRow' },
        { vehicleId: shop.id, code: shop.code, reason: 'noRow' },
      ]),
    );
    // The deleted car's km stays in the total, but it is never ranked.
    expect(km.top5.map((r) => r.vehicleId)).not.toContain(gone.id);
    expect(km.bottom5.map((r) => r.vehicleId)).not.toContain(oos.id);
  });

  it('with a set and a branch: the km by type, and no «غير مسجّلة» line', async () => {
    const km = await fleetOdometerService.kmBreakdown(
      { ...RANGE, branchIds: [B1] },
      { today: '2026-10-09', staleDays: 3, branchId: B1, setNarrows: true },
    );
    const summary = ok<FleetOdometerSummaryDto>(
      await get('/fleet/odometer/summary', wire({ ...RANGE, branchIds: [B1] })),
    );
    expect(km.total).toBe(summary.km);
    expect(km.unregistered).toBeNull();
    expect(km.byBranch.map((b) => b.branchId)).toEqual([B1]);
    expect((km.byType ?? []).reduce((sum, t) => sum + t.km, 0)).toBe(summary.km);
  });
});

describe('noReadingDigest — «بلا قراءة عداد منذ N أيام» (R-07)', () => {
  it('on 2026-11-01 with N = 3: the 28th fires, the 29th does not, the workshop car never does', async () => {
    const digest = await fleetOdometerService.noReadingDigest({ today: '2026-11-01', days: 3 });
    const stale = new Map(digest.stale.map((s) => [s.vehicleId, s.lastDate]));
    expect(stale.get(stale28.id)).toBe('2026-10-28');
    expect(stale.has(fresh29.id)).toBe(false);
    expect(stale.has(shop.id)).toBe(false);
    expect(stale.has(oos.id)).toBe(false); // not active
    expect(stale.has(gone.id)).toBe(false); // deleted
    expect(stale.get(a1.id)).toBe('2026-10-09');
    expect(digest.neverRead).toEqual([{ vehicleId: never.id, code: never.code }]);
    expect(stale.has(never.id)).toBe(false);
  });

  it('narrowed to some cars, it answers for those cars only', async () => {
    const digest = await fleetOdometerService.noReadingDigest({
      today: '2026-11-01',
      days: 3,
      vehicleIds: [stale28.id, fresh29.id, never.id],
    });
    expect(digest.stale).toEqual([
      { vehicleId: stale28.id, code: stale28.code, lastDate: '2026-10-28' },
    ]);
    expect(digest.neverRead.map((n) => n.vehicleId)).toEqual([never.id]);
  });

  it('a day recorded without a counter is not a reading: the 28th stays the latest', async () => {
    const latest = await fleetOdometerRepository.latestChainDates([stale28.id]);
    expect(latest.get(stale28.id)).toBe('2026-10-28');
    const since = await fleetOdometerRepository.vehiclesReadSince([stale28.id], '2026-10-29');
    expect(since.has(stale28.id)).toBe(false);
  });
});

describe('explain() — the period reads never scan the collection', () => {
  // An index scan, and no collection scan anywhere in the plan.
  const noCollscan = (plan: unknown) => {
    const text = JSON.stringify(plan);
    expect(text).toContain('IXSCAN');
    expect(text).not.toContain('COLLSCAN');
  };

  it('the km window, unfiltered and with a vehicle set', async () => {
    for (const query of [
      { from: '2026-10-01', to: '2026-10-31' },
      { from: '2026-10-01', to: '2026-10-31', typeIds: [T1], branchIds: [B1] },
    ]) {
      const filter = await fleetOdometerService.kmWindowFilter(query);
      noCollscan(await FleetOdometerLogModel.find(filter).explain('queryPlanner'));
    }
  });

  it('both no-reading steps', async () => {
    const ids = [a1.id, a2.id, stale28.id, never.id];
    noCollscan(
      await FleetOdometerLogModel.aggregate(
        fleetOdometerRepository.readSincePipeline(ids, '2026-10-29'),
      ).explain('queryPlanner'),
    );
    // Step 2 runs over the registry, one document per car, and seeks each car's newest chain row
    // through ix_vehicle_date with `$limit: 1` — never the car's whole history.
    const plan = JSON.stringify(
      await FleetVehicleModel.aggregate(
        fleetOdometerRepository.latestChainDatesPipeline(ids),
      ).explain('executionStats'),
    );
    expect(plan).not.toContain('COLLSCAN');
    const lookup = (JSON.parse(plan) as { stages?: Record<string, unknown>[] }).stages?.find(
      (stage) => '$lookup' in stage,
    );
    expect(lookup?.['collectionScans']).toBe(0);
    expect(lookup?.['indexesUsed']).toEqual(['ix_vehicle_date']);
    expect(Number(lookup?.['totalDocsExamined'])).toBeLessThanOrEqual(ids.length * 2);
  });
});
