// «فارق عداد الصيانة» AT EACH READING (batch 3, D1), against a real mongo and the real HTTP doors.
//
// «مفيش إنذار والمسافة كبيرة، ومش بيخصم الكيلومترات اللى بتخش كل يوم بيجيب الفرق ويسجل القراء مش
// بيزود على فارق الصيانه». The odometer page printed the car's CURRENT figure on every row, so a
// month of car 295's readings all read 5,507. Each row now carries the gap AT ITS reading, computed
// by the server for the page (the list), for a recorded reading and for a corrected one.
//
// The data is car 295's shape from the owner's screenshot and the approved sample A-odometer/02:
// a service on 20 September at 15,347 and one on 6 October at 22,790, the make «مرسيدس اسبرانتر
// 516» with «فترة الصيانة» 7,500, readings 19 October → 1 November giving 2,841 … 5,507.
//
// Kept out of `fleet.spec.ts` (the suite's slowest file); one boot, a super user.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  platformPermissions,
  type FleetMaintenanceAlarmDto,
  type FleetOdometerLogDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { fleetPermissions } from '../../src/modules/fleet/fleet.module';
import { rbacService } from '../../src/platform/rbac';
import { authService } from '../../src/platform/auth';
import { userService } from '../../src/platform/users';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { FleetVehicleModel } from '../../src/modules/fleet/vehicles/vehicle.model';
import { FleetVehicleTypeModel } from '../../src/modules/fleet/vehicle-types/vehicle-type.model';
import { FleetCatalogItemModel } from '../../src/modules/fleet/catalogs/catalog-item.model';
import { FleetMaintenanceVisitModel } from '../../src/modules/fleet/maintenance/maintenance.model';
import { FleetOdometerLogModel } from '../../src/modules/fleet/odometer/odometer.model';

const URL_ = '/api/v1/fleet/odometer';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let token: string;

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
const auth = () => ({ Authorization: `Bearer ${token}` });
const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const at = (iso: string): string => day(iso).toISOString();

let make516: Types.ObjectId;
let makeNoRule: Types.ObjectId;
let countingId: Types.ObjectId;
let repairId: Types.ObjectId;
let workshopId: Types.ObjectId;

const car = async (
  code: string,
  typeId = make516,
  status: 'active' | 'outOfService' = 'active',
): Promise<Types.ObjectId> =>
  (
    await FleetVehicleModel.create({
      code,
      typeId,
      plateNumber: `ق ف ${code}`,
      chassisNumber: `CH-${code}`,
      motorNumber: `MO-${code}`,
      joinedAt: day('2025-01-01'),
      licenseExpiresAt: day('2027-01-01'),
      branchId: new Types.ObjectId(),
      status,
    })
  )._id as Types.ObjectId;

/**
 * The chain as the register keeps it: each row opens at its reading and closes at the next one's,
 * the last row still open. A `null` reading is a day recorded without one — on no chain.
 */
const chain = async (
  vehicleId: Types.ObjectId,
  points: readonly (readonly [string, number | null])[],
): Promise<void> => {
  const read = points.filter(([, reading]) => reading !== null);
  for (const [date, reading] of points) {
    const next = reading === null ? undefined : read[read.findIndex(([d]) => d === date) + 1];
    await FleetOdometerLogModel.create({
      vehicleId,
      date: day(date),
      outReading: reading,
      inReading: reading === null ? null : (next?.[1] ?? null),
      km: reading === null || next === undefined ? null : (next[1] as number) - reading,
    });
  }
};

const visit = async (
  vehicleId: Types.ObjectId,
  v: {
    inDate: string;
    outDate: string | null;
    entry?: number;
    exit?: number;
    workTypeId?: Types.ObjectId;
  },
): Promise<string> =>
  String(
    (
      await FleetMaintenanceVisitModel.create({
        vehicleId,
        inDate: day(v.inDate),
        outDate: v.outDate === null ? null : day(v.outDate),
        workshopId,
        workTypeId: v.workTypeId ?? countingId,
        odometerAtService: v.entry ?? null,
        exitOdometer: v.exit ?? null,
      })
    )._id,
  );

const list = async (query: Record<string, string | number>): Promise<FleetOdometerLogDto[]> => {
  const res = await request(app)
    .get(URL_)
    .query({ pageSize: 100, ...query })
    .set(auth());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return data<FleetOdometerLogDto[]>(res);
};

