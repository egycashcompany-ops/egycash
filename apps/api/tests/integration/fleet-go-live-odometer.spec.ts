// The odometer go-live, against a real mongo — what the design rests on, in the order an
// operator meets it.
//
//   1. It WAITS for the cars: until the vehicle run is done it refuses, unclaimed.
//   2. The run that can proceed writes each car's chain, repairs exactly what it said it would,
//      matches drivers by name through the directory, and reports the rest by name.
//   3. Where the book meets readings the company has typed since, the tail is joined or reported.
//   4. Every boot after that does nothing; a run that died is finished by the next boot, and it
//      does not write a row twice.
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
import { FleetOdometerLogModel } from '../../src/modules/fleet/odometer/odometer.model';
import { fleetOdometerRepository } from '../../src/modules/fleet/odometer/odometer.repository';
import { fleetOdometerService } from '../../src/modules/fleet/odometer/odometer.service';
import { FleetGoLiveRunModel } from '../../src/modules/fleet/go-live/go-live-run.model';
import { runVehicleGoLive } from '../../src/modules/fleet/go-live/vehicles';
import { CARS_LOG_FILE, ODOMETER_GO_LIVE_MARK, runOdometerGoLive } from '../../src/modules/fleet/go-live/odometer';

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

/** Two employees in HR's own collection, planted through the seam's declared source. */
const DRIVER_FULL = 'مصطفى عثمان محمود عثمان';
const employeeIds = { full: new Types.ObjectId(), short: new Types.ObjectId() };

/** The book: rows in the handover's own shape, one car with every repair, one car that meets the new screen. */
const log = (over: Record<string, unknown>) => ({
  _id: { $oid: new Types.ObjectId().toHexString() },
  car_code: 'ODO-1',
  date: { $date: '2025-11-25T00:00:00.000Z' },
  out_num: '',
  in_num: '',
  km: '',
  deleted: 0,
  driver: '',
  driver2: '',
  notes: '',
  ...over,
});
const BOOK = [
  // ODO-1: a closed row with a driver by full name, an open row closed by the next, a «0» closing
  // reading, a row with no opening reading, a deleted row, and an open tail with a short name.
  log({ date: { $date: '2025-11-25T00:00:00.000Z' }, out_num: '1000', in_num: '1050', km: '50', driver: DRIVER_FULL }),
  log({ date: { $date: '2025-11-26T00:00:00.000Z' }, out_num: '1050', in_num: '', driver: 'احتياطى' }),
  log({ date: { $date: '2025-11-27T00:00:00.000Z' }, out_num: '1100', in_num: '0', driver: 'سائق غير موجود' }),
  log({ date: { $date: '2025-11-28T00:00:00.000Z' }, out_num: '', in_num: '1150' }),
  log({
    date: { $date: '2025-11-29T00:00:00.000Z' },
    out_num: '9999',
    in_num: '9999',
    deleted: 1,
    deleted_date: { $date: '2025-12-05T00:00:00.000Z' },
  }),
  log({ date: { $date: '2025-11-30T00:00:00.000Z' }, out_num: '1150', in_num: '', driver: 'عمرو عنتر', notes: 'اسوان' }),
  // ODO-2: the company has recorded a reading on the new screen AFTER the book — the tail joins it.
  log({ car_code: 'ODO-2', date: { $date: '2025-12-01T00:00:00.000Z' }, out_num: '500', in_num: '' }),
  // ODO-3: the company's open reading is dated BEFORE the book — the tail cannot be joined.
  log({ car_code: 'ODO-3', date: { $date: '2025-12-01T00:00:00.000Z' }, out_num: '700', in_num: '' }),
  // A car the registry does not have.
  log({ car_code: 'تويوتا1', date: { $date: '2025-12-01T00:00:00.000Z' }, out_num: '1', in_num: '2' }),
];

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const run = async () =>
  FleetGoLiveRunModel.findOne({ key: ODOMETER_GO_LIVE_MARK })
    .lean<{ status: string; leaseUntil: Date; outcome: Record<string, unknown> | null } | null>()
    .exec();

