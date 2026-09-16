// The violations and accidents go-live, against a real mongo — the two books that only need
// the cars, in the order an operator meets them.
//
//   1. Each WAITS for the cars: until the vehicle run is done it refuses, unclaimed.
//   2. The violations run writes the statement rows and the fines by the catalog's own types,
//      the grievance figure once per (vehicle, year), the drivers by name — and two identical
//      rows as two rows.
//   3. The accidents run writes the files with the culprit's name kept as written and the
//      employee filled in where HR knows it; what it cannot place, it lists.
//   4. A later boot writes nothing; a run that died is finished without writing a row twice,
//      and without dropping the second of two identical rows.
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
import { FleetGrievanceModel, FleetViolationModel } from '../../src/modules/fleet/violations/violation.model';
import { FleetAccidentModel } from '../../src/modules/fleet/accidents/accident.model';
import { FleetCatalogItemModel } from '../../src/modules/fleet/catalogs/catalog-item.model';
import { FleetGoLiveRunModel } from '../../src/modules/fleet/go-live/go-live-run.model';
import { runVehicleGoLive } from '../../src/modules/fleet/go-live/vehicles';
import { CAR_VIOLATIONS_FILE, VIOLATIONS_GO_LIVE_MARK, runViolationsGoLive } from '../../src/modules/fleet/go-live/violations';
import { ACCIDENTS_GO_LIVE_MARK, FLEET_ACCIDENT_FILE, runAccidentsGoLive } from '../../src/modules/fleet/go-live/accidents';
import { NOT_STATED } from '../../src/modules/fleet/go-live/accidents-import';

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
const VIOLATIONS = [
  // Two IDENTICAL statement rows — the old statement legitimately has them — plus one with the
  // grievance figure, one with a count of zero, one with no type.
  company({}),
  company({}),
  company({ type: 'الانتظار في الممنوع', num: '9', value_violationCar: '20', amount: '180', total_before_grievance: '5000', done: null }),
  company({ num: '0', amount: '0', type: '' }),
  company({ type: '' }),
  // A fine by a known driver, one under the old shorthand, one by a name HR does not have.
  fine({}),
  fine({ violation_driver: 'ت', amount: '350', done: 1 }),
  fine({ driver: 'سائق مجهول', date_driver: { $date: '2025-04-01T00:00:00.000Z' } }),
  // A car the registry lacks, and a deleted row.
  company({ car_code: 'كوستر' }),
  fine({ deleted: 1 }),
];

const accident = (over: Record<string, unknown>) => ({
  _id: { $oid: new Types.ObjectId().toHexString() },
  date_accident: { $date: '2025-02-01T00:00:00.000Z' },
  car_code: 'LG-1',
  culprit: 'احمد جمال',
  statement: 'فنوس امامى',
  company_account: '0',
  amount_collected: '1400',
  paid: '1400',
  finsh_status_color: '1',
  notes: 'تم الاصلاح',
  deleted: 0,
  ...over,
});
const ACCIDENTS = [
  accident({}),
  accident({ car_code: 'LG-2', culprit: 'سائق تاكسي', statement: '', amount_collected: '4650 من عبدالرحمن', paid: '', finsh_status_color: '0', notes: null }),
  accident({ date_accident: null }),
  accident({ car_code: 'تويوتا1' }),
  accident({ deleted: 1 }),
];

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
  const doc = await FleetVehicleModel.findOne({ code }, { _id: 1 }).lean<{ _id: Types.ObjectId }>().exec();
  return (doc as { _id: Types.ObjectId })._id;
};

const typeName = async (id: Types.ObjectId): Promise<string> => {
  const doc = await FleetCatalogItemModel.findById(id, { name: 1 }).lean<{ name: { ar: string } }>().exec();
  return (doc as { name: { ar: string } }).name.ar;
};

const violationsOf = async (code: string) =>
  FleetViolationModel.find({ vehicleId: await vehicleId(code), isDeleted: false })
    .sort({ kind: -1, date: 1, amount: 1 })
    .lean<{ kind: string; violationTypeId: Types.ObjectId; amount: number; year: number | null; count: number | null; unitValue: number | null; date: Date | null; driverEmployeeId: Types.ObjectId | null; driverName: string | null; collected: boolean; createdBy: Types.ObjectId | null }[]>()
    .exec();

