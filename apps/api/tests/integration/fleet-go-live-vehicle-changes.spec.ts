// The vehicle changes, against a real mongo — the owner's second cars export applied to the
// registry the first one filled, in the order an operator meets it.
//
//   1. It WAITS for the cars: until the vehicle run is done it refuses, unclaimed.
//   2. A new branch /system has deactivated is a refusal before the claim, not a failure inside it.
//   3. The run that can proceed applies each changed field by the three-way rule: the new value
//      where ECMS still holds the import's, a count where ECMS already holds the new one, and the
//      person's value KEPT — and listed — where somebody changed it since. It attaches a scan the
//      build carries, lists the one it does not, and neither creates nor deletes a car.
//   4. Every boot after that does nothing; a run that died is finished by the next boot, which
//      finds everything the first one wrote already new and writes nothing twice.
import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { env } from '../../src/infrastructure/config/env';
import { userService } from '../../src/platform/users';
import { branchService } from '../../src/platform/organization';
import { BranchModel } from '../../src/platform/organization/branches/branch.model';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import { FleetCatalogItemModel } from '../../src/modules/fleet/catalogs/catalog-item.model';
import { FleetGoLiveRunModel } from '../../src/modules/fleet/go-live/go-live-run.model';
import { runVehicleGoLive } from '../../src/modules/fleet/go-live/vehicles';
import {
  runVehicleChangesGoLive,
  VEHICLE_CHANGES_GO_LIVE_MARK,
  VEHICLE_CHANGES_NEW_FILE,
  VEHICLE_CHANGES_OLD_FILE,
} from '../../src/modules/fleet/go-live/vehicle-changes';

const HERE = dirname(fileURLToPath(import.meta.url));
/** A real licence scan from the go-live folder, so the Files category's image rules are met for real. */
const REAL_SCAN = join(HERE, '..', '..', 'assets', 'fleet-go-live', 'license-photos', '150.jpg');

let replset: MongoMemoryReplSet | undefined;
let dataDir = '';

const BRANCH_A = 'فرع التغييرات أ';
const BRANCH_B = 'فرع التغييرات ب';
const OLD_EXPIRY = { $date: '2026-09-04T00:00:00.000Z' };
const NEW_EXPIRY = { $date: '2026-12-03T00:00:00.000Z' };

const car = (code: string, over: Record<string, unknown> = {}) => ({
  car_type: 'سوزوكى',
  car_code: code,
  plate_num: `ج ك ق ${code}`,
  chassis_num: `CH-${code}`,
  motor_num: `MO-${code}`,
  joining_date: { $date: '2025-02-24T00:00:00.000Z' },
  expiry_date: OLD_EXPIRY,
  licens: 'برقاش م',
  branch: BRANCH_A,
  department: 'نقل اموال',
  deleted: 0,
  status: 1,
  issi: '',
  sn_motorola: '',
  ...over,
});

/** What `go-live:vehicles:v3` imported — the OLD side of the rule. */
const OLD = [car('VC-1'), car('VC-2'), car('VC-3'), car('VC-4'), car('VC-6'), car('VC-7')];

/** The second export — every kind of change the step meets, one car each. */
const NEW = [
  // Untouched on ECMS since the import: every change applies, and its scan is in the build.
  car('VC-1', {
    expiry_date: NEW_EXPIRY,
    licens: 'برقاش ت',
    branch: BRANCH_B,
    department: 'ATM',
    license_photo: '/uploads/cars_license_photos/VC-1.jpg',
  }),
  // Its expiry was retyped on ECMS since — kept. Its class applies. Its scan was not sent.
  car('VC-2', {
    expiry_date: NEW_EXPIRY,
    licens: 'برقاش ت',
    license_photo: '/uploads/cars_license_photos/VC-2.jpg',
  }),
  // Somebody already put the new expiry in on ECMS — counted, not written.
  car('VC-3', { expiry_date: NEW_EXPIRY }),
  // Disposed on ECMS — read-only by the registry's own rule, so listed, not written.
  car('VC-4', { expiry_date: NEW_EXPIRY }),
  // Only in the new export — reported, not created.
  car('VC-5'),
  // Deleted on ECMS since — the registry has no live car of the code, so it is listed.
  car('VC-7', { expiry_date: NEW_EXPIRY }),
  // (VC-6 is only in the old export — reported, not deleted.)
];

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const run = async () =>
  FleetGoLiveRunModel.findOne({ key: VEHICLE_CHANGES_GO_LIVE_MARK })
    .lean<{ status: string; leaseUntil: Date; outcome: Record<string, unknown> | null } | null>()
    .exec();