const vehicleId = async (code: string): Promise<Types.ObjectId> => {
  const doc = await FleetVehicleModel.findOne({ code }, { _id: 1 }).lean<{ _id: Types.ObjectId }>().exec();
  return (doc as { _id: Types.ObjectId })._id;
};

const chainOf = async (code: string) =>
  FleetOdometerLogModel.find({ vehicleId: await vehicleId(code), isDeleted: false })
    .sort({ date: 1 })
    .lean<{ _id: Types.ObjectId; date: Date; outReading: number; inReading: number | null; km: number | null; driver1EmployeeId: Types.ObjectId | null; driver1Name: string | null; notes: string | null; createdBy: Types.ObjectId | null }[]>()
    .exec();

let adminId = '';

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });

  dataDir = await mkdtemp(join(tmpdir(), 'fleet-go-live-odometer-'));
  await writeFile(join(dataDir, 'cars.json'), JSON.stringify([car('ODO-1'), car('ODO-2'), car('ODO-3')]), 'utf8');
  await mkdir(join(dataDir, 'license-photos'), { recursive: true });
  await writeFile(join(dataDir, CARS_LOG_FILE), JSON.stringify(BOOK), 'utf8');

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
  await branchService.create({ code: 'ODO', name: { ar: BRANCH, en: BRANCH } }, adminId);

  // The employees, where HR keeps them. One spelled in full, one the book will name by two of
  // his four names; one who has LEFT, because his readings are still his.
  const source = getDirectoryNameSource();
  expect(source, 'HR has declared where names live').not.toBeNull();
  const branchId = new Types.ObjectId();
  const employee = (id: Types.ObjectId, code: string, fullNameAr: string, status: string) => ({
    _id: id,
    code,
    status,
    isDeleted: false,
    branchId,
    departmentId: new Types.ObjectId(),
    personal: { fullNameAr, searchName: fullNameAr },
  });
  await mongoose.connection.collection((source as { collection: string }).collection).insertMany([
    employee(employeeIds.full, '0100001', 'مصطفى عثمان محمود عثمان', 'exited'),
    employee(employeeIds.short, '0100002', 'عمرو عنتر علي علي سالم', 'active'),
  ]);
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

describe('it waits for the cars', () => {
  it('refuses, unclaimed, while the vehicle run is not done — and writes why', async () => {
    await runOdometerGoLive(dataDir);

    expect(await FleetOdometerLogModel.countDocuments({}).exec(), 'no reading was written').toBe(0);
    const doc = await run();
    expect(doc?.status).toBe('running');
    expect(doc?.outcome).toMatchObject({ refused: true, reason: 'vehicles-not-done' });
    expect((doc?.leaseUntil as Date).getTime(), 'and nothing to wait out').toBeLessThanOrEqual(Date.now());
  });
});

