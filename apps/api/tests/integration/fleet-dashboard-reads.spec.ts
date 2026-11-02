// The owning modules' reads for the fleet dashboard (P1-03), against a real database.
//
// The dashboard never counts anything itself: every figure is a call into the module that owns
// it, with the query the linked screen sends. This file proves that promise where it can break —
// on real rows written through the real endpoints:
//
//   1. the four period screens (accidents, dealership, receipts, violations) accept the vehicle
//      set — «النوع / التشغيل / الفرع» (`typeIds`, `operationIds`, `branchIds`) — on a fixture WITH
//      A DELETED CAR, and for every set the list's total = the `/summary` count = `summaryOver`;
//   2. the violations card splits exactly: attributed + «مجهول» + «اسم غير مربوط» = Σ the rollup's
//      `outstandingDriverAmount`, and «مجهول» is the row count of the list's own unknown filter;
//   3. the drivers' `licenseExpiresFrom` / `licenseNotRecorded` and `registryDigest` agree with
//      `/fleet/drivers`; the fuel cards' `expiresFrom` leaves the expired cards out; «شُحن اليوم»
//      (the Cairo day since batch 3's D5) follows the clock passed in; the vehicle reads equal the registry list.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  addDaysYmd,
  cairoYmd,
  calendarDayBounds,
  licenceWindows,
  platformPermissions,
  type FleetCatalogItemDto,
  type FleetMaintenanceVisitDto,
  type FleetVehicleDto,
  type FleetVehicleTypeDto,
  type FleetViolationRollupDto,
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
import { type AuthContext, type ScopeSelector } from '../../src/shared/types';
import { FleetAccidentModel } from '../../src/modules/fleet/accidents/accident.model';
import { FleetViolationModel } from '../../src/modules/fleet/violations/violation.model';
import { fleetAccidentService } from '../../src/modules/fleet/accidents/accident.service';
import { fleetDealershipService } from '../../src/modules/fleet/dealership/dealership.service';
import { fleetReceiptService } from '../../src/modules/fleet/receipts/receipt.service';
import { fleetViolationService } from '../../src/modules/fleet/violations/violation.service';
import { fleetDriverProfileService } from '../../src/modules/fleet/driver-profiles/driver-profile.service';
import { fleetFuelCardService } from '../../src/modules/fleet/fuel-cards/fuel-card.service';
import { fleetVehicleRepository } from '../../src/modules/fleet/vehicles/vehicle.repository';
import { nextNationalId } from './helpers/national-id';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let adminUserId: string;

