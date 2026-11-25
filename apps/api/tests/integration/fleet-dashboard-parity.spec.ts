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
//
// «العهدة» and «التراخيص والتجديدات» (the last block, on a world grown by custody memos, a held and a
// transferred «استعاضة» and licence-expense memos): `opex.custodyCount` = the receipts screen's
// custody count; `custodyStates` Σ = `opex.custody`; `licenceSpend` = the licence-expense register's
// summary over the same days; each licence month column = its list link's total; the drivers' list
// = `/fleet/drivers?licExpBefore=<today + 60>`; and the held letters = «المذكرات» `status=held` —
// for the company AND under B2.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Express } from 'express';
import {
  FLEET_DASHBOARD_ALARM_ROWS,
  FLEET_DASHBOARD_DEALERSHIP_ROWS,
  FLEET_DASHBOARD_FUEL_CARD_ROWS,
  FLEET_DASHBOARD_NOW_KEYS,
  FLEET_DASHBOARD_PERIOD_KEYS,
  FLEET_DASHBOARD_VIOLATION_ROWS,
  FLEET_DASHBOARD_WORKSHOP_ROWS,
  FLEET_UNKNOWN_DRIVER_NAME,
  SettingKeys,
  calendarDayBounds,
  compareFleetVehicleCodes,
  platformPermissions,
  ConfirmFleetCustodyTransferSchema,
  CreateFleetCustodyMemoSchema,
  CreateFleetCustodyReplenishmentSchema,
  CreateFleetLicenseExpenseSchema,
  type FleetCatalogItemDto,
  type FleetCustodyFundSummaryDto,
  type FleetCustodyMemoRowDto,
  type FleetDealershipInvoiceDto,
  type FleetDashboardNowDto,
  type FleetDashboardPeriodDto,
  type FleetFuelCardDto,
  type FleetMaintenanceAlarmDto,
  type FleetMaintenanceVisitDto,
  type FleetNoticeDto,
  type FleetRosterDayDto,
  type FleetVehicleDto,
  type FleetVehicleTypeDto,
  type FleetViolationDto,
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
import { FleetReceiptModel } from '../../src/modules/fleet/receipts/receipt.model';
import { fleetCustodyMemoService } from '../../src/modules/fleet/custody/custody-memo.service';
import { fleetCustodyFundService } from '../../src/modules/fleet/custody/custody-fund.service';
import { fleetCustodyHoldService } from '../../src/modules/fleet/custody/custody-fund-hold';
import { fleetLicenseExpenseService } from '../../src/modules/fleet/license-expenses/license-expense.service';
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
/** A second drivers' type — «مخالفات الفترة حسب النوع» orders two bars. */
let driverSide2: string;
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
  driverSide2 = await mkCatalog('violationType', 'عكس الاتجاه اللوحة', { violationSide: 'driver' });
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

  // «مخالفات السائقين في الفترة» — three drivers' fines of October, written as the ledger stores
  // them: v1's by dA, ALREADY collected (in the period, never owed — R1 unchanged by it); v2's by
  // «مجهول», owed, of the second type; and one on v7 — deleted above, its fine stays — by a name
  // the book wrote, owed. Their days sit off midnight on purpose (old-book rows): whole days.
  for (const [car, day, employee, name, type, amount, collected] of [
    [v1, '2026-10-05T00:00:00.000Z', dA, null, driverSide, 40, true],
    [v2, '2026-10-20T21:00:00.000Z', null, FLEET_UNKNOWN_DRIVER_NAME, driverSide2, 25, false],
    [v7, '2026-10-07T00:00:00.000Z', null, 'سائق من الدفتر', driverSide, 15, false],
  ] as const) {
    await FleetViolationModel.create({
      ...legacy,
      kind: 'driver',
      vehicleId: new Types.ObjectId(car.id),
      violationTypeId: new Types.ObjectId(type),
      amount,
      year: null,
      count: null,
      unitValue: null,
      date: new Date(day),
      driverEmployeeId: employee === null ? null : new Types.ObjectId(employee),
      driverName: name,
      collected,
    });
  }

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

  it('T2.4 = /fleet/maintenance?state=open&to=<today>, the oldest stay in Cairo days', async () => {
    // The link's own question (D07): open visits checked in by today.
    expect(now.workshop?.open).toBe(await total('/fleet/maintenance', { open: true, to: TODAY }));
    expect(now.workshop).toMatchObject({
      open: 1,
      openActive: 1,
      openOutOfService: 0,
      openDisposed: 0,
      openNoCar: 0,
    });
    // D06: the four parts under the headline always make it up.
    const w = now.workshop;
    expect(
      (w?.openActive ?? 0) +
        (w?.openOutOfService ?? 0) +
        (w?.openDisposed ?? 0) +
        (w?.openNoCar ?? 0),
    ).toBe(w?.open);
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
    // «أقربها» = the first card of the expiring cards' own list, by expiry.
    const window = { expiresFrom: first('2026-11-02'), expiresBefore: last('2026-12-01') };
    const [soonest] = ok<FleetFuelCardDto[]>(
      await get('/fleet/fuel-cards', { ...window, sortBy: 'expiresAt', sortDir: 'asc' }),
    );
    expect(now.fuelCards).toEqual({
      warnDays: 30,
      expired: expired.cardCount,
      expiring: expiring.cardCount,
      nearest: soonest?.expiresAt?.slice(0, 10) ?? null,
    });
    expect(now.fuelCards).toMatchObject({ expired: 1, expiring: 1, nearest: '2026-11-15' });
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
      companyCards: { wataniya: all['wataniyaCards'], chillout: all['chilloutCards'] },
      // The company view names the cards on no car (none on this fixture).
      unassigned: { count: all['noCarCards'], balance: all['noCarBalance'] },
    });
    // Each company's cards = the cards screen filtered to it.
    expect(now.fuelCharging?.companyCards).toEqual({
      wataniya: await total('/fleet/fuel-cards', { company: 'wataniya' }),
      chillout: await total('/fleet/fuel-cards', { company: 'chillout' }),
    });
    expect(now.fuelCharging?.companyCards).toEqual({ wataniya: 3, chillout: 0 });
    expect(now.fuelCharging?.unassigned).toEqual({ count: 0, balance: 0 });
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

describe('R1 parity — tab «التراخيص والتجديدات», the counts', () => {
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
    // D13: each card's drivers are the catalog's alone — the drivers screen's «التخصص» total; the
    // old classification is a line apart, never added in nor taken out.
    expect(drv?.cash.drivers).toBe(
      await total('/fleet/drivers', { specializationId: csv(drv?.cash.specializationIds ?? []) }),
    );
    expect(drv?.atm.drivers).toBe(
      await total('/fleet/drivers', { specializationId: csv(drv?.atm.specializationIds ?? []) }),
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
    // October adds an owed «مجهول» (25) and an owed book name on the deleted v7 (15); dA's
    // October fine is collected, so it is in neither.
    expect(v?.drivers).toMatchObject({
      attributed: 30,
      unknown: { amount: 35, count: 2 },
      unlinked: { amount: 92, count: 2 },
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
    // The drivers' part split by whom (§7, Q1 أ) — each part the register's own list, every year:
    // «مجهول» = `unknownDriver=true`, the known drivers = the linked rows (and how many people).
    const owed = ok<FleetViolationDto[]>(
      await get('/fleet/violations', { kind: 'driver', collected: false, pageSize: 100 }),
    );
    expect(owed).toHaveLength(v?.drivers.total.count ?? -1);
    const unknownRows = ok<FleetViolationDto[]>(
      await get('/fleet/violations', {
        kind: 'driver',
        collected: false,
        unknownDriver: true,
        pageSize: 100,
      }),
    );
    const linked = owed.filter((row) => row.driverEmployeeId !== null);
    const money = (rows: readonly FleetViolationDto[]) =>
      Math.round(rows.reduce((acc, row) => acc + row.amount, 0) * 100) / 100;
    expect(v?.drivers.unknown).toEqual({ amount: money(unknownRows), count: unknownRows.length });
    expect(v?.drivers.attributed).toEqual({
      amount: money(linked),
      count: linked.length,
      drivers: new Set(linked.map((row) => row.driverEmployeeId)).size,
    });
    const parts = v?.drivers;
    expect(
      Math.round(
        ((parts?.attributed.amount ?? 0) +
          (parts?.unknown.amount ?? 0) +
          (parts?.unlinked.amount ?? 0)) *
          100,
      ) / 100,
    ).toBe(parts?.total.amount);
    expect(
      (parts?.attributed.count ?? 0) + (parts?.unknown.count ?? 0) + (parts?.unlinked.count ?? 0),
    ).toBe(parts?.total.count);
    // Last year's statement (2 × 150) is in it; this year's «ملخصات» figure is not. October adds
    // 25 («مجهول») and 15 (a book name on the deleted v7); dA's collected 40 is in no owed figure.
    expect(v).toEqual({
      company: { amount: 500, count: 3 },
      drivers: {
        total: { amount: 157, count: 5 },
        attributed: { amount: 30, count: 1, drivers: 1 },
        unknown: { amount: 35, count: 2 },
        unlinked: { amount: 92, count: 2 },
      },
      total: { amount: 657, count: 8 },
      // The company view: no fine on a car the registry never had on this fixture.
      bookOnly: { company: { amount: 0, count: 0 }, drivers: { amount: 0, count: 0 } },
    });
    expect(now.violationsYear?.company).toBe(200);
  });

  it('«كروت تحتاج متابعة» = the flagged cards of the cards and charging screens, the most urgent first', async () => {
    // Flagged = expired · below the red line · a request waiting · below the yellow line · expiring
    // in the window — each the screen's own filter; the list is their union, in urgency order.
    const ids = async (query: Record<string, unknown>) =>
      ok<FleetFuelCardDto[]>(await get('/fleet/fuel-cards', { ...query, pageSize: 100 })).map(
        (card) => card.id,
      );
    const expired = await ids({ expiresBefore: last(TODAY) });
    const red = await ids({ balanceBelow: 100 });
    const requested = await ids({ requested: true });
    const low = await ids({ balanceBelow: 300 });
    const expiring = await ids({
      expiresFrom: first('2026-11-02'),
      expiresBefore: last('2026-12-01'),
    });
    const flagged = new Set([...expired, ...red, ...requested, ...low, ...expiring]);
    const list = now.fuelCardList;
    expect(list?.total).toBe(flagged.size);
    expect(list?.rows.length).toBe(Math.min(flagged.size, FLEET_DASHBOARD_FUEL_CARD_ROWS));
    for (const row of list?.rows ?? []) {
      expect(flagged.has(row.cardId)).toBe(true);
      expect(row.states.includes('expired')).toBe(expired.includes(row.cardId));
      expect(row.states.includes('critical')).toBe(red.includes(row.cardId));
      expect(row.states.includes('requested')).toBe(requested.includes(row.cardId));
      // «رصيد منخفض» never repeats «يوشك على النفاد».
      expect(row.states.includes('low')).toBe(
        low.includes(row.cardId) && !red.includes(row.cardId),
      );
      expect(row.states.includes('expiring')).toBe(expiring.includes(row.cardId));
    }
    // v1's card expired today (and is empty), v3's waits for a top-up (empty), v2's expires on the 15th.
    expect(list?.rows.map((row) => [row.code, row.states])).toEqual([
      [v1.code, ['expired', 'critical']],
      [v3.code, ['critical', 'requested']],
      [v2.code, ['expiring']],
    ]);
    expect(list?.rows.every((row) => !row.vehicleDeleted && row.label === null)).toBe(true);
  });

  it('«مطابقة شيت شركة الوقود»: no sheet of either company was ever read — both null, never zeros', () => {
    expect(now.fuelSheets).toEqual({ wataniya: null, chillout: null });
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
      await total('/fleet/maintenance', { open: true, to: TODAY, branchIds: B2 }),
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

  it('the fuel figures follow the card’s CURRENT car’s branch: the screens with branchIds=B2', async () => {
    const q = { branchIds: B2 };
    const all = ok<Record<string, number>>(await get('/fleet/fuel-cards/summary', q));
    const low = ok<{ cardCount: number }>(
      await get('/fleet/fuel-cards/summary', { ...q, balanceBelow: 300 }),
    );
    const red = ok<{ cardCount: number }>(
      await get('/fleet/fuel-cards/summary', { ...q, balanceBelow: 100 }),
    );
    expect(b2.fuelCharging).toEqual({
      wataniya: all['wataniyaBalance'],
      chillout: all['chilloutBalance'],
      requested: { count: all['requestedCount'], amount: all['requestedAmount'] },
      low: { belowYellow: low.cardCount, belowRed: red.cardCount, yellowAt: 300, redAt: 100 },
      charged24h: all['chargedTodayAmount'],
      cards: all['cardCount'],
      companyCards: { wataniya: all['wataniyaCards'], chillout: all['chilloutCards'] },
      // A branch never names the cards on no car.
      unassigned: null,
    });
    // B2's one card is v2's: charged 500 today, no request; the company has three.
    expect(b2.fuelCharging).toMatchObject({ cards: 1, charged24h: 500, requested: { count: 0 } });
    expect(b2.fuelCharging?.cards).toBe(await total('/fleet/fuel-cards', q));
    const window = { expiresFrom: first('2026-11-02'), expiresBefore: last('2026-12-01') };
    const expired = ok<{ cardCount: number }>(
      await get('/fleet/fuel-cards/summary', { ...q, expiresBefore: last(TODAY) }),
    );
    const expiring = ok<{ cardCount: number }>(
      await get('/fleet/fuel-cards/summary', { ...q, ...window }),
    );
    const [soonest] = ok<FleetFuelCardDto[]>(
      await get('/fleet/fuel-cards', { ...q, ...window, sortBy: 'expiresAt', sortDir: 'asc' }),
    );
    expect(b2.fuelCards).toEqual({
      warnDays: 30,
      expired: expired.cardCount,
      expiring: expiring.cardCount,
      nearest: soonest?.expiresAt?.slice(0, 10) ?? null,
    });
    expect(b2.fuelCards).toMatchObject({ expired: 0, expiring: 1, nearest: '2026-11-15' });
    expect(b2.fuelCardList?.rows.map((row) => row.code)).toEqual([v2.code]);
    expect(b2.fuelCardList?.total).toBe(1);
    expect(b2.fuelSheets).toEqual({ wataniya: null, chillout: null });
    // The overview's expired line is the company's only (v1's card is B1's).
    expect(b2.alerts.map((a) => a.id)).not.toContain('fuelCardExpired');
  });

  it('«مخالفات قائمة» under B2: the drivers’ parts = the register with branchIds=B2; no book rows apart', async () => {
    const owed = ok<FleetViolationDto[]>(
      await get('/fleet/violations', {
        kind: 'driver',
        collected: false,
        branchIds: B2,
        pageSize: 100,
      }),
    );
    const unknownCount = await total('/fleet/violations', {
      kind: 'driver',
      collected: false,
      unknownDriver: true,
      branchIds: B2,
    });
    const v = b2.violationsOpen;
    expect(v?.drivers.total.count).toBe(owed.length);
    expect(v?.drivers.unknown.count).toBe(unknownCount);
    expect(v?.drivers.attributed.drivers).toBe(
      new Set(owed.flatMap((row) => (row.driverEmployeeId === null ? [] : [row.driverEmployeeId])))
        .size,
    );
    // v2's two «مجهول» fines (June and October) and the deleted v7's book name — B2's cars.
    expect(v?.drivers).toEqual({
      total: { amount: 50, count: 3 },
      attributed: { amount: 0, count: 0, drivers: 0 },
      unknown: { amount: 35, count: 2 },
      unlinked: { amount: 15, count: 1 },
    });
    expect(v?.bookOnly).toBeNull();
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
      await total('/fleet/maintenance', { open: true, to: TODAY, branchIds: B2 }),
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
  // No count by the CHECK-IN day (`from`/`to`) any more: it left with the retired `period` tab.
  expect(dto).not.toHaveProperty('visits');
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
  const accOpen = ok<{ count: number }>(
    await get('/fleet/accidents/summary', { ...q, status: 'open' }, branch),
  );
  expect(dto.accidents).toMatchObject({ count: acc.count, open: accOpen.count });
  // The open files' own remaining left with the retired `period` tab; the money is `totals`.
  expect(dto.accidents).not.toHaveProperty('openRemaining');
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
  const fuel = ok<Record<string, number>>(
    await get('/fleet/receipts/summary', { ...q, kind: 'fuel' }, branch),
  );
  expect(dto.opex?.fuel).toBe(fuel['fuelTotal']);
  const deal = ok<{ count: number; pending: number; dealershipTotal: number }>(
    await get('/fleet/dealership/summary', q, branch),
  );
  expect(dto.dealership).toMatchObject({
    amount: deal.dealershipTotal,
    rows: deal.count,
    pending: deal.pending,
    dataFrom: '2026-09-01',
  });
  // «فواتير التوكيل في الفترة» = the dealership screen's first page, same ids, same order.
  const dealRows = ok<FleetDealershipInvoiceDto[]>(
    await get(
      '/fleet/dealership',
      { ...q, page: 1, pageSize: FLEET_DASHBOARD_DEALERSHIP_ROWS },
      branch,
    ),
  );
  expect(dto.dealershipList?.rows.map((row) => row.id)).toEqual(dealRows.map((row) => row.id));
  expect(dto.dealershipList?.rows.map((row) => row.date)).toEqual(
    dealRows.map((row) => row.outDate.slice(0, 10)),
  );
  expect((dto.dealershipList?.more ?? 0) + (dto.dealershipList?.rows.length ?? 0)).toBe(deal.count);
  // «مصروف التشغيل حسب النوع» — each bar the receipts screen filtered to that kind (and source).
  const recOf = async (extra: Record<string, unknown>) =>
    ok<Record<string, number>>(await get('/fleet/receipts/summary', { ...q, ...extra }, branch));
  const byCard = await recOf({ kind: 'fuel', source: 'card' });
  const byCustody = await recOf({ kind: 'fuel', source: 'custody' });
  const tyres = await recOf({ kind: 'tyres' });
  const wash = await recOf({ kind: 'wash' });
  const maint = await recOf({ kind: 'maintenance' });
  const sumOf = (t: Record<string, number>) =>
    Math.round(((t['cardTotal'] ?? 0) + (t['custodyTotal'] ?? 0)) * 100) / 100;
  expect(dto.opex).toMatchObject({
    card: sumOf(byCard),
    fuelCustody: sumOf(byCustody),
    tyres: sumOf(tyres),
    wash: sumOf(wash),
    maintenance: sumOf(maint),
    litres: Math.round(fuel['fuelLitres'] ?? 0),
    unpricedFuel: fuel['fuelUnpriced'],
  });
  const opex = dto.opex;
  expect(
    Math.round(
      ((opex?.card ?? 0) +
        (opex?.fuelCustody ?? 0) +
        (opex?.tyres ?? 0) +
        (opex?.wash ?? 0) +
        (opex?.maintenance ?? 0)) *
        100,
    ) / 100,
  ).toBe(opex?.total);
  // «مصروف التشغيل يومًا بيوم»: every day of the range, Σ = the total; a day with receipts = the
  // receipts screen of that one day.
  const buckets = dto.opexSeries?.buckets ?? [];
  expect(buckets.length).toBe(dto.range.days);
  expect(Math.round(buckets.reduce((acc, b) => acc + b.amount, 0) * 100) / 100).toBe(opex?.total);
  expect(buckets.reduce((acc, b) => acc + b.count, 0)).toBe(opex?.count);
  for (const bucket of buckets.filter((b) => b.hasRows)) {
    const one = await recOf({ from: bucket.key, to: bucket.key });
    expect(bucket.amount, bucket.key).toBe(sumOf(one));
    expect(bucket.count, bucket.key).toBe(one['count']);
  }
  // «مخالفات السائقين في الفترة» = the register's drivers' half over the same days and set.
  const vq = { ...q, kind: 'driver' };
  const viol = dto.violations;
  expect(viol?.count).toBe(await total('/fleet/violations', vq, branch));
  expect(viol?.owed.count).toBe(
    await total('/fleet/violations', { ...vq, collected: false }, branch),
  );
  expect(viol?.collected.count).toBe(
    await total('/fleet/violations', { ...vq, collected: true }, branch),
  );
  for (const bar of viol?.byType ?? []) {
    expect(bar.count).toBe(
      await total('/fleet/violations', { ...vq, violationTypeId: bar.violationTypeId }, branch),
    );
  }
  expect((viol?.byType ?? []).reduce((acc, bar) => acc + bar.count, 0)).toBe(viol?.count);
  // …and its first page, newest fine day first.
  const violRows = ok<FleetViolationDto[]>(
    await get(
      '/fleet/violations',
      {
        ...vq,
        sortBy: 'date',
        sortDir: 'desc',
        page: 1,
        pageSize: FLEET_DASHBOARD_VIOLATION_ROWS,
      },
      branch,
    ),
  );
  expect(dto.violationList?.rows.map((row) => row.violationId)).toEqual(
    violRows.map((row) => row.id),
  );
  expect(dto.violationList?.rows.map((row) => [row.date, row.amount, row.collected])).toEqual(
    violRows.map((row) => [row.date?.slice(0, 10), row.amount, row.collected]),
  );
  expect((dto.violationList?.more ?? 0) + (dto.violationList?.rows.length ?? 0)).toBe(viol?.count);
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
    expect(oct).not.toHaveProperty('visits');
    expect(oct.accidents).toEqual({
      count: 3,
      open: 3,
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
        deleted: false,
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
    // «مخالفات السائقين في الفترة»: dA's (Oct 5, collected), the deleted v7's book name (Oct 7,
    // owed) and v2's «مجهول» (stored at 21:00Z on Oct 20 — its whole day counts); the statements
    // (a year, no day) and the fines of May–July never.
    expect(oct.violations).toEqual({
      count: 3,
      amount: 80,
      owed: { count: 2, amount: 40 },
      collected: { count: 1, amount: 40 },
      byType: [
        {
          violationTypeId: driverSide,
          name: expect.objectContaining({ ar: 'سرعة اللوحة' }) as unknown,
          unspecified: false,
          count: 2,
          amount: 55,
        },
        {
          violationTypeId: driverSide2,
          name: expect.objectContaining({ ar: 'عكس الاتجاه اللوحة' }) as unknown,
          unspecified: false,
          count: 1,
          amount: 25,
        },
      ],
    });
    // Newest fine day first; the deleted car keeps its code and loses its record link.
    expect(
      oct.violationList?.rows.map((r) => [r.code, r.date, r.vehicleDeleted, r.collected]),
    ).toEqual([
      [v2.code, '2026-10-20', false, false],
      [v7.code, '2026-10-07', true, false],
      [v1.code, '2026-10-05', false, true],
    ]);
    expect(oct.violationList?.rows.map((r) => [r.driverEmployeeId, r.driverName])).toEqual([
      [null, FLEET_UNKNOWN_DRIVER_NAME],
      [null, 'سائق من الدفتر'],
      [dA, null],
    ]);
    expect(oct.violationList?.more).toBe(0);
    // «مصروف التشغيل حسب النوع»: the custody fuel (120) and the two washes (50 + the deleted v7's
    // 35); no card receipt, no tyres, no workshop paper.
    expect(oct.opex).toMatchObject({
      card: 0,
      fuelCustody: 120,
      tyres: 0,
      wash: 85,
      maintenance: 0,
    });
    expect(
      oct.opexSeries?.buckets.filter((b) => b.hasRows).map((b) => [b.key, b.amount, b.count]),
    ).toEqual([
      ['2026-10-07', 35, 1],
      ['2026-10-15', 50, 1],
      ['2026-10-16', 120, 1],
    ]);
    // The dealership rows the two October exits opened (v2's, the deleted v7's): page 1 of the
    // screen, as `periodParity` holds; never an empty table here.
    expect(oct.dealershipList?.rows.length).toBeGreaterThan(0);
    expect(oct.opexSeries?.buckets[0]).toEqual({
      key: '2026-10-01',
      hasRows: false,
      amount: 0,
      count: 0,
    });
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
    expect(thisMonth).not.toHaveProperty('visits');
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
    // The drivers' fines of B2's cars: v2's «مجهول» and the deleted v7's (by its last branch).
    expect(b2.violations).toMatchObject({ count: 2, amount: 40, owed: { count: 2, amount: 40 } });
    expect(b2.violationList?.rows.map((r) => r.code)).toEqual([v2.code, v7.code]);
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
      await total('/fleet/maintenance', { open: true, to: TODAY, branchIds: BOTH() }),
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
      await total('/fleet/maintenance', { open: true, to: TODAY, branchIds: B2 }),
    );
  });
});

describe('«العهدة» and «التراخيص والتجديدات» parity — the company and B2', () => {
  const MONTHS = [
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
  ];
  const lastDayOf = (key: string): string => {
    const days = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0));
    return `${key}-${String(days.getUTCDate()).padStart(2, '0')}`;
  };
  const views: { label: string; branch?: string; q: Record<string, string> }[] = [
    { label: 'company', q: {} },
    { label: 'B2', branch: '', q: {} },
  ];
  let company: FleetDashboardPeriodDto;
  let b2: FleetDashboardPeriodDto;
  let nowCo: FleetDashboardNowDto;
  let nowB2: FleetDashboardNowDto;
  let heldLetter: string;

  beforeAll(async () => {
    views[1] = { label: 'B2', branch: B2, q: { branchIds: B2 } };
    // One more custody receipt, on v2 (B2): its tyres, the memo a transferred «استعاضة» takes.
    ok(
      await send('post', '/fleet/receipts', {
        date: '2026-10-20',
        vehicleId: v2.id,
        kind: 'tyres',
        amount: 80,
        driverName: 'سائق',
      }),
      201,
    );
    const receiptOf = async (vehicleId: string, kind: string): Promise<string> => {
      const found = await FleetReceiptModel.findOne({
        vehicleId: new Types.ObjectId(vehicleId),
        kind,
        source: 'custody',
        isDeleted: false,
      })
        .lean()
        .exec();
      expect(found, `${kind} on ${vehicleId}`).not.toBeNull();
      return String(found?._id);
    };
    const actor = adminId;
    const memo = async (kind: string, receiptId: string) =>
      fleetCustodyMemoService.create(
        CreateFleetCustodyMemoSchema.parse({ kind, lines: [{ receiptId }] }),
        actor,
      );
    // v1's wash: a memo a held «استعاضة» took — still waiting for the money.
    const washMemo = await memo('wash', await receiptOf(v1.id, 'wash'));
    const held = await fleetCustodyFundService.replenish(
      CreateFleetCustodyReplenishmentSchema.parse({ date: '2026-10-25', memoIds: [washMemo.id] }),
      actor,
    );
    heldLetter = held.id;
    // v2's tyres: replenished, the transfer confirmed.
    const tyresMemo = await memo('tyres', await receiptOf(v2.id, 'tyres'));
    const done = await fleetCustodyFundService.replenish(
      CreateFleetCustodyReplenishmentSchema.parse({ date: '2026-10-26', memoIds: [tyresMemo.id] }),
      actor,
    );
    await fleetCustodyHoldService.confirmTransfer(
      done.id,
      ConfirmFleetCustodyTransferSchema.parse({ date: '2026-10-27' }),
      actor,
    );
    // v3's fuel: on a memo no «استعاضة» took yet. The deleted v7's wash stays on no memo.
    await memo('fuel', await receiptOf(v3.id, 'fuel'));

    // Licence-expense memos of October — one with both memos and a hand-typed plate — and one of
    // November, out of the range.
    const half = (
      vehicleIds: string[],
      plates: string[],
      lines: [number, 'visa' | 'cash', number][],
    ) => ({
      vehicles: [
        ...vehicleIds.map((vehicleId) => ({ vehicleId, plate: '' })),
        ...plates.map((plate) => ({ vehicleId: null, plate })),
      ],
      items: lines.map(([amount, paidBy, count]) => ({
        itemId: null,
        label: 'بند',
        amount,
        count,
        paidBy,
        receipt: true,
      })),
    });
    const SIGNATURES = { agent: 'أ', director: 'ب', generalManager: 'ج' };
    for (const [date, renewal, extension] of [
      [
        '2026-10-03',
        half(
          [v1.id],
          ['ب ح 12'],
          [
            [100, 'visa', 2],
            [50, 'cash', 1],
          ],
        ),
        half([v2.id], [], [[30, 'cash', 1]]),
      ],
      ['2026-10-31', null, half([v3.id], [], [[70.5, 'visa', 1]])],
      ['2026-11-01', half([v1.id], [], [[999, 'visa', 1]]), null],
    ] as const) {
      await fleetLicenseExpenseService.create(
        CreateFleetLicenseExpenseSchema.parse({ date, renewal, extension, signatures: SIGNATURES }),
        actor,
      );
    }

    company = ok<FleetDashboardPeriodDto>(await get('/fleet/dashboard/period', OCT));
    b2 = ok<FleetDashboardPeriodDto>(await get('/fleet/dashboard/period', OCT, B2));
    nowCo = ok<FleetDashboardNowDto>(await get('/fleet/dashboard/now'));
    nowB2 = ok<FleetDashboardNowDto>(await get('/fleet/dashboard/now', {}, B2));
  }, 120_000);

  const periodOfView = (label: string) => (label === 'company' ? company : b2);
  const nowOfView = (label: string) => (label === 'company' ? nowCo : nowB2);
  const piastres = (n: number): number => Math.round(n * 100);

  it('«N إيصالًا» = the receipts screen’s custody count over the same days and branch', async () => {
    for (const { label, branch, q } of views) {
      const screen = ok<{ count: number; custodyTotal: number }>(
        await get(
          '/fleet/receipts/summary',
          { from: OCT.from, to: OCT.to, source: 'custody', ...q },
          branch,
        ),
      );
      const dto = periodOfView(label);
      expect(dto.opex?.custodyCount, label).toBe(screen.count);
      expect(dto.opex?.custody, label).toBe(screen.custodyTotal);
    }
    // v1's wash (50), v3's fuel (120), v2's tyres (80) and the deleted v7's wash (35).
    expect(company.opex?.custodyCount).toBe(4);
    // B2: v2's tyres and v7's wash (its last branch).
    expect(b2.opex?.custodyCount).toBe(2);
  });

  it('«منها حتى الآن» = where those receipts stand now; Σ = «مصروفات العهدة», to the piastre', () => {
    expect(company.custodyStates).toEqual({ replenished: 80, pending: 170, outside: 35 });
    expect(b2.custodyStates).toEqual({ replenished: 80, pending: 0, outside: 35 });
    for (const dto of [company, b2]) {
      const s = dto.custodyStates;
      expect(
        piastres(s?.replenished ?? 0) + piastres(s?.pending ?? 0) + piastres(s?.outside ?? 0),
      ).toBe(piastres(dto.opex?.custody ?? -1));
    }
  });

  it('«مصروفات التراخيص في الفترة» = the licence-expense register over the same days — the same under B2', async () => {
    const strip = ok<{ count: number; cars: number; visaTotal: number; cashTotal: number }>(
      await get('/fleet/license-expenses/summary', { from: OCT.from, to: OCT.to }),
    );
    expect(company.licenceSpend).toMatchObject({
      count: strip.count,
      cars: strip.cars,
      visa: strip.visaTotal,
      cash: strip.cashTotal,
    });
    // D05: «عدد المذكرات» counts memos — a record holding a renewal and an extension is two.
    expect(company.licenceSpend).toEqual({
      count: 3,
      cars: 4,
      visa: 270.5,
      cash: 80,
      renewal: 250,
      extension: 100.5,
      total: 350.5,
    });
    // No branch reaches a memo: B2 reads the company's.
    expect(b2.licenceSpend).toEqual(company.licenceSpend);
  });

  it('each cars’ month column = /fleet/vehicles?status=active&licenseExpiryMonths=<month>', async () => {
    for (const { label, branch } of views) {
      const months = nowOfView(label).licenceVehicles?.months ?? [];
      expect(
        months.map((m) => m.key),
        label,
      ).toEqual(MONTHS);
      for (const month of months) {
        expect(month.count, `${label} ${month.key}`).toBe(
          await total('/fleet/vehicles', {
            status: 'active',
            licenseExpiryMonths: month.key,
            ...(branch === undefined ? {} : { branchId: branch }),
          }),
        );
      }
    }
    // November: v1 (B1, run out TODAY — this month's column holds it) and v2 (B2, the 20th);
    // December: v3 (B1, the 15th).
    expect(nowCo.licenceVehicles?.months.slice(0, 2).map((m) => m.count)).toEqual([2, 1]);
    expect(nowB2.licenceVehicles?.months.slice(0, 2).map((m) => m.count)).toEqual([1, 0]);
  });

  it('each drivers’ month column = /fleet/drivers over its first and last day (HR branch)', async () => {
    for (const { label, branch } of views) {
      const months = nowOfView(label).licenceDrivers?.months ?? [];
      expect(
        months.map((m) => m.key),
        label,
      ).toEqual(MONTHS);
      for (const month of months) {
        expect(month.count, `${label} ${month.key}`).toBe(
          await total('/fleet/drivers', {
            licenseExpiresFrom: first(`${month.key}-01`),
            licenseExpiresBefore: last(lastDayOf(month.key)),
            ...(branch === undefined ? {} : { branchId: branch }),
          }),
        );
      }
    }
    // The B2 driver expiring on 20 November.
    expect(nowCo.licenceDrivers?.months[0]?.count).toBe(1);
  });

  it('«أقرب رخص السائقين» = /fleet/drivers?licExpBefore=<today + 60>, the longest-expired first', async () => {
    for (const { label, branch } of views) {
      const lic = nowOfView(label).licenceDrivers;
      const query = {
        licenseExpiresBefore: last('2026-12-31'),
        ...(branch === undefined ? {} : { branchId: branch }),
      };
      expect((lic?.list.rows.length ?? 0) + (lic?.list.more ?? 0), label).toBe(
        await total('/fleet/drivers', query),
      );
      expect((lic?.list.rows.length ?? 0) + (lic?.list.more ?? 0), label).toBe(
        (lic?.expired ?? 0) + (lic?.expiring ?? 0) + (lic?.soon ?? 0),
      );
      const listed = ok<{ employeeId: string }[]>(
        await get('/fleet/drivers', { ...query, pageSize: 100 }),
      );
      for (const row of lic?.list.rows ?? []) {
        expect(
          listed.map((d) => d.employeeId),
          label,
        ).toContain(row.employeeId);
        expect(row.days, label).toBe(
          Math.round(
            (new Date(`${row.expiresAt}T00:00:00.000Z`).getTime() -
              new Date(`${TODAY}T00:00:00.000Z`).getTime()) /
              86_400_000,
          ),
        );
        expect(row.active).toBe(true);
      }
      const days = (lic?.list.rows ?? []).map((row) => row.expiresAt);
      expect(days).toEqual([...days].sort());
    }
    // The company: the expired one of 20 October, then the B2 driver of 20 November.
    expect(nowCo.licenceDrivers?.list.rows.map((row) => [row.expiresAt, row.days])).toEqual([
      ['2026-10-20', -12],
      ['2026-11-20', 19],
    ]);
  });

  it('«أقرب تراخيص السيارات»: each row named from its car — the make, no class, no papers', async () => {
    for (const row of nowCo.licenceVehicles?.list ?? []) {
      const car = ok<FleetVehicleDto>(await get(`/fleet/vehicles/${row.vehicleId}`));
      expect(row.code).toBe(car.code);
      expect(row.expiresAt).toBe(car.licenseExpiresAt.slice(0, 10));
      expect(row.typeName?.ar).toBe(car.typeId === T1 ? 'مصفحة' : row.typeName?.ar);
      expect(row.typeName).not.toBeNull();
      // No car of this world carries a licence class: none on the board, so no papers either.
      expect(row.licenceClass).toBeNull();
      expect(row.papers).toBeNull();
    }
  });

  it('«استعاضة معلّقة»: the held letters = «المذكرات» status=held, the oldest first', async () => {
    const fund = ok<FleetCustodyFundSummaryDto>(await get('/fleet/custody/fund/summary'));
    const held = ok<FleetCustodyMemoRowDto[]>(
      await get('/fleet/custody/memos', { status: 'held', pageSize: 100 }),
    );
    expect(fund.held.letters.map((letter) => letter.id)).toEqual([heldLetter]);
    expect(fund.held.letters.flatMap((l) => l.memos.map((m) => m.id)).sort()).toEqual(
      held.map((row) => row.id).sort(),
    );
    expect(fund.held.letters[0]).toMatchObject({ date: '2026-10-25', amount: 50, receipts: 1 });
    expect(fund.held).toMatchObject({ count: 1, amount: 50, memos: 1, receipts: 1 });
  });
});
