// The odometer's period rules (fleet dashboard plan R-07, R-14…R-17), as pure functions.
//
// One place, so the figure on the dashboard and the total on `/fleet/odometer` cannot read the same
// rows two ways. Every input here is already a plain value — a row's day as 'YYYY-MM-DD', a car's
// status as the registry holds it NOW — and nothing here reads a clock: `today` is handed in.
//
//   R-14 · a row's km COUNT when it is on the chain, closed, and not negative. A closed row with
//          negative km is «قراءة تحتاج مراجعة»: excluded from every figure and counted on its own.
//   R-15 · per day: single-day km (the car's next chain row is dated at most the next day), span km
//          (a longer gap — drawn on its START day, never as a confirmed bar), pending open rows (still
//          inside the N-day grace) and stale ones (past it — they no longer hold the day open).
//   R-16 · which cars have valid readings, which may be ranked, and why the others may not.
//   R-17 · ties: km desc, then the car's code in the fleet's own order.
//   R-07 · no reading for N days: the latest chain date is before today − N.
import {
  FLEET_DASHBOARD_EXCEPTION_ROWS,
  FLEET_DASHBOARD_RANK_ROWS,
  addDaysYmd,
  compareFleetVehicleCodes,
  daysBetweenYmd,
  periodGranularity,
  sameVehicleCode,
  ymdToUtcDate,
  type FleetDashboardKmBucketDto,
  type FleetDashboardInvalidReadingDto,
  type FleetDashboardNoReadingReason,
  type FleetDashboardPeriodKmDto,
  type FleetVehicleStatus,
  type LocalizedString,
} from '@ecms/contracts';

// ── Rows (R-14) ─────────────────────────────────────────────────────────────────────────────────

export interface KmRow {
  /** The registry's car; `null` on a row kept from the old book for a car the registry never had. */
  vehicleId: string | null;
  /** The old book's code, where `vehicleId` is null. */
  vehicleCode: string | null;
  /** The row's day, 'YYYY-MM-DD' — the date part of the stored date-only value. */
  date: string;
  outReading: number | null;
  km: number | null;
  /** The insert order (the `_id`'s hex): several rows of one day keep the order they were written in. */
  order: string;
  /**
   * Set by `foldBookRows` (D20) on a row the old book wrote with no car (`vehicleId` stored null)
   * under a code a live car now carries: `vehicleId` is then that car, so the row counts for it as
   * the register's code filter counts it. It is still no REGISTRY row: the set filters («النوع /
   * التشغيل / الفرع») never read the old book, so the km by branch and type leave it out.
   */
  fromBook?: true;
}

/**
 * What a row is, for every figure:
 *   noCounter — a day recorded WITHOUT a reading: on no chain, measures nothing;
 *   open      — on the chain, not closed yet (the car's open period): no km yet;
 *   valid     — closed, km ≥ 0: counts;
 *   invalid   — closed, km < 0: «قراءة تحتاج مراجعة», never counted.
 * No upper cap is applied: the owner set none (Q-09), and none is invented here.
 */
export type KmRowKind = 'noCounter' | 'open' | 'valid' | 'invalid';

export const kmRowKind = (row: Pick<KmRow, 'outReading' | 'km'>): KmRowKind => {
  if (row.outReading === null) return 'noCounter';
  if (row.km === null) return 'open';
  return row.km >= 0 ? 'valid' : 'invalid';
};

const onChain = { $ne: [{ $ifNull: ['$outReading', null] }, null] };
const kmIsNumber = { $ne: [{ $ifNull: ['$km', null] }, null] };

/**
 * `kmRowKind` as aggregation expressions — the summary's one `$group` asks the same question of the
 * stored rows. `$ifNull` because an aggregation compares a MISSING field unlike `null`; `kmIsNumber`
 * beside `$lt` because an aggregation sorts `null` below every number.
 */
export const KM_ROW_KIND_EXPR = {
  valid: { $and: [onChain, kmIsNumber, { $gte: ['$km', 0] }] },
  invalid: { $and: [onChain, kmIsNumber, { $lt: ['$km', 0] }] },
  open: { $and: [onChain, { $not: [kmIsNumber] }] },
} as const;

// ── The N-day grace (R-07, R-15) ────────────────────────────────────────────────────────────────

/** The earliest day still inside the grace: an open row dated before it is stale, not pending. */
export const missingReadingCutoff = (today: string, days: number): string =>
  addDaysYmd(today, -days);

