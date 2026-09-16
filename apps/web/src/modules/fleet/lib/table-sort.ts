// What a click on a Fleet table's header does — and why it does not throw the last one away.
//
// «لو دوس على الكود هيجيب العربيات من الاصغر للاكبر لكن لو دوس على انتهاء الترخيص هيلغى اللى كنت
// عامله فى الكود ... انا عاوز اقدر اعمل الاتنين مع بعض وعادى».
//
// THE RULE, in one line: a click ADDS the column to the order, and clicking the same column again
// turns it round, and once more takes it out. Columns pile up in the order they were clicked, and
// the header prints that order as a small number beside each arrow, so «الكود ثم انتهاء الترخيص»
// is both what the reader asked for and what the screen says back.
//
// A plain click adds rather than replaces because the alternative is a modifier key — shift, ctrl
// — that nothing on the screen can advertise and nobody would find. The way back is the same
// click, one more time: the third press on a column removes it, and removing the last one leaves
// the screen's own default, so a table is never sorted by nothing.
//
// The FORMAT is the contract's (`parseFleetSort` / `formatFleetSort`): one string,
// `code:asc,licenseExpiresAt:desc`, which is what sits in `?sort=`, what the request carries, and
// what the server sorts by. One spelling, three places, no translation between them — which is
// also why a link a reader sends a colleague arrives with their whole order, not its first column.
import { FLEET_SORT_MAX, formatFleetSort, parseFleetSort, type FleetSortEntry } from '@ecms/contracts';

export type TableSort = FleetSortEntry;

/**
 * The order in the address bar, or the screen's own default when there is none.
 *
 * `fallback` is written in the same format — `'code:asc'` — so a screen's default order is one
 * string in one place, and a default of several columns costs nothing extra.
 */
export const readSorts = (raw: string | null, fallback: string): TableSort[] => {
  const parsed = parseFleetSort(raw);
  return parsed.length > 0 ? parsed : parseFleetSort(fallback);
};

/** The order, back into the one parameter. `null` clears it — `patch` deletes the key. */
export const writeSorts = (sorts: readonly TableSort[]): string | null => formatFleetSort(sorts);

/**
 * One click on a header.
 *
 * Not in the order yet → added at the END, ascending, because a reader adding a second column is
 * refining the first rather than replacing it. Already there → turned round. Already descending →
 * dropped, which is the only way back out and is the same click they came in with.
 *
 * At the cap the OLDEST column leaves, and the badges renumber where the reader can see it — a
 * click that silently did nothing would be the worse of the two. No table in Fleet has enough
 * sortable columns to reach it today.
 */
export const toggleSort = (sorts: readonly TableSort[], key: string): TableSort[] => {
  const at = sorts.findIndex((entry) => entry.by === key);
  const added: TableSort = { by: key, dir: 'asc' };
  if (at === -1) return [...sorts, added].slice(-FLEET_SORT_MAX);
  const current = sorts[at] as TableSort;
  if (current.dir === 'asc') {
    return sorts.map((entry, index) =>
      index === at ? ({ by: entry.by, dir: 'desc' } as TableSort) : entry,
    );
  }
  return sorts.filter((_, index) => index !== at);
};

/**
 * What the list request carries.
 *
 * BOTH shapes, deliberately. `sort` is the whole order; `sortBy`/`sortDir` are the platform's
 * pagination contract, which every other module speaks and which an older API would still honour —
 * so a request that loses the new parameter comes back sorted by the reader's FIRST column instead
 * of by the collection's default, which is the difference between «not quite» and «wrong».
 */
export const sortQuery = (
  sorts: readonly TableSort[],
): { sortBy: string | undefined; sortDir: 'asc' | 'desc' | undefined; sort: string | undefined } => {
  const first = sorts[0];
  return {
    sortBy: first?.by,
    sortDir: first?.dir,
    sort: writeSorts(sorts) ?? undefined,
  };
};
