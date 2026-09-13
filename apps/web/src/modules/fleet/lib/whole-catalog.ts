// Reading a catalog WHOLE, however many pages it takes.
//
// A fleet catalog is a vocabulary the screens point at: the spare parts a workshop fits, the
// violation types the bar files, the grades a driver holds. Every screen that touches one wants
// all of it — a dropdown offers it, and a table resolves an id through it into a name.
//
// It was read as ONE page. `MAX_PAGE_SIZE` is 100 and that is a server cap, not a request the
// caller can raise, so a catalog past a hundred entries was silently cut. The two ways that shows
// are both quiet: an option the admin added simply is not in the list, and — worse, because
// nothing looks wrong — a row referring to an entry off the end renders a BLANK name, because the
// id → name map every list page builds is built from the same cut page.
//
// Spare parts is the one that gets there first; a real parts catalog is hundreds of lines.
//
// So the loop, kept here because the arithmetic is the part with a rule in it and the part a test
// can reach without a DOM. Not `useInfiniteQuery`: nobody presses «تحميل المزيد» on a dropdown, so
// the pages are gathered inside one cache entry and every caller keeps reading `.items`.
import { MAX_PAGE_SIZE, type PageMeta, type Paginated } from '@ecms/contracts';

/**
 * How many pages this catalog has, from the first page's own meta.
 *
 * Taken from the server's `totalPages` rather than inferred from «did this page come back full?».
 * Inferring costs one extra, empty request on a catalog whose size is an exact multiple of the
 * page size — and this runs on screens that mount three or four catalogs at once.
 */
export const catalogPageCount = (meta: PageMeta | undefined): number => {
  if (meta === undefined) return 0;
  return meta.totalPages > 0 ? meta.totalPages : 0;
};

/**
 * A hard stop on the number of requests one catalog may cost.
 *
 * Not a page cap — every page is still fetched up to this bound, which is twenty thousand entries.
 * It exists so a server that reports a nonsensical `totalPages` cannot turn a dropdown into an
 * unbounded request loop; a catalog that genuinely reaches it has outgrown being a dropdown and
 * wants a search box, which is a decision for whoever gets there, not a silent truncation here.
 */
export const MAX_CATALOG_PAGES = 200;

/**
 * Every page of one catalog, as a single `Paginated` the callers already know how to read.
 *
 * `fetchPage` is the seam: the hook passes the real list call, a test passes a stub.
 */
export const fetchWholeCatalog = async <T>(
  fetchPage: (page: number, pageSize: number) => Promise<Paginated<T>>,
): Promise<Paginated<T>> => {
  const first = await fetchPage(1, MAX_PAGE_SIZE);
  const pages = Math.min(catalogPageCount(first.meta), MAX_CATALOG_PAGES);
  if (pages <= 1) return first;
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, async (_unused, index) => fetchPage(index + 2, MAX_PAGE_SIZE)),
  );
  return { ...first, items: [...first.items, ...rest.flatMap((page) => page.items)] };
};
