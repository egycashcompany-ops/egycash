// «عاوز جمب الاحصائيات داش بورد تفتح ف الشاشه كلها … كل حاجة بالتفصيل» — what the dashboard adds
// to the figures, folded from the SAME movements `/summary` folds (see `custody.service.ts`).
//
// Deliberately not a Mongo pipeline: the ledger is two collections read with their own filters
// (the book-code fallback, the driver rule, `isDeleted`) and merged in memory. A pipeline would
// copy those rules a second time and could drift from the board's figures; one pass over the rows
// the board already counts cannot.
import {
  FLEET_CUSTODY_SOURCES,
  FLEET_FUEL_TYPES,
  type FleetCustodyDashboardDto,
  type FleetCustodyDriverRowDto,
  type FleetCustodyFuelTypeRowDto,
  type FleetCustodyMovementDto,
  type FleetCustodySource,
  type FleetCustodySummaryDto,
  type FleetCustodyTimeBucketDto,
  type FleetFuelType,
} from '@ecms/contracts';

/** What one movement offers the dashboard. */
export interface CustodyDashboardRow {
  ref: FleetCustodyMovementDto['ref'];
  source: FleetCustodySource;
  date: Date;
  vehicleId: string | null;
  vehicleCode: string | null;
  driverEmployeeId: string | null;
  driverName: string | null;
  fuelType: FleetFuelType | null;
  /** A fuel receipt's litres, when it was priced; `null` on everything else. */
  litres: number | null;
  amount: number;
}

/** The dashboard's own fields — the summary's are folded by the service, once, for both. */
export type CustodyDashboardExtras = Omit<FleetCustodyDashboardDto, keyof FleetCustodySummaryDto>;

const round = (value: number): number => Math.round(value * 100) / 100;

const DAY_MS = 24 * 60 * 60 * 1000;
/** «بالتفصيل يوم بيوم» only while the filter spans a month at most — past it, a column a month. */
const MAX_DAY_SPAN = 31;

/** The board's own day and month — the UTC slice the table prints. */
const dayKey = (date: Date): string => date.toISOString().slice(0, 10);
const monthKey = (date: Date): string => date.toISOString().slice(0, 7);

/** Every day from `from` to `to`, both kept. */
const daysBetween = (from: Date, to: Date): string[] => {
  const keys: string[] = [];
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  for (let at = start; at <= to.getTime(); at += DAY_MS) keys.push(dayKey(new Date(at)));
  return keys;
};

