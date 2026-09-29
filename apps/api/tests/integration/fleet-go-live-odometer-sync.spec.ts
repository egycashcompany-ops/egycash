// The odometer sync, against a real mongo — the owner's second export of the odometer book brought
// onto the chain the first one wrote, in the order an operator meets it.
//
//   1. It WAITS for the cars and the book: until both runs are done it refuses, unclaimed.
//   2. The run that can proceed applies each change by the three-way rule — the new value where
//      ECMS still holds the import's, the person's value KEPT and listed where somebody changed it
//      since — soft-deletes what the old system deleted, writes every new row as the import would,
//      and joins the new tail to a reading typed on the new screen, or keeps it deleted and names
//      the car.
//   3. Nothing deleted reaches a screen.
//   4. Every boot after that does nothing; a run that died is finished by the next boot, which
//      finds everything the first one wrote already there and writes nothing twice.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
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
import { fleetOdometerService } from '../../src/modules/fleet/odometer/odometer.service';
import { FleetGoLiveRunModel } from '../../src/modules/fleet/go-live/go-live-run.model';
import { runVehicleGoLive } from '../../src/modules/fleet/go-live/vehicles';
import { ODOMETER_GO_LIVE_MARK, runOdometerGoLive } from '../../src/modules/fleet/go-live/odometer';
import {
  ODOMETER_SYNC_GO_LIVE_MARK,
  ODOMETER_SYNC_NEW_FILE,
  ODOMETER_SYNC_OLD_FILE,
  runOdometerSyncGoLive,
} from '../../src/modules/fleet/go-live/odometer-sync';

let replset: MongoMemoryReplSet | undefined;
let dataDir = '';

const BRANCH = 'فرع مزامنة العداد';

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

/** An employee in HR's own collection, planted through the seam's declared source. */
const DRIVER_FULL = 'مصطفى عثمان محمود عثمان';
const employeeId = new Types.ObjectId();

const id = (): string => new Types.ObjectId().toHexString();
const ID = {
  r1: id(),
  r2: id(),
  r3: id(),
  n1: id(),
  n2: id(),
  nd: id(),
  s1: id(),
  s2: id(),
  s3: id(),
  u1: id(),
  u2: id(),
  u2b: id(),
  u3: id(),
  w1: id(),
  w2: id(),
  k1: id(),
  k2: id(),
};
const DELETED_AT = { $date: '2026-09-20T07:46:26.203Z' };

const log = (key: keyof typeof ID, over: Record<string, unknown>) => ({
  _id: { $oid: ID[key] },
  car_code: 'OS-1',
  date: { $date: '2026-09-14T00:00:00.000Z' },
  out_num: '',
  in_num: '',
  km: '',
  deleted: 0,
  driver: '',
  driver2: '',
  notes: '',
  ...over,
});
const on = (day: string) => ({ $date: `${day}T00:00:00.000Z` });

/** What `go-live:odometer` imported — the OLD side of the rule. */
const OLD = [
  // OS-1: a closed row, a row closed by the next one, and the car's last row, left open.
  log('r1', {
    date: on('2026-09-14'),
    out_num: '1000',
    in_num: '1050',
    km: '50',
    driver: DRIVER_FULL,
  }),
  log('r2', { date: on('2026-09-15'), out_num: '1050', driver: 'ايمن خليفه' }),
  log('r3', { date: on('2026-09-16'), out_num: '1100' }),
  // OS-2: its last row, open — a person will record the next reading on the new screen.
  log('s1', { car_code: 'OS-2', date: on('2026-09-16'), out_num: '500' }),
  // OS-3: its last row will be deleted by the old system, and typed again.
  log('u1', { car_code: 'OS-3', date: on('2026-09-15'), out_num: '700', in_num: '750', km: '50' }),
  log('u2', { car_code: 'OS-3', date: on('2026-09-16'), out_num: '750' }),
  // OS-4: its last row will be deleted by the old system — after a person corrected its driver.
  log('w1', { car_code: 'OS-4', date: on('2026-09-16'), out_num: '300', driver: 'سائق قديم' }),
  // A car the registry never had.
  log('k1', { car_code: 'تويوتا1', date: on('2026-09-16'), out_num: '1', in_num: '2', km: '1' }),
];