interface VehicleRow {
  _id: Types.ObjectId;
  __v: number;
  licenseExpiresAt: Date;
  licenseClassId: Types.ObjectId | null;
  operationId: Types.ObjectId | null;
  branchId: Types.ObjectId | null;
  licenseImage: { fileName: string } | null;
}

const vehicle = async (code: string): Promise<VehicleRow> =>
  (await FleetVehicleModel.findOne({ code, isDeleted: false })
    .lean<VehicleRow>()
    .exec()) as VehicleRow;

const catalogId = async (kind: string, name: string): Promise<string> => {
  const doc = await FleetCatalogItemModel.findOne(
    { kind, 'name.ar': name, isDeleted: false },
    { _id: 1 },
  )
    .lean<{ _id: Types.ObjectId }>()
    .exec();
  return String(doc?._id);
};

const branchId = async (code: string): Promise<string> => {
  const doc = await BranchModel.findOne({ code }, { _id: 1 })
    .lean<{ _id: Types.ObjectId }>()
    .exec();
  return String(doc?._id);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });

  dataDir = await mkdtemp(join(tmpdir(), 'fleet-go-live-vehicle-changes-'));
  await writeFile(join(dataDir, VEHICLE_CHANGES_OLD_FILE), JSON.stringify(OLD), 'utf8');
  await writeFile(join(dataDir, VEHICLE_CHANGES_NEW_FILE), JSON.stringify(NEW), 'utf8');
  await mkdir(join(dataDir, 'license-photos'), { recursive: true });
  await copyFile(REAL_SCAN, join(dataDir, 'license-photos', 'VC-1.jpg'));

  // The step authors every change as the seeded admin, exactly as the import authored every car.
  const { user } = await userService.create(
    {
      email: env.SEED_ADMIN_EMAIL,
      firstName: { ar: 'مدير', en: 'Admin' },
      lastName: { ar: 'النظام', en: 'System' },
      locale: 'ar',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  const adminId = String(user._id);
  await branchService.create({ code: 'VCA', name: { ar: BRANCH_A, en: BRANCH_A } }, adminId);
  // The branch the new export moves VC-1 to — deactivated in /system, for the refusal below.
  await branchService.create({ code: 'VCB', name: { ar: BRANCH_B, en: BRANCH_B } }, adminId);
  await BranchModel.updateOne({ code: 'VCB' }, { $set: { status: 'inactive' } }).exec();
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

/** A refusal's row: written, with its reasons, and with a lease that has ALREADY lapsed. */
const expectRefused = async (reasons: Record<string, unknown>): Promise<void> => {
  const doc = await run();
  expect(doc, 'the refusal was written to the row').not.toBeNull();
  expect(doc?.status, 'not done').toBe('running');
  expect(doc?.outcome, 'with its reasons').toMatchObject({ refused: true, ...reasons });
  expect((doc?.leaseUntil as Date).getTime(), 'and nothing to wait out').toBeLessThanOrEqual(
    Date.now(),
  );
};

describe('it waits, and it refuses before it claims', () => {
  it('refuses, unclaimed, while the vehicle run is not done — and writes why', async () => {
    await runVehicleChangesGoLive(dataDir);

    expect(await FleetVehicleModel.countDocuments({}).exec(), 'no car exists yet to change').toBe(
      0,
    );
    await expectRefused({ reason: 'vehicles-not-done' });
  });

  it('refuses a NEW branch /system has deactivated — before the claim, with nothing written', async () => {
    await runVehicleGoLive(dataDir);
    expect(await FleetVehicleModel.countDocuments({}).exec(), 'the old export landed').toBe(6);
    const before = await vehicle('VC-1');

    await runVehicleChangesGoLive(dataDir);

    await expectRefused({
      reason: 'plan',
      missingBranches: [],
      inactiveBranches: [BRANCH_B],
      identifierClashes: [],
    });
    expect((await vehicle('VC-1')).__v, 'VC-1 was not written').toBe(before.__v);
  });
});

describe('the run that can proceed', () => {
  it('applies each change by the three-way rule, and lists every one it did not apply', async () => {
    await BranchModel.updateOne({ code: 'VCB' }, { $set: { status: 'active' } }).exec();
    // What the company did on ECMS in the fortnight between the two exports.
    await FleetVehicleModel.updateOne(
      { code: 'VC-2' },
      { $set: { licenseExpiresAt: new Date('2026-10-01T00:00:00.000Z') }, $inc: { __v: 1 } },
    ).exec();
    await FleetVehicleModel.updateOne(
      { code: 'VC-3' },
      { $set: { licenseExpiresAt: new Date('2026-12-03T00:00:00.000Z') }, $inc: { __v: 1 } },
    ).exec();
    await FleetVehicleModel.updateOne({ code: 'VC-4' }, { $set: { status: 'disposed' } }).exec();
    await FleetVehicleModel.updateOne(
      { code: 'VC-7' },
      { $set: { isDeleted: true, deletedAt: new Date() }, $inc: { __v: 1 } },
    ).exec();
    const vc3Before = await vehicle('VC-3');
    const vc4Before = await vehicle('VC-4');

    await runVehicleChangesGoLive(dataDir);

    const doc = await run();
    expect(doc?.status, 'done').toBe('done');
    expect(doc?.outcome).toMatchObject({
      cars: 6,
      carsWithChanges: 5,
      inExport: { licenseExpiresAt: 5, licenseClass: 2, branch: 1, operation: 1, photo: 2 },
      changed: { licenseExpiresAt: 1, licenseClass: 2, branch: 1, operation: 1 },
      alreadyNew: 1,
      photos: 1,
      keptEcmsEditsCount: 1,
      keptEcmsEdits: [
        {
          code: 'VC-2',
          field: 'licenseExpiresAt',
          ecms: '2026-10-01',
          old: '2026-09-04',
          new: '2026-12-03',
        },
      ],
      notInRegistry: ['VC-7'],
      disposedCars: ['VC-4: licenseExpiresAt'],
      newCars: ['VC-5'],
      goneFromExport: ['VC-6'],
      photosNotInBuild: ['VC-2: VC-2.jpg'],
      photoAlreadyThere: [],
      photoDropped: [],
      // The two NEW names, created as the vehicle import would have created them — once each.
      catalogCreated: ['licenseClass: برقاش ت', 'operation: ATM'],
      vehicleTypesCreated: [],
    });

    // VC-1: every field the export changed, and its scan.
    const vc1 = await vehicle('VC-1');
    expect(vc1.licenseExpiresAt.toISOString()).toBe('2026-12-03T00:00:00.000Z');
    expect(String(vc1.licenseClassId)).toBe(await catalogId('licenseClass', 'برقاش ت'));
    expect(String(vc1.operationId)).toBe(await catalogId('operation', 'ATM'));
    expect(String(vc1.branchId)).toBe(await branchId('VCB'));
    expect(vc1.licenseImage?.fileName).toBe('VC-1.jpg');

    // VC-2: the class applied, the person's expiry KEPT, no scan invented.
    const vc2 = await vehicle('VC-2');
    expect(String(vc2.licenseClassId)).toBe(await catalogId('licenseClass', 'برقاش ت'));
    expect(vc2.licenseExpiresAt.toISOString(), "the person's date survived").toBe(
      '2026-10-01T00:00:00.000Z',
    );
    expect(vc2.licenseImage).toBeNull();

    // VC-3 already had it and VC-4 is disposed — neither was written at all.
    expect((await vehicle('VC-3')).__v, 'VC-3 was not written').toBe(vc3Before.__v);
    const vc4 = await vehicle('VC-4');
    expect(vc4.__v, 'VC-4 was not written').toBe(vc4Before.__v);
    expect(vc4.licenseExpiresAt.toISOString()).toBe('2026-09-04T00:00:00.000Z');

    // Nothing created, nothing deleted: VC-5 is not a car, VC-6 still is, VC-7 is still deleted.
    expect(await FleetVehicleModel.countDocuments({ code: 'VC-5' }).exec()).toBe(0);
    expect(await FleetVehicleModel.countDocuments({ code: 'VC-6', isDeleted: false }).exec()).toBe(
      1,
    );
    expect(await FleetVehicleModel.countDocuments({ code: 'VC-7', isDeleted: false }).exec()).toBe(
      0,
    );
  });

  it('writes nothing at all on a later boot — not even a version bump', async () => {
    const before = await vehicle('VC-2');

    await runVehicleChangesGoLive(dataDir);

    expect((await vehicle('VC-2')).__v, 'the row was not written again').toBe(before.__v);
    expect((await run())?.status, 'still done').toBe('done');
  });
});

describe('a run that died is finished by the next boot', () => {
  it('takes over an expired lease and finds everything the first run wrote already new', async () => {
    await FleetGoLiveRunModel.updateOne(
      { key: VEHICLE_CHANGES_GO_LIVE_MARK },
      {
        $set: {
          status: 'running',
          leaseUntil: new Date(Date.now() - 60_000),
          finishedAt: null,
          outcome: null,
        },
      },
    ).exec();
    const vc1Before = await vehicle('VC-1');
    const vc2Before = await vehicle('VC-2');

    await runVehicleChangesGoLive(dataDir);

    const doc = await run();
    expect(doc?.status, 'the take-over finished the job').toBe('done');
    expect(doc?.outcome).toMatchObject({
      changed: { licenseExpiresAt: 0, licenseClass: 0, branch: 0, operation: 0 },
      // VC-1's four fields and its scan, VC-2's class, VC-3's expiry.
      alreadyNew: 7,
      photos: 0,
      keptEcmsEditsCount: 1,
      catalogCreated: [],
    });
    expect((await vehicle('VC-1')).__v, 'VC-1 was not written twice').toBe(vc1Before.__v);
    expect((await vehicle('VC-2')).__v, 'VC-2 was not written twice').toBe(vc2Before.__v);
  });

  it('does NOT take over a lease that is still live — somebody else has it', async () => {
    await FleetGoLiveRunModel.updateOne(
      { key: VEHICLE_CHANGES_GO_LIVE_MARK },
      { $set: { status: 'running', leaseUntil: new Date(Date.now() + 60_000) } },
    ).exec();
    // A change the run WOULD apply if it ran: VC-2's class put back to the old one.
    await FleetVehicleModel.updateOne(
      { code: 'VC-2' },
      {
        $set: { licenseClassId: new Types.ObjectId(await catalogId('licenseClass', 'برقاش م')) },
        $inc: { __v: 1 },
      },
    ).exec();

    await runVehicleChangesGoLive(dataDir);

    expect(
      String((await vehicle('VC-2')).licenseClassId),
      'nothing was applied under a live lease',
    ).toBe(await catalogId('licenseClass', 'برقاش م'));
    expect((await run())?.status, 'and the lease is left as it was').toBe('running');
  });
});