const TODAY = cairoYmd(new Date());
const WARN = 30;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-fleet-dashboard-reads-${Date.now()}`;
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
const ok = <T>(res: request.Response, status = 200): T => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return data<T>(res);
};
/** A list endpoint's `totalItems`. */
const total = async (path: string, query: Record<string, unknown>): Promise<number> => {
  const res = await get(path, { ...query, pageSize: 1 });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as { meta: { totalItems: number } }).meta.totalItems;
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

// ── the world ─────────────────────────────────────────────────────────────────────────────────

let B1: string;
let B2: string;
const departments = new Map<string, string>();
let jobTitleId: string;
let T1: string;
let T2: string;
let O1: string;
let O2: string;
let workshopId: string;
let workTypeId: string;
let vehicleSide: string;
let driverSide: string;

let counter = 0;
/** Arabic letters only — the HR form refuses digits in a name. */
const NAMES = ['أحمد', 'محمود', 'كريم', 'سامي', 'ياسر', 'حسن', 'طارق', 'وليد', 'هشام', 'عادل'];

/** An HR employee in a driving seat — the registry's population. */
const mkDriver = async (branchId: string): Promise<string> => {
  counter += 1;
  const res = await post('/hr/employees/direct', {
    personal: {
      identity: {
        fullNameAr: `سائق ${NAMES[counter % NAMES.length] ?? 'أحمد'}`,
        nationalId: nextNationalId(),
        nationality: 'Egyptian',
      },
      contact: { primaryPhone: `012${String(60_000_000 + counter).padStart(8, '0')}` },
      experience: [],
      drivingLicenses: [],
      certifications: [],
      references: [],
    },
    employment: {
      jobTitleId,
      departmentId: departments.get(branchId),
      branchId,
      employmentType: 'fullTime',
      probationMonths: 0,
      startDate: '2026-01-01T00:00:00.000Z',
    },
    entryStatus: 'active',
  });
  return ok<{ id: string }>(res, 201).id;
};

const mkProfile = async (employeeId: string, licenseExpiresAt: string | null): Promise<void> => {
  counter += 1;
  ok(
    await post('/fleet/drivers', {
      employeeId,
      licenseNumber: `RD-${counter}`,
      ...(licenseExpiresAt === null ? {} : { licenseExpiresAt }),
    }),
    201,
  );
};

/** A catalog item by its Arabic name — the seed's when it carries one, else made here. */
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

const mkVehicle = async (over: Record<string, unknown>): Promise<FleetVehicleDto> => {
  counter += 1;
  return ok<FleetVehicleDto>(
    await post('/fleet/vehicles', {
      code: `${300 + counter}`,
      typeId: T1,
      plateNumber: `ق ر ${counter}`,
      chassisNumber: `RCH-${counter}`,
      motorNumber: `RMO-${counter}`,
      joinedAt: '2025-01-01T00:00:00.000Z',
      licenseExpiresAt: `${addDaysYmd(TODAY, 400)}T00:00:00.000Z`,
      radio: { issi: `RISSI-${counter}` },
      branchId: B1,
      ...over,
    }),
    201,
  );
};

/** The five cars: two types × two branches × two operations, and one that will be DELETED. */
let c1: FleetVehicleDto; // T1 · B1 · O1
let c2: FleetVehicleDto; // T1 · B2 · O2
let c3: FleetVehicleDto; // T2 · B1 · O2
let c4: FleetVehicleDto; // T2 · B2 · O1
let gone: FleetVehicleDto; // T1 · B1 · O1 — its history stays, the car is soft-deleted
let driverB1: string;

const seedRecords = async (car: FleetVehicleDto, i: number): Promise<void> => {
  // An accident in October.
  ok(
    await post('/fleet/accidents', {
      vehicleId: car.id,
      occurredAt: `2026-10-${String(10 + i).padStart(2, '0')}`,
      culprit: 'طرف ثالث',
      statement: 'اصطدام',
      companyCost: 100 * (i + 1),
      amountCollected: 0,
      paidAmount: 0,
    }),
    201,
  );
  // A custody receipt in October.
  ok(
    await post('/fleet/receipts', {
      date: `2026-10-${String(10 + i).padStart(2, '0')}`,
      vehicleId: car.id,
      kind: 'wash',
      amount: 50 + i,
      driverName: 'سائق الغسيل',
    }),
    201,
  );
  // A workshop exit — which opens the dealership rows.
  const visit = ok<FleetMaintenanceVisitDto>(
    await post('/fleet/maintenance', {
      vehicleId: car.id,
      inDate: '2026-10-01',
      workshopId,
      workTypeId,
      odometerAtService: 1000,
      driverInEmployeeId: driverB1,
    }),
    201,
  );
  ok(
    await post(`/fleet/maintenance/${visit.id}/check-out`, {
      outDate: `2026-10-${String(3 + i).padStart(2, '0')}`,
      exitOdometer: 1100,
      version: visit.version,
      driverOutEmployeeId: driverB1,
    }),
  );
  // The company's statement for 2026 and two drivers' fines: one on a named driver, one «مجهول».
  ok(
    await post('/fleet/violations/vehicle', {
      vehicleId: car.id,
      year: 2026,
      violationTypeId: vehicleSide,
      count: 1,
      unitValue: 200 + i,
    }),
    201,
  );
  ok(
    await post('/fleet/violations/driver', {
      vehicleId: car.id,
      date: '2026-05-10',
      driverEmployeeId: driverB1,
      violationTypeId: driverSide,
      amount: 30 + i,
    }),
    201,
  );
  ok(
    await post('/fleet/violations/driver', {
      vehicleId: car.id,
      date: '2026-06-10',
      driverEmployeeId: null,
      violationTypeId: driverSide,
      amount: 10 + i,
    }),
    201,
  );
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();
  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions, ...fleetPermissions].map((p) => p.key),
  );
  adminUserId = await mkUser('dashboard-reads@ecms.local');
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

  const mkBranch = async (code: string, ar: string): Promise<string> =>
    ok<{ id: string }>(await post('/platform/branches', { code, name: { ar, en: ar } }), 201).id;
  B1 = await mkBranch('81', 'فرع الإسكندرية');
  B2 = await mkBranch('82', 'فرع المنصورة');
  for (const [branchId, code] of [
    [B1, 'RD-OPS-1'],
    [B2, 'RD-OPS-2'],
  ] as const) {
    departments.set(
      branchId,
      ok<{ id: string }>(
        await post('/platform/departments', {
          code,
          name: { ar: 'الحركة', en: 'Operations' },
          branchId,
        }),
        201,
      ).id,
    );
  }
  jobTitleId = ok<{ id: string }>(
    await post('/platform/job-titles', {
      code: 'RD-DRV',
      name: { ar: 'سائق', en: 'Driver' },
      jobGrade: 'G1',
      requiresDrivingTest: true,
    }),
    201,
  ).id;

  const mkType = async (ar: string): Promise<string> =>
    ok<FleetVehicleTypeDto>(
      await post('/fleet/vehicle-types', { name: { ar, en: ar }, maintenanceIntervalKm: 10_000 }),
      201,
    ).id;
  T1 = await mkType('مصفحة');
  T2 = await mkType('ميكروباص');
  O1 = await mkCatalog('operation', 'نقل أموال');
  O2 = await mkCatalog('operation', 'ATM');
  workshopId = await mkCatalog('workshop', 'ورشة التوكيل');
  workTypeId = await mkCatalog('workType', 'صيانة');

  const sideType = async (side: 'company' | 'driver', ar: string): Promise<string> =>
    ok<FleetCatalogItemDto>(
      await post('/fleet/catalog-items', {
        kind: 'violationType',
        name: { ar, en: ar },
        violationSide: side,
      }),
      201,
    ).id;
  vehicleSide = await sideType('company', 'رسوم لوحة الحركة');
  driverSide = await sideType('driver', 'سرعة لوحة الحركة');

  driverB1 = await mkDriver(B1);
  await mkProfile(driverB1, null);

  c1 = await mkVehicle({ typeId: T1, branchId: B1, operationId: O1 });
  c2 = await mkVehicle({ typeId: T1, branchId: B2, operationId: O2 });
  c3 = await mkVehicle({ typeId: T2, branchId: B1, operationId: O2 });
  c4 = await mkVehicle({ typeId: T2, branchId: B2, operationId: O1 });
  gone = await mkVehicle({ typeId: T1, branchId: B1, operationId: O1 });
  let i = 0;
  for (const car of [c1, c2, c3, c4, gone]) await seedRecords(car, i++);

  // Rows the old book left — no registry car (found by the code the book wrote), an undated
  // accident, and a driver's fine on a name nobody linked to an employee («اسم غير مربوط»).
  const legacy = { isDeleted: false, schemaVersion: 1, createdBy: null, updatedBy: null };
  await FleetAccidentModel.create({
    ...legacy,
    vehicleId: null,
    vehicleCode: 'B-77',
    occurredAt: new Date('2026-10-20T00:00:00.000Z'),
    culprit: 'دفتر',
    culpritEmployeeId: null,
    statement: 'من الدفتر',
    companyCost: 70,
    amountCollected: 0,
    paidAmount: 0,
    status: 'open',
    notes: null,
  });
  await FleetAccidentModel.create({
    ...legacy,
    vehicleId: new Types.ObjectId(c1.id),
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
  await FleetViolationModel.create({
    ...legacy,
    kind: 'driver',
    vehicleId: new Types.ObjectId(c3.id),
    violationTypeId: new Types.ObjectId(driverSide),
    amount: 77,
    year: null,
    count: null,
    unitValue: null,
    date: new Date('2026-07-01T00:00:00.000Z'),
    driverEmployeeId: null,
    driverName: 'محمد من الدفتر',
    collected: false,
  });

  // The deleted car: its history was written while it was live, then it left the registry.
  const del = await request(app)
    .delete(`/api/v1/fleet/vehicles/${gone.id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect([200, 204]).toContain(del.status);
}, 300_000);

