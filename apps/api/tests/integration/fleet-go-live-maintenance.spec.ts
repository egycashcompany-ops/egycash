// The workshop go-live, against a real mongo — what the design rests on, in the order an
// operator meets it.
//
//   1. It WAITS for the cars and the readings: until both runs are done it refuses, unclaimed.
//   2. The run that can proceed writes each car's visits: the catalog by the book's own words
//      (adding what it lacks, «غير محدد» for a blank), the counter from the book or from the
//      odometer chain, the drivers by name.
//   3. What it cannot place — no counter anywhere, a second open visit — it reports, not writes.
//   4. A later boot does nothing; a run that died is finished without writing a visit twice.
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { env } from '../../src/infrastructure/config/env';
import { userService } from '../../src/platform/users';
import { branchService } from '../../src/platform/organization';
import { getDirectoryNameSource } from '../../src/platform/directory';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import { FleetMaintenanceVisitModel } from '../../src/modules/fleet/maintenance/maintenance.model';
import { FleetCatalogItemModel } from '../../src/modules/fleet/catalogs/catalog-item.model';
import { FleetGoLiveRunModel } from '../../src/modules/fleet/go-live/go-live-run.model';
import { runVehicleGoLive } from '../../src/modules/fleet/go-live/vehicles';
import { CARS_LOG_FILE, runOdometerGoLive } from '../../src/modules/fleet/go-live/odometer';
import {
  CAR_MAINTENANCE_FILE,
  MAINTENANCE_GO_LIVE_MARK,
  runMaintenanceGoLive,
} from '../../src/modules/fleet/go-live/maintenance';

let replset: MongoMemoryReplSet | undefined;
let dataDir = '';

const BRANCH = 'فرع الاختبار';

const car = (code: string) => ({
  car_type: 'سوزوكى',
  car_code: code,
  plate_num: `ج ك ق ${code}`,
  chassis_num: `CH-${code}`,
  motor_num: `MO-${code}`,
  joining_date: { $date: '2025-02-24T00:00:00.000Z' },
  expiry_date: { $date: '2026-08-03T00:00:00.000Z' },
  branch: BRANCH,
  deleted: 0,
  status: 1,
  issi: '',
  sn_motorola: '',
});

const driverId = new Types.ObjectId();

/** The odometer book: one reading on WS-1, so a visit without a counter has somewhere to take one. */
const READINGS = [
  {
    _id: { $oid: new Types.ObjectId().toHexString() },
    car_code: 'WS-1',
    date: { $date: '2025-01-10T00:00:00.000Z' },
    out_num: '5000',
    in_num: '',
    km: '',
    deleted: 0,
    driver: '',
    driver2: '',
    notes: '',
  },
];

const log = (over: Record<string, unknown>) => ({
  _id: { $oid: new Types.ObjectId().toHexString() },
  in_date: '2025-01-13',
  out_date: '2025-01-20',
  car_code: 'WS-1',
  driver: '',
  driver2: '-',
  destination: 'mcv',
  works: 'صيانة',
  spare_parts: [],
  counter: '',
  notes: '',
  deleted: 0,
  ...over,
});
const BOOK = [
  // WS-1: a counted service with its own counter, parts and a driver by name; a repair with no
  // counter (taken from the reading on the 10th), no workshop (filed under «غير محدد») and a
  // workshop the catalog does not have; then the visit it is still in.
  log({ counter: '6000', spare_parts: ['زيت', 'فلتر زيت'], driver: 'اشرف نصحى', driver2: 'ونش' }),
  log({ in_date: '2025-02-01', out_date: '2025-02-03', works: 'إصلاح', destination: '' }),
  log({ in_date: '2025-03-01', out_date: '2025-03-02', works: 'إصلاح', destination: 'تويوتا 2', counter: '7000' }),
  log({ in_date: '2025-04-01', out_date: null, works: 'إصلاح', counter: '8000', notes: 'فاصلة كهرباء' }),
  // WS-2: no counter and no readings at all — cannot be placed; and one that left before it arrived.
  log({ car_code: 'WS-2', in_date: '2025-01-13', out_date: '2025-01-20', counter: '' }),
  log({ car_code: 'WS-2', in_date: '2025-05-13', out_date: '2025-05-11', counter: '100' }),
  // WS-3: still in the book's workshop, but already in one on the new screen.
  log({ car_code: 'WS-3', in_date: '2025-06-01', out_date: null, counter: '300' }),
  // A car the registry does not have, and a deleted row.
  log({ car_code: 'بجو', counter: '1' }),
  log({ counter: '9', deleted: 1 }),
];

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const run = async () =>
  FleetGoLiveRunModel.findOne({ key: MAINTENANCE_GO_LIVE_MARK })
    .lean<{ status: string; leaseUntil: Date; outcome: Record<string, unknown> | null } | null>()
    .exec();

