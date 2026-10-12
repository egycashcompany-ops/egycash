// «عاوز جمب الاحصائيات داش بورد تفتح ف الشاشه كلها … كل حاجة بالتفصيل» — what the dashboard adds
// to the figures, folded from the SAME movements `/summary` folds (see `custody.service.ts`).
//
// Deliberately not a Mongo pipeline: the ledger is two collections read with their own filters
// (the book-code fallback, the driver rule, `isDeleted`) and merged in memory. A pipeline would
// copy those rules a second time and could drift from the board's figures; one pass over the rows
// the board already counts cannot.
//
// The owner's design (the custody «لوحة تحكم») reads more off the same pass: the period's days,
// the fund's fuel by «الشركة» («شل أوت / وطنية» — «ومش عاوز اى داتا اجبارى», so a receipt that
// names none stays «بدون شركة», never folded into a company), and the alerts banner. Every one of
// them is counted from these rows — nothing estimated, nothing shown that the rows do not hold.
import {
  FLEET_CUSTODY_SOURCES,
  FLEET_FUEL_CARD_COMPANIES,
  FLEET_FUEL_TYPES,
  compareFleetVehicleCodes,
  type FleetCustodyAlertsDto,
  type FleetCustodyDashboardDto,
  type FleetCustodyDoubleFuelDto,
  type FleetCustodyDriverRowDto,
  type FleetCustodyFuelShareDto,
  type FleetCustodyFuelTypeRowDto,
  type FleetCustodyMovementDto,
  type FleetCustodySource,
  type FleetCustodySummaryDto,
  type FleetCustodyTimeBucketDto,
  type FleetFuelCardCompany,
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
  /** A fuel receipt's «الشركة», when the clerk picked one; `null` on everything else. */
  company: FleetFuelCardCompany | null;
  /** A fuel receipt's litres, when it was priced; `null` on everything else. */
  litres: number | null;
  /** Whether a receipt has its photo — a dealership bill is never counted as a receipt. */
  hasImage: boolean;
  amount: number;
}

