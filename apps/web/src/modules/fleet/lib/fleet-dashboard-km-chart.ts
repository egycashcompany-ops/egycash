// «الكيلومترات يومًا بيوم» — the R-15 drawing of tab 7, as pure data (plan R-15, Q-10, §8.7).
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
// Days by default; months above 31 days (`range.granularity`, the server's `periodGranularity`).
// The average line (closed km ÷ closed calendar days) is a per-DAY figure, so it is drawn only on
// the daily axis; the monthly one names it in the legend instead.
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
  /** The column holds today (the day itself, or today's month). */
  current: boolean;
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
  /** The axis top, in km (a round figure above the tallest column and the average). */
  max: number;
  /** The axis' four gridlines, top first: max, ⅔, ⅓, 0. */
  ticks: readonly number[];
  columns: readonly KmColumn[];
  /** The average line — daily axis only, and only when the server gave one. */
  average: { km: number; pct: number } | null;
  /** The x-axis labels: the first column, every seventh day (not crowding the last), and the last. */
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
/**
 * Head room above what a hatched cap reaches (an open column, or the average a cap climbs to), so a
 * cap always has room under the top. A closed column needs none: the axis is as tall as the round
 * top above it, as the approved drawing has it (10/18's 5,800 km under a 6,000 top).
 */
const HEADROOM = 1.12;
const STEPS = [1, 2, 2.5, 5, 10] as const;

/** A round axis top: three equal steps of 1, 2, 2.5 or 5 × 10ⁿ, reaching at least `value`. */
export const axisTop = (value: number): number => {
  if (!(value > 0)) return 0;
  const raw = value / 3;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = STEPS.map((s) => s * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  return step * 3;
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
  const max = axisTop(Math.max(tallest, (average ?? 0) * HEADROOM));
  const pct = (value: number): number => (max > 0 ? Math.min(100, (value / max) * 100) : 0);
  const averagePct = average === null ? 0 : pct(average);

  const columns = km.buckets.map((bucket): KmColumn => {
    const days = bucketDays(bucket.key, granularity, range);
    const current = holdsToday(bucket.key);
    const base = { bucket, ...days, current };
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
  const labels = columns.flatMap((column, index) =>
    granularity === 'month' ||
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
    ticks: [max, (max * 2) / 3, max / 3, 0],
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
