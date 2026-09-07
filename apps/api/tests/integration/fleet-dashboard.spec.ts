// `GET /fleet/dashboard` against a real database.
//
// The unit spec pins the SHAPING rules with stubbed repositories; this one asks whether the
// pipelines actually count what the screen claims. Everything here is built through the real
// endpoints — vehicles registered, readings recorded, a visit checked in, an accident filed — so
// a figure on the dashboard is a figure the module itself wrote, reached through the same
// aggregation the browser hits.
//
// Three questions it exists to answer, none of which a mocked test can:
//   1. do the matrix / stats / km / today numbers match the rows that were really written,
//   2. does a caller holding ONE fleet grant get that section and `null` for the rest,
//   3. does a branch-scoped reader see their own branch's fleet and nothing else.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  platformPermissions,
  type FleetCatalogItemDto,
  type FleetDashboardDto,
  type FleetVehicleDto,
  type FleetVehicleTypeDto,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { FleetDriverProfileModel } from '../../src/modules/fleet/driver-profiles/driver-profile.model';
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

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let adminUserId: string;
let branchOneId: string;
let branchTwoId: string;
let departmentOneId: string;
let departmentTwoId: string;
let jobTitleId: string;
let typeArmoredId: string;
let typeVanId: string;
let cashOperationId: string;
let atmOperationId: string;

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays: number): string => new Date(Date.now() + offsetDays * DAY).toISOString();

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

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

const mkUser = async (email: string, branchId: string | null = null): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  await userService.setPassword(String(user._id), PASSWORD, 'passwordReset');
  await userService.forceActivate(String(user._id));
  return String(user._id);
};

/**
 * A token WITHOUT spending a login: `POST /auth/login` is rate limited per IP and every request
 * in this file shares one, so a fixture that burns a login to assert a PERMISSION spends the
 * budget on the wrong thing. `buildAuthContext` resolves permissions live from the user's roles,
 * so the signed token proves nothing by itself and the authorization assertions are unchanged.
 */
const tokenFor = async (userId: string): Promise<string> =>
  authService.signAccessToken(userId, new Types.ObjectId().toString(), 0);

let nidCounter = 0;
let phoneCounter = 55_000_000;
const nextNid = (): string => `290010102${String(10_000 + nidCounter++).padStart(5, '0')}`;
const nextPhone = (): string => `011${String(phoneCounter++).padStart(8, '0')}`;

const mkEmployee = async (branchId: string): Promise<string> => {
  const res = await request(app)
    .post('/api/v1/hr/employees/direct')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      personal: {
        identity: { fullNameAr: 'سائق لوحة', nationalId: nextNid(), nationality: 'Egyptian' },
        contact: { primaryPhone: nextPhone() },
        experience: [],
        drivingLicenses: [],
        certifications: [],
        references: [],
      },
      employment: {
        jobTitleId,
        // Direct registration verifies the department belongs to the branch, so each branch
        // hires through its own.
        departmentId: branchId === branchOneId ? departmentOneId : departmentTwoId,
        branchId,
        employmentType: 'fullTime',
        probationMonths: 0,
        startDate: '2026-01-01T00:00:00.000Z',
      },
      entryStatus: 'active',
    });
  expect(res.status).toBe(201);
  return (res.body as { data: { id: string } }).data.id;
};

/**
 * One driver, classified by the `driverSpecialization` CATALOG — which is what «التخصص» is now.
 *
 * `specializationId: null` records a driver nobody has classified: they count in the total and in
 * neither split, which is the honest answer rather than a guess.
 */
const mkDriver = async (branchId: string, specializationId: string | null): Promise<string> => {
  const employeeId = await mkEmployee(branchId);
  const res = await request(app)
    .post('/api/v1/fleet/drivers')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      employeeId,
      licenseNumber: `DSH-LIC-${nidCounter}`,
      licenseExpiresAt: iso(400),
      specializationId,
    });
  expect(res.status).toBe(201);
  return employeeId;
};

/**
 * A driver carrying ONLY the retired enum — the state of every profile recorded before «التخصص»
 * became a catalog, and the one the compatibility shim exists for.
 *
 * Written straight to the collection because no endpoint accepts the enum any more, which is
 * exactly the point: this is a row the database already holds, not a shape the API still admits.
 */
const mkLegacyDriver = async (branchId: string, specialization: string): Promise<string> => {
  const employeeId = await mkDriver(branchId, null);
  await FleetDriverProfileModel.updateOne(
    { employeeId: new Types.ObjectId(employeeId) },
    { $set: { specialization } },
  );
  return employeeId;
};

