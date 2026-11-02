// The maintenance module's dashboard reads against a real database (P1-05, P1-06).
//
// The dashboard counts nothing itself: «زيارات الورشة» (T6.3/T6.4, tab 9), «في الورشة الآن» (T2.4)
// and the recent workshop records (T4.8) are calls into the maintenance service with the query the
// linked screen sends. This file proves the promise on real rows written through the real endpoints:
//
//   1. `visitBreakdown` over [from, to] counts exactly the visits `/fleet/maintenance?from&to` lists,
//      with and without the vehicle set — «النوع / التشغيل / الفرع» and codes — on a fixture WITH A
//      DELETED CAR, and every breakdown links to a list that shows its count;
//   2. `openNow` is `/fleet/maintenance?state=open` (`open=true`) with the oldest stay in days;
//   3. `recentWritten` keeps the window (a row the day before it is out) and the write order;
//   4. the period read is planned on an index, never a collection scan.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  addDaysYmd,
  platformPermissions,
  type FleetCatalogItemDto,
  type FleetMaintenanceVisitDto,
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
import { FleetMaintenanceVisitModel } from '../../src/modules/fleet/maintenance/maintenance.model';
import {
  fleetMaintenanceService,
  type MaintenanceFilterQuery,
} from '../../src/modules/fleet/maintenance/maintenance.service';
import { vehicleSet, type VehicleFilter } from '../../src/modules/fleet/vehicles/vehicle-set';
import { nextNationalId } from './helpers/national-id';

const PASSWORD = 'Str0ng#Pass!';
const TODAY = '2026-11-01';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-fleet-maintenance-breakdown-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
const get = (path: string, query: Record<string, unknown> = {}) =>
  request(app).get(`/api/v1${path}`).query(query).set('Authorization', `Bearer ${adminToken}`);
const post = (path: string, body: Record<string, unknown>) =>
  request(app).post(`/api/v1${path}`).set('Authorization', `Bearer ${adminToken}`).send(body);
const del = (path: string) =>
  request(app).delete(`/api/v1${path}`).set('Authorization', `Bearer ${adminToken}`);
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
/** `/fleet/maintenance`'s `totalItems` for a query, sent the way the page sends it. */
const total = async (query: Record<string, unknown>): Promise<number> => {
  const res = await get('/fleet/maintenance', { ...wire(query), pageSize: 1 });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as { meta: { totalItems: number } }).meta.totalItems;
};

// ── the world ─────────────────────────────────────────────────────────────────────────────────

let B1: string;
let B2: string;
let T1: string;
let T2: string;
let O1: string;
let O2: string;
let WS1: string;
let WS2: string;
let WT1: string;
let WT2: string;
let driver: string;

let c1: FleetVehicleDto; // T1 · B1 · O1
let c2: FleetVehicleDto; // T1 · B2 · O2
let c3: FleetVehicleDto; // T2 · B1 · O2
let c4: FleetVehicleDto; // T2 · B2 · O1
let c5: FleetVehicleDto; // T2 · B1 · O1 — open since 1 Oct, then out of service
let gone: FleetVehicleDto; // T1 · B1 · O1 — its visit stays, the car is soft-deleted

/** The visits in the order they were WRITTEN, with the business date R-12 reads. */
const written: { id: string; date: string }[] = [];
/** The deleted car's October visit — counted everywhere, never a row (§8.11). */
let goneVisit: string;

let counter = 0;
const mkVehicle = async (over: Record<string, unknown>): Promise<FleetVehicleDto> => {
  counter += 1;
  return ok<FleetVehicleDto>(
    await post('/fleet/vehicles', {
      code: `${500 + counter}`,
      plateNumber: `م ص ${counter}`,
      chassisNumber: `MBCH-${counter}`,
      motorNumber: `MBMO-${counter}`,
      joinedAt: '2025-01-01T00:00:00.000Z',
      licenseExpiresAt: '2027-12-31T00:00:00.000Z',
      radio: { issi: `MBISSI-${counter}` },
      ...over,
    }),
    201,
  );
};

