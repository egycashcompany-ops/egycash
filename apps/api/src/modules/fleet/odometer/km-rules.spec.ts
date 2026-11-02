// The odometer's period rules (R-07, R-14…R-17) on hand-built rows — the plan's P1-04 cases.
import { describe, expect, it } from 'vitest';
import { type LocalizedString } from '@ecms/contracts';
import {
  classifyRows,
  closedAverage,
  confirmedThrough,
  inWorkshopThroughout,
  kmBreakdownOf,
  kmBuckets,
  kmDays,
  kmRowKind,
  missingReadingCutoff,
  noReadingReason,
  readingIsMissing,
  type KmBreakdownInput,
  type KmRow,
  type KmVehicle,
} from './km-rules';

let seq = 0;
/** One stored row: the car, its day, its opening reading and km as the chain left them. */
const row = (
  car: string | null,
  date: string,
  outReading: number | null,
  km: number | null,
  over: Partial<KmRow> = {},
): KmRow => {
  seq += 1;
  return {
    vehicleId: car,
    vehicleCode: null,
    date,
    outReading,
    km,
    order: seq.toString(16).padStart(24, '0'),
    ...over,
  };
};

/**
 * A car's chain as `record()` leaves it: each reading closes the one before, so a row's km is the
 * next reading minus its own, and the last row is the open period.
 */
const chain = (car: string, readings: readonly (readonly [string, number])[]): KmRow[] =>
  readings.map(([date, reading], i) => {
    const next = readings[i + 1];
    return row(car, date, reading, next === undefined ? null : next[1] - reading);
  });

const car = (id: string, over: Partial<KmVehicle> = {}): KmVehicle => ({
  vehicleId: id,
  code: id,
  status: 'active',
  isDeleted: false,
  joinedAt: '2025-01-01',
  branchId: 'B1',
  typeId: 'T1',
  visit: null,
  workshopThroughout: false,
  ...over,
});

const fleet = (...cars: KmVehicle[]): Map<string, KmVehicle> =>
  new Map(cars.map((c) => [c.vehicleId, c]));

const NAMES = new Map<string, LocalizedString>([
  ['B1', { ar: 'القاهرة', en: 'Cairo' }],
  ['B2', { ar: 'الجيزة', en: 'Giza' }],
]);

const breakdown = (over: Partial<KmBreakdownInput>) =>
  kmBreakdownOf({
    rows: [],
    vehicles: new Map(),
    setIds: undefined,
    range: { from: '2026-10-01', to: '2026-10-31' },
    today: '2026-11-01',
    staleDays: 3,
    byType: false,
    setNarrows: false,
    branchNames: NAMES,
    typeNames: new Map([['T1', { ar: 'مصفحة', en: 'Armoured' }]]),
    ...over,
  });

const daysFor = (rows: KmRow[], range: { from: string; to: string }, today = '2026-11-01') =>
  kmDays(classifyRows(rows, range), { today, staleDays: 3 });

describe('R-14 · which rows count', () => {
  it('a closed row on the chain with km ≥ 0 is valid; negative is invalid; open and no-counter count nothing', () => {
    expect(kmRowKind({ outReading: 1000, km: 120 })).toBe('valid');
    expect(kmRowKind({ outReading: 1000, km: 0 })).toBe('valid');
    expect(kmRowKind({ outReading: 1000, km: -50 })).toBe('invalid');
    expect(kmRowKind({ outReading: 1000, km: null })).toBe('open');
    expect(kmRowKind({ outReading: null, km: null })).toBe('noCounter');
  });

  it('negative km is excluded from the total and counted as «قراءة تحتاج مراجعة»', () => {
    const out = breakdown({
      rows: [
        row('A', '2026-10-05', 1000, -50),
        row('A', '2026-10-06', 950, 100),
        row('A', '2026-10-07', 1050, null),
      ],
      vehicles: fleet(car('A')),
    });
    expect(out.total).toBe(100);
    expect(out.invalidRows).toBe(1);
  });
});

