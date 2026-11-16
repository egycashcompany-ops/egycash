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
// Σ buckets (confirmed + span) = Σ byBranch + unregistered; Σ byWorkType = Σ byWorkshop = exits.count;
// drivers' violations = attributed + unknown + unlinked; the licence buckets are disjoint; the
// «الحركة اليوم» rows are the board's own ready-and-unmanned rows; and a reader reaching two branches
// («كل فروعي») reads every figure its links reproduce with `branchIds=a,b`.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Express } from 'express';
import {
  FLEET_DASHBOARD_ALARM_ROWS,
  FLEET_DASHBOARD_NOW_KEYS,
  FLEET_DASHBOARD_PERIOD_KEYS,
  FLEET_DASHBOARD_WORKSHOP_ROWS,
  SettingKeys,
  calendarDayBounds,
  compareFleetVehicleCodes,
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
import { FleetMaintenanceVisitModel } from '../../src/modules/fleet/maintenance/maintenance.model';
import { FleetOdometerLogModel } from '../../src/modules/fleet/odometer/odometer.model';
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
/**
 * «إنذارات الصيانة بالكيلومتر» as the alarms board would list it: its red and yellow rows with a
 * figure, in the board's triage order (level, then the km left, then the code), the first eight.
 */
const alarmRowsOf = (board: readonly FleetMaintenanceAlarmDto[]) =>
  board
    .filter(
      (row) =>
        (row.level === 'red' || row.level === 'yellow') &&
        row.remainingKm !== null &&
        row.sinceServiceKm !== null,
    )
    .sort(
      (a, b) =>
        (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1) ||
        (a.remainingKm ?? 0) - (b.remainingKm ?? 0) ||
        compareFleetVehicleCodes(a.code, b.code),
    )
    .slice(0, FLEET_DASHBOARD_ALARM_ROWS)
    .map((row) => ({
      vehicleId: row.vehicleId,
      code: row.code,
      typeName: row.rule.vehicleType?.name ?? null,
      level: row.level,
      remainingKm: row.remainingKm,
      sinceServiceKm: row.sinceServiceKm,
      intervalKm: row.rule.intervalKm,
      lastServiceAt: row.lastServiceAt === null ? null : row.lastServiceAt.slice(0, 10),
      inWorkshop:
        row.newerUncountedVisit?.why === 'open'
          ? { workshop: row.newerUncountedVisit.workshop?.name ?? null }
          : null,
    }));

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
let adminId: string;

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
  adminId = String(user._id);
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
  // «مصروف الوقود»: a fuel receipt paid from the custody fund.
  ok(
    await send('post', '/fleet/receipts', {
      date: '2026-10-16',
      vehicleId: v3.id,
      kind: 'fuel',
      fuelType: 'diesel',
      amount: 120,
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
  // Last year's statement, still owed: «مخالفات قائمة» counts it, «ملخصات» (this year) does not.
  // Two violations on ONE statement row: its count is 2, not 1.
  ok(
    await send('post', '/fleet/violations/vehicle', {
      vehicleId: v2.id,
      year: 2025,
      violationTypeId: vehicleSide,
      count: 2,
      unitValue: 150,
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

  // «قراءات تحتاج مراجعة»: a closed row whose km is negative (as a data fix can leave one) — below
  // v3's open reading, so its chain and its latest reading stay what they were.
  await FleetOdometerLogModel.create({
    ...legacy,
    vehicleId: new Types.ObjectId(v3.id),
    vehicleCode: null,
    date: new Date('2026-10-15T00:00:00.000Z'),
    outReading: 90,
    inReading: 60,
    km: -30,
    driver1EmployeeId: null,
    driver2EmployeeId: null,
    driver1Name: null,
    driver2Name: null,
    notes: null,
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

describe('R1 parity — «الحركة اليوم» (the old «الحركة الآن» figures and the two lists)', () => {
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
    // «بلا سيارة» is the linked figure (the headline counts the seated too): the roster's available
    // panel = the licensed drivers the day's board seats on no car.
    const seated = new Set(
      board.rows.flatMap((row) => [row.driver1EmployeeId, row.driver2EmployeeId]),
    );
    expect(r?.availableWithoutVehicle).toBe(
      board.availableDrivers.filter((d) => d.licence !== 'expired' && !seated.has(d.employeeId))
        .length,
    );
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

  it('«سيارات بلا سائق اليوم» = the board’s ready, unmanned rows — class by class, each with its car’s branch', async () => {
    const board = ok<FleetRosterDayDto>(await get('/fleet/roster', { date: TODAY }));
    const unmanned = board.rows.filter((row) => row.assignable === true && row.manned !== true);
    const r = now.roster;
    expect(r?.unmannedRows.map((row) => row.code).sort()).toEqual(
      unmanned
        .map((row) => row.code)
        .slice(0, 8)
        .sort(),
    );
    // Crew gap first (v2: its standing driver on «تمام»), then «بلا طاقم ثابت ولا تخطيط» (v6).
    expect(r?.unmannedRows.map((row) => [row.code, row.why])).toEqual([
      [v2.code, 'crewGap'],
      [v6.code, 'noCrew'],
    ]);
    expect(r?.unmannedRows[0]?.absent).toEqual({ employeeId: dE, reason: 'fleetUnavailability' });
    expect(r?.unmannedRows[1]?.absent).toBeNull();
    for (const row of r?.unmannedRows ?? []) {
      const car = ok<FleetVehicleDto>(await get(`/fleet/vehicles/${row.vehicleId}`));
      expect(row.branch?.id ?? null, row.code).toBe(car.branchId);
      expect(row.typeName?.ar).toBe('مصفحة');
    }
    expect(r?.unmannedRows[0]?.branch?.name).toEqual({ ar: 'فرع أسيوط', en: 'فرع أسيوط' });
    // The tiles and the residue add up to unmanned.
    expect(
      (r?.unmannedCrewGap ?? 0) +
        (r?.unmannedStalePlan ?? 0) +
        (r?.unmannedNoCrew ?? 0) +
        (r?.unmannedUnassigned ?? 0),
    ).toBe(r?.unmanned);
    // Each row's «فتح» opens the roster of the day with `q` = its code — a filter the roster page
    // applies to this very board, where the row is present and unmanned.
    for (const row of r?.unmannedRows ?? []) {
      expect(
        unmanned.some((x) => x.vehicleId === row.vehicleId && x.code === row.code),
        row.code,
      ).toBe(true);
    }
  });

  it('«الغائبون اليوم» = the board’s unavailable drivers on «تمام» or leave, with their standing car', async () => {
    const board = ok<FleetRosterDayDto>(await get('/fleet/roster', { date: TODAY }));
    const absent = board.unavailableDrivers.filter((d) =>
      ['fleetUnavailability', 'hrLeave'].includes(d.reason),
    );
    const r = now.roster;
    expect(r?.absentDrivers.map((d) => d.employeeId).sort()).toEqual(
      absent
        .map((d) => d.employeeId)
        .slice(0, 8)
        .sort(),
    );
    expect(r?.absentDrivers).toEqual([
      {
        employeeId: dE,
        reason: 'fleetUnavailability',
        crewVehicle: { vehicleId: v2.id, code: v2.code },
      },
    ]);
    // «عرض الكل (N)» — N is the server's count of the two reasons.
    expect((r?.absent.attendance ?? 0) + (r?.absent.leave ?? 0)).toBe(absent.length);
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

  it('«أطول بقاء في الورشة الآن» = /fleet/maintenance?state=open by check-in day, the first five', async () => {
    const open = ok<FleetMaintenanceVisitDto[]>(
      await get('/fleet/maintenance', { open: true, pageSize: 100 }),
    );
    const byStay = [...open].sort(
      (a, b) => a.inDate.localeCompare(b.inDate) || a.id.localeCompare(b.id),
    );
    expect(now.workshop?.longest.map((row) => row.visitId)).toEqual(
      byStay.slice(0, FLEET_DASHBOARD_WORKSHOP_ROWS).map((row) => row.id),
    );
    expect(now.workshop?.longest.map((row) => row.code)).toEqual(
      byStay.slice(0, FLEET_DASHBOARD_WORKSHOP_ROWS).map((row) => row.vehicleCode),
    );
    expect(now.workshop?.longest[0]).toEqual({
      visitId: byStay[0]?.id,
      vehicleId: v4.id,
      code: v4.code,
      deleted: false,
      typeName: expect.objectContaining({ ar: 'ميكروباص' }) as unknown,
      inDate: '2026-10-25',
      days: 7,
      workshop: expect.objectContaining({ ar: 'ورشة اللوحة' }) as unknown,
      workType: expect.objectContaining({ ar: 'صيانة' }) as unknown,
    });
    // `oldest` is the first of them; never more rows than `open` counts.
    expect(now.workshop?.oldest).toMatchObject({
      code: now.workshop?.longest[0]?.code,
      days: now.workshop?.longest[0]?.days,
    });
    expect(now.workshop?.longest.length).toBeLessThanOrEqual(now.workshop?.open ?? 0);
  });
});

describe('R1 parity — the overview’s action centre (the old «التنبيهات» lines)', () => {
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

  it('«إنذارات الصيانة بالكيلومتر» = the board’s red/yellow rows in its triage order, the first eight', async () => {
    const board = ok<FleetMaintenanceAlarmDto[]>(await get('/fleet/odometer/alarms'));
    expect(now.maintenanceAlarm?.rows).toEqual(alarmRowsOf(board));
    // The two thresholds = the settings the board's rows were judged by (present with no alarm).
    expect(board.length).toBeGreaterThan(0);
    for (const row of board) {
      expect(row.rule.redKm).toBe(now.maintenanceAlarm?.redKm);
      expect(row.rule.yellowKm).toBe(now.maintenanceAlarm?.yellowKm);
    }
  });

  it('T1.12: last chain reading Oct 28 fires, Oct 29 does not; the workshop car never; the never-read apart', async () => {
    expect(now.noReading?.days).toBe(3);
    expect(now.noReading?.stale).toEqual([
      { vehicleId: v2.id, code: v2.code, lastDate: '2026-10-28' },
    ]);
    expect(now.noReading?.neverRead).toEqual([{ vehicleId: v6.id, code: v6.code }]);
    // The counts are fields; the listed rows carry the make and the days since the last reading.
    expect(now.noReading?.staleCount).toBe(now.noReading?.stale.length);
    expect(now.noReading?.neverReadCount).toBe(1);
    expect(now.noReading?.staleRows).toEqual([
      {
        vehicleId: v2.id,
        code: v2.code,
        typeName: expect.objectContaining({ ar: 'مصفحة' }) as unknown,
        lastDate: '2026-10-28',
        days: 4,
      },
    ]);
    expect(now.noReading?.neverReadRows).toEqual([
      {
        vehicleId: v6.id,
        code: v6.code,
        typeName: expect.objectContaining({ ar: 'مصفحة' }) as unknown,
      },
    ]);
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
      cards: all['cardCount'],
    });
    expect(now.fuelCharging?.requested).toEqual({ count: 1, amount: 200 });
    expect(now.fuelCharging?.charged24h).toBe(500);
    // «موزعة على N كارتًا» = the cards screen's own count.
    expect(now.fuelCharging?.cards).toBe(await total('/fleet/fuel-cards', {}));
    expect(now.fuelCharging?.cards).toBe(3);
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
    const missing = listed.filter(
      (n) => n.vehicleLicense === null || n.driverLicense === null || n.checkImage === null,
    );
    expect(now.notices).toEqual({
      open: summary.open,
      missingAny: missing.length,
      missingLicences: summary.missingLicences,
      missingCheckImage: summary.missingCheckImage,
      rows: expect.any(Array) as unknown,
    });
    expect(now.notices?.missingAny).toBe(1);
    // «إخطارات ينقصها مرفق»: each row is one of the screen's open notices missing something, as
    // the screen shows it, and the row's link (its car, number and day) lists it.
    expect(now.notices?.rows).toHaveLength(Math.min(missing.length, 6));
    for (const row of now.notices?.rows ?? []) {
      const twin = missing.find((n) => n.id === row.noticeId);
      expect(twin, row.noticeId).toBeDefined();
      expect(row).toMatchObject({
        template: twin?.template,
        vehicleId: twin?.vehicleId,
        code: twin?.vehicleCode,
        noticeNumber: twin?.noticeNumber,
        noticeDate: twin?.noticeDate == null ? null : twin.noticeDate.slice(0, 10),
        missing: {
          vehicleLicense: twin?.vehicleLicense === null,
          driverLicense: twin?.driverLicense === null,
          checkImage: twin?.checkImage === null,
        },
      });
      const link = ok<FleetNoticeDto[]>(
        await get('/fleet/notices', {
          status: 'open',
          ...(row.code === null ? {} : { vehicleCodes: row.code }),
          ...(row.noticeNumber === null ? {} : { noticeNumber: row.noticeNumber }),
          ...(row.noticeDate === null ? {} : { from: row.noticeDate, to: row.noticeDate }),
        }),
      );
      expect(link.map((n) => n.id)).toContain(row.noticeId);
    }
    expect(now.notices?.rows[0]).toMatchObject({
      vehicleId: v1.id,
      code: v1.code,
      typeName: expect.objectContaining({ ar: 'مصفحة' }) as unknown,
      template: 'deltaInsurance',
    });
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
    // «N فرعًا» = the distinct branches of the active cars on /fleet/vehicles.
    const active = ok<FleetVehicleDto[]>(
      await get('/fleet/vehicles', { status: 'active', pageSize: 100 }),
    );
    expect(dist?.branchCount).toBe(
      new Set(active.flatMap((car) => (car.branchId === null ? [] : [car.branchId]))).size,
    );
    expect(dist?.branchCount).toBe(2);
  });

  it('«نقل الأموال · ATM · أخرى» per branch = the vehicles list by branch and operation; largest first', async () => {
    const dist = now.distributionVehicles;
    const cashIds = csv(dist?.cash.operationIds ?? []);
    const atmIds = csv(dist?.atm.operationIds ?? []);
    for (const branch of dist?.branches ?? []) {
      const kinds = dist?.kinds[branch.id];
      expect(kinds?.cash, branch.id).toBe(
        await total('/fleet/vehicles', {
          status: 'active',
          branchId: branch.id,
          operationId: cashIds,
        }),
      );
      expect(kinds?.atm, branch.id).toBe(
        await total('/fleet/vehicles', {
          status: 'active',
          branchId: branch.id,
          operationId: atmIds,
        }),
      );
      expect((kinds?.cash ?? 0) + (kinds?.atm ?? 0) + (kinds?.other ?? 0), branch.id).toBe(
        dist?.totals.counts[branch.id] ?? 0,
      );
    }
    // Σ over the columns and «بلا فرع» = the list's own cash / ATM counts.
    const sum = (kind: 'cash' | 'atm' | 'other') =>
      Object.values(dist?.kinds ?? {}).reduce((a, k) => a + k[kind], 0) +
      (dist?.noBranchKinds[kind] ?? 0);
    expect(sum('cash')).toBe(dist?.cash.vehicles);
    expect(sum('atm')).toBe(dist?.atm.vehicles);
    expect(sum('other')).toBe(dist?.other.vehicles);
    expect(sum('cash') + sum('atm') + sum('other')).toBe(dist?.totals.total);
    // The fixture: B1 = v1, v3 (cash) + v4 (none); B2 = v2 (ATM) + v6 (none); no «بلا فرع».
    expect(dist?.kinds[B1]).toEqual({ cash: 2, atm: 0, other: 1 });
    expect(dist?.kinds[B2]).toEqual({ cash: 0, atm: 1, other: 1 });
    expect(dist?.noBranchKinds).toEqual({ cash: 0, atm: 0, other: 0 });
    expect(dist?.other).toEqual({ vehicles: 2 });
    // One order for the cards and the matrix: active cars desc.
    const counts = (dist?.branches ?? []).map((b) => dist?.totals.counts[b.id] ?? 0);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(dist?.branches.slice(0, 2).map((b) => b.id)).toEqual([B1, B2]);
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

  it('«مخالفات قائمة» = the rollup with NO year — every year still owed, amounts AND counts', async () => {
    const rollup = ok<FleetViolationRollupDto[]>(await get('/fleet/violations/rollup'));
    const sum = (pick: (row: FleetViolationRollupDto) => number) =>
      Math.round(rollup.reduce((acc, row) => acc + pick(row), 0) * 100) / 100;
    const v = now.violationsOpen;
    expect(v?.company).toEqual({
      amount: sum((row) => row.outstandingVehicleAmount),
      count: sum((row) => row.outstandingVehicleCount),
    });
    expect(v?.drivers.total).toEqual({
      amount: sum((row) => row.outstandingDriverAmount),
      count: sum((row) => row.outstandingDriverCount),
    });
    expect(v?.total.count).toBe(sum((row) => row.outstandingTotalCount));
    expect(v?.total.amount).toBe(sum((row) => row.outstandingTotalAmount));
    // The drivers' half is the drivers' list of every year still owed, one fine a row.
    expect(v?.drivers.total.count).toBe(
      await total('/fleet/violations', { kind: 'driver', collected: false }),
    );
    // Last year's statement (2 × 150) is in it; this year's «ملخصات» figure is not.
    expect(v).toEqual({
      company: { amount: 500, count: 3 },
      drivers: { total: { amount: 117, count: 3 } },
      total: { amount: 617, count: 6 },
    });
    expect(now.violationsYear?.company).toBe(200);
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
    const rollup = ok<FleetViolationRollupDto[]>(
      await get('/fleet/violations/rollup', { branchIds: B2 }),
    );
    expect(b2.violationsOpen?.total.count).toBe(
      rollup.reduce((acc, row) => acc + row.outstandingTotalCount, 0),
    );
    expect(b2.scopeBranches).toEqual([{ id: B2, name: { ar: 'فرع أسيوط', en: 'فرع أسيوط' } }]);
    // The «الحركة اليوم» rows follow the roster's scope: the branch's own cars only.
    const board = ok<FleetRosterDayDto>(await get('/fleet/roster', { date: TODAY }, B2));
    expect(b2.roster?.unmannedRows.map((row) => row.code).sort()).toEqual(
      board.rows
        .filter((row) => row.assignable === true && row.manned !== true)
        .map((row) => row.code)
        .sort(),
    );
    expect(b2.roster?.unmannedRows.every((row) => row.branch?.id === B2)).toBe(true);
    // The absent drivers are the company's pool (R-27): unchanged by the switcher.
    expect(b2.roster?.absentDrivers).toEqual(now.roster?.absentDrivers);
  });

  it('the notices follow the car’s CURRENT branch: /fleet/notices/summary?status=open&branchIds=B2', async () => {
    const summary = ok<{ open: number; missingLicences: number; missingCheckImage: number }>(
      await get('/fleet/notices/summary', { status: 'open', branchIds: B2 }),
    );
    const listed = ok<FleetNoticeDto[]>(
      await get('/fleet/notices', { status: 'open', branchIds: B2, pageSize: 100 }),
    );
    expect(b2.notices).toEqual({
      open: summary.open,
      missingAny: listed.filter(
        (n) => n.vehicleLicense === null || n.driverLicense === null || n.checkImage === null,
      ).length,
      missingLicences: summary.missingLicences,
      missingCheckImage: summary.missingCheckImage,
      rows: [],
    });
    // The one notice is on v1 (B1): none on B2, and the company's line is not B2's.
    expect(b2.notices?.open).toBe(0);
    expect(now.notices?.open).toBe(1);
    expect(b2.alerts.map((a) => a.id)).not.toContain('noticesMissing');
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
    // The table lists the branch's own rows only, in the board's order.
    expect(b2.maintenanceAlarm?.rows).toEqual(
      alarmRowsOf(board.filter((row) => inBranch.has(row.code))),
    );
    // The branch's open visits, as /fleet/maintenance?state=open&branch lists them (none on B2).
    expect(b2.workshop?.longest.length).toBe(
      await total('/fleet/maintenance', { open: true, branchIds: B2 }),
    );
    expect(b2.noReading?.stale.map((row) => row.code)).toEqual([v2.code]);
    expect(b2.noReading?.neverRead.map((row) => row.code)).toEqual([v6.code]);
    expect(b2.noReading?.staleRows.map((row) => row.code)).toEqual([v2.code]);
    expect(b2.noReading?.neverReadRows.map((row) => row.code)).toEqual([v6.code]);
    expect([b2.noReading?.staleCount, b2.noReading?.neverReadCount]).toEqual([1, 1]);
    expect(b2.vehicleScope).toMatchObject({
      branchId: B2,
      typeIds: [],
      operationIds: [],
      vehicleCodes: [],
      scopeBranches: [{ id: B2, name: { ar: 'فرع أسيوط', en: 'فرع أسيوط' } }],
    });
    // The driver pool stays company-wide, as /fleet/roster shows it (R-27).
    expect(b2.roster?.registry).toBe(now.roster?.registry);
  });
});

// ── R2 · tabs 6–10 ────────────────────────────────────────────────────────────────────────────

/** The period screens' own query for the dashboard's range and filters. */
const screen = (extra: Record<string, unknown> = {}) => ({ from: OCT.from, to: OCT.to, ...extra });

/** Whole days check-in → check-out of a listed visit (the same day = 0). */
const stayDays = (row: FleetMaintenanceVisitDto): number =>
  Math.round(
    (Date.parse(`${(row.outDate ?? row.inDate).slice(0, 10)}T00:00:00Z`) -
      Date.parse(`${row.inDate.slice(0, 10)}T00:00:00Z`)) /
      86_400_000,
  );

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
  // «أرقام الفترة»: the visits that CHECKED IN in the range (`from`/`to`), and their state now.
  expect(dto.visits?.count).toBe(await total('/fleet/maintenance', q, branch));
  expect(dto.visits?.closed).toBe(await total('/fleet/maintenance', { ...q, open: false }, branch));
  expect(dto.visits?.open).toBe(await total('/fleet/maintenance', { ...q, open: true }, branch));
  // «الصيانة والورش» and the overview's «زيارات الصيانة»: the same list over the EXIT day
  // (`outFrom`/`outTo`), never the check-in day — every figure, bar and car of it.
  const { from, to, ...rest } = q;
  const exitQ = { ...rest, outFrom: from, outTo: to };
  expect(dto.exits?.count).toBe(await total('/fleet/maintenance', exitQ, branch));
  for (const bar of dto.exits?.byWorkType ?? []) {
    expect(bar.count).toBe(
      await total('/fleet/maintenance', { ...exitQ, workTypeIds: bar.id }, branch),
    );
  }
  for (const bar of dto.exits?.byWorkshop ?? []) {
    expect(bar.count).toBe(
      await total('/fleet/maintenance', { ...exitQ, workshopIds: bar.id }, branch),
    );
  }
  const listed = ok<FleetMaintenanceVisitDto[]>(
    await get('/fleet/maintenance', { ...exitQ, pageSize: 100 }, branch),
  );
  expect(listed.length).toBe(dto.exits?.count);
  // «متوسط أيام البقاء» = the mean of the listed rows' whole-day stays, one decimal.
  expect(dto.exits?.avgStayDays).toBe(
    listed.length === 0
      ? null
      : Math.round((listed.reduce((a, row) => a + stayDays(row), 0) / listed.length) * 10) / 10,
  );
  for (const car of dto.exits?.topVehicles ?? []) {
    // A row's codes replace the set's: the list of that car's exits in the range.
    expect(car.visits).toBe(
      await total('/fleet/maintenance', { ...exitQ, vehicleCodes: car.code }, branch),
    );
    const own = listed.filter((row) => row.vehicleId === car.vehicleId);
    expect(car.lastInDate).toBe(
      own
        .map((row) => row.inDate.slice(0, 10))
        .sort()
        .at(-1),
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
  // «مبالغ ملفات حوادث الفترة» = the register's «الإحصائيات» over the same filter (open AND closed).
  const sums = ok<Record<string, number>>(await get('/fleet/accidents/summary', q, branch));
  expect(dto.accidents?.totals).toEqual({
    amountCollected: sums['amountCollected'],
    companyCost: sums['companyCost'],
    paidAmount: sums['paidAmount'],
    transferredIn: sums['transferredIn'],
    transferredOut: sums['transferredOut'],
    remaining: sums['remaining'],
  });
  // The rows' «بيان» and make are the register's own.
  const listedAcc = ok<{ id: string; statement: string }[]>(
    await get('/fleet/accidents', { ...q, pageSize: 100 }, branch),
  );
  for (const row of dto.accidentList?.rows ?? []) {
    expect(row.statement).toBe(listedAcc.find((a) => a.id === row.accidentId)?.statement);
  }
  // «سيارات بلا مسافة في الفترة»: Y − X, each a car of the set with no valid row in the range; the
  // never-read ones have no chain row at all.
  const dist = dto.km?.noDistance;
  const cov = dto.km?.coverage;
  expect(dist?.cars).toBe((cov?.of ?? 0) - (cov?.withReadings ?? 0));
  expect(cov?.of).toBe((cov?.active ?? 0) - (cov?.inWorkshop ?? 0) - (cov?.joinedAfter ?? 0));
  expect(dist?.codes).toHaveLength(dist?.cars ?? 0);
  for (const code of dist?.codes ?? []) {
    const own = ok<{ validRows: number }>(
      await get('/fleet/odometer/summary', { from: q.from, to: q.to, vehicleCodes: code }),
    );
    expect(own.validRows, code).toBe(0);
    expect(await total('/fleet/vehicles', { status: 'active', vehicleCodes: code })).toBe(1);
  }
  for (const code of dist?.neverReadCodes ?? []) {
    expect(dist?.codes).toContain(code);
    expect(await total('/fleet/odometer', { vehicleCodes: code }), code).toBe(0);
  }
  // «قراءات تحتاج مراجعة»: each listed row is the register's row of that car on that day.
  expect(dto.km?.invalidList).toHaveLength(Math.min(km.invalidRows, 3));
  for (const bad of dto.km?.invalidList ?? []) {
    const rows = ok<{ outReading: number | null; km: number | null }[]>(
      await get('/fleet/odometer', { vehicleCodes: bad.code, from: bad.date, to: bad.date }),
    );
    expect(rows.some((r) => r.outReading === bad.from && r.km === bad.km)).toBe(true);
    expect(bad.to).toBe(bad.from + bad.km);
  }
  expect(dto.accidentList?.more).toBe(acc.count - (dto.accidentList?.rows.length ?? 0));
  const rec = ok<{ cardTotal: number; custodyTotal: number; count: number }>(
    await get('/fleet/receipts/summary', q, branch),
  );
  expect(dto.opex).toMatchObject({
    card: rec.cardTotal,
    custody: rec.custodyTotal,
    count: rec.count,
  });
  // «مصروف الوقود» = the receipts screen filtered to fuel.
  const fuel = ok<{ fuelTotal: number }>(
    await get('/fleet/receipts/summary', { ...q, kind: 'fuel' }, branch),
  );
  expect(dto.opex?.fuel).toBe(fuel.fuelTotal);
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
  const exits = dto.exits;
  expect((exits?.byWorkType ?? []).reduce((a, b) => a + b.count, 0)).toBe(exits?.count);
  expect((exits?.byWorkshop ?? []).reduce((a, b) => a + b.count, 0)).toBe(exits?.count);
  const visits = dto.visits;
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
      scopeBranches: null,
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
      totals: oct.accidents?.totals,
    });
    // v1 (1000 − 300), the deleted v7 (400) and the book's B-77 (70): all open, so the period's
    // remaining equals the open files' here.
    expect(oct.accidents?.totals).toMatchObject({ companyCost: 1470, paidAmount: 300 });
    expect(oct.accidents?.totals.remaining).toBe(1170);
    expect(oct.accidentList?.rows.map((r) => r.statement)).toEqual([
      'اصطدام',
      'من الدفتر',
      'اصطدام',
    ]);
    expect(oct.accidentList?.rows.map((r) => r.typeName?.ar ?? null)).toEqual([
      'مصفحة',
      null,
      'مصفحة',
    ]);
    // The odometer: active v1–v4 and v6 (v5 is out of service, v7 deleted); v1 and v2 drove; v3
    // (an open row and a row to review), v4 (an open row) and v6 (never read) did not.
    expect(oct.km?.coverage).toEqual({
      withReadings: 2,
      of: 5,
      active: 5,
      inWorkshop: 0,
      joinedAfter: 0,
    });
    expect(oct.km?.noDistance).toEqual({
      cars: 3,
      neverRead: 1,
      codes: [v3.code, v4.code, v6.code],
      neverReadCodes: [v6.code],
    });
    expect(oct.km?.invalidRows).toBe(1);
    expect(oct.km?.invalidList).toEqual([
      {
        vehicleId: v3.id,
        code: v3.code,
        typeName: expect.objectContaining({ ar: 'ميكروباص' }) as unknown,
        date: '2026-10-15',
        from: 90,
        to: 60,
        km: -30,
      },
    ]);
    // The makes name the ranked cars in the company view too (no branch, no «حسب النوع»).
    expect(oct.km?.byType).toBeNull();
    expect(oct.km?.top5.map((r) => r.typeName?.ar)).toEqual(oct.km?.top5.map(() => 'مصفحة'));
    expect(oct.opex?.custody).toBe(85 + 120);
    expect(oct.opex?.fuel).toBe(120);
    expect(oct.opex?.total).toBe((oct.opex?.card ?? 0) + (oct.opex?.custody ?? 0));
    // By EXIT day: v2's (in Oct 10, out Oct 12: 2 days) and the deleted v7's (Oct 6 → 7: 1 day);
    // v4 is still in. The deleted car's exit counts — in the mean and the bars — but is not ranked.
    expect(oct.exits).toMatchObject({
      count: 2,
      avgStayDays: 1.5,
      byWorkType: [{ id: workTypeId, count: 2 }],
      byWorkshop: [{ id: workshopId, count: 2 }],
      topVehicles: [
        {
          vehicleId: v2.id,
          code: v2.code,
          typeName: expect.objectContaining({ ar: 'مصفحة' }) as unknown,
          visits: 1,
          lastInDate: '2026-10-10',
          lastWorkType: expect.objectContaining({ ar: 'صيانة' }) as unknown,
        },
      ],
      unregistered: 0,
    });
    // «أرقام الفترة» keeps the CHECK-IN day: v4 (Oct 25, open), v2 and v7 (closed).
    expect(oct.visits).toEqual({ count: 3, closed: 2, open: 1 });
  });

  it('holds the invariants: km = Σ buckets = Σ branches + unregistered; Σ bars = exits', () => {
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
    expect(thisMonth.exits).toEqual({
      count: 0,
      avgStayDays: null,
      byWorkType: [],
      byWorkshop: [],
      topVehicles: [],
      unregistered: 0,
    });
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
    expect(b2.vehicleScope.scopeBranches?.map((b) => b.id)).toEqual([B2]);
    await periodParity(b2, { branchIds: B2 }, B2);
    kmInvariants(b2);
    // One branch in scope: «حسب النوع» is drawn and sums to the km.
    expect((b2.km?.byType ?? []).reduce((a, t) => a + t.km, 0)).toBe(b2.km?.total);
  });

  it('operation + codes: the intersection, as each screen resolves it', async () => {
    const q = { ...OCT, operationIds: O_CASH, vehicleCodes: `${v1.code},${v2.code}` };
    const dto = ok<FleetDashboardPeriodDto>(await get('/fleet/dashboard/period', q));
    expect(dto.vehicleScope.count).toBe(1);
    await periodParity(dto, { operationIds: O_CASH, vehicleCodes: `${v1.code},${v2.code}` });
  });
});

// ── «كل فروعي» — a reader whose grant reaches B1 and B2 ──────────────────────────────────────────

describe('«كل فروعي» parity — every figure is its screen with `branchIds=B1,B2` (D9, D12)', () => {
  let mine: FleetDashboardNowDto;
  let mineOct: FleetDashboardPeriodDto;
  const BOTH = () => `${B1},${B2}`;
  beforeAll(async () => {
    const { user } = await userService.create(
      {
        email: 'dashboard-parity-reach@ecms.local',
        firstName: { ar: 'م', en: 'T' },
        lastName: { ar: 'م', en: 'T' },
        locale: 'en',
        organization: { branchId: B1, departmentId: null, sectionId: null, jobTitleId: null },
      },
      null,
    );
    const id = String(user._id);
    await userService.forceActivate(id);
    const role = await rbacService.createRole(
      {
        name: { en: 'Dashboard reach', ar: 'قارئ الفروع' },
        permissionKeys: [...new Set([...FLEET_DASHBOARD_NOW_KEYS, ...FLEET_DASHBOARD_PERIOD_KEYS])],
      },
      adminId,
    );
    await rbacService.assignRole(
      { userId: id, roleId: String(role._id), scope: 'branch', branchIds: [B2] },
      adminId,
    );
    const token = await authService.signAccessToken(id, new Types.ObjectId().toString(), 0);
    const as = (path: string, query: Record<string, unknown> = {}) =>
      request(app).get(`/api/v1${path}`).query(query).set('Authorization', `Bearer ${token}`);
    mine = ok<FleetDashboardNowDto>(await as('/fleet/dashboard/now'));
    mineOct = ok<FleetDashboardPeriodDto>(await as('/fleet/dashboard/period', OCT));
  });

  it('echoes both branches by name and no switcher; the set echo is non-null', () => {
    expect(new Set(mine.scopeBranches?.map((b) => b.id))).toEqual(new Set([B1, B2]));
    expect(mine.branchId).toBeNull();
    expect(mine.vehicleScope).not.toBeNull();
    expect(mine.vehicleScope?.branchId).toBeNull();
    expect(new Set(mineOct.vehicleScope.scopeBranches?.map((b) => b.id))).toEqual(
      new Set([B1, B2]),
    );
  });

  it('R1: the company sources are the screens’ with the list', async () => {
    expect(mine.workshop?.open).toBe(
      await total('/fleet/maintenance', { open: true, branchIds: BOTH() }),
    );
    const open = ok<{ count: number; remaining: number }>(
      await get('/fleet/accidents/summary', { status: 'open', branchIds: BOTH() }),
    );
    expect(mine.accidentsOpen).toEqual({ count: open.count, remaining: open.remaining });
    // The accident on the car the registry never had is in no branch: out of the list.
    expect(mine.accidentsOpen?.count).toBe((now.accidentsOpen?.count ?? 0) - 1);
    expect(mine.dealershipPending?.rows).toBe(
      await total('/fleet/dealership', { pending: true, branchIds: BOTH() }),
    );
    const rollup = ok<FleetViolationRollupDto[]>(
      await get('/fleet/violations/rollup', { branchIds: BOTH() }),
    );
    expect(mine.violationsOpen?.total.count).toBe(
      rollup.reduce((acc, row) => acc + row.outstandingTotalCount, 0),
    );
    expect(mine.distributionDrivers?.total).toBe(
      await total('/fleet/drivers', { branchId: BOTH() }),
    );
    expect(mine.vehicles?.active).toBe(5);
  });

  it('R2: every period screen reproduces the figure with the list; the km by branch, not by type', async () => {
    await periodParity(mineOct, { branchIds: BOTH() });
    kmInvariants(mineOct);
    expect(mineOct.km?.byType).toBeNull();
    expect(mineOct.km?.unregistered).toBeNull();
    expect(mineOct.accidents?.undated).toBeNull();
  });
});

// ── «إنذارات الصيانة بالكيلومتر» on cars really in alarm — LAST, so no figure above sees them ──

describe('R1 parity — the alarm table on cars in alarm (red, yellow, one in the workshop)', () => {
  let red: FleetVehicleDto;
  let yellow: FleetVehicleDto;
  let after: FleetDashboardNowDto;
  beforeAll(async () => {
    // A make with a short interval and a work type that counts: a counted service on 2 October,
    // then the counter runs on — 780 km (220 left: red) and 480 km (520 left: yellow).
    const short = ok<FleetVehicleTypeDto>(
      await send('post', '/fleet/vehicle-types', {
        name: { ar: 'نصف نقل', en: 'Pickup' },
        maintenanceIntervalKm: 1000,
      }),
      201,
    ).id;
    const counting = await mkCatalog('workType', 'صيانة دورية', { countsForAlarm: true });
    red = await mkVehicle({ typeId: short });
    yellow = await mkVehicle({ typeId: short, branchId: B2 });
    for (const [car, reached] of [
      [red, 900],
      [yellow, 600],
    ] as const) {
      await read(car.id, '2026-10-01', 100);
      await read(car.id, '2026-10-30', reached);
      await FleetMaintenanceVisitModel.create({
        vehicleId: new Types.ObjectId(car.id),
        inDate: new Date('2026-10-02T00:00:00.000Z'),
        outDate: new Date('2026-10-02T00:00:00.000Z'),
        workshopId: new Types.ObjectId(workshopId),
        workTypeId: new Types.ObjectId(counting),
        odometerAtService: 120,
      });
    }
    // The yellow car is back in the workshop since yesterday: «في الورشة: ورشة اللوحة».
    await checkIn(yellow.id, '2026-10-31', dA);
    after = ok<FleetDashboardNowDto>(await get('/fleet/dashboard/now'));
  }, 120_000);

  it('the rows = the alarms board’s red/yellow rows in its order; the counts stay the board’s', async () => {
    const board = ok<FleetMaintenanceAlarmDto[]>(await get('/fleet/odometer/alarms'));
    const rows = after.maintenanceAlarm?.rows ?? [];
    expect(rows).toEqual(alarmRowsOf(board));
    expect(rows.map((row) => [row.code, row.level, row.remainingKm])).toEqual([
      [red.code, 'red', 220],
      [yellow.code, 'yellow', 520],
    ]);
    expect(rows[0]).toMatchObject({
      sinceServiceKm: 780,
      intervalKm: 1000,
      lastServiceAt: '2026-10-02',
      inWorkshop: null,
    });
    expect(rows[1]?.inWorkshop).toEqual({
      workshop: expect.objectContaining({ ar: 'ورشة اللوحة' }) as unknown,
    });
    expect(after.maintenanceAlarm?.red).toBe(board.filter((row) => row.level === 'red').length);
    expect(after.maintenanceAlarm?.yellow).toBe(
      board.filter((row) => row.level === 'yellow').length,
    );
  });

  it('under a branch, the table keeps that branch’s rows only — the codes its link carries', async () => {
    const b2 = ok<FleetDashboardNowDto>(await get('/fleet/dashboard/now', {}, B2));
    expect(b2.maintenanceAlarm?.rows.map((row) => row.code)).toEqual([yellow.code]);
    expect(b2.maintenanceAlarm?.codes).toEqual({ red: [], yellow: [yellow.code] });
    // The workshop's longest stays narrow the same way: the yellow car is B2's only open visit.
    expect(b2.workshop?.longest.map((row) => [row.code, row.days])).toEqual([[yellow.code, 1]]);
    expect(b2.workshop?.longest.length).toBe(
      await total('/fleet/maintenance', { open: true, branchIds: B2 }),
    );
  });
});