/**
 * R-07: no counter on any of the last N completed days, nor today — the latest chain date is before
 * today − N. With N = 3 on 2026-11-01: 2026-10-28 fires, 2026-10-29 does not.
 */
export const readingIsMissing = (lastDate: string, today: string, days: number): boolean =>
  lastDate < missingReadingCutoff(today, days);

// ── Spans (R-15) ────────────────────────────────────────────────────────────────────────────────

/** A row of the period with what the rules say about it. */
export interface ClassifiedRow {
  row: KmRow;
  kind: KmRowKind;
  /** valid and multi-day: the car's next chain row is dated after the next day (or not in sight). */
  span: boolean;
  /** The day that next chain row is dated, when it is inside the read window; else `null`. */
  next: string | null;
}

/**
 * The car a row counts for: its registry car — for a book row `foldBookRows` folded, the live car of
 * its code — else the old book's code (`book:<code>`), a car of its own the registry never had.
 */
const carKey = (row: KmRow): string => row.vehicleId ?? `book:${row.vehicleCode ?? ''}`;

/**
 * D20 — the old book's rows under a code a live car now carries, counted for that car.
 *
 * The register's code filter (`byVehicleOrBookCode`) reads a row kept from the old book under the
 * code the book wrote, so `/fleet/odometer/summary?vehicleCodes=790` adds the book's rows of «790»
 * to the registered car's own. `bookCars` maps each such code, AS STORED on the row, to the live
 * car carrying it (`sameVehicleCode`); a row under that code then takes the car's id — its chain,
 * its km in the rankings, the cars «متوسط لكل سيارة» divides by, and no more «غير مسجّلة». A code
 * no live car carries (a deleted car's, or one the registry never had) stays a car of its own.
 *
 * Given only when no type, operation or branch narrows the view: the set filters never read the
 * old book, so a narrowed view keeps book rows apart (it has none to fold).
 */
export const foldBookRows = (
  rows: readonly KmRow[],
  bookCars: ReadonlyMap<string, string> | undefined,
): readonly KmRow[] => {
  if (bookCars === undefined || bookCars.size === 0) return rows;
  return rows.map((row) => {
    if (row.vehicleId !== null || row.vehicleCode === null) return row;
    const car = bookCars.get(row.vehicleCode);
    return car === undefined ? row : { ...row, vehicleId: car, fromBook: true };
  });
};

const byChainOrder = (a: KmRow, b: KmRow): number =>
  a.date === b.date ? a.order.localeCompare(b.order) : a.date.localeCompare(b.date);

/**
 * The rows dated in [from, to], classified. `rows` must cover [from, to + 1]: a row is single-day iff
 * its car's next chain row is dated ≤ its day + 1, and that row always falls in the window — so a
 * successor missing from the window means a span, with no look beyond it.
 */
export const classifyRows = (
  rows: readonly KmRow[],
  range: { from: string; to: string },
): ClassifiedRow[] => {
  const chains = new Map<string, KmRow[]>();
  for (const row of rows) {
    if (row.outReading === null) continue;
    const key = carKey(row);
    chains.set(key, [...(chains.get(key) ?? []), row]);
  }
  const nextOf = new Map<KmRow, string>();
  for (const chain of chains.values()) {
    chain.sort(byChainOrder);
    chain.forEach((row, i) => {
      const next = chain[i + 1];
      if (next !== undefined) nextOf.set(row, next.date);
    });
  }
  return rows
    .filter((row) => row.date >= range.from && row.date <= range.to)
    .map((row) => {
      const kind = kmRowKind(row);
      const next = nextOf.get(row) ?? null;
      return {
        row,
        kind,
        span: kind === 'valid' && (next === null || next > addDaysYmd(row.date, 1)),
        next,
      };
    });
};

// ── Days and buckets (R-15) ─────────────────────────────────────────────────────────────────────

export interface KmDay {
  chainRows: number;
  confirmedKm: number;
  spanKm: number;
  pending: number;
  stale: number;
  invalid: number;
  /** Per span row: its car, and the day it ends on when known. */
  spans: { car: string; to: string | null }[];
}

const emptyDay = (): KmDay => ({
  chainRows: 0,
  confirmedKm: 0,
  spanKm: 0,
  pending: 0,
  stale: 0,
  invalid: 0,
  spans: [],
});

