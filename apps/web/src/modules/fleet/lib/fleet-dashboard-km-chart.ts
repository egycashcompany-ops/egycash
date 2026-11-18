// «الكيلومترات يومًا بيوم» — the R-15 drawing of «العدادات والكيلومترات», as pure data (plan R-15,
// Q-10, §8.7; the approved odometer sample, approved/odo-dark.png).
//
// The server decides every number of a column (`FleetDashboardKmBucketDto`); this file only turns
// them into heights on one axis and names what each part MEANS, so the picture can never say more
// than the figures do:
//
//   solid   the confirmed single-day km of the column, in the confirmed colour. NEVER on today:
//           today is always «لم تُغلق القراءة بعد», whatever closed on it so far.
//   span    km over days without a reading, OUTLINED and stacked on the solid part of the span's
//           START day — never in the confirmed colour, so a Thursday before an unread Friday is not
//           drawn falsely low and is not drawn as confirmed either.
//   hatch   a column still waiting for readings (`pending > 0`, and today): a hatched cap above what
//           is known, reaching the average line or a little above the column — a placeholder, not
//           a figure.
//   marker  cars with no reading since that day for more than N days (`stale > 0`): a dot on the
//           column. A stale row does NOT hold its day open: the column stays solid.
//   empty   no chain row at all (`hasRows: false`): an empty slot, NEVER a zero bar.
//
// A column's FIGURE (`total`, the readout's linked «X كم» and the column's name) is what the
// odometer register totals over the column's days — every valid row dated in them, a span counted
// on its start day: `confirmedKm + spanKm` (audit D02; the solid part alone is NOT on any screen).
//
// Days by default; months above 31 days (`range.granularity`, the server's `periodGranularity`).
// The average line (closed km ÷ closed calendar days) is a per-DAY figure, so it is drawn only on
// the daily axis; the monthly one names it in the legend instead.
//
// A day column also says whether its day is a FRIDAY (the week's rest day, dimmed in the drawing):
// the calendar's weekday of the server's own day key, read in UTC — no clock, no setting. A month
// column is never a Friday.
import {
  addDaysYmd,
  type FleetDashboardKmBucketDto,
  type FleetDashboardPeriodKmDto,
} from '@ecms/contracts';

export type KmGranularity = 'day' | 'month';

export interface KmColumn {
  bucket: FleetDashboardKmBucketDto;
  /** The days the column stands for, inside the period — the from/to of its odometer link. */
  from: string;
  to: string;
  /** No chain row: an empty slot. */
  empty: boolean;
  /**
   * The column's km as the odometer register totals them over `from`…`to` (its link): the
   * single-day part and the spans that START in it — `confirmedKm + spanKm` (audit D02). 0 on an
   * empty slot.
   */
  total: number;
  /** The column holds today (the day itself, or today's month). */
  current: boolean;
  /** A daily column whose day is a Friday (dimmed); always `false` on the monthly axis. */
  friday: boolean;
  /** Heights, in % of the axis top, stacked bottom-up: solid, span, hatch. */
  solid: number;
  span: number;
  hatch: number;
  /** Where the stale marker sits (% of the axis), or `null` when no car went stale here. */
  marker: number | null;
}

export interface KmDayCount {
  key: string;
  cars: number;
}

export interface KmChartModel {
  granularity: KmGranularity;
  /** The axis top, in km (a round figure at or above the tallest column and the average). */
  max: number;
  /** The axis' gridlines, from 0 up to `max` in equal round steps (`axisTicks`). */
  ticks: readonly number[];
  columns: readonly KmColumn[];
  /** The average line — daily axis only, and only when the server gave one. */
  average: { km: number; pct: number } | null;
  /**
   * The x-axis labels: every day of a period of up to LABEL_EVERY_DAY days (the approved drawing
   * names each day and its weekday); above that the first column, every seventh day (not crowding
   * the last), and the last; every month on the monthly axis.
   */
  labels: readonly { index: number; text: string }[];
  /** Columns still waiting for readings, today excepted («لم تُغلق القراءة بعد»). */
  pending: readonly KmDayCount[];
  /** Today's column, when the period holds today and it has rows. */
  today: KmDayCount | null;
  /** Columns with no chain row at all. */
  empty: readonly string[];
  /** Columns whose marker says «N سيارات بلا قراءة منذ …». */
  stale: readonly KmDayCount[];
  /** The column the readout opens on: the latest confirmed one, else the latest with rows; −1 = none. */
  focus: number;
}

/** How far the hatched cap reaches above what is known, in % of the axis. */
export const HATCH_LIFT = 6;
/** The fewest days between two labels of the daily axis. */
const LABEL_GAP = 3;
/** Up to this many days, every day of the axis carries its label. */
export const LABEL_EVERY_DAY = 16;
/**
 * Head room above what a hatched cap reaches (an open column, or the average a cap climbs to), so a
 * cap always has room under the top. A closed column needs none: the axis is as tall as the round
 * top above it, as the approved drawing has it (11/10's 34,480 km under a 40,000 top).
 */
const HEADROOM = 1.12;
const STEPS = [1, 2, 2.5, 5, 10] as const;

/**
 * The value axis: 0 and round steps of 1, 2, 2.5 or 5 × 10ⁿ — four or so of them, as the dashboard's
 * other charts draw theirs — the top one at or above `value`. `[0]` when nothing moved.
 */
