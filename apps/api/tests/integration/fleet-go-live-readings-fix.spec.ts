// The readings fix for cars 219, 295, 248 and 249, against a real mongo — on the shapes the
// 29 September export holds for each, in the order an operator meets them.
//
//   1. It WAITS for both books' second exports: until they are done it refuses, unclaimed.
//   2. The run clears the row that opens on an impossible figure (219's 118,722, 295's 79,200),
//      closes the row before it on the reading the book has next, keeps the figures in the notes,
//      audits each, and sets 295's empty counter of 6 October to the owner's 22,790.
//   3. (a2) 249's 2 and 3 September readings stood above its 5 September counter of 113,325 —
//      «117647 دى قراءة النهارده / 113325 دى اخر صيانه»: the 3rd, which opens above it, becomes a
//      day without a reading, the 2nd closes on 6 September's opening, nothing of the maintenance
//      day or after is touched, and the board takes the counter.
//   4. It writes no reading of today, and reports — 249 now reaching the owner's 4,322.
//   5. A deleted row holding the same figure is not touched; a second run writes nothing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { env } from '../../src/infrastructure/config/env';
import { userService } from '../../src/platform/users';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import { FleetVehicleTypeModel } from '../../src/modules/fleet/vehicle-types/vehicle-type.model';
import { FleetCatalogItemModel } from '../../src/modules/fleet/catalogs/catalog-item.model';
import {
  FleetOdometerLogModel,
  type FleetOdometerLogDoc,
} from '../../src/modules/fleet/odometer/odometer.model';
import {
  FleetMaintenanceVisitModel,
  type FleetMaintenanceVisitDoc,
} from '../../src/modules/fleet/maintenance/maintenance.model';
import { FleetGoLiveRunModel } from '../../src/modules/fleet/go-live/go-live-run.model';
import { ODOMETER_SYNC_GO_LIVE_MARK } from '../../src/modules/fleet/go-live/odometer-sync';
import { MAINTENANCE_SYNC_GO_LIVE_MARK } from '../../src/modules/fleet/go-live/maintenance-sync';
import {
  READINGS_FIX_GO_LIVE_MARK,
  applyReadingsFix,
  runReadingsFixGoLive,
} from '../../src/modules/fleet/go-live/readings-fix';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const on = (day: string): Date => new Date(`${day}T00:00:00.000Z`);
const typeId = new Types.ObjectId();
const service = new Types.ObjectId();
const driver = new Types.ObjectId();
type Code = '219' | '295' | '248' | '249';
const cars: Record<Code, Types.ObjectId> = {
  '219': new Types.ObjectId(),
  '295': new Types.ObjectId(),
  '248': new Types.ObjectId(),
  '249': new Types.ObjectId(),
};

const base = () => ({
  schemaVersion: 1,
  isDeleted: false,
  deletedAt: null,
  deletedBy: null,
  createdBy: null,
  updatedBy: null,
  createdAt: on('2026-09-29'),
  updatedAt: on('2026-09-29'),
  __v: 0,
});

/** The rows are inserted in the order given, so `_id` orders two rows of one day as written. */
const rows: {
  code: Code;
  _id: Types.ObjectId;
  day: string;
  out: number;
  in: number | null;
  deleted?: boolean;
}[] = [];
const reading = (
  code: Code,
  day: string,
  out: number,
  inReading: number | null,
  deleted = false,
) => {
  const entry = { code, _id: new Types.ObjectId(), day, out, in: inReading, deleted };
  rows.push(entry);
  return entry._id;
};

// 219 — 30 July opens on 118,722 where 85,5xx was meant, and the book closed 29 July on it.
reading('219', '2026-06-24', 83992, 84037);
reading('219', '2026-06-25', 84037, 84189);
reading('219', '2026-06-28', 84189, 85482);
const r219close = reading('219', '2026-07-29', 85482, 118722);
const r219typo = reading('219', '2026-07-30', 118722, 85543);
reading('219', '2026-07-31', 85543, 89234);
reading('219', '2026-09-29', 89234, null);
// The same figure on a row somebody already deleted — never touched.
const r219deleted = reading('219', '2026-08-01', 118722, 118800, true);
// 295 — two rows on 30 July: the second opens on 79,200.
reading('295', '2026-07-29', 7884, 7997);
const r295close = reading('295', '2026-07-30', 7997, 79200);
const r295typo = reading('295', '2026-07-30', 79200, 10184);
reading('295', '2026-08-02', 10184, 22400);
reading('295', '2026-10-05', 22400, null);
// 248 — today's reading already on the board.
reading('248', '2026-10-08', 121500, 121679);
reading('248', '2026-10-11', 121679, null);
// 249 — as the 29 September export has it: the readings stood at 114,871 by 3 September, above
// the 113,325 of the 5 September service.
const r249before = reading('249', '2026-09-01', 112533, 112840);
const r249closes = reading('249', '2026-09-02', 112840, 114871);
const r249opens = reading('249', '2026-09-03', 114871, 115142);
// Deleted in the old book on 6 September, as the export has it — never touched.
const r249deleted = reading('249', '2026-09-04', 114955, 115124, true);
// The maintenance day and after: above the counter, and not (a2)'s.
const r249after = reading('249', '2026-09-06', 115124, 116910);
reading('249', '2026-09-29', 116910, null);

