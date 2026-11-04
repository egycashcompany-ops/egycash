// Reading a list WHOLE, however many pages it takes — the done pages, the mail pages and the
// machine export. The two OPEN boards no longer walk: since 2026-11 they read the whole board in
// one request (`GET /atm/{kind}/board`, `atmOpenBoardQueries`), which is what this walk was the
// stand-in for — measured in production it was the API's busiest read.
//
// The walk takes TanStack's AbortSignal: a walk the cache no longer wants (a superseded refetch, a
// range typed past, a screen left) stops between steps and aborts the page reads in flight, instead
// of fetching every remaining page for an answer nobody reads.
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

/**
 * One page of the list. `signal` is the walk's own — pass it to the request (`getPage(path,
 * { signal })`), so an abandoned walk's reads in flight are aborted too.
 */
export type BoardPageFetch<T> = (
  page: number,
  pageSize: number,
  signal?: AbortSignal,
) => Promise<Paginated<T>>;

/** Stop here if the walk was abandoned — with the signal's own reason, as `fetch` does. */
const stopIfAborted = (signal: AbortSignal | undefined): void => {
  signal?.throwIfAborted();
};

/** One walk over every page, and whether its pages agree with each other. */
const walkBoard = async <T extends { id: string }>(
  fetchPage: BoardPageFetch<T>,
  signal: AbortSignal | undefined,
): Promise<{ board: Paginated<T>; steady: boolean }> => {
  stopIfAborted(signal);
  const first = await fetchPage(1, MAX_PAGE_SIZE, signal);
  const pages = boardPageCount(first.meta.totalPages);
  if (pages <= 1) return { board: first, steady: true };
  stopIfAborted(signal);
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, async (_unused, index) =>
      fetchPage(index + 2, MAX_PAGE_SIZE, signal),
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

/**
 * Every page, in order, as one `Paginated` whose `items` hold each row once. `signal` — TanStack's,
 * from the `queryFn` context — is handed to every page read and checked between steps: once it
 * aborts, no further page is asked for and the walk rejects with its reason.
 */
export const fetchWholeBoard = async <T extends { id: string }>(
  fetchPage: BoardPageFetch<T>,
  signal?: AbortSignal,
): Promise<Paginated<T>> => {
  let read = await walkBoard(fetchPage, signal);
  for (let walks = 1; !read.steady && walks < MAX_BOARD_WALKS; walks += 1) {
    read = await walkBoard(fetchPage, signal);
  }
  return read.board;
};
