// Q-01 end to end: one licence rule on the roster, a FLAG until the owner switches the refusal on.
//
// «one rule in both places … before switching the roster rule on, give me a list to verify». The
// board marks an expired licence — a driver's and a vehicle's — from the same predicate either way;
// what `fleet.roster.refuseExpiredLicence` decides is only whether PLANNING refuses them. Off (the
// default) nothing a dispatcher could do before changes. On, both are refused with the reason
// named. A licence nobody dated never blocks, in either mode.
//
// Every date is relative to the real clock: planning refuses the past (`PAST_DATE`), so the day
// under test is always ahead of today, and the expired licence expires ON that day (Q-02).
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  FleetSettingKeys,
  SettingKeys,
  addDaysYmd,
  platformPermissions,
  type FleetDriverProfileDto,
  type FleetRosterDayDto,
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
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let settingsCtx: AuthContext;
let branchId: string;
let departmentId: string;
let jobTitleId: string;
let typeId: string;
let counter = 700;

/** The day under test — ahead of today, so planning accepts it — and the day after it. */
const todayUtc = new Date().toISOString().slice(0, 10);
const PLAN_DAY = addDaysYmd(todayUtc, 20);
const DAY_AFTER = addDaysYmd(PLAN_DAY, 1);
const at = (ymd: string): string => `${ymd}T00:00:00.000Z`;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-fleet-roster-licence-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

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

/** A driver: an HR employee in a seat whose job title requires a driving test. */
const mkDriver = async (fullNameAr: string): Promise<string> => {
  counter += 1;
  const res = await request(app)
    .post('/api/v1/hr/employees/direct')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      personal: {
        identity: {
          fullNameAr,
          nationalId: `2900101${String(400_000 + counter).padStart(7, '0')}`,
          nationality: 'Egyptian',
        },
        contact: { primaryPhone: `010${String(50_000_000 + counter).padStart(8, '0')}` },
        experience: [],
        drivingLicenses: [],
        certifications: [],
        references: [],
      },
      employment: {
        jobTitleId,
        departmentId,
        branchId,
        employmentType: 'fullTime',
        probationMonths: 0,
        startDate: '2026-07-01T00:00:00.000Z',
      },
      entryStatus: 'active',
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body as { data: { id: string } }).data.id;
};

const mkProfile = async (
  employeeId: string,
  licenseExpiresAt: string | null,
): Promise<FleetDriverProfileDto> => {
  const res = await request(app)
    .post('/api/v1/fleet/drivers')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      employeeId,
      licenseNumber: `LIC-R-${counter}`,
      ...(licenseExpiresAt === null ? {} : { licenseExpiresAt }),
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<FleetDriverProfileDto>(res);
};

const mkVehicle = async (licenseExpiresAt: string): Promise<FleetVehicleDto> => {
  counter += 1;
  const res = await request(app)
    .post('/api/v1/fleet/vehicles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      code: `R${counter}`,
      typeId,
      plateNumber: `ر ل ${counter}`,
      chassisNumber: `CH-R-${counter}`,
      motorNumber: `MO-R-${counter}`,
      joinedAt: '2024-01-01T00:00:00.000Z',
      licenseExpiresAt,
      radio: { issi: `ISSI-R-${counter}` },
      branchId,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<FleetVehicleDto>(res);
};

const plan = (vehicleId: string, driver1EmployeeId: string | null, date = PLAN_DAY) =>
  request(app)
    .post('/api/v1/fleet/roster')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ date, rows: [{ vehicleId, driver1EmployeeId, driver2EmployeeId: null }] });

const board = async (date = PLAN_DAY): Promise<FleetRosterDayDto> => {
  const res = await request(app)
    .get('/api/v1/fleet/roster')
    .query({ date })
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  return data<FleetRosterDayDto>(res);
};

