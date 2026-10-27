// The world «عقود توريد السيارات»'s integration specs run in: a booted platform on a real mongo,
// a super user, a viewer, a creator, a platform file reader with no contract grant, and three
// makes (two active, one retired). Shared by `fleet-vehicle-contracts.spec.ts` and
// `fleet-vehicle-contract-files.spec.ts`.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { expect } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import { platformPermissions, type FleetVehicleContractDto } from '@ecms/contracts';
import { bootPlatform } from '../../../src/platform/kernel/bootstrap';
import { buildApp } from '../../../src/app';
import { moduleManifests } from '../../../src/modules';
import { fleetPermissions } from '../../../src/modules/fleet/fleet.module';
import { rbacService } from '../../../src/platform/rbac';
import { authService } from '../../../src/platform/auth';
import { userService } from '../../../src/platform/users';
import { getCache } from '../../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../../src/infrastructure/database/mongo';
import { FleetVehicleTypeModel } from '../../../src/modules/fleet/vehicle-types/vehicle-type.model';

export const URL_ = '/api/v1/fleet/vehicle-contracts';
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
export const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export interface VehicleContractWorld {
  app: Express;
  admin: string;
  adminId: string;
  /** fleetVehicleContract.view only. */
  viewer: string;
  /** view + create. */
  creator: string;
  /** The platform's file.view, and no contract grant. */
  fileReader: string;
  typeA: string;
  typeB: string;
  /** A retired make. */
  typeOff: string;
}

let replSet: MongoMemoryReplSet | null = null;
let world: VehicleContractWorld | null = null;
const theWorld = (): VehicleContractWorld => {
  if (world === null) throw new Error('bootVehicleContracts() has not run');
  return world;
};

let emailNo = 0;
const userWith = async (keys: readonly string[]): Promise<{ id: string; token: string }> => {
  emailNo += 1;
  const { user } = await userService.create(
    {
      email: `vc-${emailNo}@ecms.local`,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  const id = String(user._id);
  await userService.forceActivate(id);
  const role = await rbacService.createRole(
    { name: { en: `vc role ${emailNo}`, ar: `دور ${emailNo}` }, permissionKeys: [...keys] },
    new Types.ObjectId().toString(),
  );
  await rbacService.ensureAssignment(id, String(role._id), 'organization');
  // Signed directly: logins are rate limited, and permissions are resolved live per request.
  return { id, token: await authService.signAccessToken(id, new Types.ObjectId().toString(), 0) };
};

export const makeType = async (ar: string, isActive = true): Promise<string> =>
  String(
    (
      await FleetVehicleTypeModel.create({
        name: { ar, en: ar },
        maintenanceIntervalKm: 10_000,
        isActive,
      })
    )._id,
  );

export const create = async (body: Record<string, unknown>, token = theWorld().admin) =>
  request(theWorld().app).post(URL_).set(auth(token)).send(body);
export const created = async (body: Record<string, unknown>): Promise<FleetVehicleContractDto> => {
  const res = await create(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<FleetVehicleContractDto>(res);
};
export const receive = (id: string, body: Record<string, unknown>, token = theWorld().admin) =>
  request(theWorld().app).post(`${URL_}/${id}/deliveries`).set(auth(token)).send(body);

export const bootVehicleContracts = async (): Promise<VehicleContractWorld> => {
  const external = process.env['MONGO_TEST_URI'];
  const dbName = `ecms-vc-test-${Date.now()}`;
  let uri: string;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    uri = url.toString();
  } else {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    uri = replSet.getUri(dbName);
  }
  await bootPlatform({ mongoUri: uri, modules: moduleManifests });
  const app = buildApp();
  const everything = [...platformPermissions, ...fleetPermissions].map((p) => p.key);
  const superUser = await userWith(everything);
  world = {
    app,
    admin: superUser.token,
    adminId: superUser.id,
    viewer: (await userWith(['fleetVehicleContract.view'])).token,
    creator: (await userWith(['fleetVehicleContract.view', 'fleetVehicleContract.create'])).token,
    fileReader: (await userWith(['file.view'])).token,
    typeA: await makeType('غزالة'),
    typeB: await makeType('تويوتا'),
    typeOff: await makeType('موقوفة', false),
  };
  return world;
};

export const stopVehicleContracts = async (): Promise<void> => {
  await getCache().close();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
  replSet = null;
  world = null;
};