describe('R-15 · single-day rows and spans', () => {
  const range = { from: '2026-10-05', to: '2026-10-05' };

  it('a single-day row: the next reading is the next day → a confirmed bar', () => {
    const rows = chain('A', [
      ['2026-10-05', 1000],
      ['2026-10-06', 1100],
    ]);
    const [entry] = classifyRows(rows, range);
    expect(entry).toMatchObject({ kind: 'valid', span: false, next: '2026-10-06' });
    const day = daysFor(rows, range).get('2026-10-05');
    expect(day).toMatchObject({ confirmedKm: 100, spanKm: 0, pending: 0, chainRows: 1 });
  });

  it('two rows on the same day: the first is closed by the second, both single-day', () => {
    const rows = [
      row('A', '2026-10-05', 1000, 50),
      row('A', '2026-10-05', 1050, 70),
      row('A', '2026-10-06', 1120, null),
    ];
    expect(classifyRows(rows, range).map((entry) => entry.span)).toEqual([false, false]);
    expect(daysFor(rows, range).get('2026-10-05')?.confirmedKm).toBe(120);
  });

  it('a multi-day span counts on its START day, outlined, never in the confirmed colour', () => {
    const wide = { from: '2026-10-05', to: '2026-10-08' };
    const rows = chain('A', [
      ['2026-10-05', 1000],
      ['2026-10-08', 1300],
    ]);
    const days = daysFor(rows, wide);
    expect(days.get('2026-10-05')).toMatchObject({ confirmedKm: 0, spanKm: 300 });
    const { buckets } = kmBuckets(days, wide, '2026-11-01');
    expect(buckets.map((b) => [b.key, b.hasRows, b.confirmedKm, b.spanKm])).toEqual([
      ['2026-10-05', true, 0, 300],
      // The two days nobody read are EMPTY slots, never zero bars.
      ['2026-10-06', false, 0, 0],
      ['2026-10-07', false, 0, 0],
      ['2026-10-08', true, 0, 0],
    ]);
    expect(buckets[0]).toMatchObject({ spanTo: '2026-10-08', spanVehicles: 1 });
  });

  it('a day recorded WITHOUT a reading inside a span neither breaks the span nor draws a bar', () => {
    const wide = { from: '2026-10-05', to: '2026-10-08' };
    const rows = [
      ...chain('A', [
        ['2026-10-05', 1000],
        ['2026-10-08', 1300],
      ]),
      row('A', '2026-10-06', null, null),
    ];
    const days = daysFor(rows, wide);
    expect(days.get('2026-10-05')?.spanKm).toBe(300);
    expect(days.has('2026-10-06')).toBe(false);
    expect(kmBuckets(days, wide, '2026-11-01').buckets[1]?.hasRows).toBe(false);
  });

  it('a successor beyond the window [from, to + 1] makes a span whose end is not known', () => {
    const rows = [row('A', '2026-10-05', 1000, 400)]; // closed by a reading after 10-06
    const [entry] = classifyRows(rows, range);
    expect(entry).toMatchObject({ span: true, next: null });
    expect(kmBuckets(daysFor(rows, range), range, '2026-11-01').buckets[0]?.spanTo).toBeNull();
  });

  it('Thursday followed by an unread Friday: the span sits on Thursday, the average spans the closed days', () => {
    const range3 = { from: '2026-10-22', to: '2026-10-24' }; // Thu, Fri, Sat
    const rows = [
      ...chain('A', [
        ['2026-10-22', 1000], // Thursday, next read on Saturday
        ['2026-10-24', 1400],
        ['2026-10-25', 1500],
      ]),
      ...chain('B', [
        ['2026-10-22', 5000],
        ['2026-10-23', 5200], // B is read on Friday
        ['2026-10-25', 5300],
      ]),
    ];
    const days = daysFor(rows, range3);
    expect(days.get('2026-10-22')).toMatchObject({ confirmedKm: 200, spanKm: 400 });
    expect(days.get('2026-10-23')).toMatchObject({ confirmedKm: 0, spanKm: 100 });
    expect(days.get('2026-10-24')).toMatchObject({ confirmedKm: 100, spanKm: 0 });
    const through = confirmedThrough(days, range3, '2026-11-01');
    expect(through).toBe('2026-10-24');
    // (200 + 400 + 100 + 100) ÷ 3 calendar days — not the solid bars over the confirmed days.
    expect(closedAverage(days, range3.from, through)).toEqual({ closedDays: 3, average: 266.7 });
  });

  it('a back-dated split turns a span into a single day and a span, the total unchanged', () => {
    const range4 = { from: '2026-10-22', to: '2026-10-25' };
    const before = chain('A', [
      ['2026-10-22', 1000],
      ['2026-10-25', 1600],
      ['2026-10-26', 1700],
    ]);
    const after = chain('A', [
      ['2026-10-22', 1000],
      ['2026-10-23', 1300], // entered late, for Friday
      ['2026-10-25', 1600],
      ['2026-10-26', 1700],
    ]);
    const b = daysFor(before, range4);
    const a = daysFor(after, range4);
    expect(b.get('2026-10-22')).toMatchObject({ confirmedKm: 0, spanKm: 600 });
    expect(a.get('2026-10-22')).toMatchObject({ confirmedKm: 300, spanKm: 0 });
    expect(a.get('2026-10-23')).toMatchObject({ confirmedKm: 0, spanKm: 300 });
    const total = (days: typeof a) =>
      [...days.values()].reduce((sum, day) => sum + day.confirmedKm + day.spanKm, 0);
    expect(total(a)).toBe(total(b));
  });
});

