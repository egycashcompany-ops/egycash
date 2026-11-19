// «عداد الطابعة» (FR-20, 2026-11-19), pure — «عايز يبقى فى Counter لعدد لورق المطبوع للطابعة اللى بيركب
// عليها الحبارة … وطبعا دا يتسجل للحبارة اللى كانت قبلها وفى نفس الوقت للطابعة اللى ركب عليها الحبارة».
//
// No database, no request, no clock: how a printer's readings are ordered, where a new one may sit
// on them, which one may leave them, and what each cartridge printed. The issue, «تعديل الجهاز» and
// the two read endpoints all take their answers from here, so «is this reading allowed» and «how
// many pages did that toner print» each have exactly one answer.
//
// A printer's TIMELINE is its counted issues, ordered by `at`, then id — one memo's lines share `at`
// and were written in line order. A reading must be STRICTLY above the one before it, unless it is
// a reset («تم تصفير عداد الطابعة» — a new baseline), and strictly below the one after it (a
// backdated issue), unless that one is a reset. The only equal readings are the lines of ONE memo
// on one printer: one display, one moment — they are one placement, and are never each other's
// neighbours here. «One memo, one printer, one reading»: they carry ONE reading and ONE reset, and
// every write of the reading of one of them writes it to all of them (`counterSiblings` names
// them; the writers keep it so).
//
// The pages a cartridge printed are the next reading of the SAME item on that printer less its own
// — «الحبارة اللي كانت قبلها» is the previous toner of the same item there. Never stored: computed
// from the timeline whenever it is read, so a device change, a corrected reading or a renamed item
// is always reflected. A reset MOMENT starts a new epoch — a four-colour memo reset at 0 is one
// reset of the printer, not four — and a pair across one is of unknown pages.

/** One reading on a printer's counter — the fields the rules read. */
export interface CounterRow {
  /** The movement's id (hex) — the tie-break after `at`. */
  id: string;
  at: Date;
  reading: number;
  /** «تم تصفير عداد الطابعة» — this reading started the printer's counter again. */
  reset: boolean;
  /** The memo it was issued on: rows of one memo are one moment, one placement. */
  memoId: string | null;
}