const vehicleId = async (code: string): Promise<Types.ObjectId> => {
  const doc = await FleetVehicleModel.findOne({ code }, { _id: 1 }).lean<{ _id: Types.ObjectId }>().exec();
  return (doc as { _id: Types.ObjectId })._id;
};

const visitsOf = async (code: string) =>
  FleetMaintenanceVisitModel.find({ vehicleId: await vehicleId(code), isDeleted: false })
    .sort({ inDate: 1 })
    .lean<{ inDate: Date; outDate: Date | null; workshopId: Types.ObjectId; workTypeId: Types.ObjectId; sparePartIds: Types.ObjectId[]; odometerAtService: number; driverInEmployeeId: Types.ObjectId | null; driverOutEmployeeId: Types.ObjectId | null; notes: string | null; createdBy: Types.ObjectId | null }[]>()
    .exec();

const catalogName = async (id: Types.ObjectId): Promise<string> => {
  const doc = await FleetCatalogItemModel.findById(id, { name: 1 }).lean<{ name: { ar: string } }>().exec();
  return (doc as { name: { ar: string } }).name.ar;
};

let adminId = '';

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });

  dataDir = await mkdtemp(join(tmpdir(), 'fleet-go-live-maintenance-'));
  await writeFile(join(dataDir, 'cars.json'), JSON.stringify([car('WS-1'), car('WS-2'), car('WS-3')]), 'utf8');
  await mkdir(join(dataDir, 'license-photos'), { recursive: true });
  await writeFile(join(dataDir, CARS_LOG_FILE), JSON.stringify(READINGS), 'utf8');
  await writeFile(join(dataDir, CAR_MAINTENANCE_FILE), JSON.stringify(BOOK), 'utf8');

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
  adminId = String(user._id);
  await branchService.create({ code: 'WS', name: { ar: BRANCH, en: BRANCH } }, adminId);

  const source = getDirectoryNameSource();
  expect(source, 'HR has declared where names live').not.toBeNull();
  await mongoose.connection.collection((source as { collection: string }).collection).insertOne({
    _id: driverId,
    code: '0100001',
    status: 'active',
    isDeleted: false,
    branchId: new Types.ObjectId(),
    departmentId: new Types.ObjectId(),
    personal: { fullNameAr: 'أشرف نصحي محمد', searchName: 'اشرف نصحي محمد' },
  });
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

describe('it waits for the cars and the readings', () => {
  it('refuses, unclaimed, while either earlier run is not done — and writes why', async () => {
    await runVehicleGoLive(dataDir);
    // The cars are in; the readings are not.
    await runMaintenanceGoLive(dataDir);

    expect(await FleetMaintenanceVisitModel.countDocuments({}).exec(), 'no visit was written').toBe(0);
    const doc = await run();
    expect(doc?.status).toBe('running');
    expect(doc?.outcome).toMatchObject({ refused: true, reason: 'prior-steps-not-done' });
    expect((doc?.leaseUntil as Date).getTime(), 'and nothing to wait out').toBeLessThanOrEqual(Date.now());
  });
});