describe('R-15 · pending and stale open rows; «confirmed through»', () => {
  // A car out of service since the 5th: its last row, dated the 5th, stays open for ever.
  const rows = [
    ...chain('A', [
      ['2026-10-01', 1000],
      ['2026-10-02', 1100],
      ['2026-10-03', 1200],
      ['2026-10-04', 1300],
      ['2026-10-05', 1400],
      ['2026-10-06', 1500],
      ['2026-10-07', 1600],
      ['2026-10-08', 1700],
      ['2026-10-09', 1800],
    ]),
    ...chain('C', [
      ['2026-10-04', 7000],
      ['2026-10-05', 7100],
    ]),
  ];
  const range = { from: '2026-10-01', to: '2026-10-09' };

  it('on the 9th with N = 3 the 5th is not held open: the old open row is stale, «confirmed through» the 8th', () => {
    const days = kmDays(classifyRows(rows, range), { today: '2026-10-09', staleDays: 3 });
    expect(days.get('2026-10-05')).toMatchObject({ pending: 0, stale: 1, confirmedKm: 100 });
    // Today is always open: the car read today waits for tomorrow's reading.
    expect(days.get('2026-10-09')).toMatchObject({ pending: 1 });
    expect(confirmedThrough(days, range, '2026-10-09')).toBe('2026-10-08');
  });

  it('inside the grace the same open row is pending and holds its day', () => {
    // On the 8th, the 5th is today − 3: still pending, so nothing after the 4th is confirmed.
    const days = kmDays(classifyRows(rows, range), { today: '2026-10-08', staleDays: 3 });
    expect(days.get('2026-10-05')).toMatchObject({ pending: 1, stale: 0 });
    expect(confirmedThrough(days, range, '2026-10-08')).toBe('2026-10-04');
  });

  it('the stale marker and the pending part reach the bucket; a day that has not ended is never confirmed', () => {
    const days = kmDays(classifyRows(rows, range), { today: '2026-10-09', staleDays: 3 });
    const { buckets } = kmBuckets(days, range, '2026-10-09');
    expect(buckets.find((b) => b.key === '2026-10-05')).toMatchObject({
      confirmed: true,
      stale: 1,
    });
    expect(buckets.find((b) => b.key === '2026-10-09')).toMatchObject({
      confirmed: false,
      pending: 1,
    });
  });

  it('nothing is confirmed on the first day of a month that began today', () => {
    const days = daysFor(chain('A', [['2026-11-01', 1000]]), {
      from: '2026-11-01',
      to: '2026-11-01',
    });
    expect(
      confirmedThrough(days, { from: '2026-11-01', to: '2026-11-01' }, '2026-11-01'),
    ).toBeNull();
    expect(closedAverage(days, '2026-11-01', null)).toEqual({ closedDays: 0, average: null });
  });
});

describe('R-07 · no reading for N days', () => {
  it('with N = 3 on 2026-11-01, a last chain date of 2026-10-28 fires and 2026-10-29 does not', () => {
    expect(missingReadingCutoff('2026-11-01', 3)).toBe('2026-10-29');
    expect(readingIsMissing('2026-10-28', '2026-11-01', 3)).toBe(true);
    expect(readingIsMissing('2026-10-29', '2026-11-01', 3)).toBe(false);
    expect(readingIsMissing('2026-11-01', '2026-11-01', 3)).toBe(false);
  });
});