/** Every day of [from, to], 'YYYY-MM-DD', in order. */
export const daysOf = (from: string, to: string): string[] =>
  Array.from({ length: Math.max(0, daysBetweenYmd(from, to) + 1) }, (_, i) => addDaysYmd(from, i));

export const kmDays = (
  classified: readonly ClassifiedRow[],
  clock: { today: string; staleDays: number },
): Map<string, KmDay> => {
  const cutoff = missingReadingCutoff(clock.today, clock.staleDays);
  const days = new Map<string, KmDay>();
  for (const { row, kind, span, next } of classified) {
    if (kind === 'noCounter') continue;
    const day = days.get(row.date) ?? emptyDay();
    days.set(row.date, day);
    day.chainRows += 1;
    if (kind === 'open') {
      if (row.date >= cutoff) day.pending += 1;
      else day.stale += 1;
    } else if (kind === 'invalid') {
      day.invalid += 1;
    } else if (span) {
      day.spanKm += row.km ?? 0;
      day.spans.push({ car: carKey(row), to: next });
    } else {
      day.confirmedKm += row.km ?? 0;
    }
  }
  return days;
};

/** Day d is confirmed when it has passed, no open row inside the grace holds it, and it has a row. */
export const dayConfirmed = (day: KmDay | undefined, d: string, today: string): boolean =>
  day !== undefined && d < today && day.pending === 0 && day.chainRows > 0;

/**
 * «مؤكدة حتى»: the latest day d such that every day of the period up to d is confirmed or has no
 * chain row. Never today or later — a day that has not ended is not closed. `null` when the first
 * day already is not.
 */
export const confirmedThrough = (
  days: ReadonlyMap<string, KmDay>,
  range: { from: string; to: string },
  today: string,
): string | null => {
  const last = range.to < today ? range.to : addDaysYmd(today, -1);
  let through: string | null = null;
  for (const d of daysOf(range.from, last)) {
    const day = days.get(d);
    if (day !== undefined && day.chainRows > 0 && !dayConfirmed(day, d, today)) break;
    through = d;
  }
  return through;
};

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * The average line: (single-day + span km of the days from `from` through «confirmed through») ÷ the
 * CALENDAR days of that stretch — a day nobody read, a Friday, still passed.
 */
export const closedAverage = (
  days: ReadonlyMap<string, KmDay>,
  from: string,
  through: string | null,
): { closedDays: number; average: number | null } => {
  if (through === null) return { closedDays: 0, average: null };
  const stretch = daysOf(from, through);
  const km = stretch.reduce((sum, d) => {
    const day = days.get(d);
    return sum + (day === undefined ? 0 : day.confirmedKm + day.spanKm);
  }, 0);
  return { closedDays: stretch.length, average: round1(km / stretch.length) };
};

const latestEnd = (spans: readonly { to: string | null }[]): string | null => {
  if (spans.length === 0 || spans.some((span) => span.to === null)) return null;
  return spans.reduce<string>(
    (max, span) => ((span.to as string) > max ? (span.to as string) : max),
    '',
  );
};

