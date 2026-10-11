// What the readings fix DECIDES for each of the owner's four cars — pure, so every rule below is
// tested without a database. `readings-fix.ts` reads the rows, hands them here, and writes only
// what comes back.
//
// THE OWNER'S FACTS (11 October 2026), per car: today's odometer reading, the day of the car's
// last maintenance, and the counter at that maintenance — «الرقم اللى بعد التاريخ دا بتاع الصيانه
// الرقم التانى بتاعت القراءة اللى النهارده». So the maintenance «فارق» of each should be today's
// reading less that counter: 219 → 6,166, 295 → 2,102, 248 → 0, 249 → 4,322. «266 + 246 + 503 دول
// فى الفروع لما نضيف داتا باقى الفروع هبعتهالك» — those three come later, in a step of their own.
//
// (a) A FIGURE ABOVE TODAY'S READING, ON A DAY BEFORE TODAY, IS IMPOSSIBLE — a counter does not
//     run backwards. Car 219's book carries 118,722 on 29–30 July where 85,5xx was meant, car
//     295's 79,200 on 30 July where 10,xxx was. Each is the chain's highest figure, so it is the
//     floor every real reading since has been refused against (FR-2), and the alarm's «latest».
//     The row that OPENS on such a figure becomes a day without a reading (its drivers and notes
//     kept); the row that CLOSES on one is closed on the reading the book already has next. Both
//     keep the figure they held in their notes. Nothing is invented: the true reading of the
//     typed day is unknown, and a day without a reading is exactly how the register says so.
// (a2) A FIGURE ABOVE THE LAST MAINTENANCE COUNTER, ON A DAY BEFORE THAT MAINTENANCE, IS
//     IMPOSSIBLE TOO — the same counter that does not run backwards. Car 249 read 112,840 →
//     114,871 → 115,142 on 2–3 September, above the 113,325 of its 5 September service, so the
//     alarm refused that counter (`baselineBelowChain`) and the owner's «فارق» of 4,322 could not
//     be reached. Asked which figure is wrong: «117647 دى قراءة النهارده / 113325 دى اخر صيانه» —
//     both of the owner's figures stand, so the readings that contradict them are the wrong ones.
//     Treated exactly as (a): the row that OPENS above the counter becomes a day without a
//     reading (249's 3 September); the row that only CLOSES above it is closed on the opening of
//     the next row that stays (249's 2 September on 6 September's 115,124 — read on the 6th,
//     after the service, as `chainBounds` dates a closing, so the counter does not speak for
//     it). Where that opening is impossible for the row — below its own opening, or above
//     today's — it becomes a day without a reading too, rather than leaving the car as (a) does:
//     the owner has said the counter stands. Its own opening stood, so the row that closed on it
//     is closed on the next row that stays, as `softDelete` re-links around a row — or, where
//     that is impossible too, the car is left. Rows of the maintenance day and after are not
//     this rule's.
// (b) THE LAST MAINTENANCE COUNTER — the one visit on the owner's day, set to the owner's figure
//     where it differs, the old figure kept in its notes. No visit, or several: nothing is
//     guessed, the run says so.
// (c) TODAY'S READING IS NOT WRITTEN. The clerk records it on the board; the run reports whether
//     it is there and whether the board would now take it.
import { odometerBracketBreach } from '@ecms/contracts';

/** The owner's day — «اللى النهارده». Only rows dated before it are judged against its readings. */
export const OWNER_DAY = '2026-10-11';

export interface OwnerFact {
  /** The car's code in the registry. */
  code: string;
  /** Today's odometer reading, as the owner read it off the live system. */
  today: number;
  /** The day of the car's last maintenance. */
  serviceDay: string;
  /** The counter at that maintenance. */
  counter: number;
}

/** The four cars the owner sent — and only those. */
export const OWNER_FACTS: readonly OwnerFact[] = [
  { code: '219', today: 90246, serviceDay: '2026-06-25', counter: 84080 },
  { code: '295', today: 24892, serviceDay: '2026-10-06', counter: 22790 },
  { code: '248', today: 121679, serviceDay: '2026-10-09', counter: 121679 },
  { code: '249', today: 117647, serviceDay: '2026-09-05', counter: 113325 },
];

