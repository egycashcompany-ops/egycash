// The maintenance alarm's baseline, against a real mongo: which counter it measures from, which
// readings judge that counter, and what it says when it cannot measure — car 295's «—».
//
// Car 295 went into the workshop on 6 October at 22,790 and the board showed «—» for «فارق عداد
// الصيانة». The shapes below are the ones that produce that dash, planted the way the old book and
// the go-live import left them, and read through the real `computeAlarms()` — the projection both
// alarm doors and the odometer board answer with. Kept out of `fleet.spec.ts` (one boot, no HTTP)
// so the suite's slowest file does not grow.
//
//   R4 — a counter is judged against readings dated BEFORE its own day: the register keeps no time
//        of day, so a reading of the service day may have been taken after the counter.
//   R3 — an exit counter a reading contradicts gives way to the entry counter, when that one stands.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { type FleetMaintenanceAlarmDto } from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import { FleetVehicleTypeModel } from '../../src/modules/fleet/vehicle-types/vehicle-type.model';
import { FleetCatalogItemModel } from '../../src/modules/fleet/catalogs/catalog-item.model';
import { FleetMaintenanceVisitModel } from '../../src/modules/fleet/maintenance/maintenance.model';
import { FleetOdometerLogModel } from '../../src/modules/fleet/odometer/odometer.model';
import { computeAlarm, computeAlarms } from '../../src/modules/fleet/maintenance/maintenance-alarm';
import { fleetOdometerRepository } from '../../src/modules/fleet/odometer/odometer.repository';
import { fleetMaintenanceRepository } from '../../src/modules/fleet/maintenance/maintenance.repository';

let replset: MongoMemoryReplSet | undefined;

const resolveMongoUri = async (): Promise<string> => {
  if (process.env['MONGO_TEST_URI'] !== undefined) return process.env['MONGO_TEST_URI'];
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  return replset.getUri();
};

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const at = (iso: string): string => day(iso).toISOString();

let typeId: Types.ObjectId;
let countingId: Types.ObjectId;
let washId: Types.ObjectId;
let carNo = 0;

/** A car of the 5,000 km type; `active` unless said otherwise. */
const car = async (status: 'active' | 'outOfService' = 'active'): Promise<Types.ObjectId> => {
  carNo += 1;
  const code = `ABL-${carNo}`;
  const doc = await FleetVehicleModel.create({
    code,
    typeId,
    plateNumber: `ق ب ${carNo}`,
    chassisNumber: `CH-${code}`,
    motorNumber: `MO-${code}`,
    joinedAt: day('2025-01-01'),
    licenseExpiresAt: day('2027-01-01'),
    branchId: new Types.ObjectId(),
    status,
  });
  return doc._id as Types.ObjectId;
};

/**
 * The odometer chain as the register keeps it: each row opens at its reading and closes at the
 * next one's, the last row still open. Returns the rows' ids, in date order.
 */
const readings = async (
  vehicleId: Types.ObjectId,
  points: readonly (readonly [string, number])[],
): Promise<Types.ObjectId[]> => {
  const rows = [];
  for (const [i, [date, reading]] of points.entries()) {
    rows.push(
      await FleetOdometerLogModel.create({
        vehicleId,
        date: day(date),
        outReading: reading,
        inReading: points[i + 1]?.[1] ?? null,
      }),
    );
  }
  return rows.map((row) => row._id as Types.ObjectId);
};

/** A workshop visit, closed unless `outDate` is null; counting unless another work type is given. */
const visitOf = async (
  vehicleId: Types.ObjectId,
  v: {
    inDate: string;
    outDate: string | null;
    entry?: number | null;
    exit?: number | null;
    workTypeId?: Types.ObjectId;
  },
): Promise<string> => {
  const doc = await FleetMaintenanceVisitModel.create({
    vehicleId,
    inDate: day(v.inDate),
    outDate: v.outDate === null ? null : day(v.outDate),
    workshopId: new Types.ObjectId(),
    workTypeId: v.workTypeId ?? countingId,
    odometerAtService: v.entry ?? null,
    exitOdometer: v.exit ?? null,
  });
  return String(doc._id);
};

const alarmOf = async (vehicleId: Types.ObjectId): Promise<FleetMaintenanceAlarmDto | undefined> =>
  (await computeAlarms()).find((row) => row.vehicleId === String(vehicleId));

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  typeId = (
    await FleetVehicleTypeModel.create({
      name: { ar: 'نوع الإنذار', en: 'Alarm type' },
      maintenanceIntervalKm: 5000,
    })
  )._id as Types.ObjectId;
  const workType = async (ar: string, countsForAlarm: boolean) =>
    (
      await FleetCatalogItemModel.create({
        kind: 'workType',
        name: { ar, en: ar },
        countsForAlarm,
      })
    )._id as Types.ObjectId;
  countingId = await workType('صيانة دورية للإنذار', true);
  washId = await workType('غسيل للإنذار', false);
}, 120_000);