const refuseExpired = (value: boolean): Promise<void> =>
  settingsService.set(settingsCtx, {
    key: FleetSettingKeys.RosterRefuseExpiredLicence,
    scope: 'organization',
    value,
  });

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions, ...fleetPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('roster-licence@ecms.local');
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');
  settingsCtx = {
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
  await settingsService.set(settingsCtx, {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'roster-licence@ecms.local', password: PASSWORD });
  expect(login.status).toBe(200);
  adminToken = (login.body as { data: { accessToken: string } }).data.accessToken;

  const branch = await request(app)
    .post('/api/v1/platform/branches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: '95', name: { ar: 'فرع الرخص', en: 'Licence branch' } });
  expect(branch.status).toBe(201);
  branchId = data<{ id: string }>(branch).id;
  const dept = await request(app)
    .post('/api/v1/platform/departments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'FL-LIC', name: { ar: 'إدارة الحركة', en: 'Fleet Operations' }, branchId });
  expect(dept.status).toBe(201);
  departmentId = data<{ id: string }>(dept).id;
  const title = await request(app)
    .post('/api/v1/platform/job-titles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      code: 'FL-LIC-DRV',
      name: { ar: 'سائق', en: 'Driver' },
      jobGrade: 'G1',
      requiresDrivingTest: true,
    });
  expect(title.status).toBe(201);
  jobTitleId = data<{ id: string }>(title).id;
  const type = await request(app)
    .post('/api/v1/fleet/vehicle-types')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: { ar: 'نوع الرخص', en: 'Licence type' }, maintenanceIntervalKm: 10_000 });
  expect(type.status).toBe(201);
  typeId = data<FleetVehicleTypeDto>(type).id;
}, 240_000);

afterAll(async () => {
  await getCache().close();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await refuseExpired(false);
});

const errorText = (res: request.Response): string => JSON.stringify(res.body);

describe('setting OFF (the default) — the roster FLAGS, planning is unchanged', () => {
  it('is off unless somebody switches it on', async () => {
    expect(
      await settingsService.resolve<boolean>(FleetSettingKeys.RosterRefuseExpiredLicence, {
        userId: null,
        branchId: null,
      }),
    ).toBe(false);
    expect((await board()).licenceRule).toBe('flag');
  });

  it('accepts a driver and a vehicle whose licences expire ON the planned day, and flags both', async () => {
    const driver = await mkDriver('سائق رخصته تنتهي اليوم');
    await mkProfile(driver, at(PLAN_DAY));
    const car = await mkVehicle(at(PLAN_DAY));

    const saved = await plan(car.id, driver);
    expect(saved.status, errorText(saved)).toBe(200);

    const day = await board();
    const row = day.rows.find((r) => r.vehicleId === car.id);
    expect(row?.driver1EmployeeId, 'the plan was stored as sent').toBe(driver);
    expect(row?.licenceExpired, 'the car is flagged').toBe(true);
    expect(row?.assignable, 'and not counted ready').toBe(false);
    expect(
      day.availableDrivers.find((d) => d.employeeId === driver)?.licence,
      'the driver is flagged, and still available',
    ).toBe('expired');
  });

  it('reads the day before the expiry as valid', async () => {
    const driver = await mkDriver('سائق رخصته سارية حتى الغد');
    await mkProfile(driver, at(DAY_AFTER));
    const car = await mkVehicle(at(DAY_AFTER));
    const day = await board();
    expect(day.rows.find((r) => r.vehicleId === car.id)).toMatchObject({
      licenceExpired: false,
      assignable: true,
    });
    expect(day.availableDrivers.find((d) => d.employeeId === driver)?.licence).toBe('valid');
  });
});

