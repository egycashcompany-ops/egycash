// The makes' order (الماركة) against a real mongo — «قوائم الحركه اكيد هيرتب برضو الماركات»: the
// order saved on the lists screen is the order every make picker reads, any make not named keeps
// its place after the named ones, and a stranger id is refused.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { fleetVehicleTypeService } from '../../src/modules/fleet/vehicle-types/vehicle-type.service';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const ACTOR = new Types.ObjectId().toString();

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

const names = async (): Promise<string[]> =>
  (await fleetVehicleTypeService.list({ page: 1, pageSize: 100 } as never)).items.map(
    (type) => type.name.ar,
  );

describe('the makes’ order', () => {
  it('reads by name until arranged, then in the saved order, the unnamed after', async () => {
    const make = async (ar: string) =>
      fleetVehicleTypeService.create({ name: { ar, en: ar }, maintenanceIntervalKm: 0 }, ACTOR);
    const a = await make('أ ماركة');
    const b = await make('ب ماركة');
    const c = await make('ج ماركة');
    const before = await names();
    expect(before.indexOf('أ ماركة')).toBeLessThan(before.indexOf('ج ماركة'));

    await fleetVehicleTypeService.order({ ids: [String(c._id), String(a._id)] }, ACTOR);
    const after = await names();
    expect(after.slice(0, 2)).toEqual(['ج ماركة', 'أ ماركة']);
    expect(after).toContain('ب ماركة');
    expect(after.indexOf('ب ماركة')).toBeGreaterThan(1);
    void b;

    // A make added after the list was arranged goes to its end, not before the placed ones.
    await make('ء ماركة جديدة');
    const withNew = await names();
    expect(withNew[withNew.length - 1]).toBe('ء ماركة جديدة');

    await expect(
      fleetVehicleTypeService.order({ ids: [new Types.ObjectId().toString()] }, ACTOR),
    ).rejects.toThrow();
  });
});
