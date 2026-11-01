// Reading an open board WHOLE, however many pages it takes.
//
// The boards asked for ONE page of `MAX_PAGE_SIZE` (100) and had no pager. On a busy day there are
// more open operations than that company-wide, so every row past the hundredth (by area) was not
// on the board at all — not closable, not countable — and a filter only ever searched the first
// hundred. `MAX_PAGE_SIZE` is a server cap, not a request a caller can raise.
//
// The fleet's catalogs met the same wall and walk the pages inside one cache entry
// (`fleet/lib/whole-catalog.ts`); this is that walk for a LIVE list. One difference: rows open and
// close between two page reads, so a row can slide from one page into the next and be read twice
// — it is kept once — or slide back onto a page already read and be missed, while a row closed
// meanwhile stays on the board. The realtime signal for that write cannot be relied on to repair
// it: on a board's FIRST load (every filter change is one) TanStack joins the read in flight
// instead of restarting it, and the read's success clears the invalidation. So the walk checks
// itself: every page must report the total the first one did, and the rows read must add up to it.
// A walk that disagrees is read again, up to `MAX_BOARD_WALKS` times; the last walk is shown.
import { MAX_PAGE_SIZE, type Paginated } from '@ecms/contracts';

/**
 * A hard stop on the requests one board may cost — twenty thousand open operations. Not a page cap
 * on a real board; it keeps a nonsensical `totalPages` from becoming an unbounded request loop.
 */
export const MAX_BOARD_PAGES = 200;

/**
 * Did the walk stop at `MAX_BOARD_PAGES` — rows on the server the board does not hold? A done
 * range long enough for that is not a statement of the period, and its page says so.
 */
export const isBoardCutShort = (meta: { totalPages: number }): boolean =>
  meta.totalPages > MAX_BOARD_PAGES;

/** How many pages the board has, from the first page's own meta. */
export const boardPageCount = (totalPages: number): number =>
  Math.min(Math.max(totalPages, 0), MAX_BOARD_PAGES);

/**
 * How many times one board read may walk the pages when a write keeps landing between them. Past
 * that, the last walk is shown; the next refresh reads it again.
 */
export const MAX_BOARD_WALKS = 3;

/** One walk over every page, and whether its pages agree with each other. */
const walkBoard = async <T extends { id: string }>(
  fetchPage: (page: number, pageSize: number) => Promise<Paginated<T>>,
): Promise<{ board: Paginated<T>; steady: boolean }> => {
  const first = await fetchPage(1, MAX_PAGE_SIZE);
  const pages = boardPageCount(first.meta.totalPages);
  if (pages <= 1) return { board: first, steady: true };
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, async (_unused, index) =>
      fetchPage(index + 2, MAX_PAGE_SIZE),
    ),
  );
  const seen = new Set<string>();
  const items: T[] = [];
  for (const row of [...first.items, ...rest.flatMap((page) => page.items)]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    items.push(row);
  }
  const total = first.meta.totalItems;
  const steady =
    rest.every((page) => page.meta.totalItems === total) &&
    // A board cut short by the request bound cannot add up to its total, and need not.
    (pages < first.meta.totalPages || items.length === total);
  return { board: { ...first, items }, steady };
};

/** Every page, in order, as one `Paginated` whose `items` hold each row once. */
export const fetchWholeBoard = async <T extends { id: string }>(
  fetchPage: (page: number, pageSize: number) => Promise<Paginated<T>>,
): Promise<Paginated<T>> => {
  let read = await walkBoard(fetchPage);
  for (let walks = 1; !read.steady && walks < MAX_BOARD_WALKS; walks += 1) {
    read = await walkBoard(fetchPage);
  }
  return read.board;
};
