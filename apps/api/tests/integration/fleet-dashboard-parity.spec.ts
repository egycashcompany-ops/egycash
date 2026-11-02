// «لوحة تحكم الحركة» — every figure equals the screen its link opens (plan §6.2, §8, R-28).
//
// One fixture, written through the real endpoints with the clock PINNED at 2026-10-31T23:30Z — Cairo's
// 2026-11-01 — and for each figure: read R1 / R2, call the endpoint behind the figure's link with the
// link's own parameters (as its page sends them), and compare. The fixture carries what breaks naive
// counting: a licence stamped at a non-midnight instant ON today, a car in the workshop, a car out of
// service, a DELETED car with history, an absent fixed driver, a seat-holder without a profile, an
// expired driver licence, legacy rows with no car and an undated accident.
//
// The invariants of unified.md §6.2 are asserted on the same fixture: ready = rows − inWorkshop −
// licenceExpired; registry = available + absent + inactive + not employed + licence expired; km =
// Σ buckets (confirmed + span) = Σ byBranch + unregistered; Σ byWorkType = Σ byWorkshop = visits.count;
// drivers' violations = attributed + unknown + unlinked; the licence buckets are disjoint.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  calendarDayBounds,
  platformPermissions,
  type FleetCatalogItemDto,
  type FleetDashboardNowDto,
  type FleetDashboardPeriodDto,
  type FleetMaintenanceAlarmDto,
  type FleetMaintenanceVisitDto,
  type FleetNoticeDto,
  type FleetRosterDayDto,
  type FleetVehicleDto,
  type FleetVehicleTypeDto,
  type FleetViolationRollupDto,
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
import { FleetViolationModel } from '../../src/modules/fleet/violations/violation.model';
import { nextNationalId } from './helpers/national-id';

/** Cairo's 2026-11-01, 01:30 — the UTC date is still the 31st (R-01). */
const NOW = new Date('2026-10-31T23:30:00.000Z');
const TODAY = '2026-11-01';
const OCT = { preset: 'custom', from: '2026-10-01', to: '2026-10-31' } as const;

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-fleet-dashboard-parity-${Date.now()}`;
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
const get = (path: string, query: Record<string, unknown> = {}, branch?: string) => {
  const req = request(app)
    .get(`/api/v1${path}`)
    .query(query)
    .set('Authorization', `Bearer ${adminToken}`);
  return branch === undefined ? req : req.set('X-Active-Branch', branch);
};
const send = (
  method: 'post' | 'patch' | 'delete',
  path: string,
  body: Record<string, unknown> = {},
) => request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${adminToken}`).send(body);
const ok = <T>(res: request.Response, status = 200): T => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return data<T>(res);
};
/** A list screen's `totalItems` for exactly these parameters. */
const total = async (path: string, query: Record<string, unknown>, branch?: string) => {
  const res = await get(path, { ...query, pageSize: 1 }, branch);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as { meta: { totalItems: number } }).meta.totalItems;
};
/** The first / last instant of a named day — what the pages send for a day bound (R-02). */
const first = (ymd: string) => calendarDayBounds(ymd, ymd).from.toISOString();
const last = (ymd: string) => calendarDayBounds(ymd, ymd).before.toISOString();
const csv = (ids: readonly string[]) => ids.join(',');

// ── the world ─────────────────────────────────────────────────────────────────────────────────

let B1: string;
let B2: string;
const departments = new Map<string, string>();
let jobTitleId: string;
let T1: string;
let T2: string;
let O_CASH: string;
let O_ATM: string;
let workshopId: string;
let workTypeId: string;
let vehicleSide: string;
let driverSide: string;
let counter = 0;
const NAMES = ['أحمد', 'محمود', 'كريم', 'سامي', 'ياسر', 'حسن', 'طارق', 'وليد', 'هشام', 'عادل'];