const visitIds: Record<Code, Types.ObjectId> = {
  '219': new Types.ObjectId(),
  '295': new Types.ObjectId(),
  '248': new Types.ObjectId(),
  '249': new Types.ObjectId(),
};
const visit = (code: Code, inDay: string, outDay: string, counter: number | null) => ({
  _id: visitIds[code],
  vehicleId: cars[code],
  vehicleCode: null,
  inDate: on(inDay),
  outDate: on(outDay),
  workshopId: new Types.ObjectId(),
  workTypeId: service,
  spareParts: [],
  sparePartIds: [],
  odometerAtService: counter,
  exitOdometer: null,
  driverInEmployeeId: null,
  driverOutEmployeeId: null,
  driverInName: null,
  driverOutName: null,
  takenInByEmployeeId: null,
  takenOutByEmployeeId: null,
  notes: null,
  ...base(),
});

const row = async (id: Types.ObjectId) =>
  (await FleetOdometerLogModel.findById(id)
    .lean<FleetOdometerLogDoc>()
    .exec()) as FleetOdometerLogDoc;
const visitOf = async (code: Code) =>
  (await FleetMaintenanceVisitModel.findById(visitIds[code])
    .lean<FleetMaintenanceVisitDoc>()
    .exec()) as FleetMaintenanceVisitDoc;
const runRow = () => FleetGoLiveRunModel.findOne({ key: READINGS_FIX_GO_LIVE_MARK }).lean().exec();

let adminId = '';

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
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

  await FleetVehicleTypeModel.collection.insertOne({
    _id: typeId,
    name: { ar: 'نوع اختبار القراءات', en: 'Readings test type' },
    maintenanceIntervalKm: 10000,
    isActive: true,
    sortOrder: null,
    ...base(),
  });
  await FleetCatalogItemModel.collection.insertOne({
    _id: service,
    kind: 'workType',
    name: { ar: 'صيانة اختبار القراءات', en: 'Readings test service' },
    countsForAlarm: true,
    violationSide: null,
    isActive: true,
    sortOrder: null,
    ...base(),
  });
  await FleetVehicleModel.collection.insertMany(
    Object.entries(cars).map(([code, _id]) => ({
      _id,
      code,
      typeId,
      plateNumber: `ق ر ${code}`,
      chassisNumber: `RF-CH-${code}`,
      motorNumber: `RF-MO-${code}`,
      joinedAt: on('2025-01-01'),
      licenseExpiresAt: on('2027-01-01'),
      branchId: new Types.ObjectId(),
      status: 'active',
      statusReason: null,
      ...base(),
    })),
  );
  await FleetOdometerLogModel.collection.insertMany(
    rows.map((entry) => ({
      _id: entry._id,
      vehicleId: cars[entry.code],
      vehicleCode: null,
      date: on(entry.day),
      outReading: entry.out,
      inReading: entry.in,
      km: entry.in === null ? null : entry.in - entry.out,
      driver1EmployeeId: entry._id.equals(r219typo) ? driver : null,
      driver2EmployeeId: null,
      driver1Name: null,
      driver2Name: null,
      notes: entry._id.equals(r219typo) ? 'اسوان' : null,
      ...base(),
      ...(entry.deleted ? { isDeleted: true, deletedAt: on('2026-08-02') } : {}),
    })),
  );
  await FleetMaintenanceVisitModel.collection.insertMany([
    visit('219', '2026-06-25', '2026-06-28', 84080),
    // Every counter typed on 295 since July was refused below 79,200 — the visit has none.
    visit('295', '2026-10-06', '2026-10-06', null),
    visit('248', '2026-10-09', '2026-10-09', 121679),
    visit('249', '2026-09-05', '2026-09-05', 113325),
  ]);
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

