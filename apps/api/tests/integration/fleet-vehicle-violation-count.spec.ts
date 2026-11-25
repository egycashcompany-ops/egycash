// «المخالفات» on the car record counts exactly what its link opens — against a real mongo.
//
// Owner, 2026-11-22 («أيوه صلحها»): the car record's «المخالفات» row opens
// `/fleet/violations?codes=<code>&dcodes=<code>` — both halves of the violations screen on the car's
// CODE. The company half draws `GET /fleet/violations/rollup?vehicleCodes=<code>`; the drivers half
// lists `GET /fleet/violations?kind=driver&vehicleCodes=<code>`. Both match the registry car AND the
// old book's rows kept under the code with no car attached (`byVehicleOrBookCode`).
//
// The record used to count the LIST by the car's id — documents, not fines («×3» is one statement
// document and three fines), and none of the old book's rows. It now sums the rollup's
// `totalCount` (statement rows by their count, a driver's fine one). This pins the server's side of
// that arithmetic: the rollup's sum equals what the two halves show, and differs from the old
// figure on a car with a multi-count statement and an old-book history.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  platformPermissions,
  type FleetVehicleDto,
  type FleetVehicleTypeDto,
  type FleetViolationDto,
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
import { type AuthContext } from '../../src/shared/types';
import { FleetViolationModel } from '../../src/modules/fleet/violations/violation.model';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-fleet-vehicle-violation-count-${Date.now()}`;
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
const totalOf = (res: request.Response): number => {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as { meta: { totalItems: number } }).meta.totalItems;
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
      plateNumber: `م خ ${counter}`,
      chassisNumber: `VCC-${counter}`,
      motorNumber: `VCM-${counter}`,
      joinedAt: '2025-01-01T00:00:00.000Z',
      licenseExpiresAt: '2028-01-01T00:00:00.000Z',
      radio: { issi: `VCISSI-${counter}` },
      branchId,
    }),
    201,
  );
};

const VIOLATION_TYPE = new Types.ObjectId();
const STAMP = new Date('2026-10-01T09:00:00.000Z');

/** One stored violation row, every base field present — the shape the collection holds. */
const violation = (row: Record<string, unknown>) => ({
  _id: new Types.ObjectId(),
  vehicleId: null,
  vehicleCode: null,
  violationTypeId: VIOLATION_TYPE,
  amount: 100,
  year: null,
  count: null,
  unitValue: null,
  date: null,
  filedYear: null,
  homeVehicleId: null,
  driverEmployeeId: null,
  driverName: null,
  collected: false,
  fromOldBook: false,
  isDeleted: false,
  deletedAt: null,
  deletedBy: null,
  schemaVersion: 1,
  createdBy: null,
  updatedBy: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  __v: 0,
  ...row,
});
/** A statement row — «×count» fines of one kind for a (car, year). */
const statement = (row: Record<string, unknown>) =>
  violation({ kind: 'vehicle', unitValue: 100, ...row });
/** A driver's fine — one fine, on a day. */
const driverFine = (row: Record<string, unknown>) =>
  violation({ kind: 'driver', driverName: 'سائق', ...row });

let car: FleetVehicleDto;

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();
  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions, ...fleetPermissions].map((p) => p.key),
  );
  const adminUserId = await mkUser('vehicle-violation-count@ecms.local');
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
    await post('/platform/branches', { code: '94', name: { ar: 'فرع المخالفات', en: 'Fines' } }),
    201,
  ).id;
  typeId = ok<FleetVehicleTypeDto>(
    await post('/fleet/vehicle-types', {
      name: { ar: 'نوع المخالفات', en: 'Fines type' },
      maintenanceIntervalKm: 10_000,
    }),
    201,
  ).id;
  car = await mkVehicle('200');
  const neighbour = await mkVehicle('201');
  const carId = new Types.ObjectId(car.id);

  await FleetViolationModel.collection.insertMany([
    // Car 200 in the registry: a statement «×3» in 2025 and one driver's fine in 2026.
    statement({ vehicleId: carId, year: 2025, count: 3, amount: 300 }),
    driverFine({ vehicleId: carId, date: new Date('2026-03-10T00:00:00.000Z'), amount: 400 }),
    // The old book, under the code «200» with no car attached: a statement «×2» and a fine.
    statement({ vehicleCode: '200', year: 2024, count: 2, amount: 200, fromOldBook: true }),
    driverFine({
      vehicleCode: '200',
      date: new Date('2024-06-01T00:00:00.000Z'),
      amount: 250,
      fromOldBook: true,
    }),
    // Not car 200's: a deleted row on it, the neighbour's statement, and old-book rows under codes
    // that merely CONTAIN «200» — a code is matched whole.
    statement({
      vehicleId: carId,
      year: 2026,
      count: 9,
      amount: 900,
      isDeleted: true,
      deletedAt: STAMP,
    }),
    statement({ vehicleId: new Types.ObjectId(neighbour.id), year: 2025, count: 4, amount: 400 }),
    statement({ vehicleCode: '2000', year: 2025, count: 5, amount: 500, fromOldBook: true }),
    driverFine({
      vehicleCode: '20',
      date: new Date('2025-01-02T00:00:00.000Z'),
      fromOldBook: true,
    }),
  ]);
}, 120_000);

afterAll(async () => {
  await getCache().close();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

/** What the company half draws for the car's code — the rollup the record now sums. */
const rollupOf = async (code: string): Promise<FleetViolationRollupDto[]> =>
  ok<FleetViolationRollupDto[]>(await get('/fleet/violations/rollup', { vehicleCodes: code }));

describe('the car record’s «المخالفات» = what `?codes=200&dcodes=200` opens', () => {
  it('the rollup on the code holds the car’s lines AND the old book’s — and nothing else', async () => {
    const rollup = await rollupOf('200');
    expect(
      rollup.map((row) => [row.vehicleId, row.code, row.year, row.totalCount]).sort(),
      'one line per (car, year); the old book’s on no car',
    ).toEqual(
      [
        [car.id, '200', 2026, 1],
        [car.id, '200', 2025, 3],
        [null, '200', 2024, 3],
      ].sort(),
    );
  });

  it('sums to 7 — the figure the record shows', async () => {
    const rollup = await rollupOf('200');
    expect(rollup.reduce((sum, row) => sum + row.totalCount, 0)).toBe(7);
  });

  it('equals the two halves: the statements’ «×N» and the drivers half’s list', async () => {
    const rollup = await rollupOf('200');
    const statements = rollup.reduce((sum, row) => sum + row.vehicleCount, 0);
    const drivers = totalOf(
      await get('/fleet/violations', { kind: 'driver', vehicleCodes: '200', pageSize: 1 }),
    );
    expect(statements, 'the company half: «×3» + the old book’s «×2»').toBe(5);
    expect(drivers, 'the drivers half: the car’s fine + the old book’s').toBe(2);
    expect(statements + drivers).toBe(7);
    // …and the rollup's own drivers' figure is the drivers half's badge.
    expect(rollup.reduce((sum, row) => sum + row.driverCount, 0)).toBe(drivers);
  });

  it('the drivers half lists exactly the car’s fines, the old book’s included', async () => {
    const rows = ok<FleetViolationDto[]>(
      await get('/fleet/violations', { kind: 'driver', vehicleCodes: '200', pageSize: 50 }),
    );
    expect(rows.map((row) => row.amount).sort((a, b) => a - b)).toEqual([250, 400]);
  });

  it('the old figure — the list by the car id — counted 2 documents, not 7 fines', async () => {
    // What the record read before: `GET /fleet/violations?vehicleId=<id>` → `totalItems`. It
    // counts the «×3» statement as one and misses both of the old book's rows.
    expect(
      totalOf(await get('/fleet/violations', { vehicleId: car.id, page: 1, pageSize: 1 })),
    ).toBe(2);
  });
});