afterAll(async () => {
  await disconnectMongo();
  await replset?.stop();
});

describe('car 295 — a reading of the service day itself (R4)', () => {
  let id: Types.ObjectId;
  beforeAll(async () => {
    id = await car();
    // 22,830 was logged for 6 October after the car came back from the workshop.
    await readings(id, [
      ['2026-10-05', 22_400],
      ['2026-10-06', 22_830],
      ['2026-10-20', 25_631],
    ]);
    await visitOf(id, { inDate: '2026-10-06', outDate: '2026-10-06', entry: 22_790 });
  });

  it('measures 2,841 from 22,790, judged against the 22,400 of the day before', async () => {
    const row = await alarmOf(id);
    expect(row?.noAlarmReason).toBeNull();
    expect(row?.sinceServiceKm).toBe(25_631 - 22_790);
    expect(row?.baseline).toMatchObject({
      source: 'entry',
      counter: 22_790,
      counterDate: at('2026-10-06'),
      judgedAgainst: { reading: 22_400, date: at('2026-10-05') },
      exitSetAside: null,
    });
  });

  it('the bound that day kept in is the one that used to refuse it — the change, pinned', async () => {
    const pair = [{ vehicleId: String(id), on: day('2026-10-06') }];
    const kept = (await fleetOdometerRepository.lowerBoundsAt(pair)).get(String(id));
    const cut = (await fleetOdometerRepository.lowerBoundsAt(pair, { includeDay: false })).get(
      String(id),
    );
    expect(kept?.reading).toBe(22_830);
    expect(cut?.reading).toBe(22_400);
    // Before R4 the projection handed the rule the same-day bound, and the rule refused the counter.
    const before = computeAlarm({
      intervalKm: 5000,
      yellowKm: 1000,
      redKm: 300,
      latestReading: 25_631,
      latestReadingDate: day('2026-10-20'),
      baselineCounter: 22_790,
      baselineDate: day('2026-10-06'),
      baselineLowerBound: kept?.reading ?? null,
    });
    expect(before.noAlarmReason).toBe('baselineBelowChain');
  });
});

describe('an exit counter a reading contradicts (R3)', () => {
  it('a late closure — readings typed in after check-out — is measured from the entry counter', async () => {
    const id = await car();
    await readings(id, [
      ['2026-10-05', 22_400],
      ['2026-10-10', 23_500],
      ['2026-10-20', 25_631],
    ]);
    const visitId = await visitOf(id, {
      inDate: '2026-10-06',
      outDate: '2026-10-15',
      entry: 22_790,
      exit: 22_795,
    });
    const row = await alarmOf(id);
    expect(row?.sinceServiceKm).toBe(2841);
    expect(row?.lastServiceVisitId).toBe(visitId);
    expect(row?.lastServiceAt).toBe(at('2026-10-15'));
    expect(row?.baseline).toMatchObject({
      visitId,
      entryCounter: 22_790,
      exitCounter: 22_795,
      source: 'entry',
      counter: 22_790,
      exitSetAside: {
        because: 'belowChain',
        conflict: { reading: 23_500, date: at('2026-10-10') },
      },
    });
  });

  it('an exit counter typed above the latest reading is set aside the same way', async () => {
    const id = await car();
    await readings(id, [
      ['2026-10-05', 22_400],
      ['2026-10-20', 25_631],
    ]);
    await visitOf(id, { inDate: '2026-10-06', outDate: '2026-10-07', entry: 22_790, exit: 28_790 });
    const row = await alarmOf(id);
    expect(row?.noAlarmReason).toBeNull();
    expect(row?.sinceServiceKm).toBe(2841);
    expect(row?.baseline?.exitSetAside).toEqual({
      because: 'aboveReading',
      conflict: { reading: 25_631, date: at('2026-10-20') },
    });
  });

  it('a visit written before the exit counter existed measures from its entry counter', async () => {
    // The KEY absent, not null — the shape of rows written before the field existed.
    const id = await car();
    await readings(id, [['2026-09-20', 124_850]]);
    const visitId = await visitOf(id, {
      inDate: '2026-09-01',
      outDate: '2026-09-03',
      entry: 120_000,
    });
    await FleetMaintenanceVisitModel.collection.updateOne(
      { _id: new Types.ObjectId(visitId) },
      { $unset: { exitOdometer: '' } },
    );
    const row = await alarmOf(id);
    expect(row?.sinceServiceKm).toBe(4850);
    expect(row?.baseline).toMatchObject({
      source: 'entry',
      exitCounter: null,
      entryCounter: 120_000,
    });
  });
});

