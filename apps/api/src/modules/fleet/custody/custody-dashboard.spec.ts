// «لوحة تحكم»: everything the dashboard adds to the figures, folded from the same movements — by
// the day inside a month and by the month past it, every stretch in between, each driver once,
// the receipts on no driver, the litres and the receipts that have none — and every part adding
// up to the whole. Every movement is a receipt from the fund: «صيانة» is one like tyres and
// washing, and no dealership invoice is ever among them. Then what the owner's design reads off the
// same pass: the period's days, the fund's fuel by «الشركة» with «بدون شركة» kept apart, and the
// alerts banner — all counted, none guessed.
import { describe, expect, it } from 'vitest';
import {
  custodyDashboard,
  custodyGranularity,
  custodyPeriodDays,
  type CustodyDashboardRow,
} from './custody-dashboard';

const row = (over: Partial<CustodyDashboardRow> = {}): CustodyDashboardRow => ({
  ref: 'receipt',
  source: 'fuel',
  date: new Date('2026-10-01T00:00:00.000Z'),
  vehicleId: 'v-160',
  vehicleCode: '160',
  driverEmployeeId: null,
  driverName: 'محمد رأفت',
  fuelType: 'petrol92',
  company: null,
  litres: 20,
  hasImage: true,
  amount: 315,
  ...over,
});

/** «صيانة» — a receipt from the fund like tyres and washing: no fuel type, no litres. */
const maintenance = (over: Partial<CustodyDashboardRow> = {}): CustodyDashboardRow =>
  row({
    source: 'maintenance',
    fuelType: null,
    litres: null,
    amount: 850,
    ...over,
  });

const sum = (values: readonly number[]): number =>
  Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;

describe('custodyGranularity', () => {
  it('goes by the day only when both dates are chosen and a month at most apart', () => {
    const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
    expect(custodyGranularity({ from: d('2026-10-01'), to: d('2026-10-31') })).toBe('day');
    expect(custodyGranularity({ from: d('2026-02-01'), to: d('2026-03-04') })).toBe('day');
    expect(custodyGranularity({ from: d('2026-10-01'), to: d('2026-10-01') })).toBe('day');
    expect(custodyGranularity({ from: d('2026-10-01'), to: d('2026-11-02') })).toBe('month');
    expect(custodyGranularity({ from: d('2026-10-01') })).toBe('month');
    expect(custodyGranularity({ to: d('2026-10-31') })).toBe('month');
    expect(custodyGranularity({})).toBe('month');
    // Turned round, the filter matches nothing — no day-by-day of a negative span.
    expect(custodyGranularity({ from: d('2026-10-31'), to: d('2026-10-01') })).toBe('month');
  });
});