describe('it waits for both books’ second exports', () => {
  it('refuses, unclaimed, while they are not done — and writes why', async () => {
    await runReadingsFixGoLive();
    const doc = await runRow();
    expect(doc?.status).toBe('running');
    expect(doc?.outcome).toMatchObject({ refused: true, reason: 'syncs-not-done' });
    expect((await row(r219typo)).outReading, 'nothing was written').toBe(118722);

    const now = new Date();
    for (const key of [ODOMETER_SYNC_GO_LIVE_MARK, MAINTENANCE_SYNC_GO_LIVE_MARK]) {
      await FleetGoLiveRunModel.create({
        key,
        status: 'done',
        leaseUntil: now,
        startedAt: now,
        finishedAt: now,
        outcome: {},
      });
    }
  });
});

describe('the owner’s four cars', () => {
  it('219: 30 July becomes a day without a reading, 29 July closes on 85,543 — figures kept in the notes', async () => {
    await runReadingsFixGoLive();

    const typo = await row(r219typo);
    expect([typo.outReading, typo.inReading, typo.km]).toEqual([null, null, null]);
    expect(typo.notes).toBe('اسوان · كما كُتب: عداد الخروج 118722، عداد الدخول 85543');
    expect(String(typo.driver1EmployeeId), 'who drove that day is kept').toBe(String(driver));
    expect(typo.isDeleted).toBe(false);

    const closed = await row(r219close);
    expect([closed.outReading, closed.inReading, closed.km]).toEqual([85482, 85543, 61]);
    expect(closed.notes).toBe('عداد الدخول كما كُتب: 118722');

    const deleted = await row(r219deleted);
    expect(
      [deleted.outReading, deleted.inReading, deleted.notes],
      'a deleted row is never touched',
    ).toEqual([118722, 118800, null]);
  });

  it('295: the second row of 30 July is cleared, the first closes on 10,184, and the 6 October counter is the owner’s', async () => {
    const typo = await row(r295typo);
    expect([typo.outReading, typo.inReading]).toEqual([null, null]);
    const closed = await row(r295close);
    expect([closed.inReading, closed.km]).toEqual([10184, 2187]);

    const counter = await visitOf('295');
    expect(counter.odometerAtService).toBe(22790);
    expect(counter.notes).toBe('العداد عند الصيانة كما كُتب: —');
  });

  it('249: 3 September opens above the 113,325 counter — a day without a reading; 2 September only closes above it — closed on 6 September’s 115,124', async () => {
    const opens = await row(r249opens);
    expect([opens.outReading, opens.inReading, opens.km]).toEqual([null, null, null]);
    expect(opens.notes).toBe('كما كُتب: عداد الخروج 114871، عداد الدخول 115142');
    const closes = await row(r249closes);
    expect([closes.outReading, closes.inReading, closes.km]).toEqual([112840, 115124, 2284]);
    expect(closes.notes).toBe('عداد الدخول كما كُتب: 114871');
    expect([opens.isDeleted, closes.isDeleted], 'never deleted').toEqual([false, false]);

    const before = await row(r249before);
    expect([before.outReading, before.inReading, before.notes], 'at or below the counter').toEqual([
      112533,
      112840,
      null,
    ]);
    const deleted = await row(r249deleted);
    expect([deleted.outReading, deleted.inReading, deleted.notes], 'deleted').toEqual([
      114955,
      115124,
      null,
    ]);
    const after = await row(r249after);
    expect([after.outReading, after.inReading, after.notes], 'after the maintenance').toEqual([
      115124,
      116910,
      null,
    ]);

    // The chain is whole: each row on it closes on the next one's opening.
    const chain = await FleetOdometerLogModel.find({
      vehicleId: cars['249'],
      isDeleted: false,
      outReading: { $ne: null },
    })
      .sort({ date: 1, _id: 1 })
      .lean<FleetOdometerLogDoc[]>()
      .exec();
    expect(chain.map((entry) => [entry.outReading, entry.inReading])).toEqual([
      [112533, 112840],
      [112840, 115124],
      [115124, 116910],
      [116910, null],
    ]);
  });

  it('248 and 249: their counters are the owner’s already — not written', async () => {
    expect((await visitOf('248')).odometerAtService).toBe(121679);
    expect((await visitOf('249')).odometerAtService).toBe(113325);
    expect((await visitOf('249')).notes).toBeNull();
  });

  it('no reading of today is written — that is the clerk’s', async () => {
    const today = await FleetOdometerLogModel.countDocuments({ date: on('2026-10-11') }).exec();
    expect(today, 'only 248’s, which was there before').toBe(1);
  });

  it('every change is audited under the seeding admin', async () => {
    const audits = await AuditLogModel.find({
      'entityRef.entityId': {
        $in: [r219typo, r219close, r295typo, r295close, r249closes, r249opens, visitIds['295']].map(
          String,
        ),
      },
    })
      .lean()
      .exec();
    expect(audits).toHaveLength(7);
    for (const audit of audits) {
      expect(String(audit.actor.userId)).toBe(adminId);
      expect(audit.changes).toContainEqual({
        field: 'source',
        old: null,
        new: READINGS_FIX_GO_LIVE_MARK,
      });
    }
    const cleared = audits.find((audit) => audit.entityRef.entityId === String(r219typo));
    expect(cleared?.action).toBe('correct');
    expect(cleared?.changes).toContainEqual({ field: 'outReading', old: '118722', new: null });
    expect(cleared?.changes).toContainEqual({ field: 'dayWithoutReading', old: null, new: true });
    const reclosed249 = audits.find((audit) => audit.entityRef.entityId === String(r249closes));
    expect(reclosed249?.changes).toContainEqual({
      field: 'inReading',
      old: '114871',
      new: '115124',
    });
    const counter = audits.find((audit) => audit.entityRef.entityId === String(visitIds['295']));
    expect(counter?.changes).toContainEqual({
      field: 'odometerAtService',
      old: null,
      new: '22790',
    });
  });

  it('the run is done, and says per car what it did and what the board says', async () => {
    const doc = await runRow();
    expect(doc?.status).toBe('done');
    const outcome = doc?.outcome as Record<string, string[]>;
    expect(outcome['applied']).toEqual([
      '219: 2 readings',
      '295: 2 readings, the 2026-10-06 counter',
      '249: 2 readings',
    ]);
    expect(outcome['skipped']).toEqual([
      '248: no reading above 121679 before 2026-10-11, nor above 121679 before 2026-10-09; the 2026-10-09 counter is already 121679',
    ]);
    expect(outcome['readingsCleared']).toEqual([
      '219 2026-07-30: 118722 → 85543 — now a day without a reading',
      '295 2026-07-30: 79200 → 10184 — now a day without a reading',
      '249 2026-09-03: 114871 → 115142 — now a day without a reading; opens above the 2026-09-05 maintenance counter 113325',
    ]);
    expect(outcome['readingsReclosed']).toEqual([
      '219 2026-07-29: 85482 → 118722, now → 85543',
      '295 2026-07-30: 7997 → 79200, now → 10184',
      '249 2026-09-02: 112840 → 114871, now → 115124; closed above the 2026-09-05 maintenance counter 113325',
    ]);
    expect(outcome['readingsLeft']).toEqual([]);
    expect(outcome['countersSet']).toEqual(['295 2026-10-06 odometerAtService: — → 22790']);
    expect(outcome['todayReading']).toEqual([
      '219 2026-10-11: no reading yet; 90246 would be accepted',
      '295 2026-10-11: no reading yet; 24892 would be accepted',
      '248 2026-10-11: 121679 is on the board',
      '249 2026-10-11: no reading yet; 117647 would be accepted',
    ]);
    // 219 measures from its entry counter on the day it went IN, now that 118,722 is gone.
    expect(outcome['alarmNow']).toContainEqual(
      expect.stringMatching(/^219: 5154 km since the service/),
    );
    expect(outcome['alarmOnceRecorded']).toContainEqual(
      "219: 6166 km once 90246 is recorded — the owner's 6166 ✓",
    );
    expect(outcome['alarmOnceRecorded']).toContainEqual(
      "295: 2102 km once 24892 is recorded — the owner's 2102 ✓",
    );
    expect(outcome['alarmOnceRecorded']).toContainEqual(
      "248: 0 km once 121679 is recorded — the owner's 0 ✓",
    );
    // 249 measures from the owner's 113,325 now that 2 and 3 September no longer stand above it.
    expect(outcome['alarmNow']).toContainEqual(
      expect.stringMatching(/^249: 3585 km since the service/),
    );
    expect(outcome['alarmOnceRecorded']).toContainEqual(
      "249: 4322 km once 117647 is recorded — the owner's 4322 ✓",
    );
  });

  it('happens once — a second pass writes nothing', async () => {
    await runReadingsFixGoLive();
    const again = await applyReadingsFix(adminId);
    expect(again.failures).toEqual([]);
    expect(again.outcome.applied).toEqual([]);
    expect(again.outcome.readingsCleared).toEqual([]);
    expect(again.outcome.readingsReclosed).toEqual([]);
    expect(again.outcome.readingsLeft).toEqual([]);
    expect(again.outcome.countersSet).toEqual([]);
    expect(again.outcome.countersAlready).toHaveLength(4);
    expect((await row(r219close)).notes, 'no second note').toBe('عداد الدخول كما كُتب: 118722');
    expect((await row(r249closes)).notes, 'no second note').toBe('عداد الدخول كما كُتب: 114871');
  });
});