describe('the run that can proceed', () => {
  it('writes each car’s chain as the book had it, with the two repairs and the drivers by name', async () => {
    await runVehicleGoLive(dataDir);
    expect(await FleetVehicleModel.countDocuments({}).exec()).toBe(3);

    // What the company typed on the new screen before the book arrived: a later open reading on
    // ODO-2, an EARLIER one on ODO-3.
    await FleetOdometerLogModel.create([
      { vehicleId: await vehicleId('ODO-2'), date: new Date('2026-01-10T00:00:00.000Z'), outReading: 620, inReading: null, km: null },
      { vehicleId: await vehicleId('ODO-3'), date: new Date('2025-06-01T00:00:00.000Z'), outReading: 100, inReading: null, km: null },
    ]);

    await runOdometerGoLive(dataDir);

    const doc = await run();
    expect(doc?.status, 'done').toBe('done');
    expect(doc?.outcome).toMatchObject({
      vehicles: 4,
      imported: 9, // EVERY row of the book — the deleted one and the conflicting tail included
      alreadyThere: 0,
      namesFilled: 0,
      relinked: 0,
      keptDeleted: 1,
      deletedRows: 1,
      unreadable: [],
      rejected: [],
      unknownCars: ['تويوتا1 (1)'],
      openedByPrevious: 1,
      closedByNext: 2,
      badInReading: 1,
      closedByExisting: 1,
      openConflicts: ['ODO-3 2025-12-01'],
      unmatchedDrivers: ['سائق غير موجود'],
      ambiguousDrivers: [],
      placeholders: ['احتياطى'],
    });

    const chain = await chainOf('ODO-1');
    expect(chain.map((row) => [row.outReading, row.inReading, row.km])).toEqual([
      [1000, 1050, 50],
      [1050, 1100, 50], // closed by the next row's opening reading
      [1100, 1100, 0], // «0» is no reading — closed by the row that follows, which opens here
      [1100, 1150, 50], // the row the book left with NO opening reading, opened where the car was
      [1150, null, null], // the tail stays open
    ]);
    expect(String(chain[0]?.driver1EmployeeId), 'the full name, an exited employee still').toBe(String(employeeIds.full));
    expect(chain[1]?.driver1EmployeeId, '«احتياطى» is nobody').toBeNull();
    expect(chain[2]?.driver1EmployeeId, 'a name HR does not have is no employee').toBeNull();
    expect(chain[2]?.driver1Name, '…but the name is KEPT on the row, as text').toBe('سائق غير موجود');
    expect(chain[0]?.driver1Name, 'never beside an employee').toBeNull();
    // The row the old system had deleted is THERE — off the chain, off the screen, and keeping
    // the day it was deleted on: «عاوزها موجوده والdeleted 1 زى ما هى».
    const gone = await FleetOdometerLogModel.find({ vehicleId: await vehicleId('ODO-1'), isDeleted: true })
      .lean<{ outReading: number; inReading: number | null; deletedAt: Date | null; deletedBy: Types.ObjectId | null }[]>()
      .exec();
    expect(gone.map((row) => [row.outReading, row.inReading])).toEqual([[9999, 9999]]);
    expect(gone[0]?.deletedAt, 'the day the old system deleted it').toEqual(new Date('2025-12-05T00:00:00.000Z'));
    expect(gone[0]?.deletedBy, 'by somebody this system has no user for').toBeNull();
    // The car the registry never had: its row is kept, by the book's code and no vehicle.
    const orphan = await FleetOdometerLogModel.find({ vehicleId: null, vehicleCode: 'تويوتا1', isDeleted: false })
      .lean<{ outReading: number; inReading: number | null }[]>()
      .exec();
    expect(orphan.map((row) => [row.outReading, row.inReading])).toEqual([[1, 2]]);
    expect(
      chain[3]?.driver1EmployeeId,
      'the row the book left with no opening reading carries no driver either — it named none',
    ).toBeNull();
    expect(String(chain[4]?.driver1EmployeeId), 'two of four names, matched as a prefix').toBe(String(employeeIds.short));
    expect(chain[4]?.notes).toBe('اسوان');
    expect(String(chain[0]?.createdBy), 'authored by the seeded admin').toBe(adminId);
  });

  it('joins the book’s tail to a reading the company recorded after it, and leaves an earlier one alone', async () => {
    const joined = await chainOf('ODO-2');
    expect(joined.map((row) => [row.outReading, row.inReading])).toEqual([
      [500, 620], // the book's tail, closed against the new screen's opening reading
      [620, null],
    ]);
    const conflict = await chainOf('ODO-3');
    expect(conflict.map((row) => [row.outReading, row.inReading]), 'nothing was invented to join them').toEqual([[100, null]]);
    // …and the book's row is not lost for it: it is written DELETED, so the car keeps its one
    // open period and the reading is still there to go back to — «بس ميحصلش تعارض».
    const parked = await FleetOdometerLogModel.find({ vehicleId: await vehicleId('ODO-3'), isDeleted: true })
      .lean<{ outReading: number; inReading: number | null }[]>()
      .exec();
    expect(parked.map((row) => [row.outReading, row.inReading])).toEqual([[700, null]]);
  });

  it('NOTHING that is deleted reaches a screen — «الداتا اللى ممسوحه متظهرش للمستخدم تبقى فى الداتا بيز فقط»', async () => {
    // The list the screen reads, unfiltered: every row it can show, for every car.
    const page = await fleetOdometerService.list({ page: 1, pageSize: 200, sortDir: 'desc' });
    expect(await FleetOdometerLogModel.countDocuments({}).exec(), 'in the database').toBe(11);
    expect(await FleetOdometerLogModel.countDocuments({ isDeleted: true }).exec(), 'two of them deleted').toBe(2);
    expect(page.meta.totalItems, 'and the screen shows neither').toBe(9);
    expect(page.items.some((row) => row.isDeleted), 'not one deleted row on the page').toBe(false);
    // The alarm engine measures from the same rows the screen shows — and no others.
    const latest = await fleetOdometerRepository.latestReadings([String(await vehicleId('ODO-1'))]);
    expect(latest.get(String(await vehicleId('ODO-1')))?.reading, 'never the deleted row’s 9999').toBe(1150);
  });

  it('a later boot writes nothing at all', async () => {
    const before = await FleetOdometerLogModel.countDocuments({}).exec();
    await runOdometerGoLive(dataDir);
    expect(await FleetOdometerLogModel.countDocuments({}).exec()).toBe(before);
    expect((await run())?.status).toBe('done');
  });
});