afterAll(async () => {
  await getCache().close();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

// ── 1 · the four period screens take the vehicle set ──────────────────────────────────────────

interface SetCase {
  name: string;
  query: () => Record<string, unknown>;
  /** How many of the five cars it holds — the deleted one included. */
  cars: number;
  /** c1 carries the book's undated accident; c3 the book's unlinked driver fine. */
  c1: boolean;
  c3: boolean;
}
const SETS: SetCase[] = [
  {
    name: 'type T1 (the deleted car is a T1)',
    query: () => ({ typeIds: [T1] }),
    cars: 3,
    c1: true,
    c3: false,
  },
  { name: 'operation O1', query: () => ({ operationIds: [O1] }), cars: 3, c1: true, c3: false },
  { name: 'branch B2', query: () => ({ branchIds: [B2] }), cars: 2, c1: false, c3: false },
  {
    name: 'type T1 ∩ branch B1',
    query: () => ({ typeIds: [T1], branchIds: [B1] }),
    cars: 2,
    c1: true,
    c3: false,
  },
  {
    name: 'type T2 ∩ operation O2',
    query: () => ({ typeIds: [T2], operationIds: [O2] }),
    cars: 1,
    c1: false,
    c3: true,
  },
  {
    name: 'codes ∩ a set',
    query: () => ({ vehicleCodes: [c1.code, c3.code], typeIds: [T1] }),
    cars: 1,
    c1: true,
    c3: false,
  },
];

describe('accidents — list total = /summary count = summaryOver, for every set', () => {
  for (const { name, query, cars, c1: holdsC1 } of SETS) {
    it(name, async () => {
      const q = query();
      const list = await total('/fleet/accidents', wire(q));
      const summary = ok<{ count: number }>(await get('/fleet/accidents/summary', wire(q)));
      const over = await fleetAccidentService.summaryOver(q);
      // c1's undated file is c1's: in the count (no date asked) whenever c1 is in the set.
      expect(list).toBe(cars + (holdsC1 ? 1 : 0));
      expect(summary.count).toBe(list);
      expect(over.count).toBe(list);
    });
  }

  it('without a set nothing changed — the old book’s code still finds its file', async () => {
    expect(await total('/fleet/accidents', { vehicleCodes: 'B-77' })).toBe(1);
    expect((await fleetAccidentService.summaryOver({ vehicleCodes: ['B-77'] })).count).toBe(1);
    // …and a set is a question about registry cars, which that file is not.
    expect(await total('/fleet/accidents', { vehicleCodes: 'B-77', typeIds: T1 })).toBe(0);
  });

  it('undatedCount counts the files no period can hold, over the same set', async () => {
    expect(await fleetAccidentService.undatedCount({})).toBe(1);
    expect(await fleetAccidentService.undatedCount({ typeIds: [T1] })).toBe(1);
    expect(await fleetAccidentService.undatedCount({ typeIds: [T2] })).toBe(0);
  });

  it('recentWritten: dated rows only, newest written first, the set honoured', async () => {
    const rows = await fleetAccidentService.recentWritten({
      sinceYmd: '2026-10-01',
      limit: 8,
      filter: { typeIds: [T1] },
    });
    expect(rows.map((row) => row.code)).toEqual([gone.code, c2.code, c1.code]);
    expect(rows.every((row) => /^\d{4}-\d{2}-\d{2}$/u.test(row.date))).toBe(true);
  });
});

describe('dealership — list total = /summary count = summaryOver, for every set', () => {
  for (const { name, query, cars } of SETS) {
    it(name, async () => {
      const q = query();
      const list = await total('/fleet/dealership', wire(q));
      const summary = ok<{ count: number; pending: number }>(
        await get('/fleet/dealership/summary', wire(q)),
      );
      const over = await fleetDealershipService.summaryOver(q);
      expect(list).toBe(cars);
      expect(summary.count).toBe(list);
      expect(over).toEqual(summary);
    });
  }

  it('the exit-day window still reads outDate (R-20)', async () => {
    const q = { from: '2026-10-03', to: '2026-10-04', typeIds: T1 };
    expect(await total('/fleet/dealership', q)).toBe(2);
    expect(ok<{ count: number }>(await get('/fleet/dealership/summary', q)).count).toBe(2);
  });
});

describe('receipts — list total = /summary count = summaryOver, for every set', () => {
  for (const { name, query, cars } of SETS) {
    it(name, async () => {
      const q = query();
      const list = await total('/fleet/receipts', wire(q));
      const summary = ok<{ count: number; custodyTotal: number }>(
        await get('/fleet/receipts/summary', wire(q)),
      );
      const over = await fleetReceiptService.summaryOver(q);
      expect(list).toBe(cars);
      expect(summary.count).toBe(list);
      expect(over).toEqual(summary);
    });
  }

  it('firstReceiptDate is the earliest live receipt’s day', async () => {
    expect(await fleetReceiptService.firstReceiptDate()).toBe('2026-10-10');
  });
});

describe('violations — the list and the rollup take the set; the digest splits exactly', () => {
  for (const { name, query, cars, c3: holdsC3 } of SETS) {
    it(`list: ${name}`, async () => {
      const q = query();
      // Per car: one statement row + two driver fines; c3 also carries the book's unlinked fine.
      expect(await total('/fleet/violations', wire({ ...q, year: 2026 }))).toBe(
        cars * 3 + (holdsC3 ? 1 : 0),
      );
    });
  }

  for (const { name, query } of SETS) {
    it(`digest = the rollup’s own sums: ${name}`, async () => {
      const q = query();
      const rollup = ok<FleetViolationRollupDto[]>(
        await get('/fleet/violations/rollup', wire({ ...q, year: 2026 })),
      );
      const digest = await fleetViolationService.yearDigest({ year: 2026, filter: q });
      const sum = (pick: (row: FleetViolationRollupDto) => number): number =>
        Math.round(rollup.reduce((acc, row) => acc + pick(row), 0) * 100) / 100;
      expect(digest.company).toBe(sum((row) => row.outstandingVehicleAmount));
      expect(digest.drivers.total).toBe(sum((row) => row.outstandingDriverAmount));
      const { attributed, unknown, unlinked } = digest.drivers;
      expect(attributed + unknown.amount + unlinked.amount).toBeCloseTo(digest.drivers.total, 6);
      // «مجهول» = the list's own unknown-driver rows, uncollected, in the year.
      expect(unknown.count).toBe(
        await total(
          '/fleet/violations',
          wire({ ...q, year: 2026, kind: 'driver', unknownDriver: 'true', collected: 'false' }),
        ),
      );
    });
  }

  it('the whole company: «اسم غير مربوط» is the book’s name, never folded into a driver', async () => {
    const digest = await fleetViolationService.yearDigest({ year: 2026, filter: {} });
    expect(digest.drivers.unlinked).toEqual({ amount: 77, count: 1 });
    expect(digest.drivers.unknown).toEqual({ amount: 10 + 11 + 12 + 13 + 14, count: 5 });
    expect(digest.drivers.attributed).toBe(30 + 31 + 32 + 33 + 34);
    expect(digest.company).toBe(200 + 201 + 202 + 203 + 204);
  });

  it('a collected fine is out of every owed figure', async () => {
    const fine = await FleetViolationModel.findOne({ driverName: 'محمد من الدفتر' }).exec();
    await FleetViolationModel.updateOne({ _id: fine?._id }, { $set: { collected: true } }).exec();
    const digest = await fleetViolationService.yearDigest({ year: 2026, filter: {} });
    expect(digest.drivers.unlinked).toEqual({ amount: 0, count: 0 });
    await FleetViolationModel.updateOne({ _id: fine?._id }, { $set: { collected: false } }).exec();
  });
});

// ── 2 · drivers, fuel cards, vehicles ────────────────────────────────────────────────────────

describe('drivers — registryDigest and the list filters it shares', () => {
  const at = (ymd: string): string => `${ymd}T00:00:00.000Z`;
  beforeAll(async () => {
    await mkProfile(await mkDriver(B1), at(TODAY)); // expired ON the expiry day
    await mkProfile(await mkDriver(B1), at(addDaysYmd(TODAY, 5))); // expiring
    await mkProfile(await mkDriver(B2), at(addDaysYmd(TODAY, 40))); // soon (W = 30)
    await mkProfile(await mkDriver(B2), null); // no date recorded
    await mkDriver(B1); // no profile at all
  }, 120_000);

  const digest = (branchId: string | null) =>
    fleetDriverProfileService.registryDigest({
      today: TODAY,
      warnDays: WARN,
      branchId,
      cashSpecIds: [],
      atmSpecIds: [],
    });

  it('every bucket equals the /fleet/drivers total for its link', async () => {
    const windows = licenceWindows(TODAY, WARN);
    const expired = calendarDayBounds(TODAY, TODAY).before.toISOString();
    const range = (from: string, to: string) => {
      const bounds = calendarDayBounds(from, to);
      return {
        licenseExpiresFrom: bounds.from.toISOString(),
        licenseExpiresBefore: bounds.before.toISOString(),
      };
    };
    const out = await digest(null);
    expect(out.licence).toMatchObject({ expired: 1, expiring: 1, soon: 1, unregistered: 1 });
    expect(out.licence.expired).toBe(
      await total('/fleet/drivers', { licenseExpiresBefore: expired }),
    );
    expect(out.licence.expiring).toBe(
      await total('/fleet/drivers', range(windows.expiring.from, windows.expiring.to)),
    );
    expect(out.licence.soon).toBe(
      await total('/fleet/drivers', range(windows.soon!.from, windows.soon!.to)),
    );
    // driverB1 (seeded first) has no date either: two «بلا تاريخ».
    expect(out.licence.notRecorded).toBe(2);
    expect(out.licence.notRecorded).toBe(
      await total('/fleet/drivers', { licenseNotRecorded: 'true' }),
    );
    expect(out.total).toBe(await total('/fleet/drivers', {}));
  });

  it('a switcher branch is the HR branch — `?branchId=`', async () => {
    const out = await digest(B2);
    expect(out.total).toBe(await total('/fleet/drivers', { branchId: B2 }));
    expect(out.licence).toMatchObject({ expired: 0, soon: 1, notRecorded: 1, unregistered: 0 });
  });
});

describe('fuel cards — the expiry window and the clock', () => {
  let charged: string;
  beforeAll(async () => {
    counter += 1;
    const mkCard = async (vehicleId: string, expires: string) =>
      ok<{ id: string; version: number }>(
        await post('/fleet/fuel-cards', {
          vehicleId,
          company: 'wataniya',
          name: 'كارت وطنية',
          number: `7045 99${counter} ${String(Math.random()).slice(2, 6)}`,
          expiresAt: expires,
          password: '1234',
        }),
        201,
      );
    await mkCard(c1.id, addDaysYmd(TODAY, -1)); // expired yesterday
    const soon = await mkCard(c2.id, addDaysYmd(TODAY, 10)); // within the window
    await mkCard(c3.id, addDaysYmd(TODAY, 100)); // beyond it
    const requested = ok<{ version: number }>(
      await request(app)
        .patch(`/api/v1/fleet/fuel-cards/${soon.id}/request`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 500, version: soon.version }),
    );
    ok(await post(`/fleet/fuel-cards/${soon.id}/approve`, { version: requested.version }));
    charged = soon.id;
  }, 120_000);

  it('expiresFrom keeps the expired cards out of «تنتهي خلال N يومًا»', async () => {
    const window = calendarDayBounds(addDaysYmd(TODAY, 1), addDaysYmd(TODAY, 30));
    const both = {
      expiresFrom: window.from.toISOString(),
      expiresBefore: window.before.toISOString(),
    };
    expect(ok<{ cardCount: number }>(await get('/fleet/fuel-cards/summary', both)).cardCount).toBe(
      1,
    );
    expect(await total('/fleet/fuel-cards', both)).toBe(1);
    // `expiresBefore` alone counts the expired one too — why the bound was needed.
    expect(
      ok<{ cardCount: number }>(
        await get('/fleet/fuel-cards/summary', { expiresBefore: both.expiresBefore }),
      ).cardCount,
    ).toBe(2);
  });

  it('summary(q, now) measures «شُحن اليوم» (the Cairo day) from the clock passed in', async () => {
    expect(charged).toBeDefined();
    expect((await fleetFuelCardService.summary({}, new Date())).chargedTodayAmount).toBe(500);
    const later = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    expect((await fleetFuelCardService.summary({}, later)).chargedTodayAmount).toBe(0);
  });
});

describe('vehicles — the dashboard reads equal the registry list', () => {
  const org = { scope: 'organization', userId: adminUserId } as unknown as ScopeSelector;

  it('statusCounts and countListed are the list totals', async () => {
    const counts = await fleetVehicleRepository.statusCounts(org);
    expect(counts.active).toBe(await total('/fleet/vehicles', { status: 'active' }));
    expect(counts.active, 'the deleted car is not in the registry').toBe(4);
    const before = calendarDayBounds(addDaysYmd(TODAY, 400), addDaysYmd(TODAY, 400)).before;
    expect(
      await fleetVehicleRepository.countListed(
        { status: ['active'], licenseExpiresBefore: before },
        org,
      ),
    ).toBe(
      await total('/fleet/vehicles', {
        status: 'active',
        licenseExpiresBefore: before.toISOString(),
      }),
    );
  });

  it('activeByTypeAndBranch adds up to the active cars, cell by cell', async () => {
    const cells = await fleetVehicleRepository.activeByTypeAndBranch(org);
    expect(cells.reduce((sum, cell) => sum + cell.count, 0)).toBe(4);
    for (const cell of cells) {
      expect(cell.count).toBe(
        await total('/fleet/vehicles', {
          status: 'active',
          typeId: cell.typeId,
          branchId: cell.branchId,
        }),
      );
    }
  });

  it('idsWithTypes includes the deleted car — its history is still a T1 car’s', async () => {
    expect(await fleetVehicleRepository.idsWithTypes([T1])).toEqual(
      expect.arrayContaining([c1.id, c2.id, gone.id]),
    );
  });
});
