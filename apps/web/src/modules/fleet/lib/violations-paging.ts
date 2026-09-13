// Where the drivers' board stops asking for more.
//
// The board has no «السابق / التالي» — the owner asked for it gone — so the only way to reach the
// four-hundredth fine is to keep loading. That makes ONE decision load-bearing: after a page
// arrives, is there another? Get it wrong in one direction and the board hides rows behind a
// button that never appears; wrong in the other and it offers «تحميل المزيد» forever, each press
// fetching a page the server has already said is empty.
//
// It is answered from the server's own `totalPages` rather than inferred from «did this page come
// back full?». The timeline on the users screen infers it, because its endpoint returns no total
// at all; the violations list returns a real `PageMeta`, so the exact answer is already on hand and
// inferring would be guessing with the truth in the room. The difference shows on a list whose
// size is an exact multiple of the page size: the inferring form has to fetch one more, empty page
// to discover it has finished, and until that fetch it tells the reader there is more.
//
// Kept out of the component because it is the part with a rule in it, and the part a test can
// reach without a DOM.
import { type PageMeta } from '@ecms/contracts';

/**
 * The next page to ask for, or `undefined` when the board has everything.
 *
 * `loaded` is how many pages are already in hand — TanStack's `pages.length` — rather than the
 * last page's own `page` number, because those can disagree while a refetch is in flight.
 */
export const nextViolationsPage = (
  meta: PageMeta | undefined,
  loaded: number,
): number | undefined => {
  // No answer yet: asking for a second page before the first has arrived would race it.
  if (meta === undefined) return undefined;
  // A server that reports no pages has nothing to give, whatever it says about totals.
  if (meta.totalPages <= 0) return undefined;
  return loaded < meta.totalPages ? loaded + 1 : undefined;
};

/**
 * How many rows the reader can actually see right now, against how many matched.
 *
 * The board used to say «٤٤٠» beside the filters while showing a hundred rows, with no control
 * anywhere to reach the rest — a count that was true and useless at the same time. These two
 * numbers are what the panel prints instead, so the gap between them is always visible and always
 * closable.
 */
export const violationsLoadState = (
  meta: PageMeta | undefined,
  shown: number,
): { shown: number; total: number; remaining: number; complete: boolean } => {
  const total = meta?.totalItems ?? shown;
  const remaining = Math.max(0, total - shown);
  return { shown, total, remaining, complete: remaining === 0 };
};