/** Every month from the first key to the last, both kept. */
const monthsBetween = (first: string, last: string): string[] => {
  const keys: string[] = [];
  let year = Number(first.slice(0, 4));
  let month = Number(first.slice(5, 7));
  for (;;) {
    const key = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    keys.push(key);
    if (key >= last) return keys;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
};

/** By the day when BOTH dates are chosen and at most a month apart; else by the month. */
export const custodyGranularity = (filter: {
  from?: Date | undefined;
  to?: Date | undefined;
}): 'day' | 'month' => {
  if (filter.from === undefined || filter.to === undefined) return 'month';
  const span = (filter.to.getTime() - filter.from.getTime()) / DAY_MS;
  return span >= 0 && span <= MAX_DAY_SPAN ? 'day' : 'month';
};

const emptyBucket = (key: string): FleetCustodyTimeBucketDto => ({
  key,
  dealership: 0,
  fuel: 0,
  tyres: 0,
  wash: 0,
  total: 0,
  count: 0,
});

/** A driver's identity: the roster's person when the receipt names one, else the typed name. */
const driverKey = (row: CustodyDashboardRow): string | null => {
  if (row.driverEmployeeId !== null) return `id:${row.driverEmployeeId}`;
  const name = (row.driverName ?? '').trim().replace(/\s+/gu, ' ');
  return name === '' ? null : `name:${name}`;
};

/**
 * Everything the dashboard shows beyond the figures, in one pass over the filtered movements.
 * `rows` arrive newest first (the ledger's own order), so a driver's name is the latest one typed.
 */
export const custodyDashboard = (
  rows: readonly CustodyDashboardRow[],
  filter: { from?: Date | undefined; to?: Date | undefined },
): CustodyDashboardExtras => {
  const counts = Object.fromEntries(FLEET_CUSTODY_SOURCES.map((kind) => [kind, 0])) as Record<
    FleetCustodySource,
    number
  >;
  const bySource = new Map<FleetCustodyMovementDto['ref'], { count: number; amount: number }>([
    ['receipt', { count: 0, amount: 0 }],
    ['dealershipInvoice', { count: 0, amount: 0 }],
  ]);
  const cars = new Set<string>();
  const drivers = new Map<string, FleetCustodyDriverRowDto>();
  const noDriver = { count: 0, amount: 0 };
  const fuelTypes = new Map<FleetFuelType | null, FleetCustodyFuelTypeRowDto>();
  let litres = 0;
  let litresMissing = 0;

  const granularity = custodyGranularity(filter);
  const keyOf = granularity === 'day' ? dayKey : monthKey;
  const buckets = new Map<string, FleetCustodyTimeBucketDto>();
  if (granularity === 'day' && filter.from !== undefined && filter.to !== undefined) {
    // The days the filter names, every one of them, before a movement fills any.
    for (const key of daysBetween(filter.from, filter.to)) buckets.set(key, emptyBucket(key));
  }

  for (const row of rows) {
    counts[row.source] += 1;
    const source = bySource.get(row.ref);
    if (source !== undefined) {
      source.count += 1;
      source.amount += row.amount;
    }
    // The same car key the per-car summary uses; a line with neither id nor code is no car.
    if (row.vehicleId !== null) cars.add(row.vehicleId);
    else if (row.vehicleCode !== null) cars.add(`code:${row.vehicleCode}`);

    const key = keyOf(row.date);
    const bucket = buckets.get(key) ?? emptyBucket(key);
    bucket[row.source] += row.amount;
    bucket.total += row.amount;
    bucket.count += 1;
    buckets.set(key, bucket);

    if (row.source === 'dealership') continue;
    // A receipt: its driver, and for fuel its type and litres.
    const who = driverKey(row);
    if (who === null) {
      noDriver.count += 1;
      noDriver.amount += row.amount;
    } else {
      const line = drivers.get(who) ?? {
        driverEmployeeId: row.driverEmployeeId,
        driverName: (row.driverName ?? '').trim().replace(/\s+/gu, ' '),
        fuel: 0,
        tyres: 0,
        wash: 0,
        total: 0,
        count: 0,
      };
      // A later receipt that typed the name the first one left empty still names the driver.
      if (line.driverName === '' && row.driverName !== null)
        line.driverName = row.driverName.trim();
      line[row.source] += row.amount;
      line.total += row.amount;
      line.count += 1;
      drivers.set(who, line);
    }
    if (row.source === 'fuel') {
      const type = fuelTypes.get(row.fuelType) ?? {
        fuelType: row.fuelType,
        count: 0,
        amount: 0,
        litres: 0,
      };
      type.count += 1;
      type.amount += row.amount;
      type.litres += row.litres ?? 0;
      fuelTypes.set(row.fuelType, type);
      if (row.litres === null) litresMissing += 1;
      else litres += row.litres;
    }
  }

  // By the month: every month between the first movement and the last, the empty ones too.
  if (granularity === 'month' && buckets.size > 0) {
    const keys = [...buckets.keys()].sort();
    for (const key of monthsBetween(keys[0] ?? '', keys[keys.length - 1] ?? '')) {
      if (!buckets.has(key)) buckets.set(key, emptyBucket(key));
    }
  }

  const fuelOrder = (type: FleetFuelType | null): number =>
    type === null ? FLEET_FUEL_TYPES.length : FLEET_FUEL_TYPES.indexOf(type);
  return {
    vehicleCount: cars.size,
    counts,
    bySource: [...bySource.entries()].map(([ref, line]) => ({
      ref,
      count: line.count,
      amount: round(line.amount),
    })),
    timeline: {
      granularity,
      // Oldest first — time runs left to right on the chart.
      buckets: [...buckets.values()]
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .map((bucket) => ({
          ...bucket,
          dealership: round(bucket.dealership),
          fuel: round(bucket.fuel),
          tyres: round(bucket.tyres),
          wash: round(bucket.wash),
          total: round(bucket.total),
        })),
    },
    drivers: [...drivers.values()]
      .map((line) => ({
        ...line,
        fuel: round(line.fuel),
        tyres: round(line.tyres),
        wash: round(line.wash),
        total: round(line.total),
      }))
      // Dearest first; between equals, the name, so the order never wobbles between reads.
      .sort((a, b) => b.total - a.total || a.driverName.localeCompare(b.driverName, 'ar')),
    noDriver: { count: noDriver.count, amount: round(noDriver.amount) },
    fuelTypes: [...fuelTypes.values()]
      .sort((a, b) => fuelOrder(a.fuelType) - fuelOrder(b.fuelType))
      .map((line) => ({ ...line, amount: round(line.amount), litres: round(line.litres) })),
    litres: round(litres),
    litresMissing,
  };
};
