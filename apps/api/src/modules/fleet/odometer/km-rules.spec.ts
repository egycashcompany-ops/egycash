// The odometer's period rules (R-07, R-14…R-17) on hand-built rows — the plan's P1-04 cases.
import { describe, expect, it } from 'vitest';
import { type LocalizedString } from '@ecms/contracts';
import {
  bookCarsOf,
  classifyRows,
  closedAverage,
  confirmedThrough,
  inWorkshopThroughout,
  kmBreakdownOf,
  kmBuckets,
  kmDays,
  kmRowKind,
  foldBookRows,
  missingReadingCutoff,
  noDistanceIdsOf,
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
    expect(out.coverage).toEqual({
      withReadings: 4,
      of: 4,
      active: 4,
      inWorkshop: 0,
      joinedAfter: 0,
    });
    expect(out.noDistance).toEqual({ cars: 0, neverRead: 0, codes: [], neverReadCodes: [] });
    // Every ranked car is named by its make, `byType` or not.
    expect(out.top5.every((r) => r.typeName?.ar === 'مصفحة')).toBe(true);
    expect(out.bottom5.every((r) => r.typeName?.ar === 'مصفحة')).toBe(true);
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
    // Y = the active cars less (d) and (f): 201, 202, 203, 209 — six active (207 is disposed, 208
    // deleted), less 204 in the workshop throughout, less 206 joined after.
    expect(out.coverage).toEqual({
      withReadings: 0,
      of: 4,
      active: 6,
      inWorkshop: 1,
      joinedAfter: 1,
    });
    // «سيارات بلا مسافة في الفترة» = Y − X: the four reasons noRow / onlyOpen / onlyNoCounter /
    // onlyInvalid, never (d), (e) or (f).
    expect(out.noDistance).toEqual({
      cars: 4,
      neverRead: 0,
      codes: ['201', '202', '203', '209'],
      neverReadCodes: [],
    });
    expect(out.invalidList).toEqual([
      {
        vehicleId: '209',
        code: '209',
        deleted: false,
        typeName: { ar: 'مصفحة', en: 'Armoured' },
        date: '2026-10-15',
        from: 4000,
        to: 3980,
        km: -20,
      },
    ]);
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
    expect(out.coverage).toEqual({
      withReadings: 0,
      of: 1,
      active: 2,
      inWorkshop: 1,
      joinedAfter: 0,
    });
    // The newest visit alone does not make it (d): it only says «في الورشة منذ».
    const newestOnly = car('212', { visit: { inDate: '2026-09-20', outDate: null } });
    expect(noReadingReason(newestOnly, undefined, range)).toBe('noRow');
  });
});

