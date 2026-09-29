// The violations RELOAD, against a real mongo — «امسح من ecms كل المخالفات لحد يوم 23 يعنى من يوم
// 24 البدايه وكل اللى فى الملف ضيفه ويكون الصف لونه اخضر» — in the order it meets production.
//
//   1. It WAITS for the cars and for the first violations import: until both are done it refuses,
//      unclaimed, and touches nothing.
//   2. The first import has run, on 20 September, and people have worked since: a fine typed on
//      the 22nd, one in the last millisecond of the 23rd, one at the first instant of the 24th, one
//      on the 25th with exactly the facts of a book row, a book row ticked on the 25th, and
//      grievance figures — one untouched, one set again on the 26th.
//   3. The reload soft-deletes what was recorded up to the 23rd, leaves what was recorded from the
//      24th exactly as it is, writes EVERY row of the book again flagged `fromOldBook`, and names
//      what somebody had changed since the line.
//   4. A run that died is finished without sweeping or writing anything twice, and still reports
//      the whole sweep; a later boot does nothing at all.
//
// Production's first-import rows were written before `fromOldBook` existed and on 20 September,
// so step 2 gives the rows the first import writes here that shape — no key, and that day.
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { env } from '../../src/infrastructure/config/env';
import { userService } from '../../src/platform/users';
import { branchService } from '../../src/platform/organization';
import { toViolationDto } from '../../src/modules/fleet/fleet.mappers';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import {
  FleetGrievanceModel,
  FleetViolationModel,
  type FleetViolationDoc,
} from '../../src/modules/fleet/violations/violation.model';
import { FleetGoLiveRunModel } from '../../src/modules/fleet/go-live/go-live-run.model';
import { runVehicleGoLive } from '../../src/modules/fleet/go-live/vehicles';
import {
  CAR_VIOLATIONS_FILE,
  VIOLATIONS_GO_LIVE_MARK,
  runViolationsGoLive,
} from '../../src/modules/fleet/go-live/violations';
import {
  VIOLATIONS_RELOAD_CUTOFF,
  VIOLATIONS_RELOAD_MARK,
  runViolationsReloadGoLive,
} from '../../src/modules/fleet/go-live/violations-reload';

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

const company = (over: Record<string, unknown>) => ({
  _id: { $oid: new Types.ObjectId().toHexString() },
  car_code: 'LG-1',
  date_car: { $date: '2025-12-25T00:00:00.000Z' },
  type: 'رسوم خدمة',
  num: '1',
  value_violationCar: '550',
  amount: '550',
  deleted: 0,
  total_before_grievance: '0',
  done: 1,
  ...over,
});
const fine = (over: Record<string, unknown>) => ({
  _id: { $oid: new Types.ObjectId().toHexString() },
  car_code: 'LG-1',
  date_driver: { $date: '2025-03-06T00:00:00.000Z' },
  driver: 'احمد جمال عطية',
  amount: '700',
  violation_driver: 'سرعة',
  done: null,
  deleted: 0,
  ...over,
});
/** The ledgers spec's book: ten rows, nine live, one the old system had deleted. */
const VIOLATIONS = [
  company({}),
  company({}),
  company({
    type: 'الانتظار في الممنوع',
    num: '9',
    value_violationCar: '20',
    amount: '180',
    total_before_grievance: '5000',
    done: null,
  }),
  company({ num: '0', amount: '0', type: '' }),
  company({ type: '' }),
  fine({}),
  fine({ violation_driver: 'ت', amount: '350', done: 1 }),
  fine({ driver: 'سائق مجهول', date_driver: { $date: '2025-04-01T00:00:00.000Z' } }),
  company({ car_code: 'كوستر' }),
  fine({ deleted: 1, deleted_date: { $date: '2025-12-31T00:00:00.000Z' } }),
];

/** When the first import landed in production. */
const SEP20 = new Date('2026-09-20T10:00:00.000Z');
const SEP22 = new Date('2026-09-22T10:00:00.000Z');
const LAST_MS_OF_23 = new Date(VIOLATIONS_RELOAD_CUTOFF.getTime() - 1);
const SEP25 = new Date('2026-09-25T08:00:00.000Z');
const SEP26 = new Date('2026-09-26T08:00:00.000Z');

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const run = async (key: string) =>
  FleetGoLiveRunModel.findOne({ key })
    .lean<{ status: string; leaseUntil: Date; outcome: Record<string, unknown> | null } | null>()
    .exec();

const vehicleId = async (code: string): Promise<Types.ObjectId> => {
  const doc = await FleetVehicleModel.findOne({ code }, { _id: 1 })
    .lean<{ _id: Types.ObjectId }>()
    .exec();
  return (doc as { _id: Types.ObjectId })._id;
};