/** The seeded specialization items, by their Arabic name — the seed is what the house starts with. */
const specializationId = async (ar: string): Promise<string> => {
  const res = await request(app)
    .get('/api/v1/fleet/catalog-items?kind=driverSpecialization&pageSize=100')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  const item = (res.body as { data: FleetCatalogItemDto[] }).data.find((i) => i.name.ar === ar);
  expect(item, `the seed carries «${ar}»`).toBeDefined();
  return (item as FleetCatalogItemDto).id;
};

let vehicleCounter = 700;
const mkVehicle = async (over: Record<string, unknown>): Promise<FleetVehicleDto> => {
  const n = vehicleCounter++;
  const res = await request(app)
    .post('/api/v1/fleet/vehicles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      code: `D${n}`,
      typeId: typeArmoredId,
      plateNumber: `د ش ${n}`,
      chassisNumber: `DCH-${n}`,
      motorNumber: `DMO-${n}`,
      joinedAt: '2025-01-01T00:00:00.000Z',
      licenseExpiresAt: iso(400),
      radio: { issi: `DISSI-${n}` },
      branchId: branchOneId,
      ...over,
    });
  expect(res.status).toBe(201);
  return data<FleetVehicleDto>(res);
};

const record = async (vehicleId: string, reading: number, dayOffset: number): Promise<void> => {
  const res = await request(app)
    .post('/api/v1/fleet/odometer')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ vehicleId, date: iso(dayOffset), reading });
  expect(res.status).toBe(201);
};

const mkCatalog = async (kind: string, ar: string, en: string): Promise<string> => {
  const res = await request(app)
    .post('/api/v1/fleet/catalog-items')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ kind, name: { ar, en } });
  expect(res.status).toBe(201);
  return data<FleetCatalogItemDto>(res).id;
};

/** The dashboard as one caller sees it. */
const dashboard = async (token: string): Promise<FleetDashboardDto> => {
  const res = await request(app)
    .get('/api/v1/fleet/dashboard')
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return data<FleetDashboardDto>(res);
};

/** The three vehicles whose kilometres the ranking assertions are about. */
let armoredCashOne: FleetVehicleDto; // branch one, 900 km
let armoredAtmOne: FleetVehicleDto; // branch one, 200 km
let vanCashOne: FleetVehicleDto; // branch one, no readings — 0 km, licence due
let armoredAtmTwo: FleetVehicleDto; // branch two, 1400 km

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions, ...fleetPermissions].map((p) => p.key),
  );
  adminUserId = await mkUser('admin@ecms.local');
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
  adminToken = await tokenFor(adminUserId);

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  branchOneId = await mkBranch('70', 'فرع القاهرة', 'Cairo');
  branchTwoId = await mkBranch('71', 'فرع الجيزة', 'Giza');

  const mkDepartment = async (code: string, branchId: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar: 'الحركة', en: 'Operations' }, branchId });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  departmentOneId = await mkDepartment('DSH-OPS-1', branchOneId);
  departmentTwoId = await mkDepartment('DSH-OPS-2', branchTwoId);
  const title = await request(app)
    .post('/api/v1/platform/job-titles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'DSH-DRV', name: { ar: 'سائق', en: 'Driver' }, jobGrade: 'G1' });
  expect(title.status).toBe(201);
  jobTitleId = (title.body as { data: { id: string } }).data.id;

  const armored = await request(app)
    .post('/api/v1/fleet/vehicle-types')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: { ar: 'مصفحة', en: 'Armored' }, maintenanceIntervalKm: 10_000 });
  expect(armored.status).toBe(201);
  typeArmoredId = data<FleetVehicleTypeDto>(armored).id;
  const van = await request(app)
    .post('/api/v1/fleet/vehicle-types')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: { ar: 'ميكروباص', en: 'Van' }, maintenanceIntervalKm: 8000 });
  expect(van.status).toBe(201);
  typeVanId = data<FleetVehicleTypeDto>(van).id;

  // The operations the «نقل أموال» / «ATM» counters are read from. Not seeded — the admin names
  // them, which is exactly why the service matches on the catalog's own name rather than an id.
  cashOperationId = await mkCatalog('operation', 'نقل أموال', 'Cash in transit');
  atmOperationId = await mkCatalog('operation', 'ATM', 'ATM');

  armoredCashOne = await mkVehicle({ operationId: cashOperationId });
  armoredAtmOne = await mkVehicle({ operationId: atmOperationId });
  vanCashOne = await mkVehicle({
    typeId: typeVanId,
    operationId: cashOperationId,
    licenseExpiresAt: iso(10),
  });
  armoredAtmTwo = await mkVehicle({ branchId: branchTwoId, operationId: atmOperationId });

  // Two readings per vehicle: the second closes the first's period, and the closed period's `km`
  // is what the ranking sums. `vanCashOne` gets none — a car that has driven nothing is the
  // whole point of «أقل ٥ سيارات» and must still appear.
  await record(armoredCashOne.id, 1000, -8);
  await record(armoredCashOne.id, 1900, -2);
  await record(armoredAtmOne.id, 500, -8);
  await record(armoredAtmOne.id, 700, -2);
  await record(armoredAtmTwo.id, 100, -8);
  await record(armoredAtmTwo.id, 1500, -2);

  // Drivers: two «نقل اموال» and one LEGACY «both» in branch one, one «ATM» in branch two. The
  // legacy row counts in each split and once in the total — the shim keeps the counters covering
  // the whole registry, not only the profiles that have been through the new form.
  const cashSpecialization = await specializationId('نقل اموال');
  const atmSpecialization = await specializationId('ATM');
  await mkDriver(branchOneId, cashSpecialization);
  await mkDriver(branchOneId, cashSpecialization);
  await mkLegacyDriver(branchOneId, 'both');
  await mkDriver(branchTwoId, atmSpecialization);
}, 240_000);