describe('the run that can proceed', () => {
  it('writes each car’s visits by the book’s own words, with the counter from the book or the chain', async () => {
    await runOdometerGoLive(dataDir);
    // What the company typed on the new screen before the book arrived: WS-3 is in a workshop.
    const workshop = await FleetCatalogItemModel.findOne({ kind: 'workshop', 'name.ar': 'mcv' }, { _id: 1 }).lean<{ _id: Types.ObjectId }>().exec();
    const workType = await FleetCatalogItemModel.findOne({ kind: 'workType', 'name.ar': 'صيانة' }, { _id: 1 }).lean<{ _id: Types.ObjectId }>().exec();
    await FleetMaintenanceVisitModel.create({
      vehicleId: await vehicleId('WS-3'),
      inDate: new Date('2026-01-10T00:00:00.000Z'),
      outDate: null,
      workshopId: workshop?._id,
      workTypeId: workType?._id,
      odometerAtService: 1,
    });

    await runMaintenanceGoLive(dataDir);

    const doc = await run();
    expect(doc?.status, 'done').toBe('done');
    expect(doc?.outcome).toMatchObject({
      vehicles: 4,
      imported: 5,
      alreadyThere: 0,
      namesFilled: 0,
      counterFromOdometer: 1,
      noCounter: ['WS-2 2025-01-13'],
      counterUnknown: [],
      openConflicts: ['WS-3 2025-06-01'],
      catalogCreated: ['workshop: تويوتا 2', 'workshop: غير محدد'],
      skippedDeleted: 1,
      rejected: [],
      unknownCars: ['بجو (1)'],
      outBeforeIn: ['WS-2 2025-05-13 → 2025-05-11'],
      unmatchedDrivers: [],
      ambiguousDrivers: [],
      placeholders: ['-', 'ونش'],
    });

    const visits = await visitsOf('WS-1');
    expect(visits.map((v) => [v.inDate.toISOString().slice(0, 10), v.outDate?.toISOString().slice(0, 10) ?? null, v.odometerAtService])).toEqual([
      ['2025-01-13', '2025-01-20', 6000],
      ['2025-02-01', '2025-02-03', 5000], // no counter in the book — the reading on the 10th
      ['2025-03-01', '2025-03-02', 7000],
      ['2025-04-01', null, 8000], // still in, as the book says
    ]);
    expect(await catalogName(visits[0]!.workshopId)).toBe('mcv');
    expect(await catalogName(visits[0]!.workTypeId)).toBe('صيانة');
    expect(await Promise.all(visits[0]!.sparePartIds.map(catalogName))).toEqual(['زيت', 'فلتر زيت']);
    expect(String(visits[0]!.driverInEmployeeId), 'the driver, by two of three names').toBe(String(driverId));
    expect(visits[0]!.driverOutEmployeeId, '«ونش» is nobody').toBeNull();
    expect(await catalogName(visits[1]!.workshopId), 'a blank workshop is filed under').toBe('غير محدد');
    expect(await catalogName(visits[2]!.workshopId), 'a workshop the catalog lacked, added as written').toBe('تويوتا 2');
    expect(visits[3]!.notes).toBe('فاصلة كهرباء');
    expect(String(visits[0]!.createdBy), 'authored by the seeded admin').toBe(adminId);
    expect((await visitsOf('WS-2')).length, 'no counter anywhere, left before it arrived — neither written').toBe(0);
    expect((await visitsOf('WS-3')).length, 'the new screen’s visit, and nothing invented beside it').toBe(1);
    // The car the registry never had: its visit is kept, by the book's code and no vehicle.
    expect(await FleetMaintenanceVisitModel.countDocuments({ vehicleId: null, vehicleCode: 'بجو', odometerAtService: 1 }).exec()).toBe(1);
  });

  it('a later boot writes nothing at all', async () => {
    const before = await FleetMaintenanceVisitModel.countDocuments({}).exec();
    await runMaintenanceGoLive(dataDir);
    expect(await FleetMaintenanceVisitModel.countDocuments({}).exec()).toBe(before);
    expect((await run())?.status).toBe('done');
  });
});

describe('a run that died is finished by the next boot, without writing a visit twice', () => {
  it('takes over an expired lease, skips what landed, writes what did not, adds no catalog row twice', async () => {
    await FleetGoLiveRunModel.updateOne(
      { key: MAINTENANCE_GO_LIVE_MARK },
      { $set: { status: 'running', leaseUntil: new Date(Date.now() - 60_000), finishedAt: null, outcome: null } },
    ).exec();
    await FleetMaintenanceVisitModel.deleteOne({ vehicleId: await vehicleId('WS-1'), odometerAtService: 7000 }).exec();
    expect((await visitsOf('WS-1')).length).toBe(3);

    await runMaintenanceGoLive(dataDir);

    expect((await visitsOf('WS-1')).map((v) => v.odometerAtService)).toEqual([6000, 5000, 7000, 8000]);
    const doc = await run();
    expect(doc?.status).toBe('done');
    expect(doc?.outcome).toMatchObject({ imported: 1, alreadyThere: 4, catalogCreated: [] });
    expect(await FleetCatalogItemModel.countDocuments({ kind: 'workshop', 'name.ar': 'تويوتا 2' }).exec()).toBe(1);
  });
});