describe('setting ON — planning refuses both, with the reason named', () => {
  it('refuses a vehicle whose licence expired on the planned day', async () => {
    const driver = await mkDriver('سائق سليم');
    await mkProfile(driver, at(DAY_AFTER));
    const car = await mkVehicle(at(PLAN_DAY));
    await refuseExpired(true);

    const refused = await plan(car.id, driver);
    expect(refused.status, errorText(refused)).toBe(409);
    expect(errorText(refused)).toContain('licenceExpired');
    expect(errorText(refused)).toContain(car.code);
    expect(
      (await board()).rows.find((r) => r.vehicleId === car.id)?.driver1EmployeeId ?? null,
      'nothing was written',
    ).toBeNull();
  });

  it('refuses a driver whose licence expired, through the FR-6 refusal', async () => {
    const driver = await mkDriver('سائق رخصته منتهية');
    await mkProfile(driver, at(PLAN_DAY));
    const car = await mkVehicle(at(DAY_AFTER));
    await refuseExpired(true);

    const refused = await plan(car.id, driver);
    expect(refused.status, errorText(refused)).toBe(409);
    expect(errorText(refused)).toContain('(licenceExpired)');
    expect(errorText(refused)).toContain('FR-6');

    const day = await board();
    expect(day.licenceRule).toBe('refuse');
    expect(day.unavailableDrivers).toContainEqual({ employeeId: driver, reason: 'licenceExpired' });
    expect(day.availableDrivers.map((d) => d.employeeId)).not.toContain(driver);
  });

  it('still lets the dispatcher CLEAR an expired car’s row', async () => {
    const driver = await mkDriver('سائق سيُرفع');
    await mkProfile(driver, at(DAY_AFTER));
    const car = await mkVehicle(at(PLAN_DAY));
    expect((await plan(car.id, driver)).status, 'planned while the rule was off').toBe(200);

    await refuseExpired(true);
    const cleared = await plan(car.id, null);
    expect(cleared.status, errorText(cleared)).toBe(200);
  });

  it('answers an absence before an expired licence — one reason per driver', async () => {
    const driver = await mkDriver('سائق غائب ورخصته منتهية');
    await mkProfile(driver, at(PLAN_DAY));
    const absence = await request(app)
      .post('/api/v1/fleet/availability')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ employeeId: driver, from: PLAN_DAY, to: PLAN_DAY, reason: 'مأمورية' });
    expect(absence.status, errorText(absence)).toBe(201);
    const car = await mkVehicle(at(DAY_AFTER));
    await refuseExpired(true);

    const refused = await plan(car.id, driver);
    expect(refused.status).toBe(409);
    expect(errorText(refused)).toContain('(fleetUnavailability)');
    expect((await board()).unavailableDrivers).toContainEqual({
      employeeId: driver,
      reason: 'fleetUnavailability',
    });
  });
});

describe('a null date never blocks', () => {
  it('plans a driver whose profile has no licence date, and one with no profile at all', async () => {
    await refuseExpired(true);
    const undated = await mkDriver('سائق بلا تاريخ رخصة');
    await mkProfile(undated, null);
    const unrecorded = await mkDriver('سائق بلا ملف');
    const carA = await mkVehicle(at(DAY_AFTER));
    const carB = await mkVehicle(at(DAY_AFTER));

    expect((await plan(carA.id, undated)).status).toBe(200);
    expect((await plan(carB.id, unrecorded)).status).toBe(200);

    const day = await board();
    expect(day.availableDrivers.find((d) => d.employeeId === undated)?.licence).toBe('notRecorded');
    expect(day.availableDrivers.find((d) => d.employeeId === unrecorded)?.licence).toBe(
      'noProfile',
    );
  });

  it('never invents an expiry for an id that is not a person', async () => {
    // The seam answers notADriver before it reads anything — a stray id cannot reach the profile
    // collection, so it cannot be refused for a licence it does not have.
    const stray = new Types.ObjectId().toString();
    const car = await mkVehicle(at(DAY_AFTER));
    await refuseExpired(true);
    const refused = await plan(car.id, stray);
    expect(refused.status).toBe(409);
    expect(errorText(refused)).toContain('(notADriver)');
  });
});