describe('custodyDashboard', () => {
  it('says nothing of an empty set — zeros, no stretch, no driver', () => {
    expect(custodyDashboard([], {})).toEqual({
      vehicleCount: 0,
      counts: { maintenance: 0, fuel: 0, tyres: 0, wash: 0 },
      bySource: [{ ref: 'receipt', count: 0, amount: 0 }],
      timeline: { granularity: 'month', buckets: [] },
      drivers: [],
      noDriver: { count: 0, amount: 0 },
      fuelTypes: [],
      litres: 0,
      litresMissing: 0,
      periodDays: 0,
      fuelByCompany: {
        companies: [
          { company: 'wataniya', amount: 0, count: 0, litres: 0, types: [] },
          { company: 'chillout', amount: 0, count: 0, litres: 0, types: [] },
        ],
        none: { amount: 0, count: 0, litres: 0, types: [] },
      },
      alerts: {
        doubleFuel: [],
        receiptsWithoutPhoto: 0,
        duplicateReceipts: 0,
      },
    });
  });

  it('goes month by month past a month, the empty months between the first and the last kept', () => {
    const rows = [
      row({ date: new Date('2026-12-05T00:00:00.000Z'), amount: 100 }),
      row({ source: 'wash', date: new Date('2026-12-01T00:00:00.000Z'), amount: 40 }),
      maintenance({ date: new Date('2026-09-30T00:00:00.000Z'), amount: 850 }),
    ];
    const { timeline } = custodyDashboard(rows, {});
    expect(timeline.granularity).toBe('month');
    expect(timeline.buckets.map((bucket) => bucket.key)).toEqual([
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    expect(timeline.buckets[0]).toEqual({
      key: '2026-09',
      maintenance: 850,
      fuel: 0,
      tyres: 0,
      wash: 0,
      total: 850,
      count: 1,
    });
    expect(timeline.buckets[1]).toMatchObject({ total: 0, count: 0 });
    expect(timeline.buckets[3]).toMatchObject({ fuel: 100, wash: 40, total: 140, count: 2 });
  });

  it('runs across the new year without losing a month', () => {
    const rows = [
      row({ date: new Date('2027-02-10T00:00:00.000Z') }),
      row({ date: new Date('2026-11-10T00:00:00.000Z') }),
    ];
    expect(custodyDashboard(rows, {}).timeline.buckets.map((bucket) => bucket.key)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });

  it('goes day by day inside a month — every day the filter names, on the board’s UTC day', () => {
    const from = new Date('2026-10-01T00:00:00.000Z');
    const to = new Date('2026-10-05T00:00:00.000Z');
    const rows = [
      row({ date: new Date('2026-10-04T21:30:00.000Z'), amount: 10 }),
      row({ source: 'tyres', date: new Date('2026-10-02T00:00:00.000Z'), amount: 1400 }),
    ];
    const { timeline } = custodyDashboard(rows, { from, to });
    expect(timeline.granularity).toBe('day');
    expect(timeline.buckets.map((bucket) => bucket.key)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
    ]);
    expect(timeline.buckets[1]).toMatchObject({ tyres: 1400, total: 1400, count: 1 });
    expect(timeline.buckets[3]).toMatchObject({ fuel: 10, total: 10, count: 1 });
    // Nothing that day is a zero, never a missing day.
    expect(timeline.buckets[0]).toMatchObject({ total: 0, count: 0 });
  });

  it('names each driver once — by the roster’s person, else the typed name — and the receipts on none', () => {
    const rows = [
      row({ driverEmployeeId: 'e-7', driverName: 'ابراهيم السيد', amount: 300 }),
      row({
        source: 'wash',
        driverEmployeeId: 'e-7',
        driverName: 'ابراهيم',
        fuelType: null,
        litres: null,
        amount: 50,
      }),
      row({ driverName: '  محمد   رأفت ', amount: 100 }),
      row({ source: 'tyres', driverName: 'محمد رأفت', fuelType: null, litres: null, amount: 900 }),
      row({ source: 'wash', driverName: '  ', fuelType: null, litres: null, amount: 40 }),
      row({ source: 'tyres', driverName: null, fuelType: null, litres: null, amount: 60 }),
      // «صيانة» names its driver as tyres and washing do.
      maintenance({ driverName: 'محمد رأفت', amount: 850 }),
      maintenance({ driverName: null, amount: 75 }),
    ];
    const out = custodyDashboard(rows, {});
    expect(out.drivers).toEqual([
      {
        driverEmployeeId: null,
        driverName: 'محمد رأفت',
        maintenance: 850,
        fuel: 100,
        tyres: 900,
        wash: 0,
        total: 1850,
        count: 3,
      },
      {
        driverEmployeeId: 'e-7',
        // The newest receipt's name — the rows arrive newest first.
        driverName: 'ابراهيم السيد',
        maintenance: 0,
        fuel: 300,
        tyres: 0,
        wash: 50,
        total: 350,
        count: 2,
      },
    ]);
    // A receipt with no name, or only spaces, is on no driver — whatever its kind.
    expect(out.noDriver).toEqual({ count: 3, amount: 175 });
    // The drivers and the receipts on none are every receipt.
    expect(sum([...out.drivers.map((d) => d.total), out.noDriver.amount])).toBe(
      sum(rows.map((r) => r.amount)),
    );
  });

  it('adds the litres, counts the fuel receipts that have none, and lists the types in their order', () => {
    const rows = [
      row({ fuelType: 'diesel', litres: 50.5, amount: 400 }),
      row({ fuelType: 'petrol80', litres: 20, amount: 315 }),
      row({ fuelType: null, litres: null, amount: 70 }),
      row({ fuelType: 'petrol80', litres: 10.25, amount: 160 }),
      row({ source: 'wash', fuelType: null, litres: null, amount: 40 }),
    ];
    const out = custodyDashboard(rows, {});
    expect(out.litres).toBe(80.75);
    expect(out.litresMissing).toBe(1);
    expect(out.fuelTypes).toEqual([
      { fuelType: 'petrol80', count: 2, amount: 475, litres: 30.25, companies: [] },
      { fuelType: 'diesel', count: 1, amount: 400, litres: 50.5, companies: [] },
      { fuelType: null, count: 1, amount: 70, litres: 0, companies: [] },
    ]);
  });

  it('counts each kind, the one screen and each car — «صيانة» in the place «التوكيل» had', () => {
    const rows = [
      row(),
      row({ source: 'tyres', amount: 1400 }),
      row({ vehicleId: 'v-204', vehicleCode: '204', source: 'wash', amount: 120 }),
      maintenance({ vehicleId: 'v-63', vehicleCode: '63', amount: 850 }),
      maintenance({ amount: 150 }),
    ];
    const out = custodyDashboard(rows, {});
    expect(out.counts).toEqual({ maintenance: 2, fuel: 1, tyres: 1, wash: 1 });
    expect(Object.keys(out.counts)).toEqual(['maintenance', 'fuel', 'tyres', 'wash']);
    // «المصدر»: every movement is a receipt from the fund.
    expect(out.bySource).toEqual([{ ref: 'receipt', count: 5, amount: 2835 }]);
    expect(out.vehicleCount, '160, 204 and 63').toBe(3);
  });

  it('adds up to the whole every way it is cut — the stretches, the screens, the kinds', () => {
    const rows = [
      row({ amount: 315.1 }),
      row({ source: 'tyres', amount: 1400.2, date: new Date('2026-08-03T00:00:00.000Z') }),
      row({ source: 'wash', amount: 120.3, date: new Date('2026-07-15T00:00:00.000Z') }),
      maintenance({ amount: 850.4, date: new Date('2026-09-09T00:00:00.000Z') }),
    ];
    const total = sum(rows.map((r) => r.amount));
    const out = custodyDashboard(rows, {});
    expect(sum(out.timeline.buckets.map((bucket) => bucket.total))).toBe(total);
    expect(sum(out.timeline.buckets.map((bucket) => bucket.count))).toBe(rows.length);
    expect(sum(out.bySource.map((line) => line.amount))).toBe(total);
    expect(sum(Object.values(out.counts))).toBe(rows.length);
    for (const bucket of out.timeline.buckets) {
      expect(sum([bucket.maintenance, bucket.fuel, bucket.tyres, bucket.wash]), bucket.key).toBe(
        bucket.total,
      );
    }
  });

  it('splits the fund’s fuel by «الشركة» — «بدون شركة» kept apart, never folded into a company', () => {
    const rows = [
      row({ company: 'chillout', fuelType: 'petrol92', litres: 20, amount: 345 }),
      row({ company: 'chillout', fuelType: 'petrol95', litres: 10.5, amount: 200.1 }),
      row({ company: 'wataniya', fuelType: 'diesel', litres: 30, amount: 465 }),
      row({ company: 'wataniya', fuelType: 'petrol92', litres: 5, amount: 86.25 }),
      // An old receipt, and one priced at no litres: «بدون شركة», its money still shown.
      row({ company: null, fuelType: 'petrol92', litres: 8, amount: 138 }),
      row({ company: null, fuelType: null, litres: null, amount: 70 }),
      // Not fuel: never in the split.
      row({ source: 'tyres', fuelType: null, litres: null, amount: 900 }),
      maintenance({ amount: 850 }),
    ];
    const out = custodyDashboard(rows, {});
    expect(out.fuelByCompany).toMatchObject({
      companies: [
        { company: 'wataniya', amount: 551.25, count: 2, litres: 35 },
        { company: 'chillout', amount: 545.1, count: 2, litres: 30.5 },
      ],
      none: { amount: 208, count: 2, litres: 8 },
    });
    // The companies and the receipts with none are the fund's whole fuel, to the piastre.
    const parts = [...out.fuelByCompany.companies, out.fuelByCompany.none];
    expect(sum(parts.map((part) => part.amount))).toBe(
      sum(rows.filter((r) => r.source === 'fuel').map((r) => r.amount)),
    );
    expect(sum(parts.map((part) => part.count))).toBe(
      rows.filter((r) => r.source === 'fuel').length,
    );
    expect(sum(parts.map((part) => part.litres))).toBe(out.litres);
    // Each type's badges are the companies its receipts name — none when none does.
    expect(out.fuelTypes.map((line) => [line.fuelType, line.companies])).toEqual([
      ['petrol92', ['wataniya', 'chillout']],
      ['petrol95', ['chillout']],
      ['diesel', ['wataniya']],
      [null, []],
    ]);
  });

  it('cuts each company’s fuel by its type — «وطنيه لوخدها وشيل اوت لوحدها», «بدون شركة» on its own', () => {
    const rows = [
      row({ company: 'wataniya', fuelType: 'diesel', litres: 30, amount: 465 }),
      row({ company: 'wataniya', fuelType: 'diesel', litres: 10.25, amount: 158.88 }),
      row({ company: 'wataniya', fuelType: 'petrol92', litres: 5, amount: 86.25 }),
      row({ company: 'chillout', fuelType: 'petrol95', litres: 10.5, amount: 200.1 }),
      row({ company: 'chillout', fuelType: 'petrol80', litres: 7, amount: 110.25 }),
      row({ company: 'chillout', fuelType: 'petrol92', litres: 20, amount: 345 }),
      // A receipt priced at no type: under its company, last, its litres none.
      row({ company: 'chillout', fuelType: null, litres: null, amount: 50 }),
      // «بدون شركة»: its own types, never folded into a company's.
      row({ company: null, fuelType: 'diesel', litres: 8, amount: 124 }),
      row({ company: null, fuelType: null, litres: null, amount: 70 }),
      // Not fuel: in no company and no type.
      row({ source: 'tyres', company: null, fuelType: null, litres: null, amount: 900 }),
      maintenance({ amount: 850 }),
    ];
    const { fuelByCompany, fuelTypes } = custodyDashboard(rows, {});
    const fuel = sum(rows.filter((r) => r.source === 'fuel').map((r) => r.amount));
    expect(fuelByCompany).toEqual({
      companies: [
        {
          company: 'wataniya',
          amount: 710.13,
          count: 3,
          litres: 45.25,
          // The fuel types' own order — 80, 92, 95, diesel — and only the types it bought.
          types: [
            { fuelType: 'petrol92', amount: 86.25, count: 1, litres: 5 },
            { fuelType: 'diesel', amount: 623.88, count: 2, litres: 40.25 },
          ],
        },
        {
          company: 'chillout',
          amount: 705.35,
          count: 4,
          litres: 37.5,
          types: [
            { fuelType: 'petrol80', amount: 110.25, count: 1, litres: 7 },
            { fuelType: 'petrol92', amount: 345, count: 1, litres: 20 },
            { fuelType: 'petrol95', amount: 200.1, count: 1, litres: 10.5 },
            { fuelType: null, amount: 50, count: 1, litres: 0 },
          ],
        },
      ],
      none: {
        amount: 194,
        count: 2,
        litres: 8,
        types: [
          { fuelType: 'diesel', amount: 124, count: 1, litres: 8 },
          { fuelType: null, amount: 70, count: 1, litres: 0 },
        ],
      },
    });
    // Each company's types are that company, to the piastre; all of them are the fund's fuel.
    const groups = [...fuelByCompany.companies, fuelByCompany.none];
    for (const group of groups) {
      expect(sum(group.types.map((line) => line.amount))).toBe(group.amount);
      expect(sum(group.types.map((line) => line.count))).toBe(group.count);
      expect(sum(group.types.map((line) => line.litres))).toBe(group.litres);
    }
    expect(sum(groups.flatMap((group) => group.types.map((line) => line.amount)))).toBe(fuel);
    // And each type, summed over the companies and «بدون شركة», is the type's own line.
    for (const line of fuelTypes) {
      const cut = groups.flatMap((group) =>
        group.types.filter((typed) => typed.fuelType === line.fuelType),
      );
      expect(sum(cut.map((typed) => typed.amount)), String(line.fuelType)).toBe(line.amount);
      expect(sum(cut.map((typed) => typed.count)), String(line.fuelType)).toBe(line.count);
    }
  });

  it('leaves a company that bought nothing with no types — never a type it did not buy', () => {
    const out = custodyDashboard(
      [row({ company: 'wataniya', fuelType: 'diesel', amount: 100 })],
      {},
    );
    expect(out.fuelByCompany.companies[1]).toEqual({
      company: 'chillout',
      amount: 0,
      count: 0,
      litres: 0,
      types: [],
    });
    expect(out.fuelByCompany.none).toEqual({ amount: 0, count: 0, litres: 0, types: [] });
  });

  it('counts «10 أيام» as the filter’s days when both are chosen, else the first movement’s to the last’s', () => {
    const d = (iso: string): Date => new Date(iso);
    const rows = [
      row({ date: d('2026-10-09T21:30:00.000Z') }),
      row({ date: d('2026-10-04T00:00:00.000Z') }),
      maintenance({ date: d('2026-10-01T00:00:00.000Z') }),
    ];
    // Both ends kept: the 1st to the 9th is nine days — the hour of the last one does not matter.
    expect(custodyPeriodDays(rows, {})).toBe(9);
    expect(custodyDashboard(rows, {}).periodDays).toBe(9);
    // One movement is one day; nothing at all is no period.
    expect(custodyPeriodDays([row()], {})).toBe(1);
    expect(custodyPeriodDays([], {})).toBe(0);
    // Both dates chosen: every day asked about, the quiet ones too, movements or none.
    const october = { from: d('2026-10-01T00:00:00.000Z'), to: d('2026-10-31T00:00:00.000Z') };
    expect(custodyPeriodDays(rows, october)).toBe(31);
    expect(custodyPeriodDays([], october)).toBe(31);
    expect(custodyPeriodDays([], { from: october.from, to: d('2026-10-01T23:59:59.999Z') })).toBe(
      1,
    );
    // Turned round, the filter matches nothing: no period.
    expect(custodyPeriodDays([], { from: october.to, to: october.from })).toBe(0);
    // One date alone is not a period of its own: the movements' days.
    expect(custodyPeriodDays(rows, { from: october.from })).toBe(9);
    expect(custodyPeriodDays(rows, { to: october.to })).toBe(9);
    // Day by day, the period IS the chart's columns.
    const out = custodyDashboard(rows, october);
    expect(out.periodDays).toBe(out.timeline.buckets.length);
  });

  it('raises a car fuelled from the fund twice on one day — per car, per UTC day, newest first', () => {
    const at = (iso: string): Date => new Date(iso);
    const rows = [
      row({ vehicleId: 'v-150', vehicleCode: '150', date: at('2026-10-04T08:00:00.000Z') }),
      row({ vehicleId: 'v-150', vehicleCode: '150', date: at('2026-10-04T21:00:00.000Z') }),
      row({ vehicleId: 'v-150', vehicleCode: '150', date: at('2026-10-04T23:59:00.000Z') }),
      // The next UTC day is another day.
      row({ vehicleId: 'v-150', vehicleCode: '150', date: at('2026-10-05T00:00:00.000Z') }),
      row({ vehicleId: 'v-9', vehicleCode: '9', date: at('2026-10-06T00:00:00.000Z') }),
      row({ vehicleId: 'v-9', vehicleCode: '9', date: at('2026-10-06T10:00:00.000Z') }),
      row({ vehicleId: 'v-12', vehicleCode: '12', date: at('2026-10-06T10:00:00.000Z') }),
      row({ vehicleId: 'v-12', vehicleCode: '12', date: at('2026-10-06T11:00:00.000Z') }),
      // Tyres, washing and maintenance the same day are not a second fuelling; another car is
      // another car.
      row({ vehicleId: 'v-160', vehicleCode: '160', source: 'tyres', fuelType: null }),
      row({ vehicleId: 'v-160', vehicleCode: '160' }),
      row({ vehicleId: 'v-160', vehicleCode: '160', source: 'wash', fuelType: null }),
      maintenance({ vehicleId: 'v-160', vehicleCode: '160' }),
    ];
    expect(custodyDashboard(rows, {}).alerts.doubleFuel).toEqual([
      { vehicleId: 'v-9', vehicleCode: '9', date: '2026-10-06', count: 2 },
      { vehicleId: 'v-12', vehicleCode: '12', date: '2026-10-06', count: 2 },
      { vehicleId: 'v-150', vehicleCode: '150', date: '2026-10-04', count: 3 },
    ]);
  });

  it('counts the receipts with no photo — «صيانة» as tyres and washing', () => {
    const rows = [
      row({ hasImage: false }),
      row({ source: 'wash', fuelType: null, hasImage: false }),
      row({ hasImage: true }),
      maintenance({ hasImage: false }),
      maintenance({ hasImage: true }),
    ];
    expect(custodyDashboard(rows, {}).alerts.receiptsWithoutPhoto).toBe(3);
  });

  it('counts the extra copies of a receipt — the same car, day, kind and amount', () => {
    const rows = [
      // Three alike: two extra copies.
      row({ amount: 150 }),
      row({ amount: 150, date: new Date('2026-10-01T18:00:00.000Z'), driverName: 'آخر' }),
      row({ amount: 150 }),
      // Not copies: another amount, kind, car or day.
      row({ amount: 151 }),
      row({ source: 'wash', fuelType: null, amount: 150 }),
      row({ vehicleId: 'v-204', vehicleCode: '204', amount: 150 }),
      row({ amount: 150, date: new Date('2026-10-02T00:00:00.000Z') }),
      // Two alike washes: one extra copy.
      row({ source: 'wash', fuelType: null, amount: 40 }),
      row({ source: 'wash', fuelType: null, amount: 40 }),
      // Compared to the piastre: a sum that lands a hair off is the same amount.
      row({ source: 'tyres', fuelType: null, amount: 0.1 + 0.2 }),
      row({ source: 'tyres', fuelType: null, amount: 0.3 }),
      // Two alike maintenance receipts: one extra copy; a fuel one of the same amount is another kind.
      maintenance({ amount: 850 }),
      maintenance({ amount: 850 }),
      row({ amount: 850 }),
    ];
    expect(custodyDashboard(rows, {}).alerts.duplicateReceipts).toBe(5);
  });

  it('raises nothing but what the receipts hold — no alert of a dealership invoice', () => {
    expect(Object.keys(custodyDashboard([], {}).alerts)).toEqual([
      'doubleFuel',
      'receiptsWithoutPhoto',
      'duplicateReceipts',
    ]);
  });
});