type Row = FleetViolationDoc & { fromOldBook?: boolean };
const rowById = async (id: Types.ObjectId): Promise<Row> =>
  (await FleetViolationModel.findById(id).lean<Row>().exec()) as Row;

let adminId = '';
/** The fines people typed, by what the test calls them. */
const typed: Record<'before' | 'lastMs' | 'atLine' | 'twin', Types.ObjectId> = {
  before: new Types.ObjectId(),
  lastMs: new Types.ObjectId(),
  atLine: new Types.ObjectId(),
  twin: new Types.ObjectId(),
};
let tickedBookRow: Types.ObjectId | null = null;

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });

  dataDir = await mkdtemp(join(tmpdir(), 'fleet-go-live-violations-reload-'));
  await writeFile(join(dataDir, 'cars.json'), JSON.stringify([car('LG-1'), car('LG-2')]), 'utf8');
  await mkdir(join(dataDir, 'license-photos'), { recursive: true });
  await writeFile(join(dataDir, CAR_VIOLATIONS_FILE), JSON.stringify(VIOLATIONS), 'utf8');

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
  await branchService.create({ code: 'LG', name: { ar: BRANCH, en: BRANCH } }, adminId);
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

describe('the reload waits for the cars AND the first import', () => {
  it('runs on a clock past the line — the sweep’s own dates are what it counts by', () => {
    expect(Date.now(), 'this suite assumes it runs after 24 September 2026, Cairo').toBeGreaterThan(
      VIOLATIONS_RELOAD_CUTOFF.getTime(),
    );
  });

  it('refuses, unclaimed, before the cars — and still refuses with only the cars done', async () => {
    await runViolationsReloadGoLive(dataDir);
    let doc = await run(VIOLATIONS_RELOAD_MARK);
    expect(doc?.status).toBe('running');
    expect(doc?.outcome).toMatchObject({ refused: true, reason: 'violations-not-done' });
    expect((doc?.leaseUntil as Date).getTime(), 'and nothing to wait out').toBeLessThanOrEqual(
      Date.now(),
    );

    await runVehicleGoLive(dataDir);
    expect(await FleetVehicleModel.countDocuments({}).exec()).toBe(2);
    await runViolationsReloadGoLive(dataDir);
    doc = await run(VIOLATIONS_RELOAD_MARK);
    expect(doc?.outcome, 'the first import has not run yet').toMatchObject({
      refused: true,
      reason: 'violations-not-done',
    });
    expect(await FleetViolationModel.countDocuments({}).exec()).toBe(0);
  });
});

describe('what production looks like before the reload', () => {
  it('the first import ran on the 20th, and people have worked since', async () => {
    await runViolationsGoLive(dataDir);
    expect((await run(VIOLATIONS_GO_LIVE_MARK))?.status).toBe('done');
    expect(await FleetViolationModel.countDocuments({}).exec()).toBe(10);

    // The first import's rows as production has them: written on the 20th, before the flag existed.
    // The driver's collection is written directly, so no timestamp is moved for us.
    await FleetViolationModel.collection.updateMany(
      {},
      { $unset: { fromOldBook: '' }, $set: { createdAt: SEP20, updatedAt: SEP20 } },
    );
    await FleetGrievanceModel.collection.updateMany(
      {},
      { $set: { createdAt: SEP20, updatedAt: SEP20 } },
    );

    // A book row somebody TICKED on the 25th.
    const ticked = await FleetViolationModel.findOne({ driverName: 'سائق مجهول', isDeleted: false })
      .lean<Row>()
      .exec();
    tickedBookRow = (ticked as Row)._id;
    await FleetViolationModel.collection.updateOne(
      { _id: tickedBookRow },
      { $set: { collected: true, updatedAt: SEP25 } },
    );

    const lg1 = await vehicleId('LG-1');
    const lg2 = await vehicleId('LG-2');
    const speeding = (await FleetViolationModel.findOne({
      kind: 'driver',
      amount: 700,
      date: new Date('2025-03-06T00:00:00.000Z'),
    })
      .lean<Row>()
      .exec()) as Row;
    const fineTyped = (id: Types.ObjectId, at: Date, over: Record<string, unknown> = {}) => ({
      _id: id,
      kind: 'driver',
      vehicleId: lg2,
      vehicleCode: null,
      violationTypeId: speeding.violationTypeId,
      amount: 250,
      year: null,
      count: null,
      unitValue: null,
      date: new Date('2026-09-10T00:00:00.000Z'),
      filedYear: null,
      homeVehicleId: null,
      driverEmployeeId: null,
      driverName: null,
      collected: false,
      schemaVersion: 1,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      createdBy: new Types.ObjectId(adminId),
      updatedBy: new Types.ObjectId(adminId),
      createdAt: at,
      updatedAt: at,
      __v: 0,
      ...over,
    });
    await FleetViolationModel.collection.insertMany([
      fineTyped(typed.before, SEP22),
      fineTyped(typed.lastMs, LAST_MS_OF_23),
      fineTyped(typed.atLine, VIOLATIONS_RELOAD_CUTOFF),
      // EXACTLY the facts of the book's first fine — same car, day, type, money, no employee. If
      // the reload counted a typed row as the book's, this is the row that would stand in for it.
      fineTyped(typed.twin, SEP25, {
        vehicleId: lg1,
        date: new Date('2025-03-06T00:00:00.000Z'),
        amount: 700,
      }),
    ]);

    const figure = (year: number, total: number, updatedAt: Date) => ({
      _id: new Types.ObjectId(),
      vehicleId: lg2,
      year,
      totalBeforeGrievance: total,
      schemaVersion: 1,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      createdBy: new Types.ObjectId(adminId),
      updatedBy: new Types.ObjectId(adminId),
      createdAt: SEP20,
      updatedAt,
      __v: 0,
    });
    await FleetGrievanceModel.collection.insertMany([
      figure(2023, 999, SEP20), // recorded before the line and never touched — swept
      figure(2024, 1234, SEP26), // recorded before the line, SET AGAIN on the 26th — kept
    ]);
    expect(await FleetViolationModel.countDocuments({}).exec()).toBe(14);
  });
});

