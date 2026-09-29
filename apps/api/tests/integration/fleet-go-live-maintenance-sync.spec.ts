// The workshop sync, against a real mongo — the owner's second workshop export brought onto the
// visits the first one filled, in the order an operator meets it.
//
//   1. It WAITS for the workshop import: until that run is done it refuses, unclaimed.
//   2. The run that can proceed applies each changed field by the three-way rule — the new value
//      where ECMS still holds the import's, a count where ECMS already holds the new one, the
//      person's value KEPT and listed where somebody changed it since — soft-deletes a visit the
//      old book has now deleted, and lists a change whose visit it cannot find.
//   3. It adds the new rows by the import's own rules: a visit freed by a change is the car's
//      open slot for the next one, a new row that shares an old one's key is still written, a
//      visit a person already typed is counted, a second open visit is written deleted.
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
import { FleetMaintenanceVisitModel } from '../../src/modules/fleet/maintenance/maintenance.model';
import { FleetCatalogItemModel } from '../../src/modules/fleet/catalogs/catalog-item.model';
import { FleetGoLiveRunModel } from '../../src/modules/fleet/go-live/go-live-run.model';
import { runVehicleGoLive } from '../../src/modules/fleet/go-live/vehicles';
import { CARS_LOG_FILE, runOdometerGoLive } from '../../src/modules/fleet/go-live/odometer';
import { runMaintenanceGoLive } from '../../src/modules/fleet/go-live/maintenance';
import {
  MAINTENANCE_SYNC_GO_LIVE_MARK,
  MAINTENANCE_SYNC_NEW_FILE,
  MAINTENANCE_SYNC_OLD_FILE,
  runMaintenanceSyncGoLive,
} from '../../src/modules/fleet/go-live/maintenance-sync';

let replset: MongoMemoryReplSet | undefined;
let dataDir = '';

const BRANCH = 'فرع مزامنة الورشة';

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