describe('a run that died is finished by the next boot, without writing a row twice', () => {
  it('takes over an expired lease, skips what landed, writes what did not', async () => {
    await FleetGoLiveRunModel.updateOne(
      { key: ODOMETER_GO_LIVE_MARK },
      { $set: { status: 'running', leaseUntil: new Date(Date.now() - 60_000), finishedAt: null, outcome: null } },
    ).exec();
    // One row removed underneath it — the shape a run killed mid-car leaves behind.
    await FleetOdometerLogModel.deleteOne({
      vehicleId: await vehicleId('ODO-1'),
      date: new Date('2025-11-27T00:00:00.000Z'),
    }).exec();
    expect((await chainOf('ODO-1')).length).toBe(4);

    await runOdometerGoLive(dataDir);

    expect((await chainOf('ODO-1')).map((row) => row.outReading)).toEqual([1000, 1050, 1100, 1100, 1150]);
    const doc = await run();
    expect(doc?.status).toBe('done');
    expect(doc?.outcome, 'the deleted row counts as written too, or it would land twice').toMatchObject({
      imported: 1,
      alreadyThere: 8,
    });
  });

  it('fills the book’s name into a row an earlier run wrote with the driver empty — and nothing else', async () => {
    // The shape v1 left behind: the row is there, HR did not know the spelling, the driver is empty.
    const [, , third] = await chainOf('ODO-1');
    await FleetOdometerLogModel.updateOne({ _id: third!._id }, { $set: { driver1Name: null } }).exec();
    expect(third?.outReading, 'the row whose driver HR does not know').toBe(1100);
    await FleetGoLiveRunModel.updateOne(
      { key: ODOMETER_GO_LIVE_MARK },
      { $set: { status: 'running', leaseUntil: new Date(Date.now() - 60_000), finishedAt: null, outcome: null } },
    ).exec();

    await runOdometerGoLive(dataDir);

    expect((await chainOf('ODO-1'))[2]?.driver1Name).toBe('سائق غير موجود');
    expect((await run())?.outcome).toMatchObject({ imported: 0, alreadyThere: 9, namesFilled: 1 });
  });

  it('does NOT take over a lease that is still live', async () => {
    await FleetGoLiveRunModel.updateOne(
      { key: ODOMETER_GO_LIVE_MARK },
      { $set: { status: 'running', leaseUntil: new Date(Date.now() + 60_000) } },
    ).exec();
    await FleetOdometerLogModel.deleteOne({
      vehicleId: await vehicleId('ODO-1'),
      date: new Date('2025-11-27T00:00:00.000Z'),
    }).exec();

    await runOdometerGoLive(dataDir);

    expect((await chainOf('ODO-1')).length, 'nothing was written under a live lease').toBe(4);
    expect((await run())?.status).toBe('running');
  });
});
