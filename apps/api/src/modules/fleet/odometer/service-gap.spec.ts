// «فارق عداد الصيانة» AT EACH READING (batch 3, D1) — the pure rule, without a database.
//
// «مش بيخصم الكيلومترات اللى بتخش كل يوم بيجيب الفرق». Every reading row now carries the gap AT ITS
// reading: the row's reading less the counter of the counting service in force on its day — the
// alarm's own arithmetic (`measureFromVisit` → `computeAlarm`), asked about each row in turn.
// The figures below are the owner's: car 295 after the 6 October service at 22,790, and car 157
// at the dealer since 10 September (the approved sample, A-odometer/02).
import { describe, expect, it } from 'vitest';
import { computeAlarm, NO_BOUNDS, type VisitBounds } from '../maintenance/maintenance-alarm';
import { type CountingVisit } from '../maintenance/maintenance.repository';
import {
  rowReading,
  serviceGapOf,
  serviceGapsOf,
  visitInForce,
  type GapRow,
  type GapWorld,
} from './service-gap';

const D = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const CAR = '650000000000000000000295';

let nextId = 0;
const row = (
  date: string,
  outReading: number | null,
  inReading: number | null,
  vehicleId: string | null = CAR,
): GapRow => {
  nextId += 1;
  return { _id: `row-${nextId}`, vehicleId, date: D(date), outReading, inReading };
};

const visit = (over: Partial<CountingVisit> & { visitId: string }): CountingVisit => ({
  vehicleId: CAR,
  inDate: D('2026-10-06'),
  outDate: D('2026-10-06'),
  entryCounter: null,
  exitCounter: null,
  ...over,
});

/** Car 295: in and out on 6 October at 22,790 (entry counter only); the chain held 22,400 on the 5th. */
const OCT06 = visit({ visitId: 'oct-06', entryCounter: 22_790 });
const OCT06_BOUNDS: VisitBounds = {
  ...NO_BOUNDS,
  entryBound: { reading: 22_400, date: D('2026-10-05') },
};

const world = (over: Partial<GapWorld> = {}): GapWorld => ({
  intervals: new Map([[CAR, 7_500]]),
  visits: new Map([[CAR, [OCT06]]]),
  bounds: new Map([[OCT06.visitId, OCT06_BOUNDS]]),
  ...over,
});

describe('each row carries the gap AT ITS OWN reading — the figure grows day by day', () => {
  it('car 295, 19 October → 1 November: 2,841 … 5,507, as the approved sample shows', () => {
    // The chain as the register keeps it: each row closes on the next one's opening reading.
    const rows = [
      row('2026-10-19', 25_581, 25_631),
      row('2026-10-20', 25_631, 25_709),
      row('2026-10-21', 25_709, 25_754),
      row('2026-10-22', 25_754, 25_916),
      row('2026-10-25', 25_916, 26_040),
      row('2026-10-26', 26_040, 26_126),
      row('2026-10-27', 26_126, 26_300),
      row('2026-10-28', 26_300, 28_170),
      row('2026-10-29', 28_170, 28_297),
      row('2026-11-01', 28_297, null),
    ];
    const gaps = serviceGapsOf(rows, world());
    expect(rows.map((r) => gaps.get(r._id.toString()))).toEqual([
      2_841, 2_919, 2_964, 3_126, 3_250, 3_336, 3_510, 5_380, 5_507, 5_507,
    ]);
  });

  it('a row reads how far the car had got by its END — the closing reading when there is one', () => {
    expect(rowReading({ outReading: 26_300, inReading: 28_170 })).toBe(28_170);
    expect(rowReading({ outReading: 28_297, inReading: null })).toBe(28_297);
    expect(rowReading({ outReading: null, inReading: null })).toBeNull();
    // The owner's report: 150 in, then 200 the next day — the 50 km reach the gap.
    const parked = serviceGapOf(row('2026-10-20', 22_950, 22_950), world());
    const moved = serviceGapOf(row('2026-10-21', 22_950, 23_000), world());
    expect(moved! - parked!).toBe(50);
  });

  it('the row the alarm measured carries exactly the alarm’s own figure', () => {
    const latest = row('2026-11-01', 28_297, null);
    const alarm = computeAlarm({
      intervalKm: 7_500,
      yellowKm: 1_000,
      redKm: 300,
      latestReading: 28_297,
      latestReadingDate: latest.date,
      baselineCounter: 22_790,
      baselineDate: OCT06.outDate,
      baselineLowerBound: 22_400,
    });
    expect(alarm.sinceServiceKm).toBe(5_507);
    expect(serviceGapOf(latest, world())).toBe(alarm.sinceServiceKm);
  });
});