/** The UTC day a stored date names. Every write path stores a date as midnight UTC. */
export const dayOf = (date: Date): string => date.toISOString().slice(0, 10);

/** Midnight UTC opening the day `day` names. */
export const startOfDay = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

// ---------------------------------------------------------------------------------------------
// (a) and (a2) The readings.

/** One live row of the car's chain — a row WITH an opening reading, as the repository reads it. */
export interface ChainRow {
  id: string;
  date: Date;
  out: number;
  in: number | null;
  notes: string | null;
}

/** (a2) The owner's last maintenance: no row dated before its day may read above its counter. */
export interface ServiceCeiling {
  /** Midnight UTC opening the maintenance day — only rows dated before it are judged. */
  before: Date;
  counter: number;
}

/**
 * A row that opens on an impossible figure — or, under (a2), closes on one with nothing it can be
 * closed on instead: it becomes a day without a reading.
 */
export interface ClearedRow {
  id: string;
  date: Date;
  out: number;
  in: number | null;
  notes: string | null;
  /** Why, for the run row — `null` for (a)'s rows, whose lines read as they always did. */
  why: string | null;
}

/**
 * A row that closes on an impossible figure — or (a2) on the opening of a row now cleared: closed
 * on the reading the book has next instead.
 */
export interface ReclosedRow {
  id: string;
  date: Date;
  out: number;
  oldIn: number;
  /** `null` — nothing follows it any more: it becomes the car's open period. */
  newIn: number | null;
  notes: string | null;
  /** Why, for the run row — `null` for (a)'s rows, whose lines read as they always did. */
  why: string | null;
}

export type TypoPlan =
  | { kind: 'nothing' }
  | { kind: 'fix'; clear: ClearedRow[]; reclose: ReclosedRow[] }
  /** Impossible figures were found, and fixing them as the rule says would break the chain. */
  | { kind: 'left'; found: string[]; reason: string };

/** The chain's order — the (date, _id) order `record()` splices by. Ids are 24-hex ObjectIds. */
const byDateThenId = (a: { date: Date; id: string }, b: { date: Date; id: string }): number =>
  a.date.getTime() - b.date.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const shown = (row: { date: Date; out: number; in: number | null }): string =>
  `${dayOf(row.date)}: ${row.out} → ${row.in ?? '—'}`;

/** One of the owner's figures no row dated before `before` may read above. */
interface Ceiling {
  rule: 'today' | 'counter';
  before: Date;
  max: number;
}

/** Why a row cannot be closed on the reading after it: below its own opening, or above today's. */
type Problem = 'belowOpening' | 'today';

/**
 * The impossible figures on one car, and what becomes of each row that carries one.
 *
 * `rows` — the car's live rows ON the chain (an opening reading present). `emptyDays` — the days
 * this car already has recorded WITHOUT a reading: `record()` keeps one such row per day, and a
 * cleared row must not make a second. `service` — the owner's last maintenance, for (a2); `null`
 * judges by today's reading alone.
 *
 * Refused as a whole (`left`, nothing written for the car) when the rule cannot be applied
 * cleanly: a row would close below its own opening, close above today, the car would end with
 * two open periods or lose the one it had, or a day would hold two rows without a reading. A row
 * (a2) judges is never refused for the first two: it becomes a day without a reading instead,
 * and the row that closed on its opening is closed on the next row that stays.
 */