afterAll(async () => {
  await getCache().close();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('GET /fleet/dashboard — the fleet section', () => {
  it('counts active vehicles per type per branch, with the row total', async () => {
    const dto = await dashboard(adminToken);
    expect(dto.fleet).not.toBeNull();
    const rows = dto.fleet?.types ?? [];
    const armoredRow = rows.find((r) => r.typeId === typeArmoredId);
    const vanRow = rows.find((r) => r.typeId === typeVanId);

    expect(armoredRow?.counts[branchOneId]).toBe(2);
    expect(armoredRow?.counts[branchTwoId]).toBe(1);
    expect(armoredRow?.total).toBe(3);
    expect(vanRow?.counts[branchOneId]).toBe(1);
    expect(vanRow?.counts[branchTwoId]).toBeUndefined();
    expect(vanRow?.total).toBe(1);
    // Busiest type first — the screen reads top-down.
    expect(rows[0]?.typeId).toBe(typeArmoredId);
  });

  it('drops a vehicle out of the matrix when it leaves active service', async () => {
    const extra = await mkVehicle({ operationId: cashOperationId });
    const before = await dashboard(adminToken);
    expect(before.fleet?.types.find((r) => r.typeId === typeArmoredId)?.total).toBe(4);

    const res = await request(app)
      .post(`/api/v1/fleet/vehicles/${extra.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'outOfService', reason: 'اختبار اللوحة', version: extra.version });
    expect(res.status).toBe(200);

    const after = await dashboard(adminToken);
    expect(after.fleet?.types.find((r) => r.typeId === typeArmoredId)?.total).toBe(3);
    expect(after.fleet?.types.find((r) => r.typeId === typeArmoredId)?.counts[branchOneId]).toBe(2);
  });

  it('splits vehicles and drivers by operation and specialization, company row first', async () => {
    const dto = await dashboard(adminToken);
    const stats = dto.fleet?.stats ?? [];
    const company = stats[0];
    const one = stats.find((s) => s.branchId === branchOneId);
    const two = stats.find((s) => s.branchId === branchTwoId);

    expect(company?.branchId).toBeNull();
    expect(company?.vehicles).toBe(4);
    expect(company?.cashVehicles).toBe(2);
    expect(company?.atmVehicles).toBe(2);
    expect(company?.drivers).toBe(4);
    // The legacy «both» is counted in BOTH splits: 2 cash + 1 both = 3, 1 atm + 1 both = 2.
    expect(company?.cashDrivers).toBe(3);
    expect(company?.atmDrivers).toBe(2);

    expect(one?.vehicles).toBe(3);
    expect(one?.cashVehicles).toBe(2);
    expect(one?.atmVehicles).toBe(1);
    expect(one?.drivers).toBe(3);
    expect(one?.cashDrivers).toBe(3);
    expect(one?.atmDrivers).toBe(1);

    expect(two?.vehicles).toBe(1);
    expect(two?.atmVehicles).toBe(1);
    expect(two?.cashVehicles).toBe(0);
    expect(two?.drivers).toBe(1);
    expect(two?.atmDrivers).toBe(1);
    expect(two?.cashDrivers).toBe(0);
  });

  it('lists only the licences inside the horizon, soonest first', async () => {
    const dto = await dashboard(adminToken);
    const due = dto.fleet?.dueLicenses ?? [];
    expect(due.map((row) => row.code)).toContain(vanCashOne.code);
    expect(due.map((row) => row.code)).not.toContain(armoredCashOne.code);
    expect(due[0]?.branchId).toBe(branchOneId);
    const dates = due.map((row) => Date.parse(row.licenseExpiresAt));
    expect([...dates].sort((a, b) => a - b)).toEqual(dates);
  });

  it('names every branch the matrix has a column for', async () => {
    const dto = await dashboard(adminToken);
    const ids = dto.branches.map((b) => b.id);
    expect(ids).toContain(branchOneId);
    expect(ids).toContain(branchTwoId);
    expect(dto.branches.find((b) => b.id === branchOneId)?.name.ar).toBe('فرع القاهرة');
  });
});

describe('GET /fleet/dashboard — kilometres', () => {
  it('sums the closed periods per branch and ranks the cars at both ends', async () => {
    const dto = await dashboard(adminToken);
    const byBranch = new Map((dto.odometer?.byBranch ?? []).map((row) => [row.branchId, row.km]));
    expect(byBranch.get(branchOneId)).toBe(1100); // 900 + 200 + 0
    expect(byBranch.get(branchTwoId)).toBe(1400);
    // Highest branch first.
    expect(dto.odometer?.byBranch[0]?.branchId).toBe(branchTwoId);

    const top = dto.odometer?.top ?? [];
    expect(top[0]).toMatchObject({ code: armoredAtmTwo.code, km: 1400 });
    expect(top[1]).toMatchObject({ code: armoredCashOne.code, km: 900 });
    expect(top[2]).toMatchObject({ code: armoredAtmOne.code, km: 200 });

    // A car that has driven nothing is the answer to «أقل ٥ سيارات», not an omission.
    const bottom = dto.odometer?.bottom ?? [];
    expect(bottom[0]).toMatchObject({ code: vanCashOne.code, km: 0 });
    expect(bottom.map((row) => row.km)).toEqual([...bottom.map((row) => row.km)].sort((a, b) => a - b));
  });

  it('moves a car up the ranking when a new reading closes a period', async () => {
    await record(armoredAtmOne.id, 5700, 0); // closes 700 → +5000
    const dto = await dashboard(adminToken);
    const top = dto.odometer?.top ?? [];
    expect(top[0]).toMatchObject({ code: armoredAtmOne.code, km: 5200 });
    const byBranch = new Map((dto.odometer?.byBranch ?? []).map((row) => [row.branchId, row.km]));
    expect(byBranch.get(branchOneId)).toBe(6100);
  });
});

describe('GET /fleet/dashboard — today strips', () => {
  it('shows a visit checked in today with its workshop, work type and vehicle code', async () => {
    const workshopId = await mkCatalog('workshop', 'ورشة اللوحة', 'Dashboard shop');
    const workTypes = await request(app)
      .get('/api/v1/fleet/catalog-items')
      .query({ kind: 'workType', pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    const workTypeId = data<FleetCatalogItemDto[]>(workTypes).find((i) => i.name.ar === 'صيانة')?.id;
    expect(workTypeId).toBeDefined();
    const driverId = await mkEmployee(branchOneId);

    const before = await dashboard(adminToken);
    const beforeCount = before.maintenance?.monthCount ?? 0;

    const visit = await request(app)
      .post('/api/v1/fleet/maintenance')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vehicleId: vanCashOne.id,
        inDate: iso(0),
        workshopId,
        workTypeId,
        odometerAtService: 4000,
        driverInEmployeeId: driverId,
      });
    expect(visit.status).toBe(201);

    const after = await dashboard(adminToken);
    const row = (after.maintenance?.today ?? []).find((v) => v.code === vanCashOne.code);
    expect(row).toBeDefined();
    expect(row?.workshop?.ar).toBe('ورشة اللوحة');
    expect(row?.workType?.ar).toBe('صيانة');
    expect(after.maintenance?.monthCount).toBe(beforeCount + 1);
  });

  it('leaves yesterday out of today while keeping it in the month', async () => {
    const workshopId = await mkCatalog('workshop', 'ورشة الأمس', 'Yesterday shop');
    const workTypes = await request(app)
      .get('/api/v1/fleet/catalog-items')
      .query({ kind: 'workType', pageSize: 50 })
      .set('Authorization', `Bearer ${adminToken}`);
    const workTypeId = data<FleetCatalogItemDto[]>(workTypes).find((i) => i.name.ar === 'صيانة')?.id;
    const driverId = await mkEmployee(branchOneId);
    const yesterdayCar = await mkVehicle({ operationId: cashOperationId });

    const before = await dashboard(adminToken);
    const beforeMonth = before.maintenance?.monthCount ?? 0;

    const visit = await request(app)
      .post('/api/v1/fleet/maintenance')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vehicleId: yesterdayCar.id,
        inDate: iso(-1),
        workshopId,
        workTypeId,
        odometerAtService: 10,
        driverInEmployeeId: driverId,
      });
    expect(visit.status).toBe(201);

    const after = await dashboard(adminToken);
    expect((after.maintenance?.today ?? []).map((v) => v.code)).not.toContain(yesterdayCar.code);
    // Yesterday is only inside this month when the month did not start today.
    const sameMonth = new Date(Date.now() - DAY).getUTCMonth() === new Date().getUTCMonth();
    expect(after.maintenance?.monthCount).toBe(beforeMonth + (sameMonth ? 1 : 0));
  });

  it('shows an accident recorded today and counts it in the month', async () => {
    const before = await dashboard(adminToken);
    const beforeCount = before.accidents?.monthCount ?? 0;

    const accident = await request(app)
      .post('/api/v1/fleet/accidents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vehicleId: armoredCashOne.id,
        occurredAt: iso(0),
        culprit: 'طرف ثالث',
        statement: 'اصطدام بسيط في محضر اختبار اللوحة',
        companyCost: 1500,
        amountCollected: 0,
        paidAmount: 0,
      });
    expect(accident.status).toBe(201);

    const after = await dashboard(adminToken);
    const row = (after.accidents?.today ?? []).find((a) => a.code === armoredCashOne.code);
    expect(row).toBeDefined();
    expect(row?.culprit).toBe('طرف ثالث');
    expect(row?.status).toBe('open');
    expect(after.accidents?.monthCount).toBe(beforeCount + 1);
  });
});

describe('GET /fleet/dashboard — permissions and scope', () => {
  it('gives a workshop-only reader the maintenance section and nothing else', async () => {
    const role = await rbacService.createRole(
      { name: { en: 'Workshop clerk', ar: 'كاتب ورشة' }, permissionKeys: ['fleetMaintenance.view'] },
      adminUserId,
    );
    const userId = await mkUser('clerk@ecms.local');
    await rbacService.ensureAssignment(userId, String(role._id), 'organization');

    const dto = await dashboard(await tokenFor(userId));
    expect(dto.maintenance).not.toBeNull();
    expect(dto.fleet).toBeNull();
    expect(dto.odometer).toBeNull();
    expect(dto.accidents).toBeNull();
  });

  it('turns the door away entirely when the caller holds no fleet read at all', async () => {
    const userId = await mkUser('outsider@ecms.local');
    const res = await request(app)
      .get('/api/v1/fleet/dashboard')
      .set('Authorization', `Bearer ${await tokenFor(userId)}`);
    expect(res.status).toBe(403);
  });

  it('shows a branch-scoped reader their own branch and no other', async () => {
    const role = await rbacService.createRole(
      {
        name: { en: 'Branch dispatcher', ar: 'مشرف فرع' },
        permissionKeys: ['fleetVehicle.view', 'fleetOdometer.view'],
      },
      adminUserId,
    );
    const userId = await mkUser('dispatcher-two@ecms.local', branchTwoId);
    await rbacService.ensureAssignment(userId, String(role._id), 'branch');

    const dto = await dashboard(await tokenFor(userId));
    const armoredRow = dto.fleet?.types.find((r) => r.typeId === typeArmoredId);
    expect(armoredRow?.counts[branchTwoId]).toBe(1);
    expect(armoredRow?.counts[branchOneId]).toBeUndefined();
    expect(armoredRow?.total).toBe(1);
    // The van lives in branch one only, so this reader has no van row at all.
    expect(dto.fleet?.types.find((r) => r.typeId === typeVanId)).toBeUndefined();

    const company = dto.fleet?.stats[0];
    expect(company?.vehicles).toBe(1);
    expect(dto.fleet?.stats.find((s) => s.branchId === branchOneId)?.vehicles).toBe(0);

    // Their kilometres are their own branch's, and only their cars are ranked.
    const byBranch = new Map((dto.odometer?.byBranch ?? []).map((row) => [row.branchId, row.km]));
    expect(byBranch.get(branchTwoId)).toBe(1400);
    expect(byBranch.get(branchOneId)).toBe(0);
    expect((dto.odometer?.top ?? []).map((row) => row.code)).toEqual([armoredAtmTwo.code]);
  });
});
