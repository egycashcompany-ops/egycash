// R-15's drawing as data: what each column of «الكيلومترات يومًا بيوم» is allowed to show.
import { describe, expect, it } from 'vitest';
import { type FleetDashboardKmBucketDto } from '@ecms/contracts';
import {
  HATCH_LIFT,
  LABEL_EVERY_DAY,
  axisLabel,
  axisTicks,
  bucketDays,
  isFriday,
  kmChart,
} from './fleet-dashboard-km-chart';

const TODAY = '2026-11-01';

const bucket = (
  key: string,
  over: Partial<FleetDashboardKmBucketDto> = {},
): FleetDashboardKmBucketDto => ({
  key,
  hasRows: true,
  confirmed: true,
  confirmedKm: 4000,
  spanKm: 0,
  pending: 0,
  stale: 0,
  spanTo: null,
  spanVehicles: 0,
  ...over,
});

const DAILY = { from: '2026-10-27', to: TODAY, granularity: 'day' as const };

/** 10/27 confirmed · 10/28 span start · 10/29 no row · 10/30 stale · 10/31 pending · 11/01 today. */
const WEEK = [
  bucket('2026-10-27'),
  bucket('2026-10-28', { confirmedKm: 3000, spanKm: 1800, spanTo: '2026-10-30', spanVehicles: 6 }),
  bucket('2026-10-29', { hasRows: false, confirmed: false, confirmedKm: 0 }),
  bucket('2026-10-30', { stale: 2 }),
  bucket('2026-10-31', { confirmed: false, confirmedKm: 2500, pending: 8 }),
  bucket(TODAY, { confirmed: false, confirmedKm: 300, pending: 31 }),
];

const chart = kmChart({ buckets: WEEK, average: 4200 }, DAILY, TODAY);
const column = (key: string) => {
  const found = chart.columns.find((c) => c.bucket.key === key);
  if (found === undefined) throw new Error(`no column ${key}`);
  return found;
};