/** The private cars' bills still waiting for their invoice — read beside the rows, not in them. */
export interface CustodyPendingPrivateBills {
  count: number;
  oldestOutDate: Date | null;
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

/** The start of a date's UTC day. */
const dayStart = (date: Date): number =>
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

/** How many days from `from`'s day to `to`'s, both kept — 0 when turned round. */
const inclusiveDays = (from: Date, to: Date): number => {
  const span = Math.round((dayStart(to) - dayStart(from)) / DAY_MS);
  return span < 0 ? 0 : span + 1;
};

/**
 * «10 أيام»: the filter's own days when both dates are chosen — the days asked about, the quiet
 * ones too — else the first movement's day to the last's; nothing at all is no period.
 */
export const custodyPeriodDays = (
  rows: readonly Pick<CustodyDashboardRow, 'date'>[],
  filter: { from?: Date | undefined; to?: Date | undefined },
): number => {
  if (filter.from !== undefined && filter.to !== undefined) {
    return inclusiveDays(filter.from, filter.to);
  }
  if (rows.length === 0) return 0;
  let first = Infinity;
  let last = -Infinity;
  for (const row of rows) {
    first = Math.min(first, row.date.getTime());
    last = Math.max(last, row.date.getTime());
  }
  return inclusiveDays(new Date(first), new Date(last));
};

/** Money compared to the piastre — `0.1 + 0.2` is the same amount as `0.3`. */
const cents = (amount: number): number => Math.round(amount * 100);

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

const emptyShare = (): FleetCustodyFuelShareDto => ({ amount: 0, count: 0, litres: 0 });
const roundShare = <T extends FleetCustodyFuelShareDto>(share: T): T => ({
  ...share,
  amount: round(share.amount),
  litres: round(share.litres),
});

/**
 * «تنبيهات وتدقيق العهدة» off the receipts in the set: a car fuelled from the fund more than once on
 * one day, receipts with no photo, and receipts that repeat another (the same car, day, kind and
 * amount — the extra copies only). The bills awaiting an invoice are read by the service.
 */
const custodyAlerts = (
  rows: readonly CustodyDashboardRow[],
  pendingPrivateBills: CustodyPendingPrivateBills,
): FleetCustodyAlertsDto => {
  const fuelDays = new Map<string, FleetCustodyDoubleFuelDto>();
  const copies = new Map<string, number>();
  let receiptsWithoutPhoto = 0;
  for (const row of rows) {
    if (row.ref !== 'receipt') continue;
    if (!row.hasImage) receiptsWithoutPhoto += 1;
    // A receipt is always on a car; the code stands in only should the id ever be missing.
    const car = row.vehicleId ?? `code:${row.vehicleCode ?? ''}`;
    const day = dayKey(row.date);
    const same = `${car}|${day}|${row.source}|${cents(row.amount)}`;
    copies.set(same, (copies.get(same) ?? 0) + 1);
    if (row.source !== 'fuel') continue;
    const key = `${car}|${day}`;
    const line = fuelDays.get(key) ?? {
      vehicleId: row.vehicleId,
      vehicleCode: row.vehicleCode,
      date: day,
      count: 0,
    };
    line.count += 1;
    fuelDays.set(key, line);
  }
  return {
    doubleFuel: [...fuelDays.values()]
      .filter((line) => line.count >= 2)
      // Newest day first; on one day, the fleet's own order of codes.
      .sort(
        (a, b) =>
          (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) ||
          compareFleetVehicleCodes(a.vehicleCode ?? '', b.vehicleCode ?? ''),
      ),
    pendingPrivateBills: {
      count: pendingPrivateBills.count,
      oldestOutDate:
        pendingPrivateBills.oldestOutDate === null
          ? null
          : pendingPrivateBills.oldestOutDate.toISOString(),
    },
    receiptsWithoutPhoto,
    duplicateReceipts: [...copies.values()].reduce((extra, n) => extra + n - 1, 0),
  };
};

/**
 * Everything the dashboard shows beyond the figures, in one pass over the filtered movements.
 * `rows` arrive newest first (the ledger's own order), so a driver's name is the latest one typed.
 * `pendingPrivateBills` is the service's own read: those bills have no amount yet, so they are not
 * movements of the fund and never in `rows`.
 */
export const custodyDashboard = (
  rows: readonly CustodyDashboardRow[],
  filter: { from?: Date | undefined; to?: Date | undefined },
  pendingPrivateBills: CustodyPendingPrivateBills = { count: 0, oldestOutDate: null },
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
  const typeCompanies = new Map<FleetFuelType | null, Set<FleetFuelCardCompany>>();
  const byCompany = new Map<FleetFuelCardCompany, FleetCustodyFuelShareDto>(
    FLEET_FUEL_CARD_COMPANIES.map((company) => [company, emptyShare()]),
  );
  const noCompany = emptyShare();
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
        companies: [],
      };
      type.count += 1;
      type.amount += row.amount;
      type.litres += row.litres ?? 0;
      fuelTypes.set(row.fuelType, type);
      if (row.litres === null) litresMissing += 1;
      else litres += row.litres;
      // «شل أوت / وطنية» by the receipt's own pick; none picked is «بدون شركة», never a guess.
      const share = row.company === null ? noCompany : byCompany.get(row.company);
      if (share !== undefined) {
        share.amount += row.amount;
        share.count += 1;
        share.litres += row.litres ?? 0;
      }
      if (row.company !== null) {
        const present = typeCompanies.get(row.fuelType) ?? new Set<FleetFuelCardCompany>();
        present.add(row.company);
        typeCompanies.set(row.fuelType, present);
      }
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
      .map((line) => ({
        ...line,
        amount: round(line.amount),
        litres: round(line.litres),
        // «شل أوت + وطنية»: the companies this type's receipts name, in the companies' order.
        companies: FLEET_FUEL_CARD_COMPANIES.filter(
          (company) => typeCompanies.get(line.fuelType)?.has(company) ?? false,
        ),
      })),
    litres: round(litres),
    litresMissing,
    periodDays: custodyPeriodDays(rows, filter),
    fuelByCompany: {
      companies: FLEET_FUEL_CARD_COMPANIES.map((company) => ({
        company,
        ...roundShare(byCompany.get(company) ?? emptyShare()),
      })),
      none: roundShare(noCompany),
    },
    alerts: custodyAlerts(rows, pendingPrivateBills),
  };
};