/** The timeline's order: `at`, then id. */
export const compareCounter = (
  a: Pick<CounterRow, 'at' | 'id'>,
  b: Pick<CounterRow, 'at' | 'id'>,
): number => {
  const byAt = a.at.getTime() - b.at.getTime();
  if (byAt !== 0) return byAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/**
 * Two rows of one memo on one printer — one display read once, at the memo's one `at`: never each
 * other's previous or next, and one reset when they are one.
 */
const sameMoment = (a: CounterRow, b: CounterRow): boolean =>
  a.memoId !== null && a.memoId === b.memoId && a.at.getTime() === b.at.getTime();

/**
 * The OTHER rows of `entry`'s moment on `timeline` — its memo's rows on this printer, the entry's
 * own row left out. «One memo, one printer, one reading»: a write of the entry's reading writes it
 * to each of these too, so they never disagree.
 */
export const counterSiblings = <T extends CounterRow>(
  timeline: readonly T[],
  entry: CounterRow,
): T[] => timeline.filter((row) => row.id !== entry.id && sameMoment(row, entry));

/**
 * Whether `later` may follow `earlier` on one printer: a reset always may (it starts again), the
 * rows of one memo may (one moment), and anything else must read STRICTLY more.
 */
export const counterFollows = (earlier: CounterRow, later: CounterRow): boolean =>
  later.reset || sameMoment(earlier, later) || later.reading > earlier.reading;

export type CounterPlacement<T extends CounterRow> =
  | { ok: true; previous: T | null; next: T | null }
  /** Not strictly above the reading before it, and not a reset. */
  | { ok: false; kind: 'belowPrevious'; previous: T }
  /** Backdated: not strictly below the reading after it, which is not a reset. */
  | { ok: false; kind: 'aboveNext'; next: T };

/**
 * Where `entry` would sit on `timeline`, and whether it may. The entry's own row (a correction) and
 * the rows of its own memo (one moment) are left out first — they are not its neighbours.
 */
export const counterPlacement = <T extends CounterRow>(
  timeline: readonly T[],
  entry: CounterRow,
): CounterPlacement<T> => {
  const others = timeline
    .filter((row) => row.id !== entry.id && !sameMoment(row, entry))
    .sort(compareCounter);
  let previous: T | null = null;
  let next: T | null = null;
  for (const row of others) {
    if (compareCounter(row, entry) < 0) previous = row;
    else {
      next = row;
      break;
    }
  }
  if (previous !== null && !counterFollows(previous, entry)) {
    return { ok: false, kind: 'belowPrevious', previous };
  }
  if (next !== null && !counterFollows(entry, next)) return { ok: false, kind: 'aboveNext', next };
  return { ok: true, previous, next };
};

export type CounterRemoval<T extends CounterRow> =
  | { ok: true }
  /** A reset the readings after it rest on: without it, the one after is not above the one before. */
  | { ok: false; previous: T; next: T };

/**
 * Whether the row `id` may leave `timeline` («بدون جهاز», or a move to another printer). Only a
 * reset can hold up the rows after it: every other reading sits strictly between its neighbours, so
 * they stay in order without it. A row not on the timeline leaves nothing.
 */
export const counterRemoval = <T extends CounterRow>(
  timeline: readonly T[],
  id: string,
): CounterRemoval<T> => {
  const ordered = [...timeline].sort(compareCounter);
  const at = ordered.findIndex((row) => row.id === id);
  const row = ordered[at];
  if (row === undefined || !row.reset) return { ok: true };
  const previous = ordered[at - 1];
  const next = ordered[at + 1];
  if (previous === undefined || next === undefined) return { ok: true };
  return counterFollows(previous, next) ? { ok: true } : { ok: false, previous, next };
};

/** A reading, and the cartridge of the same item it replaced on that printer. */
export interface CounterPair<T extends CounterRow> {
  row: T;
  /**
   * The previous cartridge of the same item on this printer, and what it printed (this reading less
   * its own). `pages` null: a reset lies between them. The whole field is null when this is that
   * item's first on the printer (a new model or colour).
   */
  replaced: { row: T; pages: number | null } | null;
}

/**
 * Every reading of ONE printer, oldest first, paired with the cartridge of the same item it
 * replaced. `itemKeyOf` names «the same item» — by the item's name, so a printer fed from two
 * stores, or from a transferred twin, still pairs.
 *
 * An epoch is one reset MOMENT, not one reset row: the reset rows of one memo on one printer (four
 * colours fitted at once on a counter set back to 0) are one reset of its display, so only the
 * first of them starts a new epoch, and the next memo's four colours each pair with their own.
 */
export const pairCounterReadings = <T extends CounterRow>(
  timeline: readonly T[],
  itemKeyOf: (row: T) => string,
): CounterPair<T>[] => {
  const ordered = [...timeline].sort(compareCounter);
  const last = new Map<string, { row: T; epoch: number }>();
  let epoch = 0;
  /** The reset that started the current epoch — the other resets of its moment start none. */
  let startedBy: T | null = null;
  return ordered.map((row) => {
    if (row.reset && (startedBy === null || !sameMoment(startedBy, row))) {
      epoch += 1;
      startedBy = row;
    }
    const key = itemKeyOf(row);
    const before = last.get(key);
    last.set(key, { row, epoch });
    if (before === undefined) return { row, replaced: null };
    const pages = before.epoch === epoch ? row.reading - before.row.reading : null;
    // Impossible once placed (a later reading is strictly above): defensively unknown.
    return {
      row,
      replaced: { row: before.row, pages: pages !== null && pages >= 0 ? pages : null },
    };
  });
};

/** The mean of the known pages, rounded — null when none is known. */
export const averagePages = (pages: readonly (number | null)[]): number | null => {
  const known = pages.filter((value): value is number => value !== null);
  if (known.length === 0) return null;
  return Math.round(known.reduce((sum, value) => sum + value, 0) / known.length);
};