export const planTypoReadings = (
  rows: readonly ChainRow[],
  today: number,
  cutoff: Date,
  emptyDays: readonly string[] = [],
  service: ServiceCeiling | null = null,
): TypoPlan => {
  const chain = [...rows].sort(byDateThenId);
  // (a) FIRST: a row both figures refuse — 295's 79,200 — is (a)'s, and its line on the run row
  // reads as it did before (a2).
  const byToday: Ceiling = { rule: 'today', before: cutoff, max: today };
  const ceilings: Ceiling[] = [byToday];
  if (service !== null) {
    ceilings.push({ rule: 'counter', before: service.before, max: service.counter });
  }
  const under = (row: ChainRow, ceiling: Ceiling): boolean =>
    row.date.getTime() < ceiling.before.getTime();
  const counterText =
    service === null ? '' : `the ${dayOf(service.before)} maintenance counter ${service.counter}`;

  // The rows that become days without a reading, and why. First those that OPEN on an impossible
  // figure; then, under (a2), those that close on one with no opening after them to take instead.
  const clearAs = new Map<string, string | null>();
  for (const row of chain) {
    const ceiling = ceilings.find((c) => under(row, c) && row.out > c.max);
    if (ceiling !== undefined) {
      clearAs.set(row.id, ceiling.rule === 'today' ? null : `opens above ${counterText}`);
    }
  }

  let remaining: ChainRow[] = [];
  const nextOf = (row: ChainRow): ChainRow | null => remaining[remaining.indexOf(row) + 1] ?? null;
  // A closing reading was read on the NEXT row's date (`chainBounds`). One handed on to a row of the
  // owner's day or after it — 10 October closing on the 90,300 the clerk wrote on the 11th — was
  // read then, and today's reading does not speak for it. Nor, for (a2), does the maintenance
  // counter for a reading handed on to a row of the maintenance day or after.
  const closesAbove = (row: ChainRow): Ceiling[] => {
    const next = nextOf(row);
    return ceilings.filter(
      (c) =>
        under(row, c) &&
        row.in !== null &&
        row.in > c.max &&
        !(next !== null && !under(next, c) && next.out === row.in),
    );
  };
  // What is wrong with closing `row` on the reading after it — `null`: nothing. Never the
  // counter: a row before the maintenance day that stays opens at or below it, and the opening of
  // a row of that day or after was read then — the counter does not speak for it, today's reading
  // (a) does. 249's 2 September closes on 6 September's 115,124 so; clearing it instead would
  // throw away its opening of 112,840, which 1 September closed on.
  const problemWith = (row: ChainRow, newIn: number | null): Problem | null => {
    if (newIn === null) return null;
    if (newIn < row.out) return 'belowOpening';
    return under(row, byToday) && newIn > today ? 'today' : null;
  };
  const problemText = (row: ChainRow, newIn: number, problem: Problem): string =>
    problem === 'belowOpening'
      ? `the reading after it (${newIn}) is below its own opening ${row.out}`
      : `the reading after it (${newIn}) is above today's ${today} too`;
  // (a2) A row that closes above the counter, whose «next row that stays» opens on a figure
  // impossible for it, becomes a day without a reading — one at a time, the latest first, and the
  // rest decided again against the rows that stay: clearing one hands the row before it a
  // different next row.
  for (;;) {
    remaining = chain.filter((row) => !clearAs.has(row.id));
    let stuck: { row: ChainRow; newIn: number; problem: Problem } | null = null;
    for (const row of remaining) {
      if (!closesAbove(row).some((c) => c.rule === 'counter')) continue;
      const newIn = nextOf(row)?.out ?? null;
      const problem = problemWith(row, newIn);
      if (newIn !== null && problem !== null) stuck = { row, newIn, problem };
    }
    if (stuck === null) break;
    const { row, newIn, problem } = stuck;
    clearAs.set(row.id, `closes above ${counterText}, and ${problemText(row, newIn, problem)}`);
  }

  const clearing = chain.filter((row) => clearAs.has(row.id));
  // The cleared row a row closed ON — the one shared reading — when the next row that stays does
  // not open on it: that closing now hands on to nothing, and is moved to the next row that stays,
  // as `softDelete` re-links around a row. Under (a), and for rows that OPEN above the counter,
  // that closing is above the figure too and the row is caught for it anyway; it is new beside
  // (a2)'s rows that only CLOSED above the counter, whose opening stood.
  const closedOnCleared = (row: ChainRow): ChainRow | null => {
    const after = chain[chain.indexOf(row) + 1];
    return after !== undefined &&
      clearAs.has(after.id) &&
      row.in === after.out &&
      (nextOf(row)?.out ?? null) !== row.in
      ? after
      : null;
  };
  const closing = remaining.filter(
    (row) => closesAbove(row).length > 0 || closedOnCleared(row) !== null,
  );
  if (clearing.length === 0 && closing.length === 0) return { kind: 'nothing' };

  const found = [...clearing, ...closing].sort(byDateThenId).map(shown);
  const left = (reason: string): TypoPlan => ({ kind: 'left', found, reason });

  const reclose: ReclosedRow[] = [];
  for (const row of closing) {
    // «The reading the book already has next» — the next row that stays on the chain.
    const next = nextOf(row);
    const newIn = next === null ? null : next.out;
    // (a2)'s own rows were cleared above where this fails; what is still here with a problem is
    // (a)'s, or a row closed on a cleared one — and the car is left as it is.
    const problem = problemWith(row, newIn);
    if (newIn !== null && problem !== null) {
      return left(`${dayOf(row.date)}: ${problemText(row, newIn, problem)}`);
    }
    const above = closesAbove(row);
    const onCleared = closedOnCleared(row);
    reclose.push({
      id: row.id,
      date: row.date,
      out: row.out,
      oldIn: row.in as number,
      newIn,
      notes: row.notes,
      why: above.some((c) => c.rule === 'today')
        ? null
        : above.length === 0 && onCleared !== null
          ? `it closed on ${dayOf(onCleared.date)}, now a day without a reading`
          : `closed above ${counterText}`,
    });
  }

  // At most one open period, and not none where there was one — `ux_open_period`, and the period
  // the next reading closes.
  const reclosedTo = new Map(reclose.map((row) => [row.id, row.newIn]));
  const openBefore = chain.filter((row) => row.in === null).length;
  const openAfter = remaining.filter((row) =>
    reclosedTo.has(row.id) ? reclosedTo.get(row.id) === null : row.in === null,
  ).length;
  if (openAfter > 1) return left('the car would end with two open periods');
  if (openBefore > 0 && openAfter === 0) return left('the car would end with no open period');

  // One row without a reading per day — `findDayWithoutReading`.
  const days = [...emptyDays];
  for (const row of clearing) {
    const day = dayOf(row.date);
    if (days.includes(day)) return left(`${day} already has a row without a reading`);
    days.push(day);
  }

  return {
    kind: 'fix',
    clear: clearing.map((row) => ({
      id: row.id,
      date: row.date,
      out: row.out,
      in: row.in,
      notes: row.notes,
      why: clearAs.get(row.id) ?? null,
    })),
    reclose,
  };
};