/** A check-in through the endpoint, and — when `out` is given — its check-out. */
const visit = async (
  car: FleetVehicleDto,
  inDate: string,
  out: string | null,
  workTypeId: string,
  workshopId: string,
): Promise<string> => {
  const opened = ok<FleetMaintenanceVisitDto>(
    await post('/fleet/maintenance', { vehicleId: car.id, inDate, workshopId, workTypeId }),
    201,
  );
  if (out !== null) {
    ok(
      await post(`/fleet/maintenance/${opened.id}/check-out`, {
        outDate: out,
        version: opened.version,
        driverOutEmployeeId: driver,
      }),
    );
  }
  written.push({ id: opened.id, date: out !== null && out > inDate ? out : inDate });
  return opened.id;
};

const legacyRow = async (over: Record<string, unknown>): Promise<string> => {
  const doc = await FleetMaintenanceVisitModel.create({
    isDeleted: false,
    schemaVersion: 1,
    createdBy: null,
    updatedBy: null,
    vehicleId: null,
    vehicleCode: null,
    outDate: null,
    workshopId: new Types.ObjectId(WS2),
    workTypeId: new Types.ObjectId(WT1),
    spareParts: [],
    sparePartIds: [],
    odometerAtService: null,
    exitOdometer: null,
    driverInEmployeeId: null,
    driverOutEmployeeId: null,
    driverInName: null,
    driverOutName: null,
    takenInByEmployeeId: null,
    takenOutByEmployeeId: null,
    notes: null,
    ...over,
  });
  return String(doc._id);
};

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

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();
  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions, ...fleetPermissions].map((p) => p.key),
  );
  const adminUserId = await mkUser('maintenance-breakdown@ecms.local');
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
  await FleetMaintenanceVisitModel.createIndexes();

  const mkBranch = async (code: string, ar: string): Promise<string> =>
    ok<{ id: string }>(await post('/platform/branches', { code, name: { ar, en: ar } }), 201).id;
  B1 = await mkBranch('91', 'فرع طنطا');
  B2 = await mkBranch('92', 'فرع أسيوط');
  const department = ok<{ id: string }>(
    await post('/platform/departments', {
      code: 'MB-OPS',
      name: { ar: 'الحركة', en: 'Operations' },
      branchId: B1,
    }),
    201,
  ).id;
  const jobTitleId = ok<{ id: string }>(
    await post('/platform/job-titles', {
      code: 'MB-DRV',
      name: { ar: 'سائق', en: 'Driver' },
      jobGrade: 'G1',
      requiresDrivingTest: true,
    }),
    201,
  ).id;
  driver = ok<{ id: string }>(
    await post('/hr/employees/direct', {
      personal: {
        identity: {
          fullNameAr: 'سائق الورشة',
          nationalId: nextNationalId(),
          nationality: 'Egyptian',
        },
        contact: { primaryPhone: '01299887766' },
        experience: [],
        drivingLicenses: [],
        certifications: [],
        references: [],
      },
      employment: {
        jobTitleId,
        departmentId: department,
        branchId: B1,
        employmentType: 'fullTime',
        probationMonths: 0,
        startDate: '2026-01-01T00:00:00.000Z',
      },
      entryStatus: 'active',
    }),
    201,
  ).id;

  const mkType = async (ar: string): Promise<string> =>
    ok<FleetVehicleTypeDto>(
      await post('/fleet/vehicle-types', { name: { ar, en: ar }, maintenanceIntervalKm: 10_000 }),
      201,
    ).id;
  T1 = await mkType('مصفحة الورشة');
  T2 = await mkType('ميكروباص الورشة');
  O1 = await mkCatalog('operation', 'نقل أموال');
  O2 = await mkCatalog('operation', 'ATM');
  WS1 = await mkCatalog('workshop', 'ورشة التوكيل');
  WS2 = await mkCatalog('workshop', 'ورشة الشركة');
  WT1 = await mkCatalog('workType', 'صيانة دورية');
  WT2 = await mkCatalog('workType', 'إصلاح عطل');

  c1 = await mkVehicle({ typeId: T1, branchId: B1, operationId: O1 });
  c2 = await mkVehicle({ typeId: T1, branchId: B2, operationId: O2 });
  c3 = await mkVehicle({ typeId: T2, branchId: B1, operationId: O2 });
  c4 = await mkVehicle({ typeId: T2, branchId: B2, operationId: O1 });
  c5 = await mkVehicle({ typeId: T2, branchId: B1, operationId: O1 });
  gone = await mkVehicle({ typeId: T1, branchId: B1, operationId: O1 });

  // The order these are written in IS the order R-12 reads them back in.
  await visit(c4, '2026-09-25', '2026-10-02', WT1, WS1); // outside the period; a day before the window
  await visit(c3, '2026-09-28', '2026-10-04', WT2, WS2); // outside the period; IN the window by its exit
  await visit(c5, '2026-10-01', null, WT2, WS1); // the oldest open stay
  await visit(c1, '2026-10-05', '2026-10-06', WT1, WS1);
  goneVisit = await visit(gone, '2026-10-08', '2026-10-09', WT1, WS1);
  await visit(c2, '2026-10-10', '2026-10-12', WT1, WS2);
  await visit(c3, '2026-10-15', '2026-10-15', WT2, WS2);
  // A visit the old book kept for a car the registry never had, still open.
  written.push({
    id: await legacyRow({ vehicleCode: 'B-90', inDate: new Date('2026-10-18T00:00:00.000Z') }),
    date: '2026-10-18',
  });
  await visit(c1, '2026-10-20', null, WT2, WS1);
  // A visit recorded and then deleted — on no list and in no figure.
  const mistaken = await visit(c2, '2026-10-25', null, WT1, WS2);
  expect([200, 204]).toContain((await del(`/fleet/maintenance/${mistaken}`)).status);
  written.pop();
  // A go-live import row: written LAST, but its business date is last year — not «recent».
  await legacyRow({
    vehicleId: new Types.ObjectId(c3.id),
    inDate: new Date('2025-03-01T00:00:00.000Z'),
    outDate: new Date('2025-03-02T00:00:00.000Z'),
  });

  // c5 leaves service while in the workshop; the deleted car leaves the registry.
  const c5now = ok<FleetVehicleDto>(await get(`/fleet/vehicles/${c5.id}`));
  ok(
    await post(`/fleet/vehicles/${c5.id}/status`, {
      status: 'outOfService',
      reason: 'عطل كبير',
      version: c5now.version,
    }),
  );
  const removed = await del(`/fleet/vehicles/${gone.id}`);
  expect([200, 204]).toContain(removed.status);
}, 300_000);