/** Daily while to − from ≤ 31 days (`periodGranularity`), monthly otherwise. */
export const kmBuckets = (
  days: ReadonlyMap<string, KmDay>,
  range: { from: string; to: string },
  today: string,
): { granularity: 'day' | 'month'; buckets: FleetDashboardKmBucketDto[] } => {
  const granularity = periodGranularity({
    from: ymdToUtcDate(range.from),
    to: ymdToUtcDate(range.to),
  });
  const groups = new Map<string, string[]>();
  for (const d of daysOf(range.from, range.to)) {
    const key = granularity === 'day' ? d : d.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const buckets = [...groups.entries()].map(([key, members]): FleetDashboardKmBucketDto => {
    const facts = members.map((d) => ({ d, day: days.get(d) }));
    const spans = facts.flatMap(({ day }) => day?.spans ?? []);
    const hasRows = facts.some(({ day }) => (day?.chainRows ?? 0) > 0);
    const lastDay = members[members.length - 1] as string;
    const sum = (pick: (day: KmDay) => number): number =>
      facts.reduce((total, { day }) => total + (day === undefined ? 0 : pick(day)), 0);
    return {
      key,
      hasRows,
      // A month only when every one of its days is confirmed or row-less, and it has ended.
      confirmed:
        hasRows &&
        lastDay < today &&
        facts.every(({ d, day }) => (day?.chainRows ?? 0) === 0 || dayConfirmed(day, d, today)),
      confirmedKm: sum((day) => day.confirmedKm),
      spanKm: sum((day) => day.spanKm),
      pending: sum((day) => day.pending),
      stale: sum((day) => day.stale),
      spanTo: latestEnd(spans),
      spanVehicles: new Set(spans.map((span) => span.car)).size,
    };
  });
  return { granularity, buckets };
};

// ── Cars (R-16, R-17) ───────────────────────────────────────────────────────────────────────────

/** A registry car as the rules need it — its state NOW. */
export interface KmVehicle {
  vehicleId: string;
  code: string;
  status: FleetVehicleStatus;
  isDeleted: boolean;
  /** «تاريخ الانضمام», 'YYYY-MM-DD'. */
  joinedAt: string;
  branchId: string | null;
  typeId: string | null;
  /** The car's newest workshop visit by check-in day, or `null` — for «في الورشة منذ» only. */
  visit: { inDate: string; outDate: string | null } | null;
  /**
   * (d) — SOME visit held it from the first day of the period to the last (still open counts),
   * asked of the period itself (`vehicleIdsInWorkshopThroughout`), never read off `visit`: a later
   * visit must not hide an older one that covered a past period.
   */
  workshopThroughout: boolean;
}

/** What one car's rows of the period hold. */
export interface KmCarFacts {
  km: number;
  valid: number;
  open: number;
  noCounter: number;
  invalid: number;
}

export const carFacts = (classified: readonly ClassifiedRow[]): Map<string, KmCarFacts> => {
  const facts = new Map<string, KmCarFacts>();
  for (const { row, kind } of classified) {
    if (row.vehicleId === null) continue;
    const car = facts.get(row.vehicleId) ?? { km: 0, valid: 0, open: 0, noCounter: 0, invalid: 0 };
    facts.set(row.vehicleId, car);
    car[kind] += 1;
    if (kind === 'valid') car.km += row.km ?? 0;
  }
  return facts;
};

export const activeNow = (car: KmVehicle): boolean => !car.isDeleted && car.status === 'active';

/** (f) — it joined the fleet after the period ended. */
export const joinedAfter = (car: KmVehicle, to: string): boolean => car.joinedAt > to;

/** (d) — a visit held it from the first day of the period to the last (still open counts). */
export const inWorkshopThroughout = (car: KmVehicle): boolean => car.workshopThroughout;

/**
 * Why a car of the set has no valid reading in the period — ONE reason, the first that applies:
 * (f) joined after, (e) not active now, (d) in the workshop throughout, then what its rows are —
 * (b) only its open row, (c) only days recorded without a counter, then `onlyInvalid` (its only
 * closed rows have negative km — «قراءات تحتاج مراجعة», also counted there), (a) no row at all.
 * `null` when it HAS valid readings.
 */
export const noReadingReason = (
  car: KmVehicle,
  facts: KmCarFacts | undefined,
  range: { from: string; to: string },
): FleetDashboardNoReadingReason | null => {
  if ((facts?.valid ?? 0) > 0) return null;
  if (joinedAfter(car, range.to)) return 'joinedAfter';
  if (!activeNow(car)) return 'notActive';
  if (inWorkshopThroughout(car)) return 'inWorkshop';
  if ((facts?.open ?? 0) > 0) return 'onlyOpen';
  if ((facts?.noCounter ?? 0) > 0) return 'onlyNoCounter';
  if ((facts?.invalid ?? 0) > 0) return 'onlyInvalid';
  return 'noRow';
};

const REASON_ORDER: readonly FleetDashboardNoReadingReason[] = [
  'noRow',
  'onlyOpen',
  'onlyNoCounter',
  'onlyInvalid',
  'inWorkshop',
  'notActive',
  'joinedAfter',
];

/** R-17: km desc, then the code in the fleet's order. */
export const byKmThenCode =
  (dir: 'desc' | 'asc') =>
  (a: { km: number; code: string }, b: { km: number; code: string }): number => {
    if (a.km !== b.km) return dir === 'desc' ? b.km - a.km : a.km - b.km;
    return compareFleetVehicleCodes(a.code, b.code);
  };

/** May be measured against the others: active now, and neither (d) nor (f). */
const eligible = (car: KmVehicle, range: { from: string; to: string }): boolean =>
  activeNow(car) && !inWorkshopThroughout(car) && !joinedAfter(car, range.to);

/** The screens' `vehicleCodes` cap (`vehicleCodesQuery`): a longer list gets no link (D19). */
export const KM_LINK_CODES_CAP = 50;

/** The codes in the fleet's order, or `[]` when there are more than a link may carry. */
const linkCodes = (codes: readonly string[]): string[] =>
  codes.length > KM_LINK_CODES_CAP ? [] : [...codes].sort(compareFleetVehicleCodes);

// ── The whole breakdown (tabs 6–8) ──────────────────────────────────────────────────────────────

export interface KmBreakdownInput {
  /** Every row of the filter dated in [from, to + 1] (see `classifyRows`). */
  rows: readonly KmRow[];
  /** Every car on a row and every car of the set, by id. */
  vehicles: ReadonlyMap<string, KmVehicle>;
  /** The set's cars; `undefined` = nothing narrows (every car of `vehicles`). */
  setIds: readonly string[] | undefined;
  range: { from: string; to: string };
  today: string;
  /** N = `fleet.odometer.missingReadingDays`. */
  staleDays: number;
  /** A branch is chosen: the km by type is drawn. */
  byType: boolean;
  /** A vehicle set narrows the period: book rows are then reported only when the filter kept some. */
  setNarrows: boolean;
  branchNames: ReadonlyMap<string, LocalizedString>;
  /** The makes by type id — every ranked or listed car is named by them, `byType` or not. */
  typeNames: ReadonlyMap<string, LocalizedString>;
  /**
   * Of the cars with no distance in the period (`noDistanceIdsOf`), those with no chain reading at
   * ANY date — the service asks the register once (`latestChainDates`); none when not given.
   */
  neverReadIds?: ReadonlySet<string>;
  /**
   * D20 — each old-book code (as stored on the rows) → the live car now carrying it; see
   * `foldBookRows`. Only when no type, operation or branch narrows the view; absent = no fold.
   */
  bookCars?: ReadonlyMap<string, string>;
}

/**
 * D20 — `KmBreakdownInput.bookCars`: each old-book code (as stored on the rows) → the live car
 * carrying it, by the register's own comparison (`sameVehicleCode`: whitespace and Latin case
 * aside). `candidates` are the live ids the registry's code index answered for those codes
 * (`liveIdsByCodes`). Should two live cars answer one code (two spellings of it), the lowest id
 * takes it, so the fold is the same on every read. A code no live car carries is left out.
 */
export const bookCarsOf = (
  bookCodes: readonly string[],
  candidates: readonly string[],
  vehicles: ReadonlyMap<string, KmVehicle>,
): Map<string, string> => {
  const live = [...candidates].sort().flatMap((id) => {
    const car = vehicles.get(id);
    return car === undefined || car.isDeleted ? [] : [car];
  });
  const out = new Map<string, string>();
  for (const code of bookCodes) {
    const car = live.find((candidate) => sameVehicleCode(candidate.code, code));
    if (car !== undefined) out.set(code, car.vehicleId);
  }
  return out;
};

/** The set's registry cars as the rules count them: live ones, in the order the set names them. */
const setCarsOf = (input: Pick<KmBreakdownInput, 'vehicles' | 'setIds'>): KmVehicle[] =>
  (input.setIds ?? [...input.vehicles.keys()])
    .map((id) => input.vehicles.get(id))
    .filter((car): car is KmVehicle => car !== undefined && !car.isDeleted);

/**
 * «سيارات بلا مسافة في الفترة»: the cars counted in the period (`coverage.of`) with no valid row in
 * it — the reasons noRow | onlyOpen | onlyNoCounter | onlyInvalid. Exported so the service can ask
 * the register which of them were never read at all before it builds the breakdown.
 */
export const noDistanceIdsOf = (
  input: Pick<KmBreakdownInput, 'rows' | 'vehicles' | 'setIds' | 'range' | 'bookCars'>,
): string[] => {
  const facts = carFacts(classifyRows(foldBookRows(input.rows, input.bookCars), input.range));
  return setCarsOf(input)
    .filter((car) => eligible(car, input.range) && (facts.get(car.vehicleId)?.valid ?? 0) === 0)
    .map((car) => car.vehicleId);
};

const grouped = <K>(entries: readonly { key: K; km: number }[]): Map<K, number> => {
  const out = new Map<K, number>();
  for (const { key, km } of entries) out.set(key, (out.get(key) ?? 0) + km);
  return out;
};

/**
 * A branch the live list cannot name (soft-deleted since, its cars still on it): «—», as the
 * vehicles list prints its «الفرع» and the dashboard's matrix and echo draw it (`scopeBranchesOf`).
 */
const UNNAMED_BRANCH: LocalizedString = { ar: '—', en: '—' };

const byKmThenName = (a: { km: number; name: string }, b: { km: number; name: string }): number =>
  a.km === b.km ? a.name.localeCompare(b.name, 'ar') : b.km - a.km;

export const kmBreakdownOf = (input: KmBreakdownInput): FleetDashboardPeriodKmDto => {
  const { range, today } = input;
  // D20: the book's rows under a live car's code count for that car from here on.
  const classified = classifyRows(foldBookRows(input.rows, input.bookCars), range);
  const days = kmDays(classified, { today, staleDays: input.staleDays });
  const facts = carFacts(classified);
  const valid = classified.filter((entry) => entry.kind === 'valid');
  const total = valid.reduce((sum, entry) => sum + (entry.row.km ?? 0), 0);
  const spanRows = valid.filter((entry) => entry.span);

  const carOf = (id: string): KmVehicle | undefined => input.vehicles.get(id);
  const setCars = setCarsOf(input);
  const covered = setCars.filter((car) => eligible(car, range));
  const withReadings = covered.filter((car) => (facts.get(car.vehicleId)?.valid ?? 0) > 0).length;
  // The coverage's parts: Y = the active cars less (d) and (f) — a car both is counted once, in (f).
  const active = setCars.filter(activeNow);
  const joined = active.filter((car) => joinedAfter(car, range.to)).length;
  const inWorkshop = active.filter(
    (car) => inWorkshopThroughout(car) && !joinedAfter(car, range.to),
  ).length;
  const noDistance = covered.filter((car) => (facts.get(car.vehicleId)?.valid ?? 0) === 0);
  const neverReadIds = input.neverReadIds ?? new Set<string>();
  const neverRead = noDistance.filter((car) => neverReadIds.has(car.vehicleId));
  const makeOf = (car: KmVehicle | undefined): LocalizedString | null =>
    car?.typeId == null ? null : (input.typeNames.get(car.typeId) ?? null);
  // R-16 «متوسط لكل سيارة» = the period km ÷ the cars that CARRY that km: every car with a valid row
  // in the total (out of service or deleted now, and each old-book code no live car carries,
  // included — a folded code is its car, counted once). The coverage bar's X counts the active set
  // only, so it is not the divisor.
  const carsWithKm = new Set(valid.map((entry) => carKey(entry.row))).size;

  const through = confirmedThrough(days, range, today);
  const { closedDays, average } = closedAverage(days, range.from, through);

  const ranked = [...facts.entries()]
    .filter(([, car]) => car.valid > 0)
    .map(([id, car]) => ({ car: carOf(id), km: car.km }))
    .filter(
      (entry): entry is { car: KmVehicle; km: number } =>
        entry.car !== undefined && !entry.car.isDeleted,
    )
    .map(({ car, km }) => ({ car, km, code: car.code }));

  // «غير مسجّلة»: the old book's rows that no live car's code took in (`foldBookRows`) — a folded
  // row is its car's, as `/fleet/odometer/summary?vehicleCodes=<code>` counts it.
  const bookKm = valid
    .filter((entry) => entry.row.vehicleId === null)
    .reduce((sum, entry) => sum + (entry.row.km ?? 0), 0);
  const hasBookRows = classified.some((entry) => entry.row.vehicleId === null);

  // «قراءات تحتاج مراجعة»: the oldest day first, then the code — every invalid row, any car.
  const invalidList = classified
    .filter((entry) => entry.kind === 'invalid')
    .map(({ row }): FleetDashboardInvalidReadingDto => {
      const car = row.vehicleId === null ? undefined : carOf(row.vehicleId);
      // `kmRowKind` says invalid only for a closed row on the chain: both numbers are there.
      const from = row.outReading ?? 0;
      const km = row.km ?? 0;
      return {
        vehicleId: row.vehicleId,
        code: car?.code ?? row.vehicleCode ?? '—',
        // A car deleted since keeps its rows here (they are still to review) but has no file.
        deleted: car?.isDeleted === true,
        typeName: makeOf(car),
        date: row.date,
        from,
        to: from + km,
        km,
      };
    })
    .sort((a, b) =>
      a.date === b.date ? compareFleetVehicleCodes(a.code, b.code) : a.date.localeCompare(b.date),
    )
    .slice(0, FLEET_DASHBOARD_EXCEPTION_ROWS);

  // The registry's rows with their car as it is NOW — «حسب الفرع الحالي للسيارة». Each column is
  // what the register shows for that branch (type), and the set filters never read the old book: a
  // book row folded into a live car (D20) counts for that car above — its ranking, the average —
  // but in no branch or type here, nor in «غير مسجّلة». So Σ byBranch + unregistered = total less
  // the folded book km (none unless the book wrote rows under a live car's code).
  const registryKm = valid.flatMap((entry) =>
    entry.row.vehicleId === null || entry.row.fromBook === true
      ? []
      : [{ car: carOf(entry.row.vehicleId), km: entry.row.km ?? 0 }],
  );
  const branchKm = grouped(registryKm.map(({ car, km }) => ({ key: car?.branchId ?? null, km })));
  const typeKm = grouped(
    registryKm.flatMap(({ car, km }) => (car?.typeId == null ? [] : [{ key: car.typeId, km }])),
  );

  return {
    total,
    invalidRows: classified.filter((entry) => entry.kind === 'invalid').length,
    perVehicleAvg: carsWithKm === 0 ? null : round1(total / carsWithKm),
    // of = active − inWorkshop − joinedAfter, by construction (`eligible`).
    coverage: {
      withReadings,
      of: covered.length,
      active: active.length,
      inWorkshop,
      joinedAfter: joined,
    },
    noDistance: {
      cars: noDistance.length,
      neverRead: neverRead.length,
      codes: linkCodes(noDistance.map((car) => car.code)),
      neverReadCodes: linkCodes(neverRead.map((car) => car.code)),
    },
    invalidList,
    confirmedThrough: through,
    closedDays,
    average,
    buckets: kmBuckets(days, range, today).buckets,
    spans: {
      km: spanRows.reduce((sum, entry) => sum + (entry.row.km ?? 0), 0),
      count: spanRows.length,
    },
    byBranch: [...branchKm.entries()]
      .map(([branchId, km]) => ({
        branchId,
        // D33: `null` is «بلا فرع» — a car with no branch — only. A branch the live list no longer
        // holds (soft-deleted since) keeps its id, so its column still opens its cars' register.
        name: branchId === null ? null : (input.branchNames.get(branchId) ?? UNNAMED_BRANCH),
        km,
      }))
      .sort((a, b) =>
        byKmThenName({ km: a.km, name: a.name?.ar ?? '' }, { km: b.km, name: b.name?.ar ?? '' }),
      ),
    byType: !input.byType
      ? null
      : [...typeKm.entries()]
          .map(([typeId, km]) => ({
            typeId,
            name: input.typeNames.get(typeId) ?? { ar: '', en: '' },
            km,
          }))
          .sort((a, b) =>
            byKmThenName({ km: a.km, name: a.name.ar }, { km: b.km, name: b.name.ar }),
          ),
    unregistered: input.setNarrows && !hasBookRows ? null : bookKm,
    top5: [...ranked]
      .sort(byKmThenCode('desc'))
      .slice(0, FLEET_DASHBOARD_RANK_ROWS)
      .map(({ car, km }) => ({
        vehicleId: car.vehicleId,
        code: car.code,
        km,
        typeName: makeOf(car),
      })),
    bottom5: ranked
      .filter(({ car }) => eligible(car, range))
      .sort(byKmThenCode('asc'))
      .slice(0, FLEET_DASHBOARD_RANK_ROWS)
      .map(({ car, km }) => ({
        vehicleId: car.vehicleId,
        code: car.code,
        km,
        inWorkshopSince: car.visit !== null && car.visit.outDate === null ? car.visit.inDate : null,
        typeName: makeOf(car),
      })),
    withoutReadings: setCars
      // A car disposed long ago is no news: only one the period's rows still name is listed.
      .filter((car) => car.status !== 'disposed' || facts.has(car.vehicleId))
      .flatMap((car) => {
        const reason = noReadingReason(car, facts.get(car.vehicleId), range);
        return reason === null ? [] : [{ vehicleId: car.vehicleId, code: car.code, reason }];
      })
      .sort((a, b) =>
        a.reason === b.reason
          ? compareFleetVehicleCodes(a.code, b.code)
          : REASON_ORDER.indexOf(a.reason) - REASON_ORDER.indexOf(b.reason),
      ),
  };
};