describe('buckets · daily up to 31 days, monthly above', () => {
  it('to − from = 31 days is still daily (32 slots); one more day goes by the month', () => {
    const daily = kmBuckets(new Map(), { from: '2026-10-01', to: '2026-11-01' }, '2026-11-02');
    expect(daily.granularity).toBe('day');
    expect(daily.buckets).toHaveLength(32);
    const monthly = kmBuckets(new Map(), { from: '2026-10-01', to: '2026-11-02' }, '2026-11-03');
    expect(monthly.granularity).toBe('month');
    expect(monthly.buckets.map((b) => b.key)).toEqual(['2026-10', '2026-11']);
  });

  it('a month is confirmed only when it has ended and every day of it is confirmed or row-less', () => {
    const rows = [
      ...chain('A', [
        ['2026-09-30', 900],
        ['2026-10-01', 1000],
        ['2026-11-01', 2000],
        ['2026-11-02', 2100],
      ]),
    ];
    const range = { from: '2026-09-01', to: '2026-11-02' };
    const days = daysFor(rows, range, '2026-11-02');
    const { buckets } = kmBuckets(days, range, '2026-11-02');
    expect(buckets.map((b) => [b.key, b.confirmed])).toEqual([
      ['2026-09', true],
      ['2026-10', true],
      ['2026-11', false],
    ]);
    expect(buckets[1]).toMatchObject({ spanKm: 1000, spanTo: '2026-11-01' });
  });
});

describe('R-16, R-17 · rankings, coverage and the cars without valid readings', () => {
  const range = { from: '2026-10-01', to: '2026-10-31' };
  const daily = (id: string, start: number, step: number): KmRow[] =>
    chain(id, [
      ['2026-10-10', start],
      ['2026-10-11', start + step],
      ['2026-10-12', start + step * 2],
    ]);

  it('ranks by km desc, then the code in the fleet order; the bottom five are active cars only', () => {
    const out = breakdown({
      rows: [
        ...daily('150', 0, 100), // 200 km
        ...daily('160', 0, 100), // 200 km — a tie, after 150
        ...daily('170', 0, 500), // 1000 km
        ...daily('180', 0, 50), // 100 km, but out of service now
        ...daily('190', 0, 10), // 20 km, in the workshop now (entered after the period started)
      ],
      vehicles: fleet(
        car('150'),
        car('160'),
        car('170'),
        car('180', { status: 'outOfService' }),
        car('190', { visit: { inDate: '2026-10-20', outDate: null } }),
      ),
    });
    expect(out.top5.map((r) => [r.code, r.km])).toEqual([
      ['170', 1000],
      ['150', 200],
      ['160', 200],
      ['180', 100],
      ['190', 20],
    ]);
    expect(out.bottom5.map((r) => [r.code, r.km, r.inWorkshopSince])).toEqual([
      ['190', 20, '2026-10-20'],
      ['150', 200, null],
      ['160', 200, null],
      ['170', 1000, null],
    ]);
    expect(out.coverage).toEqual({ withReadings: 4, of: 4 });
    // The km of all five cars ÷ the five cars that drove it (180, out of service now, included):
    // the coverage bar's 4 is not the divisor.
    expect(out.perVehicleAvg).toBe(304); // 1520 ÷ 5
  });

  it('gives each car without a valid reading exactly one reason, (a)–(f), and never ranks it', () => {
    const vehicles = fleet(
      car('201'), // (a) no row
      car('202'), // (b) only its open row
      car('203'), // (c) only a day recorded without a counter
      // (d) in the workshop throughout
      car('204', { visit: { inDate: '2026-09-20', outDate: null }, workshopThroughout: true }),
      car('205', { status: 'outOfService' }), // (e) not active now
      car('206', { joinedAt: '2026-11-05' }), // (f) joined after the period
      car('207', { status: 'disposed' }), // disposed long ago, no row: no news
      car('208', { isDeleted: true }), // deleted: not in the registry any more
      car('209'), // only a negative row: «تحتاج مراجعة», counted there AND named here
    );
    const out = breakdown({
      rows: [
        row('202', '2026-10-30', 9000, null),
        row('203', '2026-10-15', null, null),
        row('209', '2026-10-15', 4000, -20),
        row('209', '2026-11-01', 3980, null),
      ],
      vehicles,
    });
    expect(out.withoutReadings.map((r) => [r.code, r.reason])).toEqual([
      ['201', 'noRow'],
      ['202', 'onlyOpen'],
      ['203', 'onlyNoCounter'],
      ['209', 'onlyInvalid'],
      ['204', 'inWorkshop'],
      ['205', 'notActive'],
      ['206', 'joinedAfter'],
    ]);
    expect(out.top5).toEqual([]);
    // Y = the active cars less (d) and (f): 201, 202, 203, 209.
    expect(out.coverage).toEqual({ withReadings: 0, of: 4 });
    expect(out.perVehicleAvg).toBeNull();
    expect(noReadingReason(car('209'), undefined, range)).toBe('noRow');
  });

  it('a visit that ended before the period does not count as the workshop throughout', () => {
    const outOfShop = car('210', { visit: { inDate: '2026-09-01', outDate: '2026-10-03' } });
    expect(noReadingReason(outOfShop, undefined, range)).toBe('noRow');
  });

  it('(d) is the period’s own question: a newer, shorter visit does not hide an older one that covered it', () => {
    // 211: in from 20 September to 1 November (covers October), then in again since 2 November —
    // its NEWEST visit began after the period did, yet it was in the workshop all October.
    const covered = car('211', {
      visit: { inDate: '2026-11-02', outDate: null },
      workshopThroughout: true,
    });
    expect(inWorkshopThroughout(covered)).toBe(true);
    expect(noReadingReason(covered, undefined, range)).toBe('inWorkshop');
    const out = breakdown({ vehicles: fleet(car('201'), covered) });
    expect(out.withoutReadings.map((r) => [r.code, r.reason])).toEqual([
      ['201', 'noRow'],
      ['211', 'inWorkshop'],
    ]);
    // Y leaves it out: one car, not two.
    expect(out.coverage).toEqual({ withReadings: 0, of: 1 });
    // The newest visit alone does not make it (d): it only says «في الورشة منذ».
    const newestOnly = car('212', { visit: { inDate: '2026-09-20', outDate: null } });
    expect(noReadingReason(newestOnly, undefined, range)).toBe('noRow');
  });
});