afterAll(async () => {
  await getCache().close();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

// ── 1 · visitBreakdown = the list ─────────────────────────────────────────────────────────────

const OCTOBER = { from: '2026-10-01', to: '2026-10-31' };
/** The service's query, from the same plain object the page puts in its URL. */
const asQuery = (q: Record<string, unknown>): MaintenanceFilterQuery => ({
  ...(q['from'] === undefined ? {} : { from: new Date(`${String(q['from'])}T00:00:00.000Z`) }),
  ...(q['to'] === undefined ? {} : { to: new Date(`${String(q['to'])}T00:00:00.000Z`) }),
  ...(q['typeIds'] === undefined ? {} : { typeIds: q['typeIds'] as string[] }),
  ...(q['operationIds'] === undefined ? {} : { operationIds: q['operationIds'] as string[] }),
  ...(q['branchIds'] === undefined ? {} : { branchIds: q['branchIds'] as string[] }),
  ...(q['vehicleCodes'] === undefined ? {} : { vehicleCodes: q['vehicleCodes'] as string[] }),
});

interface Case {
  name: string;
  query: () => Record<string, unknown>;
  count: number;
  unregistered: number | null;
}
const CASES: Case[] = [
  { name: 'the period alone (company view)', query: () => OCTOBER, count: 7, unregistered: 1 },
  {
    name: 'operation O1 ∩ branch B1 — the deleted car’s visit included',
    query: () => ({ ...OCTOBER, operationIds: [O1], branchIds: [B1] }),
    count: 4,
    unregistered: null,
  },
  {
    name: 'type T1 — the deleted car is a T1',
    query: () => ({ ...OCTOBER, typeIds: [T1] }),
    count: 4,
    unregistered: null,
  },
  {
    name: 'type T2 ∩ branch B2 — nobody visited in October',
    query: () => ({ ...OCTOBER, typeIds: [T2], branchIds: [B2] }),
    count: 0,
    unregistered: null,
  },
  {
    name: 'codes — the old book’s code matches its own visit',
    query: () => ({ ...OCTOBER, vehicleCodes: [c1.code, 'B-90'] }),
    count: 3,
    unregistered: null,
  },
];

describe('visitBreakdown — every figure is the list it links to (R-18, D9)', () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const q = c.query();
      const out = await fleetMaintenanceService.visitBreakdown(asQuery(q));
      expect(out.count).toBe(c.count);
      expect(out.count).toBe(await total(q));
      // «خرجت X · ما زالت في الورشة Y (حتى الآن)» — the state now, each its own list.
      expect(out.open).toBe(await total({ ...q, open: true }));
      expect(out.closed).toBe(await total({ ...q, open: false }));
      expect(out.open + out.closed).toBe(out.count);
      // Every facet partitions the same rows.
      const sum = (rows: { count: number }[]) => rows.reduce((s, row) => s + row.count, 0);
      expect(sum(out.byWorkType)).toBe(out.count);
      expect(sum(out.byWorkshop)).toBe(out.count);
      for (const row of out.byWorkType) {
        expect(row.count, row.id).toBe(await total({ ...q, workTypeIds: [row.id] }));
      }
      for (const row of out.byWorkshop) {
        expect(row.count, row.id).toBe(await total({ ...q, workshopIds: [row.id] }));
      }
      expect(out.unregistered).toBe(c.unregistered);
    });
  }

  it('the company view, figure by figure', async () => {
    const out = await fleetMaintenanceService.visitBreakdown(asQuery(OCTOBER));
    expect(out).toMatchObject({ count: 7, open: 3, closed: 4, unregistered: 1 });
    expect(out.byWorkType.map((row) => [row.id, row.count])).toEqual([
      [WT1, 4],
      [WT2, 3],
    ]);
    expect(out.byWorkType[0]?.name?.ar).toBe('صيانة دورية');
    expect(out.byWorkshop.map((row) => [row.id, row.count])).toEqual([
      [WS1, 4],
      [WS2, 3],
    ]);
    // Visits desc, then the latest check-in desc: c1 twice, then by the day each last came in.
    // The deleted car (in 8 Oct) is not ranked — the register cannot open it by its code — though
    // its visit is in the count and in both bars above.
    expect(out.topVehicles).toEqual([
      { vehicleId: c1.id, code: c1.code, visits: 2, lastInDate: '2026-10-20' },
      { vehicleId: null, code: 'B-90', visits: 1, lastInDate: '2026-10-18' },
      { vehicleId: c3.id, code: c3.code, visits: 1, lastInDate: '2026-10-15' },
      { vehicleId: c2.id, code: c2.code, visits: 1, lastInDate: '2026-10-10' },
      { vehicleId: c5.id, code: c5.code, visits: 1, lastInDate: '2026-10-01' },
    ]);
    expect(await total({ ...OCTOBER, vehicleCodes: [gone.code] })).toBe(0);
    // Each ranked car links to its own list.
    for (const row of out.topVehicles) {
      expect(row.visits, row.code).toBe(await total({ ...OCTOBER, vehicleCodes: [row.code] }));
    }
  });

  it('the dashboard’s set (vehicleSet) gives the same count as the screen’s filter', async () => {
    const set = await vehicleSet({ operationIds: [O1] }, B1, { count: true });
    expect([...(set.ids ?? [])].sort()).toEqual([c1.id, c5.id, gone.id].sort());
    // The set keeps the deleted car (its visits still count); the display count is the registry's.
    expect(set.scope).toEqual({
      count: 2,
      typeIds: [],
      operationIds: [O1],
      vehicleCodes: [],
      branchId: B1,
    });
    const out = await fleetMaintenanceService.visitBreakdown(
      asQuery({ ...OCTOBER, operationIds: [O1], branchIds: [B1] }),
    );
    expect(out.count).toBe(await total({ ...OCTOBER, operationIds: [O1], branchIds: [B1] }));
  });
});