/** The owner's second export: every kind of news the real one carries, one car each. */
const NEW = [
  log('r1', {
    date: on('2026-09-14'),
    out_num: '1000',
    in_num: '1050',
    km: '50',
    driver: DRIVER_FULL,
  }),
  // The driver spelled out in full, and a note.
  log('r2', {
    date: on('2026-09-15'),
    out_num: '1050',
    driver: 'ايمن حسن مصطفى عبد السلام',
    notes: 'اسوان',
  }),
  // The last row, closed by the book's own reading now.
  log('r3', { date: on('2026-09-16'), out_num: '1100', in_num: '1180', km: '80' }),
  log('n1', {
    date: on('2026-09-17'),
    out_num: '1180',
    in_num: '1250',
    km: '70',
    driver: DRIVER_FULL,
  }),
  log('n2', { date: on('2026-09-18'), out_num: '1250' }),
  // A new row the old system had already deleted — it arrives deleted.
  log('nd', {
    date: on('2026-09-18'),
    out_num: '1250',
    in_num: '1300',
    deleted: 1,
    deleted_date: DELETED_AT,
  }),
  // OS-2: the book still gives its old last row no closing reading — the next row closes it.
  log('s1', { car_code: 'OS-2', date: on('2026-09-16'), out_num: '500' }),
  log('s2', { car_code: 'OS-2', date: on('2026-09-17'), out_num: '540', in_num: '600', km: '60' }),
  log('s3', { car_code: 'OS-2', date: on('2026-09-18'), out_num: '600' }),
  // OS-3: the last row deleted, and typed again the same day with the same opening reading.
  log('u1', { car_code: 'OS-3', date: on('2026-09-15'), out_num: '700', in_num: '750', km: '50' }),
  log('u2', {
    car_code: 'OS-3',
    date: on('2026-09-16'),
    out_num: '750',
    deleted: 1,
    deleted_date: DELETED_AT,
    deleted_by: 'mohamed hussein',
  }),
  log('u2b', { car_code: 'OS-3', date: on('2026-09-16'), out_num: '750', in_num: '790', km: '40' }),
  log('u3', { car_code: 'OS-3', date: on('2026-09-17'), out_num: '790' }),
  // OS-4: the last row deleted, and a new one after it.
  log('w1', {
    car_code: 'OS-4',
    date: on('2026-09-16'),
    out_num: '300',
    driver: 'سائق قديم',
    deleted: 1,
    deleted_date: DELETED_AT,
    deleted_by: 'rabie osman',
  }),
  log('w2', { car_code: 'OS-4', date: on('2026-09-17'), out_num: '330' }),
  log('k1', { car_code: 'تويوتا1', date: on('2026-09-16'), out_num: '1', in_num: '2', km: '1' }),
  log('k2', { car_code: 'تويوتا1', date: on('2026-09-17'), out_num: '2' }),
];

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const run = async () =>
  FleetGoLiveRunModel.findOne({ key: ODOMETER_SYNC_GO_LIVE_MARK })
    .lean<{ status: string; leaseUntil: Date; outcome: Record<string, unknown> | null } | null>()
    .exec();

const vehicleId = async (code: string): Promise<Types.ObjectId> => {
  const doc = await FleetVehicleModel.findOne({ code }, { _id: 1 })
    .lean<{ _id: Types.ObjectId }>()
    .exec();
  return (doc as { _id: Types.ObjectId })._id;
};

interface Row {
  _id: Types.ObjectId;
  __v: number;
  date: Date;
  outReading: number;
  inReading: number | null;
  km: number | null;
  driver1EmployeeId: Types.ObjectId | null;
  driver1Name: string | null;
  notes: string | null;
  isDeleted: boolean;
  deletedAt: Date | null;
  deletedBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
}

const rowsOf = async (code: string, isDeleted: boolean): Promise<Row[]> =>
  FleetOdometerLogModel.find(
    code === 'تويوتا1'
      ? { vehicleId: null, vehicleCode: code, isDeleted }
      : { vehicleId: await vehicleId(code), isDeleted },
  )
    .sort({ date: 1, outReading: 1 })
    .lean<Row[]>()
    .exec();

const chainOf = async (code: string) =>
  (await rowsOf(code, false)).map((row) => [row.outReading, row.inReading]);

let adminId = '';

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });

  dataDir = await mkdtemp(join(tmpdir(), 'fleet-go-live-odometer-sync-'));
  await writeFile(
    join(dataDir, 'cars.json'),
    JSON.stringify([car('OS-1'), car('OS-2'), car('OS-3'), car('OS-4')]),
    'utf8',
  );
  await mkdir(join(dataDir, 'license-photos'), { recursive: true });
  await writeFile(join(dataDir, ODOMETER_SYNC_OLD_FILE), JSON.stringify(OLD), 'utf8');
  await writeFile(join(dataDir, ODOMETER_SYNC_NEW_FILE), JSON.stringify(NEW), 'utf8');

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
  await branchService.create({ code: 'OSY', name: { ar: BRANCH, en: BRANCH } }, adminId);

  const source = getDirectoryNameSource();
  expect(source, 'HR has declared where names live').not.toBeNull();
  await mongoose.connection.collection((source as { collection: string }).collection).insertOne({
    _id: employeeId,
    code: '0100001',
    status: 'active',
    isDeleted: false,
    branchId: new Types.ObjectId(),
    departmentId: new Types.ObjectId(),
    personal: { fullNameAr: DRIVER_FULL, searchName: DRIVER_FULL },
  });
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

