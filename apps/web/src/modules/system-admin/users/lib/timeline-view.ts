// The two decisions the Activity tab makes, as functions rather than as conditions inside JSX.
//
// Both are the kind that go wrong silently. A trail that stops one page early looks like a complete
// history; a failed read rendered as "nothing has been recorded" looks like an answer. Neither
// mistake shows up in a render — the broken version renders perfectly — and the web suite runs on
// `environment: 'node'` with no DOM to drive, so the rules live here where they can be checked
// directly.

/** Which of the four panels the tab shows. Exactly one, in this order of precedence. */
export type TimelinePanel = 'loading' | 'error' | 'empty' | 'entries';

/**
 * `error` OUTRANKS `empty`, and only while nothing has loaded.
 *
 * "This account has no history" and "we could not read this account's history" are opposite
 * claims about the same screen, and an administrator who accepts the first one stops looking. So a
 * failure with nothing on screen is an error panel, never the empty state.
 *
 * Once entries ARE on screen, a later failure keeps them: the reader asked for older history and
 * did not get it, which is a note beneath what they already have — not a reason to take it away.
 */
export const timelinePanel = ({
  isLoading,
  isError,
  loaded,
}: {
  isLoading: boolean;
  isError: boolean;
  loaded: number;
}): TimelinePanel => {
  if (isLoading) return 'loading';
  if (isError && loaded === 0) return 'error';
  if (loaded === 0) return 'empty';
  return 'entries';
};

/**
 * The next page to ask for, or `undefined` when the history is exhausted.
 *
 * `TimelineDto` carries no `meta`, so "is there more" is inferred from the last page being FULL —
 * a short page cannot have more behind it. Adding a total to the DTO would be a contract change to
 * an endpoint every timeline consumer shares, and the inference costs at most one empty request
 * when the total is an exact multiple of the page size.
 */
export const nextTimelinePage = (
  lastPageCount: number,
  pagesLoaded: number,
  pageSize: number,
): number | undefined => (lastPageCount < pageSize ? undefined : pagesLoaded + 1);