const accidentsOf = async (code: string) =>
  FleetAccidentModel.find({ vehicleId: await vehicleId(code), isDeleted: false })
    .lean<{ occurredAt: Date | null; culprit: string; culpritEmployeeId: Types.ObjectId | null; statement: string; companyCost: number; amountCollected: number; paidAmount: number; status: string; notes: string | null }[]>()
    .exec();

let adminId = '';

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });

  dataDir = await mkdtemp(join(tmpdir(), 'fleet-go-live-ledgers-'));
  await writeFile(join(dataDir, 'cars.json'), JSON.stringify([car('LG-1'), car('LG-2')]), 'utf8');
  await mkdir(join(dataDir, 'license-photos'), { recursive: true });
  await writeFile(join(dataDir, CAR_VIOLATIONS_FILE), JSON.stringify(VIOLATIONS), 'utf8');
  await writeFile(join(dataDir, FLEET_ACCIDENT_FILE), JSON.stringify(ACCIDENTS), 'utf8');

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

  const source = getDirectoryNameSource();
  expect(source, 'HR has declared where names live').not.toBeNull();
  await mongoose.connection.collection((source as { collection: string }).collection).insertOne({
    _id: driverId,
    code: '0100001',
    status: 'active',
    isDeleted: false,
    branchId: new Types.ObjectId(),
    departmentId: new Types.ObjectId(),
    personal: { fullNameAr: 'أحمد جمال عطية', searchName: 'احمد جمال عطيه' },
  });
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

describe('both books wait for the cars', () => {
  it('refuse, unclaimed, while the vehicle run is not done — and write why', async () => {
    await runViolationsGoLive(dataDir);
    await runAccidentsGoLive(dataDir);

    expect(await FleetViolationModel.countDocuments({}).exec()).toBe(0);
    expect(await FleetAccidentModel.countDocuments({}).exec()).toBe(0);
    for (const key of [VIOLATIONS_GO_LIVE_MARK, ACCIDENTS_GO_LIVE_MARK]) {
      const doc = await run(key);
      expect(doc?.status, key).toBe('running');
      expect(doc?.outcome, key).toMatchObject({ refused: true, reason: 'vehicles-not-done' });
      expect((doc?.leaseUntil as Date).getTime(), 'and nothing to wait out').toBeLessThanOrEqual(Date.now());
    }
  });
});

describe('the violations book', () => {
  it('writes the statement rows and the fines by the catalog’s types, the grievance once, the drivers by name', async () => {
    await runVehicleGoLive(dataDir);
    expect(await FleetVehicleModel.countDocuments({}).exec()).toBe(2);

    await runViolationsGoLive(dataDir);

    const doc = await run(VIOLATIONS_GO_LIVE_MARK);
    expect(doc?.status, 'done').toBe('done');
    expect(doc?.outcome).toMatchObject({
      vehicles: 2,
      imported: 7,
      alreadyThere: 0,
      namesFilled: 0,
      grievancesWritten: 1,
      grievancesUnplaced: [],
      grievancesKept: [],
      skippedDeleted: 1,
      rejected: [],
      unknownCars: ['كوستر (1)'],
      zeroCount: ['LG-1 2025'],
      unknownTypes: ['LG-1 2025: —'],
      grievanceConflicts: [],
      unmatchedDrivers: ['سائق مجهول'],
      ambiguousDrivers: [],
    });

    const rows = await violationsOf('LG-1');
    const statements = rows.filter((r) => r.kind === 'vehicle');
    const fines = rows.filter((r) => r.kind === 'driver');
    expect(statements.map((r) => [r.year, r.count, r.unitValue, r.amount, r.collected])).toEqual([
      [2025, 9, 20, 180, false],
      [2025, 1, 550, 550, true],
      [2025, 1, 550, 550, true], // the second of two identical rows — both written
    ]);
    expect(await typeName(statements[0]!.violationTypeId)).toBe('الانتظار في الممنوع');
    expect(fines.map((r) => [r.date?.toISOString().slice(0, 10), r.amount, r.collected])).toEqual([
      ['2025-03-06', 350, true],
      ['2025-03-06', 700, false],
      ['2025-04-01', 700, false],
    ]);
    expect(await typeName(fines[0]!.violationTypeId), '«ت», written out').toBe('تليفون');
    expect(String(fines[1]!.driverEmployeeId), 'the driver, by name').toBe(String(driverId));
    expect(fines[2]!.driverEmployeeId, 'a name HR does not have — no employee').toBeNull();
    expect(fines[2]!.driverName, '…and the name kept on the fine, as text').toBe('سائق مجهول');
    // The car the registry never had: its row is kept, by the book's code and no vehicle.
    expect(await FleetViolationModel.countDocuments({ vehicleId: null, vehicleCode: 'كوستر', isDeleted: false }).exec()).toBe(1);
    expect(String(rows[0]!.createdBy), 'authored by the seeded admin').toBe(adminId);

    const grievance = await FleetGrievanceModel.findOne({ vehicleId: await vehicleId('LG-1'), year: 2025 }).lean<{ totalBeforeGrievance: number }>().exec();
    expect(grievance?.totalBeforeGrievance).toBe(5000);
  });

  it('a later boot writes nothing; a run that died is finished without a duplicate — or a dropped twin', async () => {
    const before = await FleetViolationModel.countDocuments({}).exec();
    await runViolationsGoLive(dataDir);
    expect(await FleetViolationModel.countDocuments({}).exec()).toBe(before);

    await FleetGoLiveRunModel.updateOne(
      { key: VIOLATIONS_GO_LIVE_MARK },
      { $set: { status: 'running', leaseUntil: new Date(Date.now() - 60_000), finishedAt: null, outcome: null } },
    ).exec();
    // One of the two identical rows removed underneath it: the take-over must put exactly one back.
    await FleetViolationModel.deleteOne({ vehicleId: await vehicleId('LG-1'), kind: 'vehicle', unitValue: 550 }).exec();

    await runViolationsGoLive(dataDir);

    expect(await FleetViolationModel.countDocuments({}).exec()).toBe(before);
    const doc = await run(VIOLATIONS_GO_LIVE_MARK);
    expect(doc?.status).toBe('done');
    expect(doc?.outcome).toMatchObject({ imported: 1, alreadyThere: 6, grievancesWritten: 0 });
    expect(await FleetGrievanceModel.countDocuments({}).exec(), 'the grievance figure, once').toBe(1);
  });
});