/** The odometer book: one reading on MS-3, so a visit without a counter has somewhere to take one. */
const READINGS = [
  {
    _id: { $oid: new Types.ObjectId().toHexString() },
    car_code: 'MS-3',
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

const log = (id: string, over: Record<string, unknown>) => ({
  _id: { $oid: id },
  in_date: '2025-01-13',
  out_date: '2025-01-20',
  car_code: 'MS-1',
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

/** The old system's row ids — the same row in both exports. */
const ID = Object.fromEntries(
  ['F', 'A', 'B', 'C', 'D', 'E', 'N', 'G', 'H', 'J', 'K', 'L', 'M'].map((key) => [
    key,
    new Types.ObjectId().toHexString(),
  ]),
) as Record<string, string>;

/** What `go-live:maintenance:v3` imported — the OLD side of the rule. */
const OLD_ROWS = {
  // MS-1: a closed service, and the visit it is still in.
  F: log(ID.F as string, { counter: '6000' }),
  A: log(ID.A as string, {
    in_date: '2025-04-01',
    out_date: null,
    works: 'إصلاح',
    counter: '8000',
  }),
  // MS-2: the visit it is in, and an older closed one.
  B: log(ID.B as string, {
    car_code: 'MS-2',
    in_date: '2025-04-01',
    out_date: null,
    works: 'إصلاح',
    counter: '100',
  }),
  N: log(ID.N as string, {
    car_code: 'MS-2',
    in_date: '2025-02-01',
    out_date: '2025-02-02',
    counter: '50',
    notes: 'n1',
  }),
  // MS-3: a service with no counter in the book — the import took 5000 from the reading on the 10th.
  C: log(ID.C as string, { car_code: 'MS-3', in_date: '2025-02-01', out_date: '2025-02-03' }),
  // MS-4 and MS-5: closed repairs.
  D: log(ID.D as string, {
    car_code: 'MS-4',
    in_date: '2025-03-01',
    out_date: '2025-03-02',
    works: 'إصلاح',
    counter: '700',
    notes: 'x',
  }),
  E: log(ID.E as string, {
    car_code: 'MS-5',
    in_date: '2025-05-01',
    out_date: '2025-05-03',
    works: 'إصلاح',
    counter: '900',
    notes: 'a',
  }),
};
const OLD = Object.values(OLD_ROWS);

/** The second export — every kind of change and every kind of new row the step meets. */
const NEW = [
  OLD_ROWS.F,
  // Untouched on ECMS since the import: every change applies — the car leaves, a part, a driver.
  { ...OLD_ROWS.A, out_date: '2025-04-05', driver2: 'اشرف نصحى', spare_parts: ['زيت'] },
  // Checked out on ECMS since, a different day and a driver the book does not name: kept, listed.
  { ...OLD_ROWS.B, out_date: '2025-04-06', driver2: 'معتز' },
  // The counter the book left blank, written in: applied over the import's stand-in.
  { ...OLD_ROWS.C, counter: '5100' },
  // Deleted in the old system since: deleted here, softly, with the book's day of it.
  { ...OLD_ROWS.D, deleted: 1, deleted_date: { $date: '2025-06-01T09:00:00.000Z' } },
  // The same note somebody already typed on ECMS: counted, not written.
  { ...OLD_ROWS.E, notes: 'b' },
  // Its day in was corrected on ECMS since: the visit is not found by its old key — listed.
  { ...OLD_ROWS.N, notes: 'n2' },
  // NEW ROWS. MS-1's next visit — open, in the slot the change above frees.
  log(ID.G as string, {
    in_date: '2025-06-01',
    out_date: null,
    counter: '9000',
    driver: 'اشرف نصحى',
  }),
  // A second MS-1 visit under F's key — written, not mistaken for F's visit.
  log(ID.H as string, { out_date: '2025-01-14', counter: '6100' }),
  // An open visit on MS-5, which somebody has in a workshop on ECMS already: written deleted.
  log(ID.J as string, {
    car_code: 'MS-5',
    in_date: '2025-06-03',
    out_date: null,
    works: 'إصلاح',
    counter: '960',
  }),
  // A visit somebody already typed on ECMS: counted.
  log(ID.K as string, {
    car_code: 'MS-4',
    in_date: '2025-06-10',
    out_date: '2025-06-11',
    counter: '1000',
  }),
  // A visit the old system had deleted: it arrives deleted.
  log(ID.L as string, {
    car_code: 'MS-3',
    in_date: '2025-06-15',
    out_date: '2025-06-16',
    counter: '5200',
    deleted: 1,
    deleted_date: { $date: '2025-06-20T00:00:00.000Z' },
  }),
  // No counter: taken from the odometer chain.
  log(ID.M as string, { car_code: 'MS-3', in_date: '2025-07-01', out_date: '2025-07-02' }),
];

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const run = async () =>
  FleetGoLiveRunModel.findOne({ key: MAINTENANCE_SYNC_GO_LIVE_MARK })
    .lean<{ status: string; leaseUntil: Date; outcome: Record<string, unknown> | null } | null>()
    .exec();

const vehicleId = async (code: string): Promise<Types.ObjectId> => {
  const doc = await FleetVehicleModel.findOne({ code }, { _id: 1 })
    .lean<{ _id: Types.ObjectId }>()
    .exec();
  return (doc as { _id: Types.ObjectId })._id;
};

const catalogId = async (kind: string, name: string): Promise<Types.ObjectId> => {
  const doc = await FleetCatalogItemModel.findOne(
    { kind, 'name.ar': name, isDeleted: false },
    { _id: 1 },
  )
    .lean<{ _id: Types.ObjectId }>()
    .exec();
  return (doc as { _id: Types.ObjectId })._id;
};

interface VisitRow {
  _id: Types.ObjectId;
  __v: number;
  inDate: Date;
  outDate: Date | null;
  sparePartIds: Types.ObjectId[];
  odometerAtService: number;
  driverOutEmployeeId: Types.ObjectId | null;
  driverOutName: string | null;
  notes: string | null;
  isDeleted: boolean;
  deletedAt: Date | null;
  deletedBy: Types.ObjectId | null;
}

/** One car's visit by its day in — in ANY state: a deleted visit is still in the database. */
const visit = async (code: string, inDate: string): Promise<VisitRow> =>
  (await FleetMaintenanceVisitModel.findOne({
    vehicleId: await vehicleId(code),
    inDate: new Date(`${inDate}T00:00:00.000Z`),
  })
    .lean<VisitRow>()
    .exec()) as VisitRow;

const day = (date: Date | null): string | null =>
  date === null ? null : date.toISOString().slice(0, 10);

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });

  dataDir = await mkdtemp(join(tmpdir(), 'fleet-go-live-maintenance-sync-'));
  await writeFile(
    join(dataDir, 'cars.json'),
    JSON.stringify(['MS-1', 'MS-2', 'MS-3', 'MS-4', 'MS-5'].map(car)),
    'utf8',
  );
  await mkdir(join(dataDir, 'license-photos'), { recursive: true });
  await writeFile(join(dataDir, CARS_LOG_FILE), JSON.stringify(READINGS), 'utf8');
  await writeFile(join(dataDir, MAINTENANCE_SYNC_OLD_FILE), JSON.stringify(OLD), 'utf8');
  await writeFile(join(dataDir, MAINTENANCE_SYNC_NEW_FILE), JSON.stringify(NEW), 'utf8');

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
  await branchService.create({ code: 'MSY', name: { ar: BRANCH, en: BRANCH } }, String(user._id));

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

describe('it waits for the workshop import', () => {
  it('refuses, unclaimed, while the workshop run is not done — and writes why', async () => {
    await runVehicleGoLive(dataDir);
    await runOdometerGoLive(dataDir);
    // The cars and the readings are in; the workshop book is not.
    await runMaintenanceSyncGoLive(dataDir);

    expect(await FleetMaintenanceVisitModel.countDocuments({}).exec(), 'no visit was written').toBe(
      0,
    );
    const doc = await run();
    expect(doc?.status).toBe('running');
    expect(doc?.outcome).toMatchObject({ refused: true, reason: 'maintenance-not-done' });
    expect((doc?.leaseUntil as Date).getTime(), 'and nothing to wait out').toBeLessThanOrEqual(
      Date.now(),
    );
  });
});

describe('the run that can proceed', () => {
  it('applies each change by the three-way rule, and adds the new rows by the import’s own', async () => {
    await runMaintenanceGoLive(dataDir);
    expect(await FleetMaintenanceVisitModel.countDocuments({}).exec(), 'the old book landed').toBe(
      7,
    );

    // What the company did on ECMS between the two exports.
    await FleetMaintenanceVisitModel.updateOne(
      { vehicleId: await vehicleId('MS-2'), inDate: new Date('2025-04-01T00:00:00.000Z') },
      {
        $set: {
          outDate: new Date('2025-04-04T00:00:00.000Z'),
          driverOutEmployeeId: driverId,
          exitOdometer: 150,
        },
        $inc: { __v: 1 },
      },
    ).exec();
    await FleetMaintenanceVisitModel.updateOne(
      { vehicleId: await vehicleId('MS-2'), inDate: new Date('2025-02-01T00:00:00.000Z') },
      { $set: { inDate: new Date('2025-02-02T00:00:00.000Z') }, $inc: { __v: 1 } },
    ).exec();
    await FleetMaintenanceVisitModel.updateOne(
      { vehicleId: await vehicleId('MS-5'), inDate: new Date('2025-05-01T00:00:00.000Z') },
      { $set: { notes: 'b' }, $inc: { __v: 1 } },
    ).exec();
    await FleetMaintenanceVisitModel.create({
      vehicleId: await vehicleId('MS-5'),
      inDate: new Date('2025-06-20T00:00:00.000Z'),
      outDate: null,
      workshopId: await catalogId('workshop', 'mcv'),
      workTypeId: await catalogId('workType', 'صيانة'),
      odometerAtService: 950,
    });
    await FleetMaintenanceVisitModel.create({
      vehicleId: await vehicleId('MS-4'),
      inDate: new Date('2025-06-10T00:00:00.000Z'),
      outDate: new Date('2025-06-11T00:00:00.000Z'),
      workshopId: await catalogId('workshop', 'mcv'),
      workTypeId: await catalogId('workType', 'صيانة'),
      odometerAtService: 1000,
    });
    const e = await visit('MS-5', '2025-05-01');

    await runMaintenanceSyncGoLive(dataDir);

    const doc = await run();
    expect(doc?.status, 'done').toBe('done');
    expect(doc?.outcome).toMatchObject({
      exportRows: 13,
      added: 5, // G, H, J, L, M — K was typed on ECMS already
      alreadyThere: 1,
      changed: { outDate: 1, spareParts: 1, counter: 1, driverOut: 1, notes: 0, deleted: 1 },
      changesAlreadyThere: { notes: 1 },
      keptEcmsEditsCount: 2,
      deletedByBook: ['MS-4 2025-03-01'],
      restoredByBook: [],
      unappliedCount: 1,
      parkedChanged: [],
      inExport: { outDate: 2, spareParts: 1, driverOut: 2, counter: 1, deleted: 1, notes: 2 },
      columnsChanged: {
        out_date: 2,
        driver2: 2,
        spare_parts: 1,
        counter: 1,
        deleted: 1,
        deleted_date: 1,
        notes: 2,
      },
      goneFromExport: [],
      namesFilled: 0,
      counterFromOdometer: 1,
      noCounter: [],
      counterUnknown: [],
      openConflicts: ['MS-5 2025-06-03'],
      outBeforeIn: [],
      catalogCreated: [],
      keptDeleted: 1,
      unreadable: [],
      deletedRows: 1,
      unknownCars: [],
      unmatchedDrivers: ['معتز'],
      ambiguousDrivers: [],
      placeholders: ['-'],
    });
    const outcome = doc?.outcome as {
      keptEcmsEdits: Record<string, unknown>[];
      unapplied: Record<string, unknown>[];
    };
    expect(outcome.keptEcmsEdits).toEqual([
      {
        code: 'MS-2',
        date: '2025-04-01',
        field: 'outDate',
        ecms: '2025-04-04',
        old: null,
        new: '2025-04-06',
      },
      {
        code: 'MS-2',
        date: '2025-04-01',
        field: 'driverOut',
        ecms: expect.any(String),
        old: null,
        new: 'معتز',
      },
    ]);
    expect(outcome.unapplied).toEqual([
      {
        code: 'MS-2',
        date: '2025-02-01',
        field: 'notes',
        reason: expect.stringContaining('not on ECMS'),
      },
    ]);

    // A: closed on the book's day, with its part and the driver HR knows.
    const a = await visit('MS-1', '2025-04-01');
    expect(day(a.outDate)).toBe('2025-04-05');
    expect(a.sparePartIds.map(String)).toEqual([String(await catalogId('sparePart', 'زيت'))]);
    expect(String(a.driverOutEmployeeId)).toBe(String(driverId));
    expect(a.driverOutName).toBeNull();
    expect(a.__v, 'one write').toBe(1);
    // B: the person's check-out survived whole.
    const b = await visit('MS-2', '2025-04-01');
    expect(day(b.outDate)).toBe('2025-04-04');
    expect(String(b.driverOutEmployeeId)).toBe(String(driverId));
    expect(b.__v, 'only the person’s write').toBe(1);
    // C: the book's counter over the import's stand-in.
    expect((await visit('MS-3', '2025-02-01')).odometerAtService).toBe(5100);
    // D: deleted — off the screen, in the database, carrying the book's day and nobody's name.
    const d = await visit('MS-4', '2025-03-01');
    expect([d.isDeleted, d.deletedAt?.toISOString(), d.deletedBy]).toEqual([
      true,
      '2025-06-01T09:00:00.000Z',
      null,
    ]);
    // E: already there — not written at all.
    expect((await visit('MS-5', '2025-05-01')).__v).toBe(e.__v);
    // N: the person's corrected day, untouched.
    expect((await visit('MS-2', '2025-02-02')).notes).toBe('n1');

    // The new rows. MS-1: H beside F under one key, and G in the open slot A's closing freed.
    const ms1 = await FleetMaintenanceVisitModel.find({
      vehicleId: await vehicleId('MS-1'),
      isDeleted: false,
    })
      .sort({ inDate: 1, odometerAtService: 1 })
      .lean<VisitRow[]>()
      .exec();
    expect(ms1.map((v) => [day(v.inDate), day(v.outDate), v.odometerAtService])).toEqual([
      ['2025-01-13', '2025-01-20', 6000],
      ['2025-01-13', '2025-01-14', 6100],
      ['2025-04-01', '2025-04-05', 8000],
      ['2025-06-01', null, 9000],
    ]);
    // MS-3: the book's deleted visit arrives deleted; the one with no counter takes the chain's.
    const l = await visit('MS-3', '2025-06-15');
    expect([l.isDeleted, l.deletedAt?.toISOString()]).toEqual([true, '2025-06-20T00:00:00.000Z']);
    expect((await visit('MS-3', '2025-07-01')).odometerAtService).toBe(5000);
    // MS-4: the visit typed on ECMS was not written again.
    expect(
      await FleetMaintenanceVisitModel.countDocuments({
        vehicleId: await vehicleId('MS-4'),
        inDate: new Date('2025-06-10T00:00:00.000Z'),
      }).exec(),
    ).toBe(1);
    // MS-5: the book's open visit is kept, deleted — the car is never in two workshops.
    const j = await visit('MS-5', '2025-06-03');
    expect([j.isDeleted, j.odometerAtService]).toEqual([true, 960]);
    expect(
      await FleetMaintenanceVisitModel.countDocuments({
        vehicleId: await vehicleId('MS-5'),
        outDate: null,
        isDeleted: false,
      }).exec(),
    ).toBe(1);
  });

  it('writes nothing at all on a later boot — not even a version bump', async () => {
    const before = await FleetMaintenanceVisitModel.countDocuments({}).exec();
    const a = await visit('MS-1', '2025-04-01');

    await runMaintenanceSyncGoLive(dataDir);

    expect(await FleetMaintenanceVisitModel.countDocuments({}).exec()).toBe(before);
    expect((await visit('MS-1', '2025-04-01')).__v).toBe(a.__v);
    expect((await run())?.status).toBe('done');
  });
});

describe('a run that died is finished by the next boot', () => {
  it('takes over an expired lease and finds everything the first run wrote already there', async () => {
    await FleetGoLiveRunModel.updateOne(
      { key: MAINTENANCE_SYNC_GO_LIVE_MARK },
      {
        $set: {
          status: 'running',
          leaseUntil: new Date(Date.now() - 60_000),
          finishedAt: null,
          outcome: null,
        },
      },
    ).exec();
    const before = await FleetMaintenanceVisitModel.countDocuments({}).exec();
    const a = await visit('MS-1', '2025-04-01');

    await runMaintenanceSyncGoLive(dataDir);

    const doc = await run();
    expect(doc?.status, 'the take-over finished the job').toBe('done');
    expect(doc?.outcome).toMatchObject({
      added: 0,
      alreadyThere: 6, // G, H, J, K, L, M
      changed: { outDate: 0, spareParts: 0, counter: 0, driverOut: 0, notes: 0, deleted: 0 },
      changesAlreadyThere: {
        outDate: 1,
        spareParts: 1,
        driverOut: 1,
        counter: 1,
        deleted: 1,
        notes: 1,
      },
      keptEcmsEditsCount: 2,
      unappliedCount: 1,
      deletedByBook: [],
      openConflicts: [],
      catalogCreated: [],
    });
    expect(
      await FleetMaintenanceVisitModel.countDocuments({}).exec(),
      'no visit written twice',
    ).toBe(before);
    expect((await visit('MS-1', '2025-04-01')).__v, 'A was not written twice').toBe(a.__v);
  });
});