// ── 2 · openNow = /fleet/maintenance?state=open ───────────────────────────────────────────────

describe('openNow — «في الورشة الآن» (R-09)', () => {
  it('the company: every open visit of any status, the oldest stay in Cairo days', async () => {
    const out = await fleetMaintenanceService.openNow({ today: TODAY, filter: {} });
    expect(out).toEqual({
      open: 3,
      openActive: 1, // c1
      openOutOfService: 1, // c5 — the book's row is in neither part
      oldest: { vehicleId: c5.id, code: c5.code, inDate: '2026-10-01', days: 31 },
    });
    expect(out.open).toBe(await total({ open: true }));
  });

  const FILTERS: [string, () => VehicleFilter][] = [
    ['branch B1', () => ({ branchIds: [B1] })],
    ['type T2', () => ({ typeIds: [T2] })],
    ['operation O1', () => ({ operationIds: [O1] })],
    ['codes', () => ({ vehicleCodes: [c1.code, 'B-90'] })],
  ];
  for (const [name, filter] of FILTERS) {
    it(`with ${name}: the same rows as the list`, async () => {
      const f = filter();
      const out = await fleetMaintenanceService.openNow({ today: TODAY, filter: f });
      expect(out.open).toBe(await total({ ...f, open: true }));
    });
  }

  it('the days follow the day asked about', async () => {
    const out = await fleetMaintenanceService.openNow({
      today: '2026-10-11',
      filter: { branchIds: [B1] },
    });
    expect(out.oldest).toEqual({
      vehicleId: c5.id,
      code: c5.code,
      inDate: '2026-10-01',
      days: 10,
    });
  });
});

