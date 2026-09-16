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
/**
 * WHAT A CLICK MEANS WHEN THE READER HAS NOT ORDERED THE TABLE YET.
 *
 * «النوع بدوس عليه بيحدد الكود برضو وانا مجتش جمبه». Every screen opens on an order of its own —
 * the registry on the code, the drivers on when they were recorded, the workshop on the check-in
 * date. That order is the SCREEN's, not the reader's, and `toggleSort` could not tell the two
 * apart: a first click on «النوع» was read as a SECOND column added behind «الكود», so the code
 * still decided, the make only broke its ties, and both columns lit up.
 *
 * On the screens whose default is a column nobody can see — «تاريخ الإضافة» on the drivers
 * registry, the check-in date on the workshop — it was worse than confusing: the click marked the
 * column, sent the order, and changed nothing at all, because the invisible default went first.
 *
 * So the first click REPLACES the default rather than joining it:
 *   • the column the default already names keeps its place and turns round, which is what its
 *     arrow on the screen promises;
 *   • any other column becomes the whole order, ascending, and the default lets go.
 *
 * Every click after that is `toggleSort` exactly as before — «انا عاوز اقدر اعمل الاتنين مع بعض»
 * is about the reader's own columns, and they are the ones that pile up.
 */
export const clickSort = (raw: string | null, fallback: string, key: string): TableSort[] => {
  const chosen = parseFleetSort(raw);
  if (chosen.length > 0) return toggleSort(chosen, key);
  const inDefault = parseFleetSort(fallback).find((entry) => entry.by === key);
  if (inDefault === undefined) return [{ by: key, dir: 'asc' }];
  // TURNED ROUND, never dropped. `toggleSort` would take a descending column straight out of the
  // order, which is right for a column the reader put there and wrong for one the screen did:
  // taking it out lands back on the default, so a click on «التاريخ» of an untouched workshop
  // board would have left the board exactly as it was.
  return [{ by: key, dir: inDefault.dir === 'asc' ? 'desc' : 'asc' }];
};

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
