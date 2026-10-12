// «لوحة تحكم»: everything the dashboard adds to the figures, folded from the same movements — by
// the day inside a month and by the month past it, every stretch in between, each driver once,
// the bills on no driver, the litres and the receipts that have none — and every part adding up
// to the whole.
import { describe, expect, it } from 'vitest';
import {
  custodyDashboard,
  custodyGranularity,
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
  litres: 20,
  amount: 315,
  ...over,
});

const bill = (over: Partial<CustodyDashboardRow> = {}): CustodyDashboardRow =>
  row({
    ref: 'dealershipInvoice',
    source: 'dealership',
    driverName: null,
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
      counts: { dealership: 0, fuel: 0, tyres: 0, wash: 0 },
      bySource: [
        { ref: 'receipt', count: 0, amount: 0 },
        { ref: 'dealershipInvoice', count: 0, amount: 0 },
      ],
      timeline: { granularity: 'month', buckets: [] },
      drivers: [],
      noDriver: { count: 0, amount: 0 },
      fuelTypes: [],
      litres: 0,
      litresMissing: 0,
    });
  });

  it('goes month by month past a month, the empty months between the first and the last kept', () => {
    const rows = [
      row({ date: new Date('2026-12-05T00:00:00.000Z'), amount: 100 }),
      row({ source: 'wash', date: new Date('2026-12-01T00:00:00.000Z'), amount: 40 }),
      bill({ date: new Date('2026-09-30T00:00:00.000Z'), amount: 850 }),
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
      dealership: 850,
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

  it('names each driver once — by the roster’s person, else the typed name — and the bills on none', () => {
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
      bill({ amount: 850 }),
    ];
    const out = custodyDashboard(rows, {});
    expect(out.drivers).toEqual([
      {
        driverEmployeeId: null,
        driverName: 'محمد رأفت',
        fuel: 100,
        tyres: 900,
        wash: 0,
        total: 1000,
        count: 2,
      },
      {
        driverEmployeeId: 'e-7',
        // The newest receipt's name — the rows arrive newest first.
        driverName: 'ابراهيم السيد',
        fuel: 300,
        tyres: 0,
        wash: 50,
        total: 350,
        count: 2,
      },
    ]);
    // A receipt with no name, or only spaces, is on no driver; a bill is never on one.
    expect(out.noDriver).toEqual({ count: 2, amount: 100 });
    // The drivers and the receipts on none are every receipt.
    const receipts = rows.filter((r) => r.source !== 'dealership');
    expect(sum([...out.drivers.map((d) => d.total), out.noDriver.amount])).toBe(
      sum(receipts.map((r) => r.amount)),
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
      { fuelType: 'petrol80', count: 2, amount: 475, litres: 30.25 },
      { fuelType: 'diesel', count: 1, amount: 400, litres: 50.5 },
      { fuelType: null, count: 1, amount: 70, litres: 0 },
    ]);
  });

  it('counts each kind, each screen and each car — a bill typed with a book code is its car', () => {
    const rows = [
      row(),
      row({ source: 'tyres', amount: 1400 }),
      row({ vehicleId: 'v-204', vehicleCode: '204', source: 'wash', amount: 120 }),
      bill({ vehicleId: null, vehicleCode: '63', amount: 850 }),
      bill({ vehicleId: null, vehicleCode: null, amount: 0 }),
    ];
    const out = custodyDashboard(rows, {});
    expect(out.counts).toEqual({ dealership: 2, fuel: 1, tyres: 1, wash: 1 });
    expect(out.bySource).toEqual([
      { ref: 'receipt', count: 3, amount: 1835 },
      { ref: 'dealershipInvoice', count: 2, amount: 850 },
    ]);
    expect(out.vehicleCount, '160, 204 and the book code 63 — a line with no car is none').toBe(3);
  });

  it('adds up to the whole every way it is cut — the stretches, the screens, the kinds', () => {
    const rows = [
      row({ amount: 315.1 }),
      row({ source: 'tyres', amount: 1400.2, date: new Date('2026-08-03T00:00:00.000Z') }),
      row({ source: 'wash', amount: 120.3, date: new Date('2026-07-15T00:00:00.000Z') }),
      bill({ amount: 850.4, date: new Date('2026-09-09T00:00:00.000Z') }),
    ];
    const total = sum(rows.map((r) => r.amount));
    const out = custodyDashboard(rows, {});
    expect(sum(out.timeline.buckets.map((bucket) => bucket.total))).toBe(total);
    expect(sum(out.timeline.buckets.map((bucket) => bucket.count))).toBe(rows.length);
    expect(sum(out.bySource.map((line) => line.amount))).toBe(total);
    expect(sum(Object.values(out.counts))).toBe(rows.length);
    for (const bucket of out.timeline.buckets) {
      expect(sum([bucket.dealership, bucket.fuel, bucket.tyres, bucket.wash]), bucket.key).toBe(
        bucket.total,
      );
    }
  });
});