// ── 3 · recentWritten (R-12) ──────────────────────────────────────────────────────────────────

describe('recentWritten — the recent workshop records (R-12)', () => {
  const SINCE = '2026-10-03';

  it('the window: a business date on its first day is in, the day before is out', async () => {
    const rows = await fleetMaintenanceService.recentWritten({
      sinceYmd: SINCE,
      limit: 50,
      filter: {},
    });
    // Newest written first; the deleted car's visit is not a row (its code opens an empty list).
    const expected = [...written]
      .reverse()
      .filter((row) => row.date >= SINCE && row.id !== goneVisit);
    expect(expected.length).toBeGreaterThan(3);
    expect(rows.map((row) => row.visitId)).toEqual(expected.map((row) => row.id));
    expect(rows.map((row) => row.date)).toEqual(expected.map((row) => row.date));
    // In by its EXIT day (in 28 Sep, out 4 Oct); out: the 2 Oct exit, the 1 Oct open stay, and
    // the import row written last with last year's dates.
    expect(rows.some((row) => row.code === c3.code && row.date === '2026-10-04')).toBe(true);
    expect(rows.some((row) => row.code === c4.code)).toBe(false);
    expect(rows.some((row) => row.code === c5.code)).toBe(false);
    expect(rows.every((row) => row.date >= SINCE)).toBe(true);
    // The window moved back one day takes in the 2 Oct exit.
    const wider = await fleetMaintenanceService.recentWritten({
      sinceYmd: addDaysYmd(SINCE, -1),
      limit: 50,
      filter: {},
    });
    expect(wider.map((row) => row.code)).toContain(c4.code);
  });

  it('newest written first, at most `limit`; a row carries its names and its state', async () => {
    const rows = await fleetMaintenanceService.recentWritten({
      sinceYmd: SINCE,
      limit: 3,
      filter: {},
    });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      vehicleId: c1.id,
      code: c1.code,
      date: '2026-10-20',
      workshop: { ar: 'ورشة التوكيل' },
      workType: { ar: 'إصلاح عطل' },
      open: true,
    });
    expect(rows[1]).toMatchObject({ vehicleId: null, code: 'B-90', open: true });
    expect(Number.isNaN(Date.parse(rows[0]?.recordedAt ?? ''))).toBe(false);
    for (let i = 1; i < rows.length; i += 1) {
      expect((rows[i - 1]?.recordedAt ?? '') >= (rows[i]?.recordedAt ?? '')).toBe(true);
    }
  });

  it('follows the vehicle filter like the list', async () => {
    const rows = await fleetMaintenanceService.recentWritten({
      sinceYmd: SINCE,
      limit: 50,
      filter: { branchIds: [B2] },
    });
    expect(rows.map((row) => row.code)).toEqual([c2.code]);
  });
});

// ── 4 · the plan ──────────────────────────────────────────────────────────────────────────────

describe('explain() — the period read is an index scan', () => {
  it('visitBreakdown over [from, to], with and without the set', async () => {
    for (const q of [OCTOBER, { ...OCTOBER, typeIds: [T1], branchIds: [B1] }]) {
      const spy = vi.spyOn(FleetMaintenanceVisitModel, 'aggregate');
      await fleetMaintenanceService.visitBreakdown(asQuery(q));
      const pipeline = spy.mock.calls[0]?.[0] ?? [];
      spy.mockRestore();
      const plan = JSON.stringify(
        await FleetMaintenanceVisitModel.aggregate(pipeline).explain('queryPlanner'),
      );
      expect(plan).toContain('IXSCAN');
      expect(plan).not.toContain('COLLSCAN');
    }
  });
});