describe('the km by branch and type; the rows without a car', () => {
  const rows = [
    ...chain('A', [
      ['2026-10-10', 0],
      ['2026-10-11', 300],
    ]),
    ...chain('B', [
      ['2026-10-10', 0],
      ['2026-10-11', 500],
    ]),
    // A row kept from the old book for a car the registry never had.
    row(null, '2026-10-10', 100, 40, { vehicleCode: 'كوستر' }),
    row(null, '2026-10-11', 140, null, { vehicleCode: 'كوستر' }),
  ];
  const vehicles = fleet(car('A', { branchId: 'B1' }), car('B', { branchId: 'B2' }));

  it('km = Σ buckets = Σ byBranch + unregistered, by the car’s CURRENT branch', () => {
    const out = breakdown({ rows, vehicles });
    expect(out.total).toBe(840);
    const buckets = out.buckets.reduce((sum, b) => sum + b.confirmedKm + b.spanKm, 0);
    expect(buckets).toBe(840);
    expect(out.byBranch).toEqual([
      { branchId: 'B2', name: { ar: 'الجيزة', en: 'Giza' }, km: 500 },
      { branchId: 'B1', name: { ar: 'القاهرة', en: 'Cairo' }, km: 300 },
    ]);
    expect(out.unregistered).toBe(40);
    expect(out.byType).toBeNull();
    // The old-book car carries 40 of the 840 km, so it is one of the three cars divided by.
    expect(out.perVehicleAvg).toBe(280);
  });

  it('with a set: no «غير مسجّلة» when the filter kept no row without a car; by type when a branch is chosen', () => {
    const out = breakdown({
      rows: rows.filter((r) => r.vehicleId === 'A'),
      vehicles,
      setIds: ['A'],
      setNarrows: true,
      byType: true,
    });
    expect(out.unregistered).toBeNull();
    expect(out.byType).toEqual([{ typeId: 'T1', name: { ar: 'مصفحة', en: 'Armoured' }, km: 300 }]);
    expect(out.coverage).toEqual({ withReadings: 1, of: 1 });
  });

  it('the spans line and «confirmed through» come from the same days', () => {
    const out = breakdown({
      rows: chain('A', [
        ['2026-10-01', 0],
        ['2026-10-03', 200],
        ['2026-10-04', 260],
      ]),
      vehicles,
      range: { from: '2026-10-01', to: '2026-10-03' },
    });
    expect(out.spans).toEqual({ km: 200, count: 1 });
    expect(out.confirmedThrough).toBe('2026-10-03');
    expect(out.closedDays).toBe(3);
    expect(out.average).toBe(86.7); // 260 ÷ 3
  });
});
