// The go-live reset, against a real mongo — what goes, what stays, and that it happens once.
//
// A wipe is the one kind of change where a test that reads the source is not enough: the thing
// to prove is the exact boundary, on real collections, and that the five things the owner said
// «اوعى تيجى جمبهم» about are still there afterwards with the rest gone around them.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { FleetCatalogItemModel } from '../../src/modules/fleet/catalogs/catalog-item.model';
import { FleetOdometerLogModel } from '../../src/modules/fleet/odometer/odometer.model';
import { FleetMaintenanceVisitModel } from '../../src/modules/fleet/maintenance/maintenance.model';
import { FleetDutyAssignmentModel } from '../../src/modules/fleet/roster/duty-assignment.model';
import { FleetFixedCrewModel } from '../../src/modules/fleet/fixed-roster/fixed-crew.model';
import { FleetAccidentModel } from '../../src/modules/fleet/accidents/accident.model';
import {
  FleetGrievanceModel,
  FleetViolationModel,
} from '../../src/modules/fleet/violations/violation.model';
import { FleetDriverProfileModel } from '../../src/modules/fleet/driver-profiles/driver-profile.model';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import { FleetSweepMarkModel } from '../../src/modules/fleet/sweeps/sweep-mark.model';
import { GO_LIVE_RESET_MARK, runGoLiveReset } from '../../src/modules/fleet/go-live/reset';

/**
 * The four protected kinds, SPELLED OUT rather than imported from `reset.ts`. A sabotage that
 * dropped «violationType» from the module's own list left this file green when it read that list
 * — the expectation and the code were the same constant. The owner's instruction is the source of
 * truth here, not the implementation of it.
 */
const PROTECTED_CATALOG_KINDS = [
  'violationType',
  'driverJob',
  'driverSpecialization',
  'driverLicenseType',
] as const;

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const oid = (): Types.ObjectId => new Types.ObjectId();

/** Raw inserts: the shapes need only be enough for `deleteMany` to have something to delete. */
const plant = async (): Promise<void> => {
  const vehicleId = oid();
  await FleetOdometerLogModel.collection.insertMany([
    { vehicleId, date: new Date(), outReading: 1, inReading: 2, km: 1, isDeleted: false },
    { vehicleId, date: new Date(), outReading: 2, inReading: 3, km: 1, isDeleted: false },
  ]);
  await FleetMaintenanceVisitModel.collection.insertOne({ vehicleId, inDate: new Date(), isDeleted: false });
  await FleetDutyAssignmentModel.collection.insertOne({ vehicleId, date: new Date(), isDeleted: false });
  await FleetFixedCrewModel.collection.insertOne({ vehicleId, isDeleted: false });
  await FleetAccidentModel.collection.insertOne({ vehicleId, occurredAt: new Date(), isDeleted: false });
  await FleetViolationModel.collection.insertOne({ vehicleId, isDeleted: false });
  await FleetGrievanceModel.collection.insertOne({ vehicleId, isDeleted: false });
  // Catalog: one row of every unprotected kind that exists on the screen, plus the five protected.
  for (const kind of ['workshop', 'workType', 'sparePart', 'missionType', 'insuranceCompany', 'licenseClass', 'operation']) {
    await FleetCatalogItemModel.collection.insertOne({
      kind, name: { ar: `اختبار ${kind}`, en: `test ${kind}` }, countsForAlarm: false, isActive: true, isDeleted: false,
    });
  }
  for (const kind of PROTECTED_CATALOG_KINDS) {
    await FleetCatalogItemModel.collection.insertOne({
      kind, name: { ar: `محمي ${kind}`, en: `kept ${kind}` }, countsForAlarm: false, isActive: true, isDeleted: false,
    });
  }
  // Two things NOT on the list at all, which must come through untouched.
  await FleetDriverProfileModel.collection.insertOne({ employeeId: oid(), isActive: true, isDeleted: false });
  await FleetVehicleModel.collection.insertOne({ code: 'KEEP-1', isDeleted: false, status: 'active' });
};

const count = async (model: { countDocuments: (f?: object) => { exec: () => Promise<number> } }, f: object = {}) =>
  model.countDocuments(f).exec();

const UNPROTECTED = { kind: { $nin: [...PROTECTED_CATALOG_KINDS] } };

/**
 * What the boot itself put in the catalog, before a single fixture: the 167-name vocabulary on
 * the unprotected side, and the violation types plus the three driver catalogs on the protected
 * side. The reset is expected to take the former and leave the latter, so every count below is a
 * DELTA against this — an absolute number would be asserting the size of the seed, not the reset.
 */
let seededUnprotected = 0;
const seededProtected = new Map<string, number>();

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  seededUnprotected = await count(FleetCatalogItemModel, UNPROTECTED);
  for (const kind of PROTECTED_CATALOG_KINDS) {
    seededProtected.set(kind, await count(FleetCatalogItemModel, { kind }));
  }
  expect(seededUnprotected, 'the seed put the vocabulary in first').toBeGreaterThan(0);
  await plant();
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

describe('what the reset clears', () => {
  it('empties the eight screens and reports each count', async () => {
    const outcome = await runGoLiveReset();
    expect(outcome).not.toBeNull();
    expect(outcome).toMatchObject({
      odometerLogs: 2,
      maintenanceVisits: 1,
      dutyAssignments: 1,
      fixedCrews: 1,
      accidents: 1,
      violations: 1,
      grievances: 1,
      // The seven planted unprotected rows, AND the whole seeded vocabulary beside them — the
      // catalogs screen is on the list, and «امسحها خالص» does not stop at rows a test planted.
      catalogItems: seededUnprotected + 7,
    });
    for (const model of [
      FleetOdometerLogModel, FleetMaintenanceVisitModel, FleetDutyAssignmentModel, FleetFixedCrewModel,
      FleetAccidentModel, FleetViolationModel, FleetGrievanceModel,
    ]) {
      expect(await count(model), `${model.collection.name} is empty`).toBe(0);
    }
    expect(await count(FleetCatalogItemModel, UNPROTECTED)).toBe(0);
  });
});

describe('what the reset spares', () => {
  it('leaves every protected catalog kind exactly as it was', async () => {
    // «أنواع المخالفات و وظيفة السائق و تخصص السائق ورخصة السائق»
    for (const kind of PROTECTED_CATALOG_KINDS) {
      // Everything the seed put there, plus the one row planted on top: not a row fewer.
      expect(await count(FleetCatalogItemModel, { kind }), `${kind} survived`).toBe(
        (seededProtected.get(kind) ?? 0) + 1,
      );
    }
  });

  it('does not touch the drivers registry, and not the vehicles either', async () => {
    // «السواقيين» is on the owner's list; the vehicles are simply not on the list of screens.
    expect(await count(FleetDriverProfileModel)).toBe(1);
    expect(await count(FleetVehicleModel)).toBe(1);
  });
});

describe('once', () => {
  it('a second run finds its mark and returns null — nothing else happens', async () => {
    await FleetOdometerLogModel.collection.insertOne({ vehicleId: oid(), date: new Date(), outReading: 5, inReading: 6, km: 1, isDeleted: false });
    expect(await runGoLiveReset()).toBeNull();
    expect(await count(FleetOdometerLogModel), 'the row written after the reset is still there').toBe(1);
    expect(await count(FleetSweepMarkModel, { key: GO_LIVE_RESET_MARK })).toBe(1);
  });
});