describe('the R-15 columns', () => {
  it('draws a day without any chain row as an empty slot, never a zero bar', () => {
    const empty = column('2026-10-29');
    expect(empty.empty).toBe(true);
    expect([empty.solid, empty.span, empty.hatch, empty.marker]).toEqual([0, 0, 0, null]);
    expect(chart.empty).toEqual(['2026-10-29']);
  });

  it('never draws today solid: what closed on it so far sits under its hatched cap', () => {
    const today = column(TODAY);
    expect(today.current).toBe(true);
    expect(today.solid).toBe(0);
    expect(today.hatch).toBeGreaterThan(0);
    expect(chart.today).toEqual({ key: TODAY, cars: 31 });
    // Today is not listed again among the other unfinished days.
    expect(chart.pending).toEqual([{ key: '2026-10-31', cars: 8 }]);
  });

  it('keeps a stale day solid, with its marker on top — a stale row holds no day open', () => {
    const stale = column('2026-10-30');
    expect(stale.solid).toBeGreaterThan(0);
    expect(stale.hatch).toBe(0);
    expect(stale.marker).toBe(stale.solid + stale.span);
    expect(chart.stale).toEqual([{ key: '2026-10-30', cars: 2 }]);
  });

  it('stacks the span km on its start day as its own part, above the confirmed part', () => {
    const start = column('2026-10-28');
    expect(start.solid).toBeCloseTo((3000 / chart.max) * 100);
    expect(start.span).toBeCloseTo((1800 / chart.max) * 100);
    expect(start.hatch).toBe(0);
  });

  it('caps an unfinished day with a hatch reaching the average line, over its confirmed part', () => {
    const open = column('2026-10-31');
    expect(open.solid).toBeCloseTo((2500 / chart.max) * 100);
    expect(chart.average).not.toBeNull();
    const average = chart.average?.pct ?? 0;
    expect(open.solid + open.hatch).toBeCloseTo(Math.min(100, average + HATCH_LIFT));
  });

  it('keeps every column under the axis top', () => {
    for (const c of chart.columns) expect(c.solid + c.span + c.hatch).toBeLessThanOrEqual(100);
    expect(chart.max).toBeGreaterThanOrEqual(3000 + 1800);
    // Round steps from 0 to the top, the top being the axis' max.
    expect(chart.ticks[0]).toBe(0);
    expect(chart.ticks[chart.ticks.length - 1]).toBe(chart.max);
  });

  it('opens the readout on the latest confirmed day', () => {
    expect(chart.columns[chart.focus]?.bucket.key).toBe('2026-10-30');
    const none = kmChart(
      { buckets: [bucket('2026-10-31', { confirmed: false, pending: 3 })], average: null },
      DAILY,
      TODAY,
    );
    expect(none.focus).toBe(0);
    const blank = kmChart(
      { buckets: [bucket('2026-10-31', { hasRows: false, confirmed: false })], average: null },
      DAILY,
      TODAY,
    );
    expect(blank.focus).toBe(-1);
  });

  it('labels the first day, every seventh and the last, never two side by side', () => {
    const days = Array.from({ length: 30 }, (_, i) => {
      const day = String(i + 1).padStart(2, '0');
      return bucket(`2026-09-${day}`);
    });
    const month = kmChart(
      { buckets: days, average: 4000 },
      { from: '2026-09-01', to: '2026-09-30', granularity: 'day' },
      TODAY,
    );
    // The 29th (index 28) would sit on the 30th's label: left out.
    expect(month.labels.map((l) => l.index)).toEqual([0, 7, 14, 21, 29]);
    // Three days before the last is room enough: the 29th keeps its label on a 32-day axis.
    const longer = kmChart(
      { buckets: [...days, bucket('2026-10-01'), bucket('2026-10-02')], average: null },
      { from: '2026-09-01', to: '2026-10-02', granularity: 'day' },
      TODAY,
    );
    expect(longer.labels.map((l) => l.index)).toEqual([0, 7, 14, 21, 28, 31]);
    expect(month.labels[0]?.text).toBe('09/01');
    expect(month.today).toBeNull();
  });

  it('names every day of a short period, as the approved drawing does (11 days of «هذا الشهر»)', () => {
    const eleven = Array.from({ length: 11 }, (_, i) =>
      bucket(`2026-11-${String(i + 1).padStart(2, '0')}`),
    );
    const short = kmChart(
      { buckets: eleven, average: 31_248 },
      { from: '2026-11-01', to: '2026-11-11', granularity: 'day' },
      '2026-11-11',
    );
    expect(short.labels.map((l) => l.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(LABEL_EVERY_DAY).toBe(16);
    const sixteen = kmChart(
      {
        buckets: Array.from({ length: 17 }, (_, i) =>
          bucket(`2026-09-${String(i + 1).padStart(2, '0')}`),
        ),
        average: null,
      },
      { from: '2026-09-01', to: '2026-09-17', granularity: 'day' },
      TODAY,
    );
    // Above sixteen days the axis thins out again.
    expect(sixteen.labels.map((l) => l.index)).toEqual([0, 7, 16]);
  });
});

describe('the Friday of each day (the week\u2019s rest day, dimmed)', () => {
  it('reads the weekday of the server\u2019s own day key, in UTC', () => {
    expect(isFriday('2026-11-06')).toBe(true);
    expect(isFriday('2026-11-07')).toBe(false);
    expect(isFriday('2026-10-30')).toBe(true);
    expect(isFriday('2026-10-29')).toBe(false);
  });

  it('flags the Fridays of the daily axis, an empty or a today column too', () => {
    // WEEK: 10/27 … 11/01 — 10/30 is the only Friday.
    expect(chart.columns.filter((c) => c.friday).map((c) => c.bucket.key)).toEqual(['2026-10-30']);
    const friday = kmChart(
      {
        buckets: [
          bucket('2026-11-06', { hasRows: false, confirmed: false, confirmedKm: 0 }),
          bucket('2026-11-13', { confirmed: false, pending: 4 }),
        ],
        average: null,
      },
      { from: '2026-11-06', to: '2026-11-13', granularity: 'day' },
      '2026-11-13',
    );
    expect(friday.columns.map((c) => c.friday)).toEqual([true, true]);
    expect(friday.columns[1]?.current).toBe(true);
  });

  it('never flags a month bucket, whatever its first day is', () => {
    // 2026-05-01 is a Friday: its month is still no Friday.
    const months = kmChart(
      { buckets: [bucket('2026-05'), bucket('2026-06')], average: null },
      { from: '2026-05-01', to: '2026-06-30', granularity: 'month' },
      TODAY,
    );
    expect(months.columns.map((c) => c.friday)).toEqual([false, false]);
  });
});

describe('the monthly axis (above 31 days)', () => {
  const range = { from: '2026-01-15', to: '2026-03-10', granularity: 'month' as const };
  const months = kmChart(
    {
      buckets: [
        bucket('2026-01', { confirmedKm: 60000 }),
        bucket('2026-02', { confirmedKm: 90000 }),
        bucket('2026-03', { confirmedKm: 30000 }),
      ],
      average: 3200,
    },
    range,
    TODAY,
  );

  it('clamps each month to the period for its link', () => {
    expect(months.columns.map((c) => [c.from, c.to])).toEqual([
      ['2026-01-15', '2026-01-31'],
      ['2026-02-01', '2026-02-28'],
      ['2026-03-01', '2026-03-10'],
    ]);
    expect(bucketDays('2028-02', 'month', { from: '2028-01-01', to: '2028-12-31' })).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
    expect(bucketDays('2026-12', 'month', { from: '2026-01-01', to: '2026-12-31' })).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
  });

  it('labels every month and draws no per-day average line over month totals', () => {
    expect(months.labels.map((l) => l.text)).toEqual(['2026/01', '2026/02', '2026/03']);
    expect(months.average).toBeNull();
  });

  it('keeps today’s month solid for what closed, hatched for what is still open', () => {
    const live = kmChart(
      {
        buckets: [
          bucket('2026-10'),
          bucket('2026-11', { confirmed: false, confirmedKm: 900, pending: 31 }),
        ],
        average: 4000,
      },
      { from: '2026-10-01', to: TODAY, granularity: 'month' },
      TODAY,
    );
    const now = live.columns[1];
    expect(now?.current).toBe(true);
    expect(now?.solid).toBeGreaterThan(0);
    expect(now?.hatch).toBeGreaterThan(0);
    // «اليوم» is a day: the monthly axis has no today column to name.
    expect(live.today).toBeNull();
  });
});

describe('the axis', () => {
  it('climbs in four or so round steps of 1, 2, 2.5 or 5 × 10ⁿ to the first at or over the value', () => {
    expect(axisTicks(0)).toEqual([0]);
    expect(axisTicks(5800)).toEqual([0, 2000, 4000, 6000]);
    // The approved drawing: 34,998 (the average and its head room) under a 40,000 top.
    expect(axisTicks(34_998)).toEqual([0, 10_000, 20_000, 30_000, 40_000]);
    expect(axisTicks(12)).toEqual([0, 5, 10, 15]);
    expect(axisTicks(130_000)).toEqual([0, 50_000, 100_000, 150_000]);
    expect(axisTicks(100)).toEqual([0, 25, 50, 75, 100]);
  });

  it('writes a day as MM/DD and a month as YYYY/MM', () => {
    expect(axisLabel('2026-10-14', 'day')).toBe('10/14');
    expect(axisLabel('2026-10', 'month')).toBe('2026/10');
  });

  it('draws nothing tall when nothing moved', () => {
    const still = kmChart(
      { buckets: [bucket('2026-10-31', { confirmedKm: 0 })], average: null },
      DAILY,
      TODAY,
    );
    expect(still.max).toBe(0);
    expect(still.ticks).toEqual([0]);
    expect(still.columns[0]).toMatchObject({ empty: false, solid: 0, span: 0, hatch: 0 });
  });
});