const alarmOf = async (code: string): Promise<FleetMaintenanceAlarmDto | undefined> => {
  const res = await request(app).get(`${URL_}/alarms`).set(auth());
  expect(res.status).toBe(200);
  return data<FleetMaintenanceAlarmDto[]>(res).find((row) => row.code === code);
};

/** «date → gap» for one car's rows — what the column shows, row by row. */
const gapsByDay = (rows: readonly FleetOdometerLogDto[]): Record<string, number | null> =>
  Object.fromEntries(rows.map((row) => [row.date.slice(0, 10), row.serviceGapKm]));

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await bootPlatform({
    mongoUri: replSet.getUri(`ecms-odo-gap-${Date.now()}`),
    modules: moduleManifests,
  });
  app = buildApp();
  const { user } = await userService.create(
    {
      email: 'odo-gap@ecms.local',
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  const id = String(user._id);
  await userService.forceActivate(id);
  const role = await rbacService.createRole(
    {
      name: { en: 'odo gap', ar: 'فارق العداد' },
      permissionKeys: [...platformPermissions, ...fleetPermissions].map((p) => p.key),
    },
    new Types.ObjectId().toString(),
  );
  await rbacService.ensureAssignment(id, String(role._id), 'organization');
  token = await authService.signAccessToken(id, new Types.ObjectId().toString(), 0);

  make516 = (
    await FleetVehicleTypeModel.create({
      name: { ar: 'مرسيدس اسبرانتر 516 للفارق', en: 'Sprinter 516 (gap)' },
      maintenanceIntervalKm: 7_500,
    })
  )._id as Types.ObjectId;
  makeNoRule = (
    await FleetVehicleTypeModel.create({
      name: { ar: 'نوع بلا مسافة للفارق', en: 'No interval (gap)' },
      maintenanceIntervalKm: 0,
    })
  )._id as Types.ObjectId;
  const catalog = async (kind: 'workType' | 'workshop', ar: string, countsForAlarm = false) =>
    (await FleetCatalogItemModel.create({ kind, name: { ar, en: ar }, countsForAlarm }))
      ._id as Types.ObjectId;
  countingId = await catalog('workType', 'صيانة للفارق', true);
  repairId = await catalog('workType', 'إصلاح للفارق');
  workshopId = await catalog('workshop', 'التوكيل للفارق');
}, 120_000);

afterAll(async () => {
  await getCache().close();
  await disconnectMongo();
  await replSet?.stop();
});