/** The note a cleared row keeps — the figures it held, in the screen's own column names. */
export const clearedNote = (row: Pick<ClearedRow, 'out' | 'in'>): string =>
  `كما كُتب: عداد الخروج ${row.out}، عداد الدخول ${row.in ?? '—'}`;

/** The note a reclosed row keeps — the closing figure it held. */
export const reclosedNote = (row: Pick<ReclosedRow, 'oldIn'>): string =>
  `عداد الدخول كما كُتب: ${row.oldIn}`;

// ---------------------------------------------------------------------------------------------
// (b) The last maintenance counter.

/** A live visit of the car, as much of it as the decision reads. */
export interface ServiceVisit {
  id: string;
  inDate: Date;
  outDate: Date | null;
  odometerAtService: number | null;
  exitOdometer: number | null;
  notes: string | null;
}

export type VisitPick =
  | { kind: 'one'; visit: ServiceVisit }
  | { kind: 'none' }
  | { kind: 'several'; visits: ServiceVisit[] };

/**
 * The visit of the owner's day: the one that went IN on that day — else the one that came OUT on
 * it. Exactly one, or nothing is chosen: two visits on one day are a question for the owner.
 */
export const pickServiceVisit = (visits: readonly ServiceVisit[], day: string): VisitPick => {
  const wentIn = visits.filter((visit) => dayOf(visit.inDate) === day);
  const candidates =
    wentIn.length > 0
      ? wentIn
      : visits.filter((visit) => visit.outDate !== null && dayOf(visit.outDate) === day);
  if (candidates.length === 0) return { kind: 'none' };
  if (candidates.length > 1) return { kind: 'several', visits: candidates };
  return { kind: 'one', visit: candidates[0] as ServiceVisit };
};