describe('nothing honest to show → «—» (null)', () => {
  it('before the car’s first counting service', () => {
    expect(serviceGapOf(row('2026-10-01', 22_000, 22_100), world())).toBeNull();
  });

  it('on the service day itself — that reading is «older than the service», as the alarm says', () => {
    // 22,830 was logged for 6 October; the 6 October service is not yet in force on its own day.
    expect(serviceGapOf(row('2026-10-06', 22_830, 22_900), world())).toBeNull();
  });

  it('a day recorded without a reading, and a row kept from the old book with no car', () => {
    expect(serviceGapOf(row('2026-10-24', null, null), world())).toBeNull();
    expect(serviceGapOf(row('2026-10-24', 26_000, 26_100, null), world())).toBeNull();
  });

  it('a car outside the alarm — not active, or its make has no «مسافة الصيانة»', () => {
    // `loadServiceGaps` leaves such a car out of `intervals`, exactly as `computeAlarms` skips it.
    expect(
      serviceGapOf(row('2026-10-20', 25_631, 25_709), world({ intervals: new Map() })),
    ).toBeNull();
    // And an interval of 0 is the alarm's `noInterval` — no distance either.
    expect(
      serviceGapOf(row('2026-10-20', 25_631, 25_709), world({ intervals: new Map([[CAR, 0]]) })),
    ).toBeNull();
  });

  it('a counter the alarm would refuse — below a reading the chain held before its day', () => {
    const refused = world({
      bounds: new Map([
        [OCT06.visitId, { ...NO_BOUNDS, entryBound: { reading: 22_900, date: D('2026-10-04') } }],
      ]),
    });
    expect(serviceGapOf(row('2026-10-20', 25_631, 25_709), refused)).toBeNull();
  });

  it('a row read below the service counter (a typo) — the alarm’s «above the reading» refusal', () => {
    expect(serviceGapOf(row('2026-10-07', 22_700, 22_780), world())).toBeNull();
  });
});

describe('the service IN FORCE on each row’s day', () => {
  /** Car 295's September service in the old book: 20 September at 15,347. */
  const SEP20 = visit({
    visitId: 'sep-20',
    inDate: D('2026-09-09'),
    outDate: D('2026-09-20'),
    entryCounter: 15_347,
  });
  const twoServices = world({
    visits: new Map([[CAR, [OCT06, SEP20]]]),
    bounds: new Map([
      [OCT06.visitId, OCT06_BOUNDS],
      [SEP20.visitId, NO_BOUNDS],
    ]),
  });

  it('two services → each row from the one in force on its day', () => {
    expect(serviceGapOf(row('2026-10-05', 22_400, 22_830), twoServices)).toBe(22_830 - 15_347);
    expect(serviceGapOf(row('2026-10-06', 22_830, 22_900), twoServices)).toBe(22_900 - 15_347);
    expect(serviceGapOf(row('2026-10-07', 22_900, 23_000), twoServices)).toBe(23_000 - 22_790);
  });

  it('is the first visit, newest check-out first, checked out strictly before the day', () => {
    const visits = [OCT06, SEP20];
    expect(visitInForce(visits, D('2026-10-07'))?.visitId).toBe('oct-06');
    expect(visitInForce(visits, D('2026-10-06'))?.visitId).toBe('sep-20');
    expect(visitInForce(visits, D('2026-09-20'))).toBeNull();
    // A reading stamped with a time on the 7th is still the 7th.
    expect(visitInForce(visits, new Date('2026-10-07T13:45:00.000Z'))?.visitId).toBe('oct-06');
  });

  it('two services out on one day: the later-recorded one, as `alarmBaselines` orders them', () => {
    // The repository answers newest `_id` first among equal check-outs; the first one wins.
    const later = visit({ visitId: 'later', exitCounter: 22_795 });
    expect(visitInForce([later, OCT06], D('2026-10-07'))?.visitId).toBe('later');
  });
});