describe('car 295 — each row reads the gap AT ITS reading', () => {
  beforeAll(async () => {
    const id = await car('G-295');
    await chain(id, [
      ['2026-09-19', 15_300],
      ['2026-09-20', 15_347],
      ['2026-10-05', 22_400],
      ['2026-10-06', 22_830],
      ['2026-10-19', 25_581],
      ['2026-10-20', 25_631],
      ['2026-10-21', 25_709],
      ['2026-10-22', 25_754],
      ['2026-10-23', null],
      ['2026-10-25', 25_916],
      ['2026-10-26', 26_040],
      ['2026-10-27', 26_126],
      ['2026-10-28', 26_300],
      ['2026-10-29', 28_170],
      ['2026-11-01', 28_297],
    ]);
    await visit(id, { inDate: '2026-09-09', outDate: '2026-09-20', entry: 15_347 });
    await visit(id, { inDate: '2026-10-06', outDate: '2026-10-06', entry: 22_790 });
    // A newer visit that does not count changes nothing about the figures.
    await visit(id, { inDate: '2026-10-30', outDate: '2026-10-30', workTypeId: repairId });
  });

  it('19 October → 1 November: 2,841 … 5,507 — the approved sample’s figures, growing day by day', async () => {
    const rows = await list({ vehicleCodes: 'G-295', from: '2026-10-19', to: '2026-11-01' });
    expect(gapsByDay(rows)).toEqual({
      '2026-10-19': 2_841,
      '2026-10-20': 2_919,
      '2026-10-21': 2_964,
      '2026-10-22': 3_126,
      // A day recorded without a reading carries no figure.
      '2026-10-23': null,
      '2026-10-25': 3_250,
      '2026-10-26': 3_336,
      '2026-10-27': 3_510,
      '2026-10-28': 5_380,
      '2026-10-29': 5_507,
      '2026-11-01': 5_507,
    });
  });

  it('the newest row equals the alarm — and the alarm shows why there is no alarm at 5,507', async () => {
    const alarm = await alarmOf('G-295');
    expect(alarm?.sinceServiceKm).toBe(5_507);
    // «المتبقي 1,993 من 7,500 كم» — above the 1,000 yellow threshold, so «لا يوجد» is right.
    expect(alarm?.remainingKm).toBe(1_993);
    expect(alarm?.level).toBe('none');
    expect(alarm?.rule).toMatchObject({
      vehicleType: { id: String(make516), name: { ar: 'مرسيدس اسبرانتر 516 للفارق' } },
      intervalKm: 7_500,
      yellowKm: 1_000,
      redKm: 300,
    });
    const rows = await list({ vehicleCodes: 'G-295', from: '2026-11-01', to: '2026-11-01' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(alarm?.latestReadingLogId);
    expect(rows[0]!.serviceGapKm).toBe(alarm?.sinceServiceKm);
  });

  it('each row is measured from the service IN FORCE on its day', async () => {
    const rows = await list({ vehicleCodes: 'G-295', from: '2026-09-19', to: '2026-10-06' });
    expect(gapsByDay(rows)).toEqual({
      // Before the first counting service, and on its own check-out day: nothing to measure from.
      '2026-09-19': null,
      '2026-09-20': null,
      // After 20 September, from its 15,347 — the row's reading is how far the car got that day.
      '2026-10-05': 22_830 - 15_347,
      // 6 October is the second service's own day: still measured from the first.
      '2026-10-06': 25_581 - 15_347,
    });
  });
});

describe('the column is sorted by the CAR’s current figure, not the row’s', () => {
  it('a car at 4,000 now sorts wholly before car 295 at 5,507, whatever its rows read', async () => {
    const id = await car('G-150');
    await chain(id, [
      ['2026-10-19', 166_711],
      ['2026-10-31', 167_000],
    ]);
    await visit(id, { inDate: '2026-10-10', outDate: '2026-10-10', entry: 163_000 });
    const rows = await list({
      vehicleCodes: 'G-150,G-295',
      from: '2026-10-19',
      to: '2026-11-01',
      sortBy: 'alarmSinceService',
      sortDir: 'asc',
    });
    const codes = rows.map((row) => row.vehicleCode);
    expect(codes.slice(0, 2)).toEqual(['G-150', 'G-150']);
    expect(new Set(codes.slice(2))).toEqual(new Set(['G-295']));
    // …while each row still carries its own figure: 295's 19 October reads 2,841, below 4,000.
    const first295 = rows.find(
      (row) => row.vehicleCode === 'G-295' && row.date === at('2026-10-19'),
    );
    expect(first295?.serviceGapKm).toBe(2_841);
    expect(rows.filter((row) => row.vehicleCode === 'G-150').map((r) => r.serviceGapKm)).toEqual([
      4_000, 4_000,
    ]);
  });
});

describe('nothing honest to show → null', () => {
  it('a car the alarm does not cover: not active, or its make has no «مسافة الصيانة»', async () => {
    const parked = await car('G-OFF', make516, 'outOfService');
    const noRule = await car('G-NORULE', makeNoRule);
    for (const id of [parked, noRule]) {
      await chain(id, [
        ['2026-10-01', 1_000],
        ['2026-10-20', 2_000],
      ]);
      await visit(id, { inDate: '2026-10-05', outDate: '2026-10-05', entry: 1_200 });
    }
    const rows = await list({ vehicleCodes: 'G-OFF,G-NORULE' });
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.serviceGapKm, row.vehicleCode ?? '').toBeNull();
  });

  it('an open visit is not a service yet — the row before it is measured from nothing', async () => {
    const id = await car('G-157');
    await chain(id, [
      ['2026-09-03', 173_294],
      ['2026-09-10', 173_345],
      ['2026-09-23', 173_634],
      ['2026-10-24', null],
    ]);
    await visit(id, { inDate: '2026-09-05', outDate: '2026-09-05', entry: 173_344 });
    await visit(id, { inDate: '2026-09-10', outDate: null, workTypeId: repairId });
    expect(gapsByDay(await list({ vehicleCodes: 'G-157' }))).toEqual({
      '2026-09-03': null,
      // 173,634 − 173,344 = 290, as his screenshot shows for 157.
      '2026-09-10': 290,
      '2026-09-23': 290,
      '2026-10-24': null,
    });
    const alarm = await alarmOf('G-157');
    expect(alarm?.sinceServiceKm).toBe(290);
    expect(alarm?.newerUncountedVisit).toMatchObject({
      why: 'open',
      workType: { id: String(repairId) },
      workshop: { id: String(workshopId) },
    });
  });

  it('a reading kept from the old book on a car the registry never had', async () => {
    await FleetOdometerLogModel.create({
      vehicleId: null,
      vehicleCode: 'G-194',
      date: day('2026-09-01'),
      outReading: 50_000,
      inReading: null,
    });
    const rows = await list({ vehicleCodes: 'G-194' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.serviceGapKm).toBeNull();
  });
});

describe('a recorded and a corrected reading answer with their gap', () => {
  it('record → its gap; correct → the corrected gap', async () => {
    const id = await car('G-REC');
    await chain(id, [['2026-10-01', 10_000]]);
    await visit(id, { inDate: '2026-10-05', outDate: '2026-10-05', entry: 10_200 });

    const recorded = await request(app)
      .post(URL_)
      .set(auth())
      .send({ vehicleId: String(id), date: '2026-10-20', reading: 11_000 });
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(201);
    const row = data<FleetOdometerLogDto>(recorded);
    expect(row.serviceGapKm).toBe(800);

    const corrected = await request(app)
      .patch(`${URL_}/${row.id}`)
      .set(auth())
      .send({ outReading: 11_050, version: row.version });
    expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
    expect(data<FleetOdometerLogDto>(corrected).serviceGapKm).toBe(850);
  });

  it('a day recorded without a reading answers null', async () => {
    const id = await car('G-DAY');
    await chain(id, [['2026-10-01', 10_000]]);
    await visit(id, { inDate: '2026-10-05', outDate: '2026-10-05', entry: 10_200 });
    const res = await request(app)
      .post(URL_)
      .set(auth())
      .send({ vehicleId: String(id), date: '2026-10-10', reading: null });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(data<FleetOdometerLogDto>(res).serviceGapKm).toBeNull();
  });
});

/**
 * The owner's report after approval, through the real write paths: a parked day (150 → 150) and
 * the next day closed at 200 by a correction, then the parked day deleted and recorded again — so
 * the 0-km row is the one written LAST. The car still reads 200 and the day's 50 km are in the gap.
 */
describe('the day’s km reach the gap after a correction re-creates the older row', () => {
  it('still 200 — on the alarm, on the expected reading and on the rows', async () => {
    const id = await car('G-TIE');
    await chain(id, [['2026-09-30', 90]]);
    await visit(id, { inDate: '2026-10-01', outDate: '2026-10-01', entry: 100 });
    const record = async (date: string, reading: number) => {
      const res = await request(app)
        .post(URL_)
        .set(auth())
        .send({ vehicleId: String(id), date, reading });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return data<FleetOdometerLogDto>(res);
    };
    const parked = await record('2026-10-10', 150);
    const moving = await record('2026-10-11', 150);
    const closed = await request(app)
      .patch(`${URL_}/${moving.id}`)
      .set(auth())
      .send({ inReading: 200, version: moving.version });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(data<FleetOdometerLogDto>(closed).serviceGapKm).toBe(100);

    expect((await request(app).delete(`${URL_}/${parked.id}`).set(auth())).status).toBe(204);
    const again = await record('2026-10-10', 150);
    expect(again.serviceGapKm).toBe(50);

    const alarm = await alarmOf('G-TIE');
    expect(alarm?.latestReading).toBe(200);
    expect(alarm?.latestReadingLogId).toBe(moving.id);
    expect(alarm?.sinceServiceKm).toBe(100);
    const expected = await request(app)
      .get(`${URL_}/expected`)
      .query({ vehicleId: String(id) })
      .set(auth());
    expect(data<{ expectedReading: number; asOf: string }>(expected)).toMatchObject({
      expectedReading: 200,
      asOf: at('2026-10-11'),
    });
    expect(gapsByDay(await list({ vehicleCodes: 'G-TIE', from: '2026-10-10' }))).toEqual({
      '2026-10-10': 50,
      '2026-10-11': 100,
    });
  });
});
