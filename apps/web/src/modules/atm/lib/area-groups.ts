// The open boards, area by area — «عايز كمان إن التغذيات والأعطال يبقي معمولها Group by المناطق +
// Sorting بالمناطق بردو · يعني كل منطقة تظهر اعطالها وتغذياتها تحت بعض + بترتيب ابجدى للمناطق»
// (2026-11-02).
//
// On /atm/replenishments and /atm/maintenance a row's area decides FIRST: each area's rows sit
// together under a line that names it, and the areas run in alphabetical order. A row with no
// area goes last either way. The reader's columns order the rows INSIDE each area, and the board's
// own order breaks every tie, as before (`useBoardView.ts`).
//
// The area keeps its arrow on the head, lit and first: that is the board's real order. A click on
// it turns the areas round (ي → أ), and the next click turns them back (أ → ي). It never lets go,
// because the board is always grouped. Any other column orders inside the areas, by the board's usual rule
// (`toggleSort`: it replaces, then turns round, then lets go). `?sort=` holds only what the reader
// chose: the areas appear in it only while they run backwards.
import { type Locale } from '@ecms/contracts';
import { formatNumber } from '../../../shared/lib/format';
import { toggleSort, type TableSort } from '../../../shared/lib/table-sort';

/** The column key the boards group by. */
export const AREA_KEY = 'area';

/**
 * The area a row is grouped under, as the board filters name it: the stored text, trimmed. A
 * spelling that differs only by surrounding spaces is the same area (`board-filter.ts` on the
 * server), so the board has one group for it, not two.
 */
export const areaGroupOf = (row: { area: string }): string => row.area.trim();

/**
 * Pure: two areas in alphabetical order, ASCENDING. Words are compared as words in Arabic
 * collation (`localeCompare(…, 'ar')`, as every ATM sort is). Two names that collate as equal but
 * are written differently are then put in code-point order, so each still forms ONE run of rows
 * and never interleaves with the other. The empty area is not compared here: it goes last.
 */
export const compareAreas = (left: string, right: string): number => {
  const collated = left.localeCompare(right, 'ar');
  if (collated !== 0) return collated;
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

export interface BoardAreaOrder {
  /** Which way the areas run. Ascending unless the reader turned them round. */
  areaDir: 'asc' | 'desc';
  /** The reader's other columns, which order the rows inside each area. */
  within: TableSort[];
  /** What the head shows: the area first, then the reader's columns. */
  shown: TableSort[];
}

/** Pure: the board's order from the reader's chosen sorts (`?sort=`, already kept to the table's keys). */
export const boardAreaOrder = (chosen: readonly TableSort[]): BoardAreaOrder => {
  const areaDir = chosen.find((entry) => entry.by === AREA_KEY)?.dir ?? 'asc';
  const within = chosen.filter((entry) => entry.by !== AREA_KEY);
  return { areaDir, within, shown: [{ by: AREA_KEY, dir: areaDir }, ...within] };
};

/**
 * Pure: the reader's sorts after one header click, as `?sort=` should hold them.
 *
 *   · On the area, the areas turn round. The reader's other columns stay as they were.
 *   · On another column, `toggleSort` decides among the reader's columns. The areas keep their
 *     direction.
 *
 * Ascending areas are the default and are not written: an untouched board's address carries no
 * sort at all.
 */
export const clickBoardSort = (chosen: readonly TableSort[], key: string): TableSort[] => {
  const { areaDir, within } = boardAreaOrder(chosen);
  const nextDir = key === AREA_KEY ? (areaDir === 'asc' ? 'desc' : 'asc') : areaDir;
  const nextWithin = key === AREA_KEY ? within : toggleSort(within, key);
  return [...(nextDir === 'desc' ? [{ by: AREA_KEY, dir: 'desc' as const }] : []), ...nextWithin];
};

/**
 * Pure: `rows` grouped by area, areas in `dir` order, a row with no area last. The rows of one
 * area keep the order they came in. The sort is stable, so this runs AFTER the reader's columns
 * and the board's own order have ordered the rows (`useBoardView.ts`).
 */
export const groupRowsByArea = <T extends { area: string }>(
  rows: readonly T[],
  dir: 'asc' | 'desc',
): T[] =>
  [...rows].sort((a, b) => {
    const left = areaGroupOf(a);
    const right = areaGroupOf(b);
    if (left === right) return 0;
    if (left === '') return 1;
    if (right === '') return -1;
    const verdict = compareAreas(left, right);
    return dir === 'asc' ? verdict : -verdict;
  });

/**
 * The line above each area on a board (`DataTable`'s `group`): the area's name, or «بدون منطقة»,
 * and how many of the view's rows it holds, in the reader's digits.
 */
export const areaGroupLine = (
  t: (key: string) => string,
  locale: Locale,
): {
  of: (row: { area: string }) => string;
  label: (area: string) => string;
  count: (rows: number) => string;
} => ({
  of: areaGroupOf,
  label: (area) => (area === '' ? t('atm.board.noArea') : area),
  count: (rows) => formatNumber(rows, locale),
});
