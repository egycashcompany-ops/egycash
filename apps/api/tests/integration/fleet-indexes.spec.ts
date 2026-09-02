// The index step, against a real mongo.
//
// THE TRAP THIS FILE IS SHAPED AROUND: in the test environment `NODE_ENV` is `test`, so
// `autoIndex` is ON and mongoose builds every declared index by itself. A test that merely
// asserted "the indexes exist" would therefore pass with the migration deleted — it would be
// testing mongoose. So every case here DROPS the index first and then proves the migration is
// what brought it back.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { migrateFleetIndexes, fleetIndexedModels } from '../../src/modules/fleet/fleet-indexes';
import { FleetMaintenanceVisitModel } from '../../src/modules/fleet/maintenance/maintenance.model';
import { FleetSweepMarkModel } from '../../src/modules/fleet/sweeps/sweep-mark.model';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const indexNames = async (model: {
  collection: { listIndexes: () => { toArray: () => Promise<{ name?: string }[]> } };
}) => new Set((await model.collection.listIndexes().toArray()).map((index) => String(index.name)));

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

describe('the migration builds what the schemas declare', () => {
  it('rebuilds a dropped UNIQUE index — the FR-4 invariant', async () => {
    await FleetMaintenanceVisitModel.collection.dropIndex('ux_open_visit');
    expect(await indexNames(FleetMaintenanceVisitModel)).not.toContain('ux_open_visit');

    const result = await migrateFleetIndexes();

    expect(await indexNames(FleetMaintenanceVisitModel)).toContain('ux_open_visit');
    expect(result.built).toBeGreaterThan(0);
    expect(result.skippedDuplicates).toEqual([]);
  });

  it('rebuilds `ux_key` — without it `markOnce` never detects a repeat', async () => {
    await FleetSweepMarkModel.collection.dropIndex('ux_key');
    await migrateFleetIndexes();
    expect(await indexNames(FleetSweepMarkModel)).toContain('ux_key');

    // And the guarantee that index IS: the same key twice must be refused.
    const key = `test:${new Types.ObjectId().toString()}`;
    await FleetSweepMarkModel.create({ key });
    await expect(FleetSweepMarkModel.create({ key })).rejects.toMatchObject({ code: 11000 });
  });

  it('rebuilds a dropped ORDINARY index too', async () => {
    await FleetVehicleModel.collection.dropIndex('ix_license_sweep');
    await migrateFleetIndexes();
    expect(await indexNames(FleetVehicleModel)).toContain('ix_license_sweep');
  });

  it('is idempotent — a second run builds nothing and changes nothing', async () => {
    await migrateFleetIndexes();
    const before = await Promise.all(
      fleetIndexedModels().map(async (entry) => [...(await indexNames(entry.model))].sort()),
    );
    const second = await migrateFleetIndexes();
    const after = await Promise.all(
      fleetIndexedModels().map(async (entry) => [...(await indexNames(entry.model))].sort()),
    );

    expect(second.built).toBe(0);
    expect(second.alreadyPresent).toBeGreaterThan(0);
    expect(second.failed).toEqual([]);
    expect(after).toEqual(before);
  });

  it('every declared index of every Fleet collection is present afterwards', async () => {
    await migrateFleetIndexes();
    for (const { collection, model } of fleetIndexedModels()) {
      const present = await indexNames(model);
      for (const [, options] of model.schema.indexes()) {
        const name = String((options as { name?: unknown }).name);
        expect(present.has(name), `${collection}.${name}`).toBe(true);
      }
    }
  });
});

describe('a violated unique index is REPORTED, never resolved', () => {
  it('leaves the rows alone, skips only that index, and builds the rest', async () => {
    // Two open visits for one vehicle — exactly what `ux_open_visit` forbids. Written straight
    // through the driver, because the service would refuse to create this state.
    await FleetMaintenanceVisitModel.collection.dropIndex('ux_open_visit').catch(() => undefined);
    const vehicleId = new Types.ObjectId();
    const row = (): Record<string, unknown> => ({
      vehicleId,
      inDate: new Date('2026-09-01'),
      outDate: null,
      workshopId: new Types.ObjectId(),
      workTypeId: new Types.ObjectId(),
      spareParts: [],
      sparePartIds: [],
      odometerAtService: 1000,
      exitOdometer: null,
      driverInEmployeeId: null,
      driverOutEmployeeId: null,
      takenInByEmployeeId: null,
      takenOutByEmployeeId: null,
      notes: null,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      createdBy: null,
      updatedBy: null,
      schemaVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 0,
    });
    await FleetMaintenanceVisitModel.collection.insertMany([row(), row()]);
    // The other collection's index is dropped too, to prove one violation does not block others.
    await FleetVehicleModel.collection.dropIndex('ix_license_sweep').catch(() => undefined);

    const result = await migrateFleetIndexes();

    expect(result.skippedDuplicates).toContainEqual({
      collection: 'fleet_maintenance_visits',
      index: 'ux_open_visit',
      groups: 1,
    });
    expect(
      await indexNames(FleetMaintenanceVisitModel),
      'the violated index stays absent',
    ).not.toContain('ux_open_visit');
    // NOTHING was deleted or merged: both rows are still there, exactly as found.
    expect(await FleetMaintenanceVisitModel.collection.countDocuments({ vehicleId })).toBe(2);
    // …and an unrelated index was still built.
    expect(await indexNames(FleetVehicleModel)).toContain('ix_license_sweep');

    // Clean up so later files in the run are not left with a broken collection.
    await FleetMaintenanceVisitModel.collection.deleteMany({ vehicleId });
    await migrateFleetIndexes();
    expect(await indexNames(FleetMaintenanceVisitModel)).toContain('ux_open_visit');
  });
});