describe('the reload', () => {
  it('sweeps what was recorded up to the 23rd, keeps the rest as it is, and writes the whole book again', async () => {
    await runViolationsReloadGoLive(dataDir);

    const doc = await run(VIOLATIONS_RELOAD_MARK);
    expect(doc?.status, 'done').toBe('done');
    expect(doc?.outcome).toMatchObject({
      cutoff: '2026-09-23T21:00:00.000Z',
      // Nine live rows of the first import, the fine typed on the 22nd, the one at 23:59:59.999.
      deletedViolations: 11,
      // The first import's LG-1 2025 figure and the untouched LG-2 2023 one.
      deletedGrievances: 2,
      // The fine at the first instant of the 24th, and the typed twin of the 25th.
      keptRecordedSince: 2,
      changedSinceCutoff: ['LG-1 2025-04-01: 700 ✓'],
      changedSinceCutoffCount: 1,
      grievancesKeptSinceCutoff: ['LG-2 2024: 1234'],
      vehicles: 2,
      imported: 10, // EVERY row of the book, the deleted fine included — the typed twin is not the book
      alreadyThere: 0,
      namesFilled: 0,
      grievancesWritten: 1,
      grievancesKept: [],
      typesCreated: [], // the «غير محدد» row the first import added is found, not added again
      keptDeleted: 1,
      deletedRows: 1,
      unreadable: [],
      rejected: [],
      unknownCars: ['كوستر (1)'],
      zeroCount: ['LG-1 2025'],
      unknownTypes: ['LG-1 2025: —', 'LG-1 2025: —'],
      grievanceConflicts: [],
    });
    expect(
      await FleetViolationModel.countDocuments({}).exec(),
      '10 first-import + 4 typed + 10 reloaded',
    ).toBe(24);

    // THE SWEEP — soft, by nobody, the version moved; the first import's rows are all off the board.
    const firstImport = await FleetViolationModel.find({
      fromOldBook: { $exists: false },
      createdAt: SEP20,
    })
      .lean<Row[]>()
      .exec();
    expect(firstImport).toHaveLength(10);
    expect(firstImport.every((r) => r.isDeleted)).toBe(true);
    const swept = firstImport.filter((r) => r.__v === 1);
    expect(swept, 'nine swept now').toHaveLength(9);
    for (const row of swept) {
      expect(row.deletedBy).toBeNull();
      expect((row.deletedAt as Date).getTime()).toBeGreaterThanOrEqual(
        VIOLATIONS_RELOAD_CUTOFF.getTime(),
      );
    }
    const bookDeleted = firstImport.find((r) => r.__v === 0);
    expect(bookDeleted?.deletedAt, 'the one the old system deleted is left as it lay').toEqual(
      new Date('2025-12-31T00:00:00.000Z'),
    );
    for (const id of [typed.before, typed.lastMs]) {
      expect(await rowById(id)).toMatchObject({ isDeleted: true, deletedBy: null, __v: 1 });
    }
    // FROM THE 24TH ON, exactly as it was.
    for (const id of [typed.atLine, typed.twin]) {
      expect(await rowById(id)).toMatchObject({ isDeleted: false, deletedAt: null, __v: 0 });
    }

    // THE BOOK, again — every row flagged, the old system's deletion carried as before.
    const reloaded = await FleetViolationModel.find({ fromOldBook: true }).lean<Row[]>().exec();
    expect(reloaded).toHaveLength(10);
    expect(reloaded.filter((r) => r.isDeleted).map((r) => r.deletedAt)).toEqual([
      new Date('2025-12-31T00:00:00.000Z'),
    ]);
    expect(String(reloaded[0]?.createdBy), 'authored by the seeded admin').toBe(adminId);
    const lg1Live = await FleetViolationModel.find({
      vehicleId: await vehicleId('LG-1'),
      isDeleted: false,
    })
      .lean<Row[]>()
      .exec();
    expect(lg1Live, 'eight book rows and the typed twin').toHaveLength(9);
    expect(lg1Live.filter((r) => r.fromOldBook === true)).toHaveLength(8);
    // The tick somebody gave on the 25th went with the swept row; the book's copy says what the book says.
    const tickedAgain = lg1Live.find(
      (r) => r.fromOldBook === true && r.driverName === 'سائق مجهول',
    );
    expect(tickedAgain?.collected).toBe(false);
    expect((await rowById(tickedBookRow as Types.ObjectId)).isDeleted).toBe(true);

    // What the board is told: green for the book, the normal colour for a row somebody typed.
    expect(toViolationDto(reloaded[0] as FleetViolationDoc).fromOldBook).toBe(true);
    expect(toViolationDto(await rowById(typed.twin)).fromOldBook).toBe(false);

    // THE FIGURES: the book's written back, the one set on the 26th left, the untouched one swept.
    const figures = await FleetGrievanceModel.find({ isDeleted: false })
      .lean<
        { vehicleId: Types.ObjectId; year: number; totalBeforeGrievance: number; createdAt: Date }[]
      >()
      .exec();
    const lg1 = String(await vehicleId('LG-1'));
    const lg2 = String(await vehicleId('LG-2'));
    expect(
      figures.map((f) => [String(f.vehicleId), f.year, f.totalBeforeGrievance]).sort(),
    ).toEqual(
      [
        [lg1, 2025, 5000],
        [lg2, 2024, 1234],
      ].sort(),
    );
    const written = figures.find((f) => String(f.vehicleId) === lg1);
    expect(
      (written?.createdAt as Date).getTime(),
      'the book’s figure, written anew',
    ).toBeGreaterThanOrEqual(VIOLATIONS_RELOAD_CUTOFF.getTime());
    expect(
      await FleetGrievanceModel.countDocuments({ isDeleted: true, deletedBy: null }).exec(),
    ).toBe(2);
  });

  it('a run that died is finished without sweeping or writing twice — and still reports the whole sweep', async () => {
    const before = await FleetViolationModel.countDocuments({}).exec();
    // Cut off after the sweep and partway through the book: the lease lapsed, the outcome the
    // first attempt wrote still on the row, and one of the two identical rows never written.
    await FleetGoLiveRunModel.updateOne(
      { key: VIOLATIONS_RELOAD_MARK },
      { $set: { status: 'running', leaseUntil: new Date(Date.now() - 60_000), finishedAt: null } },
    ).exec();
    await FleetViolationModel.deleteOne({
      vehicleId: await vehicleId('LG-1'),
      kind: 'vehicle',
      unitValue: 550,
      fromOldBook: true,
    }).exec();

    await runViolationsReloadGoLive(dataDir);

    expect(await FleetViolationModel.countDocuments({}).exec()).toBe(before);
    const doc = await run(VIOLATIONS_RELOAD_MARK);
    expect(doc?.status).toBe('done');
    expect(doc?.outcome).toMatchObject({
      deletedViolations: 11, // the WHOLE sweep, not the nothing this attempt found left
      deletedGrievances: 2,
      keptRecordedSince: 2,
      changedSinceCutoff: ['LG-1 2025-04-01: 700 ✓'], // from the row — the swept rows cannot say it again
      changedSinceCutoffCount: 1,
      imported: 1,
      alreadyThere: 9,
      grievancesWritten: 0,
      grievancesKept: [],
    });
    for (const id of [typed.atLine, typed.twin]) {
      expect(await rowById(id), 'still exactly as it was').toMatchObject({
        isDeleted: false,
        __v: 0,
      });
    }
    expect(
      await FleetViolationModel.countDocuments({ fromOldBook: true, isDeleted: false }).exec(),
    ).toBe(9);
  });

  it('a later boot does nothing at all', async () => {
    const before = await FleetViolationModel.countDocuments({ isDeleted: false }).exec();
    await runViolationsReloadGoLive(dataDir);
    expect(await FleetViolationModel.countDocuments({ isDeleted: false }).exec()).toBe(before);
    expect((await run(VIOLATIONS_RELOAD_MARK))?.status).toBe('done');
  });
});
