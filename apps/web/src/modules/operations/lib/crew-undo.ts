// «تراجع» — ONE STEP BACK, not everything (Round 24).
//
// THE OWNER: «وعاوز تراجع دا يتراجع عن اخر عمليه مش كل العمليات فاهم». Until Round 24 «تراجع» on «لوحة
// التشغيلة» threw away every unsaved change at once (the draft back to the server's answer); a
// planner who dropped one name on the wrong van lost the forty right ones with it. Now each press
// takes back the LAST operation only, and the next press the one before it, until nothing is left.
//
// WHAT ONE OPERATION IS: one thing the planner did — a drop, a pick from a slot's list, a chip's ✕,
// a van given, a row added or deleted or emptied, a type, a colour, a time, a direction, the notes
// of a row, the standing crew loaded or taken off. ONE ENTRY each, however many rows it touched (a
// drag that moves somebody from one van to another changes two rows; the standing crew fills
// twenty): the entry holds the whole draft as it was BEFORE the operation, so taking it back is
// putting that draft back — never an inverse worked out per kind, which is where an undo goes wrong.
//
// TYPING IS ONE OPERATION. The notes box changes the draft on every key; a press of «تراجع» after
// typing a word takes back the word, not its last letter. An entry recorded with a `merge` key
// absorbs the next entry with the same key (its «before» stays the one from the first key), until
// it is SEALED — the box loses the focus — or anything else is recorded on top of it.
//
// WHEN ANOTHER DESK SAVES. The page rebases the draft under the planner's unsaved work
// (`rebaseDraft`, Round 22). The history is rebased THE SAME WAY (`rebaseHistory`): every entry's
// «before» is an earlier draft over the same answer the current one was made from, so the same
// rebase gives what that earlier draft is over the new answer — the other desk's rows show in it
// too, and a press of «تراجع» never brings back the other desk's old rows. An entry the rebase
// leaves equal to the state after it (the other desk made the same change) would undo nothing; it
// is dropped rather than left as a press that does nothing.
//
// Generic over the state (`S`): «لوحة التشغيلة» keeps its rows and its standing-crew toggle in it,
// «توزيع المحصنات» its draft of moves.
import { sameRow, type PlanRow } from './crew-plan';

/** What an entry takes back, for the button's tooltip: a kind and the words it is said with. */
export interface UndoWhat {
  kind: string;
  /** Names and places as they were when the operation was done — the tooltip says them. */
  vars?: Readonly<Record<string, string>>;
}

export interface UndoStep<S> {
  /** The state BEFORE the operation — what one press of «تراجع» puts back. */
  before: S;
  what: UndoWhat;
  /** Set while a typing session may still add to this entry (`record`'s `merge`). */
  merge: string | null;
}

export interface UndoHistory<S> {
  /** The state on screen. */
  now: S;
  /** The operations that led to it, the LAST at the end. */
  past: readonly UndoStep<S>[];
}

/**
 * How many operations are kept. A day's plan is a few hundred moves at the most; past this the
 * oldest is forgotten (the planner can still not save, which is the old «everything back»).
 */
export const UNDO_LIMIT = 200;

/** A fresh history — nothing to take back. The day's first read, a new day, a save read back. */
export const startHistory = <S>(now: S): UndoHistory<S> => ({ now, past: [] });

/**
 * One operation done: `next` is on screen, and the state before it is kept to come back to.
 *
 *   · nothing changed (`same`) → the history as it was: a refused drop, a type picked again, a box
 *     left as it was are not operations, and a press of «تراجع» must not spend itself on them;
 *   · `merge` equal to the last entry's (still open) → that entry grows instead: the same typing;
 *   · else a new entry, the oldest forgotten past `UNDO_LIMIT`.
 */
export const record = <S>(
  history: UndoHistory<S>,
  next: S,
  what: UndoWhat,
  options: { same: (a: S, b: S) => boolean; merge?: string },
): UndoHistory<S> => {
  if (next === history.now || options.same(next, history.now)) return history;
  const last = history.past[history.past.length - 1];
  const merge = options.merge ?? null;
  if (merge !== null && last !== undefined && last.merge === merge) {
    // The typing goes on: one entry, still holding the state before its first key. Typed back to
    // where it began, the entry is no operation at all — it goes.
    return options.same(next, last.before)
      ? { now: next, past: history.past.slice(0, -1) }
      : { now: next, past: history.past };
  }
  const past = [...history.past, { before: history.now, what, merge }];
  return { now: next, past: past.length > UNDO_LIMIT ? past.slice(-UNDO_LIMIT) : past };
};