describe('it waits for the cars and the book', () => {
  it('refuses, unclaimed, while the odometer book is not done — and writes why', async () => {
    await runOdometerSyncGoLive(dataDir);

    expect(await FleetOdometerLogModel.countDocuments({}).exec(), 'no reading was written').toBe(0);
    const doc = await run();
    expect(doc?.status).toBe('running');
    expect(doc?.outcome).toMatchObject({ refused: true, reason: 'prior-steps-not-done' });
    expect((doc?.leaseUntil as Date).getTime(), 'and nothing to wait out').toBeLessThanOrEqual(
      Date.now(),
    );
  });
});

describe('the run that can proceed', () => {
  it('brings the new export onto the chain the import wrote, and keeps what people changed since', async () => {
    await runVehicleGoLive(dataDir);
    await runOdometerGoLive(dataDir);
    expect(
      (
        await FleetGoLiveRunModel.findOne({ key: ODOMETER_GO_LIVE_MARK })
          .lean<{ status: string }>()
          .exec()
      )?.status,
    ).toBe('done');
    expect(await chainOf('OS-1')).toEqual([
      [1000, 1050],
      [1050, 1100],
      [1100, null],
    ]);

    // What the company did on ECMS since the import. On OS-2 a reading was recorded for the 20th —
    // the screen closed the book's last row with it and opened the next. On OS-4 somebody put the
    // right driver on the book's last row.
    const [s1] = await rowsOf('OS-2', false);
    await FleetOdometerLogModel.updateOne(
      { _id: s1!._id },
      { $set: { inReading: 620, km: 120 }, $inc: { __v: 1 } },
    ).exec();
    await FleetOdometerLogModel.create({
      vehicleId: await vehicleId('OS-2'),
      date: new Date('2026-09-20T00:00:00.000Z'),
      outReading: 620,
      inReading: null,
      km: null,
    });
    const [w1] = await rowsOf('OS-4', false);
    await FleetOdometerLogModel.updateOne(
      { _id: w1!._id },
      { $set: { driver1EmployeeId: employeeId, driver1Name: null }, $inc: { __v: 1 } },
    ).exec();

    await runOdometerSyncGoLive(dataDir);

    const doc = await run();
    expect(doc?.status, 'done').toBe('done');
    expect(doc?.outcome).toMatchObject({
      vehicles: 5,
      inExport: {
        newRows: 9,
        changedRows: 4,
        in_num: 1,
        km: 1,
        driver: 1,
        notes: 1,
        deleted: 2,
        deleted_date: 2,
        deleted_by: 2,
      },
      added: 9, // EVERY new row — the one already deleted and the contested tail included
      alreadyThere: 0,
      changed: { inReading: 1, driver1: 1, notes: 1 },
      changesAlreadyThere: 0,
      deletedByBook: 1,
      restoredByBook: 0,
      restored: 0,
      closedByExisting: 1,
      deletedRows: 2,
      keptEcmsEditsCount: 2,
      keptEcmsEdits: [
        {
          code: 'OS-2',
          date: '2026-09-16',
          field: 'inReading',
          ecms: '620',
          old: null,
          new: '540',
        },
        {
          code: 'OS-4',
          date: '2026-09-16',
          field: 'deleted',
          ecms: 'live — driver1 changed on ECMS',
          old: 'live',
          new: 'deleted',
        },
      ],
      openConflicts: ['OS-4 2026-09-17'],
      unappliedCount: 0,
      unapplied: [],
      goneFromExport: [],
      keptDeleted: 1,
      unreadable: [],
      unknownCars: ['تويوتا1 (1)'],
      unmatchedDrivers: ['ايمن حسن مصطفى عبد السلام'],
      ambiguousDrivers: [],
      placeholders: [],
    });

    // OS-1: nobody touched it — the chain a fresh import of the new book writes.
    expect(await chainOf('OS-1')).toEqual([
      [1000, 1050],
      [1050, 1100],
      [1100, 1180], // the last row, closed by the book's own reading now
      [1180, 1250],
      [1250, null], // the new last row is the car's open period
    ]);
    const os1 = await rowsOf('OS-1', false);
    expect(os1[1]?.driver1Name, 'the driver as the old system spells him now').toBe(
      'ايمن حسن مصطفى عبد السلام',
    );
    expect(os1[1]?.notes).toBe('اسوان');
    expect(os1[2]?.km).toBe(80);
    expect(os1[2]?.__v, 'every write moves the version').toBe(1);
    expect(String(os1[2]?.updatedBy), 'written by the seeded admin').toBe(adminId);
    expect(
      String(os1[3]?.driver1EmployeeId),
      'a new row’s driver, matched by name through HR',
    ).toBe(String(employeeId));
    expect(
      (await rowsOf('OS-1', true)).map((row) => [row.outReading, row.inReading, row.deletedAt]),
    ).toEqual([[1250, 1300, new Date('2026-09-20T07:46:26.203Z')]]);

    // OS-2: the closing reading the screen gave the old last row is KEPT; the new rows go in, and
    // the book's new last row is closed against the reading recorded on the 20th.
    expect(await chainOf('OS-2')).toEqual([
      [500, 620],
      [540, 600],
      [600, 620],
      [620, null],
    ]);

    // OS-3: the old system's deletion, SOFT — its day, no user, a new version — and the row it
    // typed again beside it, written rather than taken for the deleted one.
    expect(await chainOf('OS-3')).toEqual([
      [700, 750],
      [750, 790],
      [790, null],
    ]);
    const [u2] = await rowsOf('OS-3', true);
    expect(u2).toMatchObject({
      outReading: 750,
      inReading: null,
      isDeleted: true,
      deletedAt: new Date('2026-09-20T07:46:26.203Z'),
      deletedBy: null,
      __v: 1,
    });

    // OS-4: somebody decided about that row on ECMS, so the old system's deletion is not applied
    // — and the new last row, which would be a second open period, is kept DELETED, not dropped.
    expect(await chainOf('OS-4')).toEqual([[300, null]]);
    const parked = await rowsOf('OS-4', true);
    expect(parked.map((row) => [row.outReading, row.inReading, row.deletedBy])).toEqual([
      [330, null, null],
    ]);
    expect(parked[0]?.deletedAt, 'deleted now — nobody deleted it; it did not fit').not.toBeNull();

    // The car the registry never had: its new row kept by the book's code, on no chain.
    expect(await chainOf('تويوتا1')).toEqual([
      [1, 2],
      [2, null],
    ]);
  });

  it('NOTHING that is deleted reaches a screen — «الداتا اللى ممسوحه متظهرش للمستخدم تبقى فى الداتا بيز فقط»', async () => {
    const page = await fleetOdometerService.list({ page: 1, pageSize: 200, sortDir: 'desc' });
    expect(
      await FleetOdometerLogModel.countDocuments({ isDeleted: true }).exec(),
      'in the database',
    ).toBe(3);
    expect(page.meta.totalItems, 'and on no screen').toBe(
      await FleetOdometerLogModel.countDocuments({ isDeleted: false }).exec(),
    );
    expect(page.meta.totalItems).toBe(15);
    expect(page.items.some((row) => row.isDeleted)).toBe(false);
  });

  it('a later boot writes nothing at all', async () => {
    const before = await FleetOdometerLogModel.countDocuments({}).exec();
    await runOdometerSyncGoLive(dataDir);
    expect(await FleetOdometerLogModel.countDocuments({}).exec()).toBe(before);
    expect((await run())?.status).toBe('done');
  });
});