describe('a newer visit the alarm cannot measure from', () => {
  it('still open — named, and the baseline stays the visit before it', async () => {
    const id = await car();
    await readings(id, [
      ['2026-08-30', 9_900],
      ['2026-09-20', 11_000],
    ]);
    const baselineId = await visitOf(id, {
      inDate: '2026-09-01',
      outDate: '2026-09-02',
      exit: 10_000,
    });
    const openId = await visitOf(id, { inDate: '2026-10-01', outDate: null, entry: 11_000 });
    const row = await alarmOf(id);
    expect(row?.lastServiceVisitId).toBe(baselineId);
    expect(row?.newerUncountedVisit).toEqual({
      visitId: openId,
      inDate: at('2026-10-01'),
      outDate: null,
      why: 'open',
    });
  });

  it('of a work type that does not count — named «not counting»', async () => {
    const id = await car();
    await readings(id, [['2026-09-20', 11_000]]);
    await visitOf(id, { inDate: '2026-09-01', outDate: '2026-09-02', exit: 10_000 });
    const washVisit = await visitOf(id, {
      inDate: '2026-09-10',
      outDate: '2026-09-10',
      workTypeId: washId,
    });
    const row = await alarmOf(id);
    expect(row?.newerUncountedVisit).toMatchObject({ visitId: washVisit, why: 'notCounting' });
  });

  it('with no counting visit at all, the open one is what the car is waiting on', async () => {
    const id = await car();
    await readings(id, [['2026-09-20', 11_000]]);
    const openId = await visitOf(id, { inDate: '2026-09-25', outDate: null, entry: 11_000 });
    const row = await alarmOf(id);
    expect(row?.noAlarmReason).toBe('noService');
    expect(row?.baseline).toBeNull();
    expect(row?.newerUncountedVisit).toMatchObject({ visitId: openId, why: 'open' });
  });

  it('a soft-deleted visit is never answered', async () => {
    const id = await car();
    await readings(id, [['2026-09-20', 11_000]]);
    const liveId = await visitOf(id, { inDate: '2026-09-01', outDate: '2026-09-02', exit: 10_000 });
    const goneId = await visitOf(id, {
      inDate: '2026-09-10',
      outDate: '2026-09-10',
      workTypeId: washId,
    });
    await FleetMaintenanceVisitModel.updateOne({ _id: goneId }, { $set: { isDeleted: true } });
    const newest = await fleetMaintenanceRepository.newestVisits([String(id)]);
    expect(newest.get(String(id))?.visitId).toBe(liveId);
    expect((await alarmOf(id))?.newerUncountedVisit).toBeNull();
  });
});

describe('the reading the alarm measured', () => {
  it('names its row — the open period — and that row’s day, even when two rows tie', async () => {
    // FR-2 allows an equal reading, so 5,000 twice is ordinary; `_id` settles which is «latest».
    const id = await car();
    const [, open] = await readings(id, [
      ['2026-09-01', 5_000],
      ['2026-09-02', 5_000],
    ]);
    const row = await alarmOf(id);
    expect(row?.latestReading).toBe(5_000);
    expect(row?.latestReadingLogId).toBe(String(open));
    expect(row?.latestReadingAt).toBe(at('2026-09-02'));
  });

  it('a reading stamped with a time on the counter’s day is still that day, and still cut', async () => {
    const id = await car();
    await FleetOdometerLogModel.create({
      vehicleId: id,
      date: new Date('2026-10-06T15:30:00.000Z'),
      outReading: 22_830,
      inReading: null,
    });
    const pair = [{ vehicleId: String(id), on: day('2026-10-06') }];
    expect((await fleetOdometerRepository.lowerBoundsAt(pair)).get(String(id))?.reading).toBe(
      22_830,
    );
    expect((await fleetOdometerRepository.lowerBoundsAt(pair, { includeDay: false })).size).toBe(0);
  });
});

describe('what the projection leaves alone', () => {
  it('a car out of service or deleted has no row at all — the screen says so itself', async () => {
    const parked = await car('outOfService');
    const deleted = await car();
    await FleetVehicleModel.updateOne({ _id: deleted }, { $set: { isDeleted: true } });
    const ids = (await computeAlarms()).map((row) => row.vehicleId);
    expect(ids).not.toContain(String(parked));
    expect(ids).not.toContain(String(deleted));
  });

  it('it writes nothing, and every row keeps the invariants its DTO documents', async () => {
    const snapshot = async () => ({
      visits: await FleetMaintenanceVisitModel.collection.find({}).sort({ _id: 1 }).toArray(),
      logs: await FleetOdometerLogModel.collection.find({}).sort({ _id: 1 }).toArray(),
    });
    const before = await snapshot();
    const rows = await computeAlarms();
    expect(await snapshot()).toEqual(before);

    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) {
      expect(row.baseline === null, row.code).toBe(row.lastServiceVisitId === null);
      if (row.baseline !== null) {
        expect(row.baseline.visitId).toBe(row.lastServiceVisitId);
        expect(row.baseline.outDate).toBe(row.lastServiceAt);
      }
      expect(row.latestReadingAt === null).toBe(row.latestReading === null);
      if (row.noAlarmReason === null) {
        expect(row.sinceServiceKm, row.code).toBe(
          (row.latestReading as number) - (row.baseline?.counter as number),
        );
      }
    }
  });
});
