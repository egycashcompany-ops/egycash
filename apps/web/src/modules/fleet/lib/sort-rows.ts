// Ordering a board that is ALREADY WHOLE — the client-side half of «عاوز هنا يكون فيه سهم».
//
// Three Fleet screens hold every row they report on: the daily roster and the standing roster are
// a day's whole fleet, and the alarms board derives one row per vehicle with no paging at all. On
// those, sorting in the browser is not a shortcut — it is the honest answer, because there is no
// second page for an arrow to be wrong about. Everywhere else the register is paged and the order
// belongs to the server, which is why this module is not exported to those screens.
//
// The RULE is the same one the server follows, deliberately: the columns decide in the order they
// were clicked, a missing value sorts LAST in either direction, and a stable tiebreaker closes
// every comparison so the board cannot reshuffle under a reader who changed nothing.
import { type TableSort } from './table-sort';

/** What one column of one row is worth. `null` = nothing to order by — see `compare`. */
export type SortValue = string | number | null;

/**
 * Two values of one column. `null` always answers LAST, whichever way the arrow points.
 *
 * Not «smallest»: a car with no service on file is not the most overdue one, and floating it to
 * the top of «المتبقي» would bury the car that actually is. The infinities carry that answer out
 * past the caller's direction, which is the only way a direction-independent rule survives being
 * multiplied by −1.
 */
export const compare = (left: SortValue, right: SortValue): number => {
  if (left === null && right === null) return 0;
  if (left === null) return Number.POSITIVE_INFINITY;
  if (right === null) return Number.NEGATIVE_INFINITY;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  // Words are compared as WORDS. Arabic in code-point order is not alphabetical order, and this
  // is the column a reader scans down looking for a name.
  return String(left).localeCompare(String(right), 'ar');
};

/**
 * The board, in the reader's order.
 *
 * `value` answers what one column of one row is worth; a key it does not know answers `null`,
 * which is what makes a hand-edited `?sort=` harmless. `tiebreak` is the board's OWN order — the
 * one it had before anybody clicked — so rows the reader's columns cannot separate stay where
 * they were rather than shuffling on every render.
 */
export const sortRows = <T>(
  rows: readonly T[],
  sorts: readonly TableSort[],
  value: (row: T, key: string) => SortValue,
  tiebreak: (a: T, b: T) => number = () => 0,
): T[] =>
  [...rows].sort((a, b) => {
    for (const entry of sorts) {
      const verdict = compare(value(a, entry.by), value(b, entry.by));
      if (verdict === Number.POSITIVE_INFINITY) return 1;
      if (verdict === Number.NEGATIVE_INFINITY) return -1;
      if (verdict !== 0) return entry.dir === 'asc' ? verdict : -verdict;
    }
    return tiebreak(a, b);
  });