describe('the counter choice is the alarm’s, per row (R3, R4)', () => {
  it('a visit with no counter is measured from the reading the car left on (the stand-in)', () => {
    const bare = visit({ visitId: 'bare' });
    const stand = world({
      visits: new Map([[CAR, [bare]]]),
      bounds: new Map([
        [bare.visitId, { ...NO_BOUNDS, standIn: { reading: 22_830, date: D('2026-10-06') } }],
      ]),
    });
    expect(serviceGapOf(row('2026-10-20', 25_631, 25_709), stand)).toBe(25_709 - 22_830);
  });

  it('R3: an exit counter below the chain gives way to the entry counter — on every row', () => {
    // Out on the 15th at 22,795, with 23,500 typed in afterwards for the 10th.
    const late = visit({
      visitId: 'late',
      outDate: D('2026-10-15'),
      entryCounter: 22_790,
      exitCounter: 22_795,
    });
    const r3 = world({
      visits: new Map([[CAR, [late]]]),
      bounds: new Map([
        [
          late.visitId,
          {
            exitBound: { reading: 23_500, date: D('2026-10-10') },
            entryBound: { reading: 22_400, date: D('2026-10-05') },
            standIn: null,
          },
        ],
      ]),
    });
    expect(serviceGapOf(row('2026-10-16', 23_600, 23_700), r3)).toBe(23_700 - 22_790);
    expect(serviceGapOf(row('2026-10-20', 25_631, 25_709), r3)).toBe(25_709 - 22_790);
    // Before the check-out day the late visit is not in force yet.
    expect(serviceGapOf(row('2026-10-12', 23_500, 23_600), r3)).toBeNull();
  });

  it('the exit counter, when it stands, is the one used', () => {
    const both = visit({ visitId: 'both', entryCounter: 22_790, exitCounter: 22_800 });
    const exitFirst = world({
      visits: new Map([[CAR, [both]]]),
      bounds: new Map([
        [both.visitId, { ...NO_BOUNDS, exitBound: { reading: 22_400, date: D('2026-10-05') } }],
      ]),
    });
    expect(serviceGapOf(row('2026-10-20', 25_631, 25_709), exitFirst)).toBe(25_709 - 22_800);
  });
});

describe('car 157 — at the dealer since 10 September', () => {
  const CAR_157 = '650000000000000000000157';
  const SEP05 = visit({
    vehicleId: CAR_157,
    visitId: 'sep-05',
    inDate: D('2026-09-05'),
    outDate: D('2026-09-05'),
    entryCounter: 173_344,
  });
  const at157 = world({
    intervals: new Map([[CAR_157, 5_000]]),
    visits: new Map([[CAR_157, [SEP05]]]),
    bounds: new Map([
      [SEP05.visitId, { ...NO_BOUNDS, entryBound: { reading: 173_294, date: D('2026-09-03') } }],
    ]),
  });

  it('its last reading row reads 290; its days without a reading read «—»', () => {
    expect(serviceGapOf(row('2026-09-10', 173_345, 173_634, CAR_157), at157)).toBe(290);
    expect(serviceGapOf(row('2026-09-23', 173_634, null, CAR_157), at157)).toBe(290);
    expect(serviceGapOf(row('2026-10-24', null, null, CAR_157), at157)).toBeNull();
  });
});
