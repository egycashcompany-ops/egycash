// When a day typed into a done page's range box reaches the address bar — and through it the query.
//
// The range IS the URL, and the URL is the read: each new range is a whole walk of its pages
// (`lib/whole-board.ts`). A native date box reports a date at every keystroke once all three parts
// hold digits, so typing the year «2026» walked the value through 0002-11-04, 0020-11-04 and
// 0202-11-04 first — each a valid date, each committed at once, each starting the walk of a range
// reaching back centuries: hundreds of page requests for one year typed.
//
// So a box's day is committed only when it is a COMPLETE, real calendar date in a year from
// `DONE_RANGE_MIN_YEAR`, and only once the box has held still for `DONE_RANGE_COMMIT_DELAY_MS` — or
// at once when the reader leaves it (blur). A day that is not yet one is kept in the box while it
// is typed and never sent; left that way, the box goes back to the day the page reads. The pages
// read the range from the URL exactly as before (`doneRange`), so a shared link is unaffected.

/** How long a box must hold still before its day is committed. */
export const DONE_RANGE_COMMIT_DELAY_MS = 500;

/** The first year a range may reach — before it, a year is still being typed. */
export const DONE_RANGE_MIN_YEAR = 2000;

export interface DayRange {
  from: string;
  to: string;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Pure: is this box's value a day to commit — complete, real, and from `DONE_RANGE_MIN_YEAR`? */
export const isCommittableDay = (value: string): boolean => {
  const match = DAY.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < DONE_RANGE_MIN_YEAR) return false;
  // A real calendar day: 2026-02-30 is refused, not rolled into March.
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
};

/**
 * Pure: the range a draft stands for — each box's day when it is one to commit, else the day the
 * page reads now. A box mid-edit therefore never moves the range; the other box still can.
 */
export const committableRange = (draft: DayRange, committed: DayRange): DayRange => ({
  from: isCommittableDay(draft.from) ? draft.from : committed.from,
  to: isCommittableDay(draft.to) ? draft.to : committed.to,
});

const sameRange = (a: DayRange, b: DayRange): boolean => a.from === b.from && a.to === b.to;

/** The debounce between the boxes and the page's `onChange`, kept free of React for its spec. */
export interface RangeCommitter {
  /** The range the page reads now (its URL) — what a draft is measured against and falls back to. */
  sync: (committed: DayRange) => void;
  /** A box changed: commit after the delay, if the draft names a new range; otherwise wait. */
  edit: (draft: DayRange) => void;
  /** A box was left: commit what the draft names now, without waiting. */
  flush: () => void;
  /** Drop any pending commit — the bar unmounted. */
  cancel: () => void;
}

export const createRangeCommitter = (
  onCommit: (range: DayRange) => void,
  initial: DayRange,
  delayMs: number = DONE_RANGE_COMMIT_DELAY_MS,
): RangeCommitter => {
  let committed = initial;
  let draft: DayRange | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const commitNow = (): void => {
    stop();
    if (draft === null) return;
    const next = committableRange(draft, committed);
    draft = null;
    if (sameRange(next, committed)) return;
    // Held as committed at once, so a blur right after the timer cannot send the same range twice.
    committed = next;
    onCommit(next);
  };

  return {
    sync: (range) => {
      // The page moved to another range from outside the boxes (Back, a link): a pending edit was
      // made against the range it left, so it is dropped — committing it would undo that move.
      // The commit's own echo (`committed` already equals it) keeps nothing pending either way.
      if (!sameRange(range, committed)) {
        stop();
        draft = null;
      }
      committed = range;
    },
    edit: (next) => {
      draft = next;
      stop();
      // Nothing new to commit — a box mid-edit, or back on the day the page reads: no timer at all.
      if (sameRange(committableRange(next, committed), committed)) return;
      timer = setTimeout(commitNow, delayMs);
    },
    flush: commitNow,
    cancel: () => {
      stop();
      draft = null;
    },
  };
};