export type CounterField = 'odometerAtService' | 'exitOdometer';

/**
 * Which of the visit's two counters is «the counter at that maintenance» — the one the alarm
 * measures from. The alarm takes the exit counter where there is one (`$ifNull` in
 * `alarmBaselines`), so on a visit that CLOSED on the owner's day with an exit counter that is
 * the figure; otherwise it is the counter written when the car went in.
 */
export const counterField = (visit: ServiceVisit, day: string): CounterField =>
  visit.outDate !== null && dayOf(visit.outDate) === day && visit.exitOdometer !== null
    ? 'exitOdometer'
    : 'odometerAtService';

const COUNTER_LABEL: Record<CounterField, string> = {
  odometerAtService: 'العداد عند الصيانة',
  exitOdometer: 'عداد الخروج من الصيانة',
};

/** The note a visit keeps — the counter it held, under the form's own label. */
export const counterNote = (field: CounterField, old: number | null): string =>
  `${COUNTER_LABEL[field]} كما كُتب: ${old ?? '—'}`;

export type CounterPlan =
  | { kind: 'already'; field: CounterField }
  | { kind: 'set'; field: CounterField; old: number | null }
  /** Writing it would leave the visit out below its own in — `maintenance.service` refuses that. */
  | { kind: 'conflict'; field: CounterField; reason: string };

export const planCounter = (visit: ServiceVisit, day: string, figure: number): CounterPlan => {
  const field = counterField(visit, day);
  const old = visit[field];
  if (old === figure) return { kind: 'already', field };
  if (field === 'odometerAtService' && visit.exitOdometer !== null && visit.exitOdometer < figure) {
    return {
      kind: 'conflict',
      field,
      reason: `its exit counter ${visit.exitOdometer} is below the owner's ${figure}`,
    };
  }
  if (
    field === 'exitOdometer' &&
    visit.odometerAtService !== null &&
    visit.odometerAtService > figure
  ) {
    return {
      kind: 'conflict',
      field,
      reason: `its counter on the way in ${visit.odometerAtService} is above the owner's ${figure}`,
    };
  }
  return { kind: 'set', field, old };
};

// ---------------------------------------------------------------------------------------------
// (c) Today's reading — reported, never written.

/** The rows dated on the owner's day, and what the board would say to the owner's figure. */
export interface TodayState {
  /** The opening reading of each live row dated on the owner's day; `null` = a day without one. */
  onDay: readonly (number | null)[];
  /** `false` — a disposed car takes no reading. */
  writable: boolean;
  lower: { reading: number; date: Date } | null;
  upper: { reading: number; date: Date } | null;
}

/** One line for the run row: is today's reading on the board, and would the board take it. */
export const describeToday = (fact: OwnerFact, state: TodayState): string => {
  const head = `${fact.code} ${OWNER_DAY}`;
  if (state.onDay.includes(fact.today)) return `${head}: ${fact.today} is on the board`;
  const readings = state.onDay.filter((value): value is number => value !== null);
  const there =
    readings.length > 0
      ? `the board has ${readings.join(', ')}, not the owner's ${fact.today} — left as it is`
      : state.onDay.length > 0
        ? 'recorded without a reading'
        : 'no reading yet';
  if (!state.writable)
    return `${head}: ${there}; the car is disposed, so ${fact.today} cannot be recorded`;
  // The board's own rule (FR-2, equality inside), through the shared bracket — not a third copy.
  const breach = odometerBracketBreach(fact.today, {
    lowerBound: state.lower?.reading ?? null,
    upperBound: state.upper?.reading ?? null,
  });
  if (breach === 'belowChain' && state.lower !== null) {
    return `${head}: ${there}; ${fact.today} would be REFUSED — below ${state.lower.reading} on ${dayOf(state.lower.date)}`;
  }
  if (breach === 'aboveChain' && state.upper !== null) {
    return `${head}: ${there}; ${fact.today} would be REFUSED — above ${state.upper.reading} on ${dayOf(state.upper.date)}`;
  }
  return `${head}: ${there}; ${fact.today} would be accepted`;
};

/** The figure the owner expects on the maintenance board once today's reading is recorded. */
export const expectedSince = (fact: OwnerFact): number => fact.today - fact.counter;