const mkEmployee = async (branchId: string): Promise<string> => {
  counter += 1;
  const res = await send('post', '/hr/employees/direct', {
    personal: {
      identity: {
        fullNameAr: `سائق ${NAMES[counter % NAMES.length] ?? 'أحمد'}`,
        nationalId: nextNationalId(),
        nationality: 'Egyptian',
      },
      contact: { primaryPhone: `012${String(70_000_000 + counter).padStart(8, '0')}` },
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

const mkDriver = async (
  branchId: string,
  profile: { licenseExpiresAt?: string; specializationId?: string } | null,
): Promise<string> => {
  const employeeId = await mkEmployee(branchId);
  if (profile !== null) {
    counter += 1;
    ok(
      await send('post', '/fleet/drivers', {
        employeeId,
        licenseNumber: `PD-${counter}`,
        ...profile,
      }),
      201,
    );
  }
  return employeeId;
};

const mkCatalog = async (kind: string, ar: string, extra: Record<string, unknown> = {}) => {
  const seeded = ok<FleetCatalogItemDto[]>(
    await get('/fleet/catalog-items', { kind, pageSize: 100 }),
  ).find((item) => item.name.ar === ar);
  if (seeded !== undefined) return seeded.id;
  return ok<FleetCatalogItemDto>(
    await send('post', '/fleet/catalog-items', { kind, name: { ar, en: ar }, ...extra }),
    201,
  ).id;
};

const mkVehicle = async (over: Record<string, unknown>): Promise<FleetVehicleDto> => {
  counter += 1;
  return ok<FleetVehicleDto>(
    await send('post', '/fleet/vehicles', {
      code: `${500 + counter}`,
      typeId: T1,
      plateNumber: `ب ر ${counter}`,
      chassisNumber: `PCH-${counter}`,
      motorNumber: `PMO-${counter}`,
      joinedAt: '2025-01-01T00:00:00.000Z',
      licenseExpiresAt: '2027-12-31T00:00:00.000Z',
      radio: { issi: `PISSI-${counter}` },
      branchId: B1,
      ...over,
    }),
    201,
  );
};
const read = async (vehicleId: string, date: string, reading: number) =>
  ok(await send('post', '/fleet/odometer', { vehicleId, date, reading }), 201);
const checkIn = async (vehicleId: string, inDate: string, driver: string) =>
  ok<FleetMaintenanceVisitDto>(
    await send('post', '/fleet/maintenance', {
      vehicleId,
      inDate,
      workshopId,
      workTypeId,
      driverInEmployeeId: driver,
    }),
    201,
  );
const checkOut = async (visit: FleetMaintenanceVisitDto, outDate: string, driver: string) =>
  ok(
    await send('post', `/fleet/maintenance/${visit.id}/check-out`, {
      outDate,
      version: visit.version,
      driverOutEmployeeId: driver,
    }),
  );

// v1 T1·B1·cash  licence expired TODAY at 10:00Z (a non-midnight stamp) · read Oct 25 → Oct 31
// v2 T1·B2·atm   licence Nov 20 (expiring) · standing crew = dE, absent today · last read Oct 28
// v3 T2·B1·cash  licence Dec 15 (≤ 60 days) · planned today with dA · read once Oct 29
// v4 T2·B1       in the workshop since Oct 25
// v5 T1·B1       out of service, licence expired Oct 1
// v6 T1·B2       never read
// v7 T1·B2       DELETED after its October history was written
let v1: FleetVehicleDto;
let v2: FleetVehicleDto;
let v3: FleetVehicleDto;
let v4: FleetVehicleDto;
let v5: FleetVehicleDto;
let v6: FleetVehicleDto;
let v7: FleetVehicleDto;
let dA: string; // B1 · licence valid · «نقل اموال»
let dE: string; // B2 · valid · التمامات today — v2's fixed driver

let now: FleetDashboardNowDto;
let oct: FleetDashboardPeriodDto;

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
      email: 'dashboard-parity@ecms.local',
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  const adminId = String(user._id);
  await userService.forceActivate(adminId);
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
  adminToken = await authService.signAccessToken(adminId, new Types.ObjectId().toString(), 0);

  const mkBranch = async (code: string, ar: string) =>
    ok<{ id: string }>(
      await send('post', '/platform/branches', { code, name: { ar, en: ar } }),
      201,
    ).id;
  B1 = await mkBranch('91', 'فرع طنطا');
  B2 = await mkBranch('92', 'فرع أسيوط');
  for (const [branchId, code] of [
    [B1, 'PD-OPS-1'],
    [B2, 'PD-OPS-2'],
  ] as const) {
    departments.set(
      branchId,
      ok<{ id: string }>(
        await send('post', '/platform/departments', {
          code,
          name: { ar: 'الحركة', en: 'Ops' },
          branchId,
        }),
        201,
      ).id,
    );
  }
  jobTitleId = ok<{ id: string }>(
    await send('post', '/platform/job-titles', {
      code: 'PD-DRV',
      name: { ar: 'سائق', en: 'Driver' },
      jobGrade: 'G1',
      requiresDrivingTest: true,
    }),
    201,
  ).id;
  const mkType = async (ar: string) =>
    ok<FleetVehicleTypeDto>(
      await send('post', '/fleet/vehicle-types', {
        name: { ar, en: ar },
        maintenanceIntervalKm: 10_000,
      }),
      201,
    ).id;
  T1 = await mkType('مصفحة');
  T2 = await mkType('ميكروباص');
  O_CASH = await mkCatalog('operation', 'نقل أموال');
  O_ATM = await mkCatalog('operation', 'ATM');
  workshopId = await mkCatalog('workshop', 'ورشة اللوحة');
  workTypeId = await mkCatalog('workType', 'صيانة');
  vehicleSide = await mkCatalog('violationType', 'رسوم اللوحة', { violationSide: 'company' });
  driverSide = await mkCatalog('violationType', 'سرعة اللوحة', { violationSide: 'driver' });
  const specCash = await mkCatalog('driverSpecialization', 'نقل اموال');
  const specAtm = await mkCatalog('driverSpecialization', 'ATM');

  dA = await mkDriver(B1, { licenseExpiresAt: '2027-06-30', specializationId: specCash });
  await mkDriver(B1, { licenseExpiresAt: '2026-10-20' }); // expired
  await mkDriver(B2, { specializationId: specAtm }); // no licence date
  await mkDriver(B1, null); // a seat-holder with no profile
  dE = await mkDriver(B2, { licenseExpiresAt: '2027-06-30' });
  await mkDriver(B2, { licenseExpiresAt: '2026-11-20' }); // expiring

  v1 = await mkVehicle({ operationId: O_CASH, licenseExpiresAt: '2026-11-01T10:00:00.000Z' });
  v2 = await mkVehicle({
    branchId: B2,
    operationId: O_ATM,
    licenseExpiresAt: '2026-11-20T00:00:00.000Z',
  });
  v3 = await mkVehicle({
    typeId: T2,
    operationId: O_CASH,
    licenseExpiresAt: '2026-12-15T00:00:00.000Z',
  });
  v4 = await mkVehicle({ typeId: T2 });
  v5 = await mkVehicle({ licenseExpiresAt: '2026-10-01T00:00:00.000Z' });
  v6 = await mkVehicle({ branchId: B2 });
  v7 = await mkVehicle({ branchId: B2 });

  await read(v1.id, '2026-10-25', 1000);
  await read(v1.id, '2026-10-31', 1300);
  await read(v2.id, '2026-10-20', 500);
  await read(v2.id, '2026-10-28', 800);
  await read(v3.id, '2026-10-29', 100);
  await read(v4.id, '2026-10-01', 50);
  await read(v7.id, '2026-10-05', 2000);
  await read(v7.id, '2026-10-06', 2100);

  await checkIn(v4.id, '2026-10-25', dA);
  await checkOut(await checkIn(v2.id, '2026-10-10', dE), '2026-10-12', dE);
  await checkOut(await checkIn(v7.id, '2026-10-06', dE), '2026-10-07', dE);

  const status = await send('post', `/fleet/vehicles/${v5.id}/status`, {
    status: 'outOfService',
    reason: 'حادث جسيم',
    version: v5.version,
  });
  ok(status);

  for (const [car, day, cost, paid] of [
    [v1, '2026-10-30', 1000, 300],
    [v7, '2026-10-08', 400, 0],
  ] as const) {
    ok(
      await send('post', '/fleet/accidents', {
        vehicleId: car.id,
        occurredAt: day,
        culprit: 'طرف ثالث',
        statement: 'اصطدام',
        companyCost: cost,
        amountCollected: 0,
        paidAmount: paid,
      }),
      201,
    );
  }
  ok(
    await send('post', '/fleet/receipts', {
      date: '2026-10-15',
      vehicleId: v1.id,
      kind: 'wash',
      amount: 50,
      driverName: 'سائق',
    }),
    201,
  );
  ok(
    await send('post', '/fleet/receipts', {
      date: '2026-10-07',
      vehicleId: v7.id,
      kind: 'wash',
      amount: 35,
      driverName: 'سائق',
    }),
    201,
  );
  ok(
    await send('post', '/fleet/violations/vehicle', {
      vehicleId: v1.id,
      year: 2026,
      violationTypeId: vehicleSide,
      count: 1,
      unitValue: 200,
    }),
    201,
  );
  ok(
    await send('post', '/fleet/violations/driver', {
      vehicleId: v1.id,
      date: '2026-05-10',
      driverEmployeeId: dA,
      violationTypeId: driverSide,
      amount: 30,
    }),
    201,
  );
  ok(
    await send('post', '/fleet/violations/driver', {
      vehicleId: v2.id,
      date: '2026-06-10',
      driverEmployeeId: null,
      violationTypeId: driverSide,
      amount: 10,
    }),
    201,
  );
  ok(
    await send('post', '/fleet/notices', {
      template: 'deltaInsurance',
      values: { driverName: 'سائق' },
      vehicleId: v1.id,
    }),
    201,
  );

  // Fuel cards: one expired today, one expiring and charged, one waiting for a top-up.
  const mkCard = async (vehicleId: string, expiresAt: string) => {
    counter += 1;
    return ok<{ id: string; version: number }>(
      await send('post', '/fleet/fuel-cards', {
        vehicleId,
        company: 'wataniya',
        name: 'كارت وطنية',
        number: `7045 88${counter} ${1000 + counter}`,
        expiresAt,
        password: '1234',
      }),
      201,
    );
  };
  await mkCard(v1.id, '2026-11-01');
  const charged = await mkCard(v2.id, '2026-11-15');
  const waiting = await mkCard(v3.id, '2027-06-30');
  const asked = ok<{ version: number }>(
    await send('patch', `/fleet/fuel-cards/${charged.id}/request`, {
      amount: 500,
      version: charged.version,
    }),
  );
  ok(await send('post', `/fleet/fuel-cards/${charged.id}/approve`, { version: asked.version }));
  ok(
    await send('patch', `/fleet/fuel-cards/${waiting.id}/request`, {
      amount: 200,
      version: waiting.version,
    }),
  );

  // The roster of the Cairo day: v2's standing driver is away (التمامات), v3 is planned with dA.
  ok(
    await send('post', '/fleet/fixed-roster', {
      rows: [{ vehicleId: v2.id, driver1EmployeeId: dE, driver2EmployeeId: null }],
    }),
  );
  ok(
    await send('post', '/fleet/availability', {
      employeeId: dE,
      from: TODAY,
      to: TODAY,
      reason: 'مأمورية',
    }),
    201,
  );
  ok(
    await send('post', '/fleet/roster', {
      date: TODAY,
      rows: [{ vehicleId: v3.id, driver1EmployeeId: dA, driver2EmployeeId: null }],
    }),
  );

  // The old book's rows: an accident on a car the registry never had, an undated one, an unlinked
  // driver's name on a fine.
  const legacy = { isDeleted: false, schemaVersion: 1, createdBy: null, updatedBy: null };
  const book = {
    culprit: 'دفتر',
    culpritEmployeeId: null,
    statement: 'من الدفتر',
    amountCollected: 0,
    paidAmount: 0,
    status: 'open',
    notes: null,
  };
  await FleetAccidentModel.create({
    ...legacy,
    ...book,
    vehicleId: null,
    vehicleCode: 'B-77',
    occurredAt: new Date('2026-10-20T00:00:00.000Z'),
    companyCost: 70,
  });
  await FleetAccidentModel.create({
    ...legacy,
    ...book,
    vehicleId: new Types.ObjectId(v2.id),
    vehicleCode: null,
    occurredAt: null,
    companyCost: 5,
  });
  await FleetViolationModel.create({
    ...legacy,
    kind: 'driver',
    vehicleId: new Types.ObjectId(v3.id),
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

  const del = await send('delete', `/fleet/vehicles/${v7.id}`);
  expect([200, 204]).toContain(del.status);

  now = ok<FleetDashboardNowDto>(await get('/fleet/dashboard/now'));
  oct = ok<FleetDashboardPeriodDto>(await get('/fleet/dashboard/period', OCT));
}, 300_000);

afterAll(async () => {
  vi.useRealTimers();
  await getCache().close();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

// ── R1 · tabs 1–5 ─────────────────────────────────────────────────────────────────────────────

describe('R1 — the Cairo day', () => {
  it('reads 2026-11-01 at 2026-10-31T23:30Z, every section present for the admin', () => {
    expect(now.today).toBe(TODAY);
    expect(now.unavailable).toEqual([]);
    for (const key of [
      'vehicles',
      'roster',
      'workshop',
      'licenceVehicles',
      'fuelCharging',
      'violationsYear',
    ] as const) {
      expect(now[key], key).not.toBeNull();
    }
    expect(now.vehicleScope).toBeNull();
  });
});

describe('R1 parity — tab 2 «الحركة الآن»', () => {
  it('T2.1/T2.2 = the vehicles list by status; the reason is printed as written', async () => {
    expect(now.vehicles?.active).toBe(await total('/fleet/vehicles', { status: 'active' }));
    expect(now.vehicles?.active).toBe(5);
    expect(now.vehicles?.outOfService).toBe(
      await total('/fleet/vehicles', { status: 'outOfService' }),
    );
    expect(now.vehicles?.outOfServiceList).toEqual([
      { vehicleId: v5.id, code: v5.code, reason: 'حادث جسيم' },
    ]);
  });

  it('T2.3/T2.5/T1.6 = the roster board of the same day, counted from its own row flags', async () => {
    const board = ok<FleetRosterDayDto>(await get('/fleet/roster', { date: TODAY }));
    const ready = board.rows.filter((row) => row.assignable === true);
    const r = now.roster;
    expect(r?.ready).toBe(ready.length);
    expect(r?.unmanned).toBe(ready.filter((row) => row.manned !== true).length);
    expect(r?.crewGap.vehicles).toBe(
      ready.filter((row) =>
        (row.crewGaps ?? []).some((g) => ['fleetUnavailability', 'hrLeave'].includes(g.reason)),
      ).length,
    );
    expect(r).toMatchObject({
      rows: 5,
      ready: 3,
      inWorkshop: 1,
      licenceExpired: 1,
      readyManned: 1,
      unmanned: 2,
      unmannedCrewGap: 1,
      unmannedStalePlan: 0,
      unmannedNoCrew: 1,
    });
    expect(r?.crewGap.vehicles).toBe(1);
    expect(r?.ready).toBe((r?.rows ?? 0) - (r?.inWorkshop ?? 0) - (r?.licenceExpired ?? 0));
  });

  it('T2.6/T2.7 = the board’s pools; registry = every seat-holder = /fleet/drivers', async () => {
    const board = ok<FleetRosterDayDto>(await get('/fleet/roster', { date: TODAY }));
    const r = now.roster;
    expect(r?.available).toBe(board.availableDrivers.filter((d) => d.licence !== 'expired').length);
    expect(r?.absent.attendance).toBe(
      board.unavailableDrivers.filter((d) => d.reason === 'fleetUnavailability').length,
    );
    expect(r).toMatchObject({
      available: 4,
      availableWithoutVehicle: 3,
      availableLicenceNotRecorded: 1,
      availableNoProfile: 1,
      licenceExpiredDrivers: 1,
    });
    expect(r?.absent).toEqual({ attendance: 1, leave: 0 });
    expect(r?.registry).toBe(await total('/fleet/drivers', {}));
    expect(r?.registry).toBe(
      (r?.available ?? 0) +
        (r?.absent.attendance ?? 0) +
        (r?.absent.leave ?? 0) +
        (r?.profileInactive ?? 0) +
        (r?.notEmployed ?? 0) +
        (r?.licenceExpiredDrivers ?? 0),
    );
    expect(r?.licenceRule).toBe('flag');
  });

  it('T2.4 = /fleet/maintenance?state=open, the oldest stay in Cairo days', async () => {
    expect(now.workshop?.open).toBe(await total('/fleet/maintenance', { open: true }));
    expect(now.workshop).toMatchObject({ open: 1, openActive: 1, openOutOfService: 0 });
    expect(now.workshop?.oldest).toMatchObject({
      vehicleId: v4.id,
      code: v4.code,
      inDate: '2026-10-25',
      days: 7,
    });
  });
});

describe('R1 parity — tab 1 «التنبيهات»', () => {
  it('T1.1 = the alarms board’s red rows (and of them the overdue)', async () => {
    const rows = ok<FleetMaintenanceAlarmDto[]>(await get('/fleet/odometer/alarms'));
    const red = rows.filter((row) => row.level === 'red');
    expect(now.maintenanceAlarm?.red).toBe(red.length);
    expect(now.maintenanceAlarm?.overdue).toBe(
      red.filter((row) => (row.remainingKm ?? 0) < 0).length,
    );
    expect(now.maintenanceAlarm?.yellow).toBe(rows.filter((row) => row.level === 'yellow').length);
    expect(now.maintenanceAlarm?.codes).toBeNull();
  });

  it('T1.12: last chain reading Oct 28 fires, Oct 29 does not; the workshop car never; the never-read apart', async () => {
    expect(now.noReading?.days).toBe(3);
    expect(now.noReading?.stale).toEqual([
      { vehicleId: v2.id, code: v2.code, lastDate: '2026-10-28' },
    ]);
    expect(now.noReading?.neverRead).toEqual([{ vehicleId: v6.id, code: v6.code }]);
    // The link: the odometer screen of those cars shows no chain row since today − N.
    expect(await total('/fleet/odometer', { vehicleCodes: v2.code, from: '2026-10-29' })).toBe(0);
    expect(await total('/fleet/odometer', { vehicleCodes: v3.code, from: '2026-10-29' })).toBe(1);
  });

  it('T1.4/T4.7 = the fuel cards summary with the day bounds the page sends', async () => {
    const expired = ok<{ cardCount: number }>(
      await get('/fleet/fuel-cards/summary', { expiresBefore: last(TODAY) }),
    );
    const expiring = ok<{ cardCount: number }>(
      await get('/fleet/fuel-cards/summary', {
        expiresFrom: first('2026-11-02'),
        expiresBefore: last('2026-12-01'),
      }),
    );
    expect(now.fuelCards).toEqual({
      warnDays: 30,
      expired: expired.cardCount,
      expiring: expiring.cardCount,
    });
    expect(now.fuelCards).toMatchObject({ expired: 1, expiring: 1 });
  });

  it('T1.7/T1.8/T5.1–T5.5 = the charging screen’s summary', async () => {
    const all = ok<Record<string, number>>(await get('/fleet/fuel-cards/summary'));
    const low = ok<{ cardCount: number }>(
      await get('/fleet/fuel-cards/summary', { balanceBelow: 300 }),
    );
    const red = ok<{ cardCount: number }>(
      await get('/fleet/fuel-cards/summary', { balanceBelow: 100 }),
    );
    expect(now.fuelCharging).toEqual({
      wataniya: all['wataniyaBalance'],
      chillout: all['chilloutBalance'],
      requested: { count: all['requestedCount'], amount: all['requestedAmount'] },
      low: { belowYellow: low.cardCount, belowRed: red.cardCount, yellowAt: 300, redAt: 100 },
      charged24h: all['chargedTodayAmount'],
    });
    expect(now.fuelCharging?.requested).toEqual({ count: 1, amount: 200 });
    expect(now.fuelCharging?.charged24h).toBe(500);
  });

  it('T1.9 = /fleet/dealership?state=pending (pending=true)', async () => {
    expect(now.dealershipPending?.rows).toBe(await total('/fleet/dealership', { pending: true }));
    expect(now.dealershipPending?.rows).toBeGreaterThan(0);
  });

  it('T1.10 = the open notices missing ANY attachment, each once; the parts = the summary', async () => {
    const summary = ok<{ open: number; missingLicences: number; missingCheckImage: number }>(
      await get('/fleet/notices/summary', { status: 'open' }),
    );
    const listed = ok<FleetNoticeDto[]>(
      await get('/fleet/notices', { status: 'open', pageSize: 100 }),
    );
    expect(now.notices).toEqual({
      open: summary.open,
      missingAny: listed.filter(
        (n) => n.vehicleLicense === null || n.driverLicense === null || n.checkImage === null,
      ).length,
      missingLicences: summary.missingLicences,
      missingCheckImage: summary.missingCheckImage,
    });
    expect(now.notices?.missingAny).toBe(1);
  });

  it('derives its lines from those very figures, red first', () => {
    const line = (id: string) => now.alerts.find((a) => a.id === id)?.count;
    expect(line('vehicleLicenceExpired')).toBe(now.licenceVehicles?.expired);
    expect(line('driverLicenceExpired')).toBe(now.licenceDrivers?.expired);
    expect(line('fuelCardExpired')).toBe(1);
    expect(line('crewAbsent')).toBe(1);
    expect(line('noReading')).toBe(1);
    expect(line('noticesMissing')).toBe(1);
    const levels = now.alerts.map((a) => a.level);
    expect(levels.indexOf('orange')).toBeGreaterThan(levels.lastIndexOf('red'));
  });
});

describe('R1 parity — tab 4 «التراخيص وآخر ما سُجّل»', () => {
  it('T1.2/T4.1–T4.3 = the vehicles list with first/last-instant bounds — the 10:00Z stamp is expired today', async () => {
    const lic = now.licenceVehicles;
    expect(lic?.expired).toBe(
      await total('/fleet/vehicles', { status: 'active', licenseExpiresBefore: last(TODAY) }),
    );
    expect(lic?.expiring).toBe(
      await total('/fleet/vehicles', {
        status: 'active',
        licenseExpiresFrom: first('2026-11-02'),
        licenseExpiresBefore: last('2026-12-01'),
      }),
    );
    expect(lic?.soon).toBe(
      await total('/fleet/vehicles', {
        status: 'active',
        licenseExpiresFrom: first('2026-12-02'),
        licenseExpiresBefore: last('2026-12-31'),
      }),
    );
    expect(lic?.outOfServiceExpired).toBe(
      await total('/fleet/vehicles', { status: 'outOfService', licenseExpiresBefore: last(TODAY) }),
    );
    expect(lic).toMatchObject({
      warnDays: 30,
      expired: 1,
      expiring: 1,
      soon: 1,
      outOfServiceExpired: 1,
    });
    // Disjoint, and together every dated active car up to today + 60.
    expect((lic?.expired ?? 0) + (lic?.expiring ?? 0) + (lic?.soon ?? 0)).toBe(
      await total('/fleet/vehicles', {
        status: 'active',
        licenseExpiresBefore: last('2026-12-31'),
      }),
    );
    expect(lic?.list.map((row) => [row.code, row.days])).toEqual([
      [v1.code, 0],
      [v2.code, 19],
      [v3.code, 44],
    ]);
    expect(lic?.more).toBe(0);
  });

  it('T1.3/T4.5 = /fleet/drivers with the same bounds; «بلا تاريخ» = licenseNotRecorded', async () => {
    const lic = now.licenceDrivers;
    expect(lic?.expired).toBe(await total('/fleet/drivers', { licenseExpiresBefore: last(TODAY) }));
    expect(lic?.expiring).toBe(
      await total('/fleet/drivers', {
        licenseExpiresFrom: first('2026-11-02'),
        licenseExpiresBefore: last('2026-12-01'),
      }),
    );
    expect(lic?.notRecorded).toBe(await total('/fleet/drivers', { licenseNotRecorded: true }));
    expect(lic).toMatchObject({
      expired: 1,
      expiring: 1,
      soon: 0,
      notRecorded: 1,
      unregistered: 1,
    });
  });

  it('T4.8/T4.9: each recent row opens its own list (code + its day)', async () => {
    expect(now.recentWorkshop?.length).toBeGreaterThan(0);
    for (const row of now.recentWorkshop ?? []) {
      expect(row.date >= '2026-10-03').toBe(true);
      const query = row.open
        ? { vehicleCodes: row.code, from: row.date, to: row.date }
        : { vehicleCodes: row.code, outFrom: row.date, outTo: row.date };
      expect(await total('/fleet/maintenance', query), row.code).toBeGreaterThan(0);
    }
    expect((now.recentWorkshop ?? []).map((row) => row.code)).not.toContain(v7.code);
    const accidents = now.recentAccidents ?? [];
    expect(accidents.map((row) => [row.code, row.date])).toContainEqual([v1.code, '2026-10-30']);
    for (const row of accidents) {
      expect(
        await total('/fleet/accidents', { vehicleCodes: row.code, from: row.date, to: row.date }),
        row.code,
      ).toBeGreaterThan(0);
    }
  });
});

describe('R1 parity — tabs 3 and 5', () => {
  it('T3.1–T3.3 = the vehicles list per cell; T3.5/T3.7 = by the cash / ATM operations', async () => {
    const dist = now.distributionVehicles;
    expect(dist?.totals.total).toBe(now.vehicles?.active);
    for (const row of dist?.rows ?? []) {
      for (const [branchId, count] of Object.entries(row.counts)) {
        expect(count).toBe(
          await total('/fleet/vehicles', { status: 'active', typeId: row.typeId, branchId }),
        );
      }
      expect(Object.values(row.counts).reduce((a, b) => a + b, 0) + row.noBranch).toBe(row.total);
    }
    expect(dist?.cash).toEqual({
      vehicles: await total('/fleet/vehicles', {
        status: 'active',
        operationId: csv(dist?.cash.operationIds ?? []),
      }),
      operationIds: [O_CASH],
    });
    expect(dist?.atm.vehicles).toBe(
      await total('/fleet/vehicles', {
        status: 'active',
        operationId: csv(dist?.atm.operationIds ?? []),
      }),
    );
    expect(dist?.branches.map((b) => b.id)).toEqual(expect.arrayContaining([B1, B2]));
  });

  it('T3.4/T3.6/T3.8 = /fleet/drivers, by `spec`', async () => {
    const drv = now.distributionDrivers;
    expect(drv?.total).toBe(await total('/fleet/drivers', {}));
    expect((drv?.cash.drivers ?? 0) - (drv?.cash.legacy ?? 0)).toBe(
      await total('/fleet/drivers', { specializationId: csv(drv?.cash.specializationIds ?? []) }),
    );
    expect(drv).toMatchObject({
      total: 6,
      cash: { drivers: 1, legacy: 0 },
      atm: { drivers: 1, legacy: 0 },
    });
  });

  it('T5.10 = /fleet/accidents/summary?status=open', async () => {
    const s = ok<{ count: number; remaining: number }>(
      await get('/fleet/accidents/summary', { status: 'open' }),
    );
    expect(now.accidentsOpen).toEqual({ count: s.count, remaining: s.remaining });
  });

  it('T5.11/T5.12 = the Cairo year’s rollup, the drivers split exactly; «مجهول» = the unknown list', async () => {
    const rollup = ok<FleetViolationRollupDto[]>(
      await get('/fleet/violations/rollup', { year: 2026 }),
    );
    const sum = (pick: (row: FleetViolationRollupDto) => number) =>
      Math.round(rollup.reduce((acc, row) => acc + pick(row), 0) * 100) / 100;
    const v = now.violationsYear;
    expect(v?.year).toBe(2026);
    expect(v?.company).toBe(sum((row) => row.outstandingVehicleAmount));
    expect(v?.drivers.total).toBe(sum((row) => row.outstandingDriverAmount));
    expect(v?.drivers.total).toBe(
      Math.round(
        ((v?.drivers.attributed ?? 0) +
          (v?.drivers.unknown.amount ?? 0) +
          (v?.drivers.unlinked.amount ?? 0)) *
          100,
      ) / 100,
    );
    expect(v?.drivers.unknown.count).toBe(
      await total('/fleet/violations', {
        year: 2026,
        kind: 'driver',
        unknownDriver: true,
        collected: false,
      }),
    );
    expect(v?.drivers).toMatchObject({
      attributed: 30,
      unknown: { amount: 10, count: 1 },
      unlinked: { amount: 77, count: 1 },
    });
  });

  it('T4.6 = the licensing papers counted read-only (none open on this fixture)', () => {
    expect(now.papers).toEqual({ insurance: 0, tax: 0 });
  });
});

describe('R1 parity — with the switcher on a branch (X-Active-Branch)', () => {
  let b2: FleetDashboardNowDto;
  beforeAll(async () => {
    b2 = ok<FleetDashboardNowDto>(await get('/fleet/dashboard/now', {}, B2));
  });

  it('the screen sections follow the reader’s narrowed scope, the company ones the branch set', async () => {
    expect(b2.branchId).toBe(B2);
    expect(b2.vehicles?.active).toBe(await total('/fleet/vehicles', { status: 'active' }, B2));
    expect(b2.vehicles?.active).toBe(2);
    expect(b2.workshop?.open).toBe(
      await total('/fleet/maintenance', { open: true, branchIds: B2 }),
    );
    expect(b2.dealershipPending?.rows).toBe(
      await total('/fleet/dealership', { pending: true, branchIds: B2 }),
    );
    const open = ok<{ count: number; remaining: number }>(
      await get('/fleet/accidents/summary', { status: 'open', branchIds: B2 }),
    );
    expect(b2.accidentsOpen).toEqual({ count: open.count, remaining: open.remaining });
    expect(b2.licenceDrivers?.expired).toBe(
      await total('/fleet/drivers', { licenseExpiresBefore: last(TODAY), branchId: B2 }),
    );
    expect(b2.distributionDrivers?.total).toBe(await total('/fleet/drivers', { branchId: B2 }));
  });

  it('the alarm and no-reading lines narrow to the branch’s cars, the link carrying their codes', async () => {
    // Each level's link carries that level's codes of the branch, as the alarms board lists them.
    const board = ok<FleetMaintenanceAlarmDto[]>(await get('/fleet/odometer/alarms'));
    const inBranch = new Set([v2.code, v6.code]);
    const codesOf = (level: 'red' | 'yellow'): string[] =>
      board
        .filter((row) => row.level === level && inBranch.has(row.code))
        .map((row) => row.code)
        .sort((a, b) => a.localeCompare(b));
    expect(b2.maintenanceAlarm?.codes).toEqual({ red: codesOf('red'), yellow: codesOf('yellow') });
    expect(b2.maintenanceAlarm?.red).toBe(codesOf('red').length);
    expect(b2.maintenanceAlarm?.yellow).toBe(codesOf('yellow').length);
    expect(b2.noReading?.stale.map((row) => row.code)).toEqual([v2.code]);
    expect(b2.noReading?.neverRead.map((row) => row.code)).toEqual([v6.code]);
    expect(b2.vehicleScope).toMatchObject({
      branchId: B2,
      typeIds: [],
      operationIds: [],
      vehicleCodes: [],
    });
    // The driver pool stays company-wide, as /fleet/roster shows it (R-27).
    expect(b2.roster?.registry).toBe(now.roster?.registry);
  });
});

// ── R2 · tabs 6–10 ────────────────────────────────────────────────────────────────────────────

/** The period screens' own query for the dashboard's range and filters. */
const screen = (extra: Record<string, unknown> = {}) => ({ from: OCT.from, to: OCT.to, ...extra });

const periodParity = async (
  dto: FleetDashboardPeriodDto,
  set: Record<string, unknown>,
  branch?: string,
) => {
  const q = screen(set);
  const km = ok<{ km: number; invalidRows: number }>(
    await get('/fleet/odometer/summary', q, branch),
  );
  expect(dto.km?.total).toBe(km.km);
  expect(dto.km?.invalidRows).toBe(km.invalidRows);
  expect(dto.visits?.count).toBe(await total('/fleet/maintenance', q, branch));
  expect(dto.visits?.closed).toBe(await total('/fleet/maintenance', { ...q, open: false }, branch));
  expect(dto.visits?.open).toBe(await total('/fleet/maintenance', { ...q, open: true }, branch));
  for (const bar of dto.visits?.byWorkType ?? []) {
    expect(bar.count).toBe(
      await total('/fleet/maintenance', { ...q, workTypeIds: bar.id }, branch),
    );
  }
  for (const car of dto.visits?.topVehicles ?? []) {
    expect(car.visits).toBe(
      await total('/fleet/maintenance', { ...q, vehicleCodes: car.code }, branch),
    );
  }
  const acc = ok<{ count: number }>(await get('/fleet/accidents/summary', q, branch));
  const accOpen = ok<{ count: number; remaining: number }>(
    await get('/fleet/accidents/summary', { ...q, status: 'open' }, branch),
  );
  expect(dto.accidents).toMatchObject({
    count: acc.count,
    open: accOpen.count,
    openRemaining: accOpen.remaining,
  });
  expect(dto.accidentList?.more).toBe(acc.count - (dto.accidentList?.rows.length ?? 0));
  const rec = ok<{ cardTotal: number; custodyTotal: number; count: number }>(
    await get('/fleet/receipts/summary', q, branch),
  );
  expect(dto.opex).toMatchObject({
    card: rec.cardTotal,
    custody: rec.custodyTotal,
    count: rec.count,
  });
  const deal = ok<{ count: number; pending: number; dealershipTotal: number }>(
    await get('/fleet/dealership/summary', q, branch),
  );
  expect(dto.dealership).toMatchObject({
    amount: deal.dealershipTotal,
    rows: deal.count,
    pending: deal.pending,
    dataFrom: '2026-09-01',
  });
};

const kmInvariants = (dto: FleetDashboardPeriodDto) => {
  const km = dto.km;
  const buckets = (km?.buckets ?? []).reduce((a, b) => a + b.confirmedKm + b.spanKm, 0);
  expect(buckets).toBe(km?.total);
  expect((km?.byBranch ?? []).reduce((a, b) => a + b.km, 0) + (km?.unregistered ?? 0)).toBe(
    km?.total,
  );
  const visits = dto.visits;
  expect((visits?.byWorkType ?? []).reduce((a, b) => a + b.count, 0)).toBe(visits?.count);
  expect((visits?.byWorkshop ?? []).reduce((a, b) => a + b.count, 0)).toBe(visits?.count);
  expect((visits?.closed ?? 0) + (visits?.open ?? 0)).toBe(visits?.count);
};

describe('R2 parity — the company view of October', () => {
  it('echoes the range by the day and no set', () => {
    expect(oct.range).toEqual({
      preset: 'custom',
      from: OCT.from,
      to: OCT.to,
      days: 31,
      granularity: 'day',
    });
    expect(oct.vehicleScope).toEqual({
      count: null,
      typeIds: [],
      operationIds: [],
      vehicleCodes: [],
      branchId: null,
    });
    expect(oct.unavailable).toEqual([]);
  });

  it('every figure = its screen over the same from/to; the deleted car’s history counts', async () => {
    await periodParity(oct, {});
    expect(oct.visits?.count).toBe(3);
    expect(oct.accidents).toEqual({
      count: 3,
      open: 3,
      openRemaining: oct.accidents?.openRemaining,
      undated: 1,
    });
    expect(oct.opex?.custody).toBe(85);
    expect(oct.opex?.total).toBe((oct.opex?.card ?? 0) + (oct.opex?.custody ?? 0));
  });

  it('holds the invariants: km = Σ buckets = Σ branches + unregistered; Σ bars = visits', () => {
    kmInvariants(oct);
    expect(oct.km?.buckets.length).toBe(31);
  });

  it('this month on Cairo’s 2026-11-01 is the single day, nothing yet', async () => {
    const thisMonth = ok<FleetDashboardPeriodDto>(await get('/fleet/dashboard/period'));
    expect(thisMonth.range).toEqual({
      preset: 'thisMonth',
      from: TODAY,
      to: TODAY,
      days: 1,
      granularity: 'day',
    });
    expect(thisMonth.visits?.count).toBe(0);
  });
});

describe('R2 parity — the vehicle set travels as filters', () => {
  it('type T1 (the deleted car is a T1): every screen with typeIds reproduces the figure', async () => {
    const t1 = ok<FleetDashboardPeriodDto>(
      await get('/fleet/dashboard/period', { ...OCT, typeIds: T1 }),
    );
    // The chip «المجموعة المختارة: N سيارة» counts the registry's cars, as /fleet/vehicles does —
    // the deleted T1 car is in the SET (its history counts) but not in that count.
    expect(t1.vehicleScope).toMatchObject({ typeIds: [T1], count: 4 });
    expect(t1.vehicleScope.count).toBe(await total('/fleet/vehicles', { typeId: T1 }));
    await periodParity(t1, { typeIds: T1 });
    kmInvariants(t1);
    // A set exists: the legacy rows without a car are out, and the undated note is the company view's.
    expect(t1.accidents?.undated).toBeNull();
    expect(t1.km?.unregistered).toBeNull();
  });

  it('the switcher branch B2 rides as branchIds on every screen', async () => {
    const b2 = ok<FleetDashboardPeriodDto>(await get('/fleet/dashboard/period', OCT, B2));
    expect(b2.vehicleScope.branchId).toBe(B2);
    await periodParity(b2, { branchIds: B2 }, B2);
    kmInvariants(b2);
  });

  it('operation + codes: the intersection, as each screen resolves it', async () => {
    const q = { ...OCT, operationIds: O_CASH, vehicleCodes: `${v1.code},${v2.code}` };
    const dto = ok<FleetDashboardPeriodDto>(await get('/fleet/dashboard/period', q));
    expect(dto.vehicleScope.count).toBe(1);
    await periodParity(dto, { operationIds: O_CASH, vehicleCodes: `${v1.code},${v2.code}` });
  });
});