describe('the accidents book', () => {
  it('writes the files with the culprit as written and the employee where known; lists what it cannot place', async () => {
    await runAccidentsGoLive(dataDir);

    const doc = await run(ACCIDENTS_GO_LIVE_MARK);
    expect(doc?.status, 'done').toBe('done');
    expect(doc?.outcome).toMatchObject({
      vehicles: 3,
      imported: 4,
      alreadyThere: 0,
      skippedDeleted: 1,
      rejected: [],
      unknownCars: ['تويوتا1 (1)'],
      noDate: ['LG-1: احمد جمال'],
      statementFilled: 1,
      blankAmounts: 1,
      amountNotes: ['LG-2 2025-02-01: amountCollected: من عبدالرحمن'],
      unmatchedCulprits: ['سائق تاكسي'],
    });

    const lg1 = await accidentsOf('LG-1');
    // The file with no date is KEPT — with none — beside the dated one.
    expect(lg1.map((a) => a.occurredAt?.toISOString().slice(0, 10) ?? null).sort()).toEqual(['2025-02-01', null].sort());
    const closed = lg1.find((a) => a.occurredAt !== null);
    expect(closed).toMatchObject({ culprit: 'احمد جمال', statement: 'فنوس امامى', companyCost: 0, amountCollected: 1400, paidAmount: 1400, status: 'closed', notes: 'تم الاصلاح' });
    expect(String(closed!.culpritEmployeeId), 'two of three names, matched as a prefix').toBe(String(driverId));
    const [open] = await accidentsOf('LG-2');
    expect(open).toMatchObject({ culprit: 'سائق تاكسي', culpritEmployeeId: null, statement: NOT_STATED, amountCollected: 4650, paidAmount: 0, status: 'open', notes: null });
    // The car the registry never had: its file is kept, by the book's code and no vehicle.
    expect(await FleetAccidentModel.countDocuments({ vehicleId: null, vehicleCode: 'تويوتا1', isDeleted: false }).exec()).toBe(1);
  });

  it('a later boot writes nothing at all', async () => {
    const before = await FleetAccidentModel.countDocuments({}).exec();
    await runAccidentsGoLive(dataDir);
    expect(await FleetAccidentModel.countDocuments({}).exec()).toBe(before);
    expect((await run(ACCIDENTS_GO_LIVE_MARK))?.status).toBe('done');
  });
});
