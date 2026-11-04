// «كورولا 1» as a filter, against a real database — the owner's report, end to end.
//
// «لما باجى اعمل فلتر على اى عربيه من اللى بالعربى دى مش بيجيب العربيه و بيسرش اكن الاسم بتاع
// العربيه حاجه والرقم اللى جمبها حاجه تانيه». A code holding a space — «كورولا 1», «MG 2», «فورتشنر 2»
// — was split by `vehicleCodes` into two codes nobody has, and a stored code with a stray space
// («فورتشنر 2 » in the go-live sheet) never matched exactly even when it was not.
//
//   1. the registry (`GET /fleet/vehicles?vehicleCodes=`): the word and its number are one car, any
//      whitespace and Latin case aside, exact otherwise; two numbers are still two cars;
//   2. the odometer register (`GET /fleet/odometer?vehicleCodes=`): the same codes find the same
//      cars' readings — and a row kept from the old book, matched by the code the book wrote;
//   3. the dashboard's vehicle set (`idsByCodes`) answers the same.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  platformPermissions,
  type FleetOdometerLogDto,
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
import { fleetVehicleRepository } from '../../src/modules/fleet/vehicles/vehicle.repository';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-fleet-vehicle-codes-spaces-${Date.now()}`;
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

let branchId: string;
let typeId: string;
let counter = 0;
const mkVehicle = async (code: string): Promise<FleetVehicleDto> => {
  counter += 1;
  return ok<FleetVehicleDto>(
    await post('/fleet/vehicles', {
      code,
      typeId,
      plateNumber: `ك ر ${counter}`,
      chassisNumber: `SPC-${counter}`,
      motorNumber: `SPM-${counter}`,
      joinedAt: '2025-01-01T00:00:00.000Z',
      licenseExpiresAt: '2028-01-01T00:00:00.000Z',
      radio: { issi: `SPISSI-${counter}` },
      branchId,
    }),
    201,
  );
};

/**
 * Store a code EXACTLY as written, past the schema's `trim` — the shape the go-live sheet left
 * behind («فورتشنر 2 ») and a double space a clerk can leave inside one.
 */
const storeCodeAsIs = async (car: FleetVehicleDto, code: string): Promise<void> => {
  await FleetVehicleModel.collection.updateOne(
    { _id: new Types.ObjectId(car.id) },
    { $set: { code } },
  );
};

const cars: Record<string, FleetVehicleDto> = {};
const idOf = (key: string): string => (cars[key] as FleetVehicleDto).id;

/** The registry's answer for `vehicleCodes=<text>`, as the cars' ids. */
const registry = async (vehicleCodes: string): Promise<string[]> =>
  ok<FleetVehicleDto[]>(await get('/fleet/vehicles', { vehicleCodes, pageSize: 100 }))
    .map((vehicle) => vehicle.id)
    .sort();
/** The odometer register's answer for `vehicleCodes=<text>`. */
const odometer = async (vehicleCodes: string): Promise<FleetOdometerLogDto[]> =>
  ok<FleetOdometerLogDto[]>(await get('/fleet/odometer', { vehicleCodes, pageSize: 100 }));
const ids = (...keys: string[]): string[] => keys.map(idOf).sort();

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();
  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions, ...fleetPermissions].map((p) => p.key),
  );
  const adminUserId = await mkUser('vehicle-codes-spaces@ecms.local');
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

  branchId = ok<{ id: string }>(
    await post('/platform/branches', { code: '93', name: { ar: 'فرع الأكواد', en: 'Codes' } }),
    201,
  ).id;
  typeId = ok<FleetVehicleTypeDto>(
    await post('/fleet/vehicle-types', {
      name: { ar: 'تويوتا الأكواد', en: 'Codes type' },
      maintenanceIntervalKm: 10_000,
    }),
    201,
  ).id;

  // The registry's real shapes: a model's name and the number beside it, a Latin one, numbers.
  for (const code of ['كورولا 1', 'كورولا 2', 'كورولا 10', 'MG 2', 'كوستر 1', 'فورتشنر 2']) {
    cars[code] = await mkVehicle(code);
  }
  for (const code of ['150', '151', 'كولراى']) cars[code] = await mkVehicle(code);
  // Stored past the schema's trim: a trailing space and a double space.
  await storeCodeAsIs(cars['فورتشنر 2'] as FleetVehicleDto, 'فورتشنر 2 ');
  await storeCodeAsIs(cars['كوستر 1'] as FleetVehicleDto, 'كوستر  1');

  // One reading per car, so each has a row on the register.
  let reading = 10_000;
  for (const key of Object.keys(cars)) {
    reading += 1_000;
    ok(await post('/fleet/odometer', { vehicleId: idOf(key), date: '2026-10-01', reading }), 201);
  }
  // A row kept from the old book for a car the registry never had, under the code the book wrote.
  await FleetOdometerLogModel.collection.insertOne({
    isDeleted: false,
    schemaVersion: 1,
    createdBy: null,
    updatedBy: null,
    vehicleId: null,
    vehicleCode: 'MG 3 ',
    date: new Date('2026-09-01T00:00:00.000Z'),
    outReading: 5_000,
    inReading: null,
    driver1EmployeeId: null,
    driver2EmployeeId: null,
    driver1Name: null,
    driver2Name: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}, 120_000);

afterAll(async () => {
  await getCache().close();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('the registry — `GET /fleet/vehicles?vehicleCodes=`', () => {
  it('reads «كورولا 1» as ONE car — not «كورولا» and «1»', async () => {
    expect(await registry('كورولا 1')).toEqual(ids('كورولا 1'));
    expect(await registry('كورولا 2')).toEqual(ids('كورولا 2'));
  });

  it('is exact: «كورولا 1» is not «كورولا 10», and «كورولا» alone names no car', async () => {
    expect(await registry('كورولا 10')).toEqual(ids('كورولا 10'));
    expect(await registry('كورولا')).toEqual([]);
  });

  it('reads «MG 2» whole, and «mg 2» as the same car', async () => {
    expect(await registry('MG 2')).toEqual(ids('MG 2'));
    expect(await registry('mg 2')).toEqual(ids('MG 2'));
  });

  it('finds a stored «فورتشنر 2 » and «كوستر  1» by their codes as written today', async () => {
    expect(await registry('فورتشنر 2')).toEqual(ids('فورتشنر 2'));
    expect(await registry('كوستر 1')).toEqual(ids('كوستر 1'));
    expect(await registry(' كوستر   1 ')).toEqual(ids('كوستر 1'));
  });

  it('still reads two NUMBERS as two cars, and a list of codes as all of them', async () => {
    expect(await registry('150 151')).toEqual(ids('150', '151'));
    expect(await registry('كورولا 1, كورولا 2')).toEqual(ids('كورولا 1', 'كورولا 2'));
    expect(await registry('كورولا 1 - MG 2 - 150')).toEqual(ids('كورولا 1', 'MG 2', '150'));
    expect(await registry('كولراى')).toEqual(ids('كولراى'));
  });

  it('answers «no such car» for a code holding a NUL byte — not a 500 out of the driver', async () => {
    // BSON refuses a regex whose source holds a null byte; the pattern spells it `\x00` instead.
    for (const path of ['/fleet/vehicles', '/fleet/odometer']) {
      const res = await get(path, { vehicleCodes: 'a\u0000b', pageSize: 100 });
      expect(res.status, `${path} ${JSON.stringify(res.body)}`).toBe(200);
      expect(data<unknown[]>(res)).toEqual([]);
    }
    expect(await fleetVehicleRepository.idsByCodes(['\u0000'])).toEqual([]);
  });

  it('the dashboard vehicle set resolves the same codes to the same cars', async () => {
    expect((await fleetVehicleRepository.idsByCodes(['فورتشنر 2', 'mg 2'])).sort()).toEqual(
      ids('فورتشنر 2', 'MG 2'),
    );
  });
});

describe('the odometer register — `GET /fleet/odometer?vehicleCodes=`', () => {
  const carsOf = (rows: readonly FleetOdometerLogDto[]): (string | null)[] =>
    [...new Set(rows.map((row) => row.vehicleId))].sort();

  it('finds the readings of «كورولا 1», «MG 2» and «mg 2» — one car each', async () => {
    expect(carsOf(await odometer('كورولا 1'))).toEqual(ids('كورولا 1'));
    expect(carsOf(await odometer('MG 2'))).toEqual(ids('MG 2'));
    expect(carsOf(await odometer('mg 2'))).toEqual(ids('MG 2'));
  });

  it('finds a stored «فورتشنر 2 » by «فورتشنر 2»', async () => {
    expect(carsOf(await odometer('فورتشنر 2'))).toEqual(ids('فورتشنر 2'));
  });

  it('still reads «150 151» as two cars', async () => {
    expect(carsOf(await odometer('150 151'))).toEqual(ids('150', '151'));
  });

  it('finds the old book’s «MG 3 » row by «mg 3», as the book wrote it', async () => {
    const rows = await odometer('mg 3');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.vehicleId).toBeNull();
    expect(rows[0]?.vehicleCode?.trim()).toBe('MG 3');
  });
});
