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
import { fleetOdometerService } from '../../src/modules/fleet/odometer/odometer.service';

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
/** A workshop the catalog names — «التوكيل». */
let dealerId: Types.ObjectId;
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
    workshopId?: Types.ObjectId;
  },
): Promise<string> => {
  const doc = await FleetMaintenanceVisitModel.create({
    vehicleId,
    inDate: day(v.inDate),
    outDate: v.outDate === null ? null : day(v.outDate),
    workshopId: v.workshopId ?? new Types.ObjectId(),
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
  dealerId = (
    await FleetCatalogItemModel.create({
      kind: 'workshop',
      name: { ar: 'التوكيل للإنذار', en: 'Dealer (alarm)' },
    })
  )._id as Types.ObjectId;
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
    const openId = await visitOf(id, {
      inDate: '2026-10-01',
      outDate: null,
      entry: 11_000,
      workshopId: dealerId,
    });
    const row = await alarmOf(id);
    expect(row?.lastServiceVisitId).toBe(baselineId);
    // Batch 3 (real values now, replacing F0's neutral nulls): the card names the visit — its
    // work type and its workshop, read from the catalog.
    expect(row?.newerUncountedVisit).toEqual({
      visitId: openId,
      inDate: at('2026-10-01'),
      outDate: null,
      why: 'open',
      workType: {
        id: String(countingId),
        name: { ar: 'صيانة دورية للإنذار', en: 'صيانة دورية للإنذار' },
      },
      workshop: { id: String(dealerId), name: { ar: 'التوكيل للإنذار', en: 'Dealer (alarm)' } },
      // Its work type is on the counting list: once closed, it is the visit measured from.
      counts: true,
    });
    // The counted visit is named too; a workshop the catalog does not hold stays unnamed.
    expect(row?.baseline?.workType).toEqual({
      id: String(countingId),
      name: { ar: 'صيانة دورية للإنذار', en: 'صيانة دورية للإنذار' },
    });
  });

  it('closed and counting, but checked out BEFORE the visit measured from — named (C8)', async () => {
    // The 295 shape the critic found: A in on 26 September at 19,790, closed on 20 October; B in
    // and out on 6 October at 22,790. The baseline is the latest CHECK-OUT (A); the newest by
    // CHECK-IN is B, and the reader is told why it is not the one measured from.
    const id = await car();
    await readings(id, [
      ['2026-09-25', 19_700],
      ['2026-10-21', 22_900],
    ]);
    const a = await visitOf(id, { inDate: '2026-09-26', outDate: '2026-10-20', entry: 19_790 });
    const b = await visitOf(id, {
      inDate: '2026-10-06',
      outDate: '2026-10-06',
      entry: 22_790,
      workshopId: dealerId,
    });
    const row = await alarmOf(id);
    expect(row?.lastServiceVisitId).toBe(a);
    expect(row?.sinceServiceKm).toBe(22_900 - 19_790);
    expect(row?.newerUncountedVisit).toMatchObject({
      visitId: b,
      inDate: at('2026-10-06'),
      outDate: at('2026-10-06'),
      why: 'checkedOutEarlier',
      workType: { id: String(countingId) },
      workshop: { id: String(dealerId) },
      counts: true,
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
    expect(row?.newerUncountedVisit).toMatchObject({
      visitId: washVisit,
      why: 'notCounting',
      counts: false,
    });
  });

  it('open, of a work type that does not count — says so, so the card need not guess (A/04)', async () => {
    // Car 157: the newest visit is «إصلاح» at the dealer, still open. Closing it would not reset
    // the cycle, because its work type is not on the counting list.
    const id = await car();
    await readings(id, [['2026-09-20', 11_000]]);
    await visitOf(id, { inDate: '2026-09-01', outDate: '2026-09-02', exit: 10_000 });
    const openId = await visitOf(id, { inDate: '2026-09-25', outDate: null, workTypeId: washId });
    const row = await alarmOf(id);
    expect(row?.newerUncountedVisit).toMatchObject({ visitId: openId, why: 'open', counts: false });
  });

  it('with no counting visit at all, the open one is what the car is waiting on', async () => {
    const id = await car();
    await readings(id, [['2026-09-20', 11_000]]);
    const openId = await visitOf(id, { inDate: '2026-09-25', outDate: null, entry: 11_000 });
    const row = await alarmOf(id);
    expect(row?.noAlarmReason).toBe('noService');
    expect(row?.baseline).toBeNull();
    expect(row?.newerUncountedVisit).toMatchObject({ visitId: openId, why: 'open', counts: true });
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

/**
 * THE OWNER'S REPORT AFTER APPROVAL (batch 3, A-ODO step 0): «لو ماشية مثلا 150 دخول وأنا كتبت بعد
 * كده دخول بتاع تاني يوم 200، يبقى هي مشيت 50، بيكتب لي كيلومتر 50 وما بيضيفش 50 دي على فرق
 * الصيانة». Two rows sharing the top OPENING reading — a parked day (150 → 150) and the next day
 * (150 → 200) — used to be told apart by `_id` alone, so when the 0-km row was written last the
 * car's reading stayed 150. The later DAY settles that tie now, and its closing reading is the one
 * reported.
 */
describe('the day’s km reach the gap — two rows share the top opening reading', () => {
  /** A counting service on 1 October at 100 km, the chain at 90 the day before. */
  const serviced = async (): Promise<Types.ObjectId> => {
    const id = await car();
    await FleetOdometerLogModel.create({
      vehicleId: id,
      date: day('2026-09-30'),
      outReading: 90,
      inReading: 150,
    });
    await visitOf(id, { inDate: '2026-10-01', outDate: '2026-10-01', entry: 100 });
    return id;
  };
  const parkedDay = (id: Types.ObjectId) =>
    FleetOdometerLogModel.create({
      vehicleId: id,
      date: day('2026-10-10'),
      outReading: 150,
      inReading: 150,
    });
  const movingDay = (id: Types.ObjectId) =>
    FleetOdometerLogModel.create({
      vehicleId: id,
      date: day('2026-10-11'),
      outReading: 150,
      inReading: 200,
    });

  it.each([
    ['the parked day written first', true],
    ['the parked day written LAST (back-dated, or re-created by a correction)', false],
  ])('%s → the car reads 200, and the 50 km are in the gap', async (_label, parkedFirst) => {
    const id = await serviced();
    let moving;
    if (parkedFirst) {
      await parkedDay(id);
      moving = await movingDay(id);
    } else {
      moving = await movingDay(id);
      await parkedDay(id);
    }
    const row = await alarmOf(id);
    expect(row?.latestReading).toBe(200);
    expect(row?.latestReadingAt).toBe(at('2026-10-11'));
    expect(row?.latestReadingLogId).toBe(String(moving._id));
    expect(row?.sinceServiceKm).toBe(100);
    // C6: on this healthy chain the newest-dated row is the same point.
    expect(row?.newestReading).toEqual({ reading: 200, date: at('2026-10-11') });
  });

  it('a tie on the opening reading goes to the later DAY, whatever was written last', async () => {
    const id = await car();
    const later = await FleetOdometerLogModel.create({
      vehicleId: id,
      date: day('2026-10-12'),
      outReading: 200,
      inReading: null,
    });
    // A parked day typed in afterwards for the 11th: the same opening AND closing reading, and the
    // newer `_id` — which used to make it «the latest reading», dated a day too early.
    await FleetOdometerLogModel.create({
      vehicleId: id,
      date: day('2026-10-11'),
      outReading: 200,
      inReading: 200,
    });
    const latest = (await fleetOdometerRepository.latestReadings([String(id)])).get(String(id));
    expect(latest).toMatchObject({ reading: 200, logId: String(later._id) });
    expect(latest?.date.toISOString()).toBe(at('2026-10-12'));
  });

  it('C6: a typo-high reading in the past is the HIGHEST, the newest is told beside it', async () => {
    const id = await car();
    await FleetOdometerLogModel.create({
      vehicleId: id,
      date: day('2026-07-30'),
      outReading: 79_200,
      inReading: 79_200,
    });
    await FleetOdometerLogModel.create({
      vehicleId: id,
      date: day('2026-10-26'),
      outReading: 25_631,
      inReading: null,
    });
    const row = await alarmOf(id);
    expect(row?.latestReading).toBe(79_200);
    expect(row?.latestReadingAt).toBe(at('2026-07-30'));
    expect(row?.newestReading).toEqual({ reading: 25_631, date: at('2026-10-26') });
  });
});

/**
 * PR #639's REGRESSION, PINNED. Ranking a car's rows by `max(out, in)` let an OLD row's closing
 * reading become the car's latest reading — the old book's rows do not always chain (a row's
 * عداد الدخول above the next row's عداد الخروج), and closing readings carry typos and test figures:
 * car 255 read 128,457 and the record dialog said «الخادم يتوقع 1,008,500 كم أو أكثر». The latest
 * reading is the row with the highest عداد الخروج again — the row the FR-2 guard takes its floor
 * from — the later day first on a tie, reported as how far that row got.
 */
describe('the latest reading is picked by عداد الخروج — an old closing reading never wins', () => {
  /** Rows exactly as given — the old book's, which need not chain. */
  const rowsOf = async (
    vehicleId: Types.ObjectId,
    rows: readonly (readonly [string, number, number | null])[],
  ): Promise<Types.ObjectId[]> => {
    const ids = [];
    for (const [date, outReading, inReading] of rows) {
      const doc = await FleetOdometerLogModel.create({
        vehicleId,
        date: day(date),
        outReading,
        inReading,
      });
      ids.push(doc._id as Types.ObjectId);
    }
    return ids;
  };
  const latestOf = async (id: Types.ObjectId) =>
    (await fleetOdometerRepository.latestReadings([String(id)])).get(String(id));
  const expectedOf = async (id: Types.ObjectId) => {
    const expected = await fleetOdometerService.expectedReading(String(id));
    return { reading: expected.reading, asOf: expected.asOf?.toISOString() ?? null };
  };
  /** The FR-2 floor for a reading taken today — the guard the hint must agree with. */
  const floorOf = async (id: Types.ObjectId) => {
    const bracket = await fleetOdometerService.bracket(String(id), day('2026-11-02'));
    return { reading: bracket.lowerBound, asOf: bracket.lowerBoundAt?.toISOString() ?? null };
  };

  it('(A) an old row closing above the next row’s opening does not become the latest', async () => {
    const id = await car();
    await visitOf(id, { inDate: '2026-07-20', outDate: '2026-07-20', exit: 39_500 });
    const [, , , open] = await rowsOf(id, [
      // The book closed 1 August at 47,000 — the next row opens at 41,000.
      ['2026-08-01', 40_000, 47_000],
      ['2026-08-02', 41_000, 42_000],
      ['2026-08-03', 42_000, 43_000],
      ['2026-08-04', 43_000, null],
    ]);
    const latest = await latestOf(id);
    expect(latest).toMatchObject({ reading: 43_000, logId: String(open) });
    expect(latest?.date.toISOString()).toBe(at('2026-08-04'));

    const expected = await expectedOf(id);
    expect(expected).toEqual({ reading: 43_000, asOf: at('2026-08-04') });
    // The hint and the guard name ONE row now.
    expect(await floorOf(id)).toEqual(expected);

    const row = await alarmOf(id);
    expect(row?.latestReading).toBe(43_000);
    expect(row?.latestReadingLogId).toBe(String(open));
    expect(row?.sinceServiceKm).toBe(3_500);
    expect(row?.remainingKm).toBe(1_500);
    expect(row?.level).toBe('none');
    expect(row?.newestReading).toEqual({ reading: 43_000, date: at('2026-08-04') });
  });

  it('(B) an extra digit on an OLD closing reading leaves the car at 52,000, not 500,500', async () => {
    const id = await car();
    await visitOf(id, { inDate: '2026-09-01', outDate: '2026-09-01', exit: 49_000 });
    const [, , , open] = await rowsOf(id, [
      ['2026-09-10', 50_000, 500_500],
      ['2026-09-11', 50_500, 51_000],
      ['2026-09-12', 51_000, 52_000],
      ['2026-09-13', 52_000, null],
    ]);
    const latest = await latestOf(id);
    expect(latest).toMatchObject({ reading: 52_000, logId: String(open) });
    expect(latest?.date.toISOString()).toBe(at('2026-09-13'));

    const expected = await expectedOf(id);
    expect(expected).toEqual({ reading: 52_000, asOf: at('2026-09-13') });
    expect(await floorOf(id)).toEqual(expected);

    // A sane alarm: 3,000 km since the 49,000 service — not 451,500 and red.
    const row = await alarmOf(id);
    expect(row?.latestReading).toBe(52_000);
    expect(row?.latestReadingAt).toBe(at('2026-09-13'));
    expect(row?.sinceServiceKm).toBe(3_000);
    expect(row?.remainingKm).toBe(2_000);
    expect(row?.level).toBe('none');
    expect(row?.newestReading).toEqual({ reading: 52_000, date: at('2026-09-13') });
  });

  it.each([
    ['the parked day written first', true],
    ['the parked day written LAST', false],
  ])(
    '(C) a parked day and the next day opening where it stood → the LATER day (%s)',
    async (_label, parkedFirst) => {
      const id = await car();
      const parked: readonly [string, number, number | null] = ['2026-10-10', 150, 150];
      const moving: readonly [string, number, number | null] = ['2026-10-11', 150, 200];
      const ids = await rowsOf(id, parkedFirst ? [parked, moving] : [moving, parked]);
      const movingId = parkedFirst ? ids[1] : ids[0];
      const latest = await latestOf(id);
      expect(latest).toMatchObject({ reading: 200, logId: String(movingId) });
      expect(latest?.date.toISOString()).toBe(at('2026-10-11'));
      expect(await expectedOf(id)).toEqual({ reading: 200, asOf: at('2026-10-11') });
    },
  );

  it('(D) the newest row’s own closing reading still counts', async () => {
    const id = await car();
    const [, closed] = await rowsOf(id, [
      ['2026-10-01', 128_000, 128_457],
      ['2026-10-02', 128_457, 128_500],
    ]);
    const latest = await latestOf(id);
    expect(latest).toMatchObject({ reading: 128_500, logId: String(closed) });
    expect(latest?.date.toISOString()).toBe(at('2026-10-02'));
    expect(await expectedOf(id)).toEqual({ reading: 128_500, asOf: at('2026-10-02') });
    expect((await alarmOf(id))?.newestReading).toEqual({
      reading: 128_500,
      date: at('2026-10-02'),
    });
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