// ---------------------------------------------------------------------------------------------
// The maintenance board — what it says now, and what it will say once today's reading is on it.

/** As much of an alarm as the run row reports. */
export interface AlarmFigure {
  level: string;
  sinceServiceKm: number | null;
  noAlarmReason: string | null;
}

/** One line for the board as it stands after this run. `null` — the car is not on the board. */
export const describeAlarm = (code: string, alarm: AlarmFigure | null): string => {
  if (alarm === null) return `${code}: not on the maintenance board — the car is not active`;
  if (alarm.noAlarmReason !== null) return `${code}: no figure — ${alarm.noAlarmReason}`;
  return `${code}: ${alarm.sinceServiceKm} km since the service (${alarm.level})`;
};

/**
 * One line for the board once the owner's reading of today is recorded, beside the owner's own
 * figure. A refusal names what refuses it — for `baselineBelowChain`, the reading the chain
 * still stands at on the day the counter was taken. Both of the owner's figures stand, so that
 * reading is the wrong one: (a2) clears such readings where it can, and this names one it did not
 * — left by a guard (`readingsLeft`), or read on the maintenance day itself.
 */
export const describeOnceRecorded = (
  fact: OwnerFact,
  alarm: AlarmFigure,
  baseline: { counter: number | null; lower: { reading: number; date: Date } | null },
): string => {
  const expected = expectedSince(fact);
  if (alarm.noAlarmReason === null) {
    const agrees = alarm.sinceServiceKm === expected ? ' ✓' : '';
    return `${fact.code}: ${alarm.sinceServiceKm} km once ${fact.today} is recorded — the owner's ${expected}${agrees}`;
  }
  if (alarm.noAlarmReason === 'baselineBelowChain' && baseline.lower !== null) {
    return `${fact.code}: still no figure — baselineBelowChain: the readings stand at ${baseline.lower.reading} on ${dayOf(baseline.lower.date)}, above the service counter ${baseline.counter ?? '—'}, and the fix did not clear that reading; the owner's ${expected} waits on it`;
  }
  return `${fact.code}: still no figure — ${alarm.noAlarmReason}; the owner's ${expected}`;
};

// ---------------------------------------------------------------------------------------------
// The run row across attempts.

/** The run row's lists that say what was WRITTEN. */
export const WRITTEN_LISTS = [
  'applied',
  'readingsCleared',
  'readingsReclosed',
  'countersSet',
] as const;
export type WrittenLists = Record<(typeof WRITTEN_LISTS)[number], string[]>;

/** The car an entry is about — every entry opens on the car's code. */
const carOf = (entry: string): string => entry.split(/[:\s]/, 1)[0] ?? '';

/** What an earlier attempt's run row says it wrote — nothing, where it says nothing (a refusal). */
export const earlierWrites = (outcome: unknown): Partial<WrittenLists> => {
  if (typeof outcome !== 'object' || outcome === null) return {};
  const found: Partial<WrittenLists> = {};
  for (const list of WRITTEN_LISTS) {
    const value = (outcome as Record<string, unknown>)[list];
    if (Array.isArray(value)) {
      found[list] = value.filter((entry): entry is string => typeof entry === 'string');
    }
  }
  return found;
};

/**
 * This attempt's outcome with an earlier attempt's writes joined in. The one part of the account a
 * take-over cannot find again for itself: a row an earlier attempt fixed reads as «nothing to do»
 * to the next one, and the outcome the run finishes with would say the step never touched it. A
 * car an attempt wrote on is not also listed as «wrote nothing on».
 */
export const withEarlierWrites = <T extends WrittenLists & { skipped: string[] }>(
  earlier: Partial<WrittenLists>,
  now: T,
): T => {
  const joined = { ...now };
  for (const list of WRITTEN_LISTS) {
    joined[list] = [...new Set([...(earlier[list] ?? []), ...now[list]])] as T[typeof list];
  }
  const wrote = new Set(joined.applied.map(carOf));
  joined.skipped = now.skipped.filter((entry) => !wrote.has(carOf(entry))) as T['skipped'];
  return joined;
};