export const axisTicks = (value: number): number[] => {
  if (!(value > 0)) return [0];
  const raw = value / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = STEPS.map((s) => s * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  const ticks: number[] = [0];
  while ((ticks[ticks.length - 1] ?? 0) < value) {
    ticks.push(Math.round(ticks.length * step * 100) / 100);
  }
  return ticks;
};

const lastDayOfMonth = (month: string): string => {
  const year = Number(month.slice(0, 4));
  const next = Number(month.slice(5, 7)) + 1;
  const first = next === 13 ? `${year + 1}-01-01` : `${year}-${String(next).padStart(2, '0')}-01`;
  return addDaysYmd(first, -1);
};

/** A column's days inside the period: the day itself, or its month clamped to the period. */
export const bucketDays = (
  key: string,
  granularity: KmGranularity,
  range: { from: string; to: string },
): { from: string; to: string } => {
  if (granularity === 'day') return { from: key, to: key };
  const first = `${key}-01`;
  const last = lastDayOfMonth(key);
  return { from: first < range.from ? range.from : first, to: last > range.to ? range.to : last };
};

/** 'YYYY-MM-DD' → «10/14» on the daily axis; 'YYYY-MM' → «2026/10» on the monthly one. */
export const axisLabel = (key: string, granularity: KmGranularity): string =>
  granularity === 'day' ? key.slice(5).replace('-', '/') : key.replace('-', '/');

/** A 'YYYY-MM-DD' day key falls on a Friday — the calendar's weekday, read in UTC (no clock). */
export const isFriday = (key: string): boolean =>
  new Date(`${key}T00:00:00.000Z`).getUTCDay() === 5;

export const kmChart = (
  km: Pick<FleetDashboardPeriodKmDto, 'buckets' | 'average'>,
  range: { from: string; to: string; granularity: KmGranularity },
  today: string,
): KmChartModel => {
  const { granularity } = range;
  const holdsToday = (key: string): boolean =>
    granularity === 'day' ? key === today : key === today.slice(0, 7);
  const average = granularity === 'day' && km.average !== null ? km.average : null;

  const capped = (bucket: FleetDashboardKmBucketDto): boolean =>
    bucket.hasRows && (bucket.pending > 0 || (granularity === 'day' && holdsToday(bucket.key)));
  const tallest = Math.max(
    0,
    ...km.buckets.map((b) => (b.confirmedKm + b.spanKm) * (capped(b) ? HEADROOM : 1)),
  );
  const ticks = axisTicks(Math.max(tallest, (average ?? 0) * HEADROOM));
  const max = ticks[ticks.length - 1] ?? 0;
  const pct = (value: number): number => (max > 0 ? Math.min(100, (value / max) * 100) : 0);
  const averagePct = average === null ? 0 : pct(average);

  const columns = km.buckets.map((bucket): KmColumn => {
    const days = bucketDays(bucket.key, granularity, range);
    const current = holdsToday(bucket.key);
    const friday = granularity === 'day' && isFriday(bucket.key);
    const base = { bucket, ...days, current, friday, total: bucket.confirmedKm + bucket.spanKm };
    if (!bucket.hasRows) {
      return { ...base, empty: true, solid: 0, span: 0, hatch: 0, marker: null };
    }
    // Today is never solid: what closed on it so far is part of its hatched, unfinished column.
    const todayOnly = granularity === 'day' && current;
    const solid = todayOnly ? 0 : pct(bucket.confirmedKm);
    const span = pct(bucket.spanKm);
    const known = solid + span;
    const open = bucket.pending > 0 || todayOnly;
    const reach = Math.max(known, todayOnly ? pct(bucket.confirmedKm) : 0, averagePct);
    const hatch = open ? Math.max(0, Math.min(100, reach + HATCH_LIFT) - known) : 0;
    return {
      ...base,
      empty: false,
      solid,
      span,
      hatch,
      marker: bucket.stale > 0 ? known : null,
    };
  });

  const last = columns.length - 1;
  const every = granularity === 'month' || columns.length <= LABEL_EVERY_DAY;
  const labels = columns.flatMap((column, index) =>
    every ||
    index === 0 ||
    index === last ||
    // Every seventh day, unless it would sit on the last day's label.
    (index % 7 === 0 && last - index >= LABEL_GAP)
      ? [{ index, text: axisLabel(column.bucket.key, granularity) }]
      : [],
  );

  const findLast = (test: (column: KmColumn) => boolean): number => {
    for (let i = last; i >= 0; i -= 1) {
      const column = columns[i];
      if (column !== undefined && test(column)) return i;
    }
    return -1;
  };
  const confirmed = findLast((column) => !column.empty && column.bucket.confirmed);
  const focus = confirmed !== -1 ? confirmed : findLast((column) => !column.empty);

  const todayColumn = columns.find(
    (column) => granularity === 'day' && column.current && !column.empty,
  );
  return {
    granularity,
    max,
    ticks,
    columns,
    average: average === null ? null : { km: average, pct: averagePct },
    labels,
    pending: columns
      .filter((column) => column.bucket.pending > 0 && !(granularity === 'day' && column.current))
      .map((column) => ({ key: column.bucket.key, cars: column.bucket.pending })),
    today:
      todayColumn === undefined
        ? null
        : { key: todayColumn.bucket.key, cars: todayColumn.bucket.pending },
    empty: columns.filter((column) => column.empty).map((column) => column.bucket.key),
    stale: columns
      .filter((column) => column.bucket.stale > 0)
      .map((column) => ({ key: column.bucket.key, cars: column.bucket.stale })),
    focus,
  };
};