describe('a run that died is finished by the next boot, without writing a row twice', () => {
  it('takes over an expired lease, finds what landed, writes what did not', async () => {
    await FleetGoLiveRunModel.updateOne(
      { key: ODOMETER_SYNC_GO_LIVE_MARK },
      {
        $set: {
          status: 'running',
          leaseUntil: new Date(Date.now() - 60_000),
          finishedAt: null,
          outcome: null,
        },
      },
    ).exec();
    // One new row removed underneath it — the shape a run killed mid-car leaves behind.
    await FleetOdometerLogModel.deleteOne({
      vehicleId: await vehicleId('OS-1'),
      date: new Date('2026-09-17T00:00:00.000Z'),
    }).exec();
    expect((await chainOf('OS-1')).length).toBe(4);

    await runOdometerSyncGoLive(dataDir);

    expect(await chainOf('OS-1')).toEqual([
      [1000, 1050],
      [1050, 1100],
      [1100, 1180],
      [1180, 1250],
      [1250, null],
    ]);
    const doc = await run();
    expect(doc?.status).toBe('done');
    expect(
      doc?.outcome,
      'the deleted twin and the parked tail count as written too, or they would land twice',
    ).toMatchObject({
      added: 1,
      alreadyThere: 8,
      changed: { inReading: 0, driver1: 0, notes: 0 },
      changesAlreadyThere: 4,
      deletedByBook: 0,
      closedByExisting: 0,
      deletedRows: 0,
      openConflicts: [],
      keptEcmsEditsCount: 2,
    });
    expect(
      await FleetOdometerLogModel.countDocuments({}).exec(),
      'eighteen rows, as before the crash',
    ).toBe(18);
  });
});