describe('«العدادات والكيلومترات» · coverage parts, the cars with no distance, the readings to review', () => {
  it('Y = active − in the workshop throughout − joined after, a car that is both counted once, in (f)', () => {
    const out = breakdown({
      rows: chain('301', [
        ['2026-10-10', 0],
        ['2026-10-11', 80],
      ]),
      vehicles: fleet(
        car('301'),
        car('302'),
        car('303', { workshopThroughout: true, visit: { inDate: '2026-09-01', outDate: null } }),
        car('304', { joinedAt: '2026-11-03' }),
        // Joined after AND (somehow) held throughout: one car, in «انضمت بعد الفترة» only.
        car('305', { joinedAt: '2026-11-03', workshopThroughout: true }),
        car('306', { status: 'outOfService' }),
      ),
    });
    const { active, inWorkshop, joinedAfter, of, withReadings } = out.coverage;
    expect({ active, inWorkshop, joinedAfter, of, withReadings }).toEqual({
      active: 5,
      inWorkshop: 1,
      joinedAfter: 2,
      of: 2,
      withReadings: 1,
    });
    expect(of).toBe(active - inWorkshop - joinedAfter);
    expect(out.noDistance.cars).toBe(of - withReadings);
    expect(out.noDistance.codes).toEqual(['302']);
  });

  it('names the never-read cars among them from the service’s answer, codes in the fleet order', () => {
    const out = breakdown({
      vehicles: fleet(car('12'), car('9'), car('101')),
      // 101 was read before the period; 12 and 9 never were.
      neverReadIds: new Set(['12', '9']),
    });
    expect(out.noDistance).toEqual({
      cars: 3,
      neverRead: 2,
      codes: ['9', '12', '101'],
      neverReadCodes: ['9', '12'],
    });
    // A never-read id that is not one of the period's no-distance cars is not counted.
    const other = breakdown({
      rows: chain('12', [
        ['2026-10-10', 0],
        ['2026-10-11', 50],
      ]),
      vehicles: fleet(car('12'), car('9')),
      neverReadIds: new Set(['12', '9', 'not-in-the-set']),
    });
    expect(other.noDistance).toEqual({
      cars: 1,
      neverRead: 1,
      codes: ['9'],
      neverReadCodes: ['9'],
    });
  });

  it('over 50 cars the codes are [] (no link) while the counts stay', () => {
    const many = Array.from({ length: 51 }, (_, i) => car(String(500 + i)));
    const out = breakdown({
      vehicles: fleet(...many),
      neverReadIds: new Set(many.slice(0, 50).map((c) => c.vehicleId)),
    });
    expect(out.noDistance.cars).toBe(51);
    expect(out.noDistance.codes).toEqual([]);
    // 50 is still a link.
    expect(out.noDistance.neverRead).toBe(50);
    expect(out.noDistance.neverReadCodes).toHaveLength(50);
    expect(out.noDistance.neverReadCodes[0]).toBe('500');
  });

  it('the readings to review: at most three, the oldest day first, then the code; from → from + km', () => {
    const out = breakdown({
      rows: [
        row('402', '2026-10-20', 9000, -15),
        row('401', '2026-10-20', 7000, -5),
        row('403', '2026-10-05', 1200, -200),
        // An old-book code with no registry car: its own code, no make.
        row(null, '2026-10-02', 300, -30, { vehicleCode: 'كوستر' }),
        // A car whose make has no name: no make.
        row('404', '2026-10-25', 50, -1),
        row('401', '2026-10-21', 6995, 10), // valid, not listed
      ],
      vehicles: fleet(car('401'), car('402'), car('403'), car('404', { typeId: 'T9' })),
    });
    expect(out.invalidRows).toBe(5);
    expect(out.invalidList).toEqual([
      {
        vehicleId: null,
        code: 'كوستر',
        deleted: false,
        typeName: null,
        date: '2026-10-02',
        from: 300,
        to: 270,
        km: -30,
      },
      {
        vehicleId: '403',
        code: '403',
        deleted: false,
        typeName: { ar: 'مصفحة', en: 'Armoured' },
        date: '2026-10-05',
        from: 1200,
        to: 1000,
        km: -200,
      },
      {
        vehicleId: '401',
        code: '401',
        deleted: false,
        typeName: { ar: 'مصفحة', en: 'Armoured' },
        date: '2026-10-20',
        from: 7000,
        to: 6995,
        km: -5,
      },
    ]);
    // The fourth and fifth are counted, not listed; a negative row never enters the total.
    expect(out.total).toBe(10);
    const nameless = breakdown({
      rows: [row('404', '2026-10-25', 50, -1)],
      vehicles: fleet(car('404', { typeId: 'T9' })),
    });
    expect(nameless.invalidList[0]?.typeName).toBeNull();
  });

  it('a car deleted since keeps its readings to review, flagged deleted (it has no file any more)', () => {
    const out = breakdown({
      rows: [row('405', '2026-10-03', 900, -40), row('406', '2026-10-04', 500, -10)],
      vehicles: fleet(car('405', { isDeleted: true }), car('406')),
    });
    expect(out.invalidRows).toBe(2);
    expect(out.invalidList.map(({ code, deleted }) => ({ code, deleted }))).toEqual([
      { code: '405', deleted: true },
      { code: '406', deleted: false },
    ]);
    // Still named by its registry code and make.
    expect(out.invalidList[0]).toMatchObject({
      vehicleId: '405',
      typeName: { ar: 'مصفحة', en: 'Armoured' },
    });
  });

  it('a ranked car whose make has no name carries none', () => {
    const out = breakdown({
      rows: chain('601', [
        ['2026-10-10', 0],
        ['2026-10-11', 40],
      ]),
      vehicles: fleet(car('601', { typeId: null })),
    });
    expect(out.top5).toEqual([{ vehicleId: '601', code: '601', km: 40, typeName: null }]);
    expect(out.bottom5[0]?.typeName).toBeNull();
  });

  it('noDistanceIdsOf asks the same question as the breakdown, before it is built', () => {
    const input = {
      rows: [
        ...chain('701', [
          ['2026-10-10', 0],
          ['2026-10-11', 40],
        ]),
        row('702', '2026-10-15', 100, -3),
      ],
      vehicles: fleet(
        car('701'),
        car('702'),
        car('703'),
        car('704', { status: 'outOfService' }),
        car('705', { isDeleted: true }),
      ),
      setIds: undefined,
      range: { from: '2026-10-01', to: '2026-10-31' },
    };
    expect(noDistanceIdsOf(input)).toEqual(['702', '703']);
    expect(breakdown(input).noDistance.codes).toEqual(['702', '703']);
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
    expect(out.coverage).toEqual({
      withReadings: 1,
      of: 1,
      active: 1,
      inWorkshop: 0,
      joinedAfter: 0,
    });
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

describe('D20 · the old book’s rows under a code a live car now carries', () => {
  // «790» was registered after the old book wrote rows under its code (vehicleId null): 100 km on
  // the 12th–13th in the book, 100 km on the 20th–21st in the registry. The register's code filter
  // (`/fleet/odometer/summary?vehicleCodes=790`) adds both: 200.
  const book = (date: string, outReading: number, km: number | null, code = '790'): KmRow =>
    row(null, date, outReading, km, { vehicleCode: code });
  const rows = [
    book('2026-10-12', 500, 60),
    book('2026-10-13', 560, 40),
    ...chain('Z', [
      ['2026-10-20', 700],
      ['2026-10-21', 760],
      ['2026-10-22', 800],
    ]),
    ...chain('A', [
      ['2026-10-10', 0],
      ['2026-10-11', 300],
    ]),
    // A code no live car carries stays a car of its own, «غير مسجّلة».
    book('2026-10-10', 100, 40, 'كوستر'),
    book('2026-10-11', 140, null, 'كوستر'),
  ];
  const vehicles = fleet(
    car('Z', { code: '790', branchId: 'B1' }),
    car('A', { code: '701', branchId: 'B2' }),
  );
  const bookCars = new Map([['790', 'Z']]);

  it('folded (nothing narrows): the car carries 200 = the register by its code; «غير مسجّلة» keeps only the unknown code', () => {
    const out = breakdown({ rows, vehicles, bookCars });
    expect(out.total).toBe(540);
    expect(out.top5.map((r) => [r.code, r.km])).toEqual([
      ['701', 300],
      ['790', 200],
    ]);
    expect(out.bottom5.map((r) => [r.code, r.km])).toEqual([
      ['790', 200],
      ['701', 300],
    ]);
    // The folded code is its car: 540 ÷ 3 cars (790, 701, «كوستر»), not ÷ 4.
    expect(out.perVehicleAvg).toBe(180);
    expect(out.unregistered).toBe(40);
    // Each branch column is what the register shows for that branch — the set filters never read
    // the old book — so the folded 100 km sit in no column: Σ columns + «غير مسجّلة» = total − 100.
    expect(out.byBranch).toEqual([
      { branchId: 'B2', name: { ar: 'الجيزة', en: 'Giza' }, km: 300 },
      { branchId: 'B1', name: { ar: 'القاهرة', en: 'Cairo' }, km: 100 },
    ]);
    const columns = out.byBranch.reduce((sum, b) => sum + b.km, 0);
    expect(columns + (out.unregistered ?? 0) + 100).toBe(out.total);
    // The drawing is unchanged: every km on its day.
    expect(out.buckets.reduce((sum, b) => sum + b.confirmedKm + b.spanKm, 0)).toBe(out.total);
  });

  it('folded rows join the car’s chain: the book’s last row is a span up to the car’s next reading', () => {
    const out = breakdown({ rows, vehicles, bookCars });
    const the13th = out.buckets.find((b) => b.key === '2026-10-13');
    expect(the13th).toMatchObject({ spanKm: 40, spanTo: '2026-10-20', spanVehicles: 1 });
    // Not folded, the book's chain ends there: the span's end is not known.
    const apart = breakdown({ rows, vehicles });
    expect(apart.buckets.find((b) => b.key === '2026-10-13')).toMatchObject({
      spanKm: 40,
      spanTo: null,
    });
  });

  it('not folded (a narrowed view, or no live car of that code): the rows stay apart as before', () => {
    const out = breakdown({ rows, vehicles });
    expect(out.top5.map((r) => [r.code, r.km])).toEqual([
      ['701', 300],
      ['790', 100],
    ]);
    expect(out.perVehicleAvg).toBe(135); // 540 ÷ 4 — «790» counted twice
    expect(out.unregistered).toBe(140);
    const columns = out.byBranch.reduce((sum, b) => sum + b.km, 0);
    expect(columns + (out.unregistered ?? 0)).toBe(out.total);
  });

  it('a live car whose only rows are the book’s is ranked by them and has a distance', () => {
    const only = [book('2026-10-12', 500, 60), book('2026-10-13', 560, null)];
    const cars = fleet(car('Z', { code: '790' }), car('N', { code: '706' }));
    const range = { from: '2026-10-01', to: '2026-10-31' };
    const input = { rows: only, vehicles: cars, setIds: undefined, range, bookCars };
    expect(noDistanceIdsOf(input)).toEqual(['N']);
    const out = breakdown({ ...input });
    expect(out.top5.map((r) => [r.code, r.km])).toEqual([['790', 60]]);
    expect(out.coverage.withReadings).toBe(1);
    expect(out.noDistance.codes).toEqual(['706']);
    expect(out.unregistered).toBe(0);
    expect(out.withoutReadings.map((r) => r.code)).toEqual(['706']);
    // Not folded, the same car has no distance in the period.
    expect(noDistanceIdsOf({ rows: only, vehicles: cars, setIds: undefined, range })).toEqual([
      'Z',
      'N',
    ]);
  });

  it('a folded row to review is the car’s: its id, its code, its make', () => {
    const out = breakdown({
      rows: [book('2026-10-14', 900, -30)],
      vehicles: fleet(car('Z', { code: '790' })),
      bookCars,
    });
    expect(out.invalidList).toEqual([
      {
        vehicleId: 'Z',
        code: '790',
        deleted: false,
        typeName: { ar: 'مصفحة', en: 'Armoured' },
        date: '2026-10-14',
        from: 900,
        to: 870,
        km: -30,
      },
    ]);
  });

  it('a narrowed view (no map, and no book row: the set filters never read the old book) is unchanged', () => {
    const narrowed = breakdown({
      rows: rows.filter((r) => r.vehicleId === 'Z'),
      vehicles,
      setIds: ['Z'],
      setNarrows: true,
    });
    expect(narrowed.top5.map((r) => [r.code, r.km])).toEqual([['790', 100]]);
    expect(narrowed.unregistered).toBeNull();
  });

  it('bookCarsOf pairs a code by the register’s comparison; a deleted car takes none; two spellings → the lowest id', () => {
    const cars = fleet(
      car('a2', { code: 'MG 2' }),
      car('a1', { code: 'mg  2' }),
      car('d', { code: '799', isDeleted: true }),
      car('k', { code: 'كورولا 1' }),
    );
    const map = bookCarsOf(['mg 2', '799', 'كورولا 1 ', 'كورولا 10'], ['a2', 'a1', 'd', 'k'], cars);
    expect([...map.entries()]).toEqual([
      ['mg 2', 'a1'],
      ['كورولا 1 ', 'k'],
    ]);
  });

  it('foldBookRows leaves the registry’s rows and the unknown codes alone', () => {
    const folded = foldBookRows(rows, bookCars);
    expect(folded.filter((r) => r.fromBook === true).map((r) => [r.vehicleId, r.date])).toEqual([
      ['Z', '2026-10-12'],
      ['Z', '2026-10-13'],
    ]);
    expect(folded.filter((r) => r.vehicleId === null).map((r) => r.vehicleCode)).toEqual([
      'كوستر',
      'كوستر',
    ]);
    expect(foldBookRows(rows, undefined)).toBe(rows);
  });
});

describe('D33 · the km column of a branch the live list no longer holds', () => {
  it('keeps its id and is named «—»; «بلا فرع» (name null) is a car with no branch only', () => {
    const out = breakdown({
      rows: [
        ...chain('A', [
          ['2026-10-10', 0],
          ['2026-10-11', 300],
        ]),
        ...chain('G', [
          ['2026-10-10', 0],
          ['2026-10-11', 200],
        ]),
        ...chain('N', [
          ['2026-10-10', 0],
          ['2026-10-11', 100],
        ]),
      ],
      vehicles: fleet(
        car('A', { branchId: 'B1' }),
        car('G', { branchId: 'GONE' }),
        car('N', { branchId: null }),
      ),
    });
    expect(out.byBranch).toEqual([
      { branchId: 'B1', name: { ar: 'القاهرة', en: 'Cairo' }, km: 300 },
      { branchId: 'GONE', name: { ar: '—', en: '—' }, km: 200 },
      { branchId: null, name: null, km: 100 },
    ]);
  });
});