/**
 * Which changes of a row's own fields come in more than one event yet are ONE operation — merged
 * under this key until the page seals the history. The notes: a key at a time, until the box is
 * left. The time: the panel's hour, then its minute — two clicks, one time — until the panel closes
 * (a press of «تراجع» after 07:30 picked must not leave 07 with the old minute, a time nobody chose).
 * Everything else (a type, a colour, a direction picked from its list) is one event: no key.
 */
export const mergeKeyOf = (kind: string, rowKey: string): string | undefined =>
  kind === 'notes' || kind === 'time' ? `${kind}:${rowKey}` : undefined;

/** The operation one press would take back, or null — the button is then off. */
export const lastStep = <S>(history: UndoHistory<S>): UndoStep<S> | null =>
  history.past[history.past.length - 1] ?? null;

/** One press of «تراجع»: the last operation taken back. Nothing to take back → as it was. */
export const undo = <S>(history: UndoHistory<S>): UndoHistory<S> => {
  const last = lastStep(history);
  return last === null ? history : { now: last.before, past: history.past.slice(0, -1) };
};

/** The typing ended (the box lost the focus): the next key in it is a new operation. */
export const sealHistory = <S>(history: UndoHistory<S>): UndoHistory<S> => {
  const last = lastStep(history);
  if (last === null || last.merge === null) return history;
  return { now: history.now, past: [...history.past.slice(0, -1), { ...last, merge: null }] };
};

/**
 * Another desk's save under the draft: `rebase` (the page's `rebaseDraft`, over the same two
 * answers) applied to the state on screen AND to every entry's «before». An entry that comes out
 * equal to the state after it undoes nothing any more, and is dropped.
 */
export const rebaseHistory = <S>(
  history: UndoHistory<S>,
  rebase: (state: S) => S,
  same: (a: S, b: S) => boolean,
): UndoHistory<S> => {
  const now = rebase(history.now);
  const befores = history.past.map((step) => rebase(step.before));
  const past: UndoStep<S>[] = [];
  history.past.forEach((step, index) => {
    const before = befores[index] as S;
    const after = index + 1 < befores.length ? (befores[index + 1] as S) : now;
    if (!same(before, after)) past.push({ ...step, before });
  });
  return { now, past };
};

// ── «لوحة التشغيلة»'s state ──────────────────────────────────────────────────────────────────────

/**
 * What one press of the board's «تراجع» puts back: the rows, and which of them the standing-crew
 * toggle filled (its «off» empties exactly those — taken back with the load, it is off again).
 */
export interface CrewDraft {
  rows: readonly PlanRow[];
  standingKeys: readonly string[] | null;
}

const sameKeys = (a: readonly string[] | null, b: readonly string[] | null): boolean =>
  a === b ||
  (a !== null && b !== null && a.length === b.length && a.every((key, at) => key === b[at]));

/**
 * The same board: the same rows in the same order, each the same to the save (`sameRow`) and showing
 * the same van — and the standing crew toggled the same way.
 */
export const sameCrewDraft = (a: CrewDraft, b: CrewDraft): boolean =>
  sameKeys(a.standingKeys, b.standingKeys) &&
  (a.rows === b.rows ||
    (a.rows.length === b.rows.length &&
      a.rows.every((row, at) => {
        const other = b.rows[at];
        return (
          other !== undefined &&
          other.key === row.key &&
          other.vehicleCode === row.vehicleCode &&
          other.onRoster === row.onRoster &&
          sameRow(row, other)
        );
      })));

/** The rows one press changes — the keys that differ between two drafts, in the board's order. */
export const changedRowKeys = (from: readonly PlanRow[], to: readonly PlanRow[]): string[] => {
  const was = new Map(from.map((row) => [row.key, row]));
  const now = new Map(to.map((row) => [row.key, row]));
  const keys = [...new Set([...to.map((row) => row.key), ...from.map((row) => row.key)])];
  return keys.filter((key) => {
    const a = was.get(key);
    const b = now.get(key);
    return a === undefined || b === undefined || !sameRow(a, b);
  });
};
