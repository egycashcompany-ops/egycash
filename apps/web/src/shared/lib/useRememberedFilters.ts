// A screen remembers how you left it.
//
// An operator works one slice all morning — "open tickets, high priority, Maadi branch" — and every
// visit through the sidebar used to drop them back on the unfiltered list, so they set the same
// filters again. The sidebar links carry no query string, so arriving from one is always a bare
// URL, which is exactly the moment there is something to restore.
//
// WHAT IS REMEMBERED IS DECLARED, NOT INFERRED. Each screen passes the params it wants kept, and
// nothing else is written — not the whole query string minus a blocklist. The query vocabulary is
// not uniform enough for a blocklist to be safe: `code` names a vehicle on the registry and half a
// verification credential on the contract check; `kind` is a filter on the violations board and a
// TAB on the catalogs; `date` on the daily board is not a filter at all but what the board IS. A
// list per screen is more to write once, and the only version that cannot silently start
// remembering the wrong thing later.
//
// Two rules keep this from becoming a bug:
//
//   • A URL THAT ALREADY SAYS SOMETHING WINS. Arriving with a query string — a shared link, a
//     bookmark, the back button — means the address bar is the intent, and replacing it with
//     yesterday's filters would break every link anyone sends. Restoring happens only on a bare
//     arrival, and REPLACES the history entry rather than pushing, so Back still leaves the screen
//     instead of bouncing between remembered and bare.
//
//   • `page` IS NEVER REMEMBERED. It is derived, not chosen: every screen's `patch()` already drops
//     it whenever a filter changes. Restoring page 7 of a list the reader has not seen since
//     yesterday would land them somewhere they never asked to be.
import { useEffect, useRef } from 'react';
import { useLocation, type useSearchParams } from 'react-router-dom';

/**
 * Storage is keyed by PATHNAME, so no screen can read another's filters and nobody has to invent a
 * unique name for 43 of them. A route carrying an id (`/interviews/stage/:stageId`) therefore gets
 * one entry per stage — which is right: those queues are different queues.
 *
 * Only for screens whose path is stable while they are open. A detail page filtering by an
 * unbounded id would grow an entry per record, and must not use this hook.
 */
const key = (pathname: string): string => `ecms.filters.${pathname}`;

/** Same prefix the locale and theme preferences use — client-side, per browser, no server round trip. */
const read = (pathname: string): string => {
  try {
    return window.localStorage.getItem(key(pathname)) ?? '';
  } catch {
    // Private mode, or storage disabled. A screen that cannot remember still works.
    return '';
  }
};

const write = (pathname: string, value: string): void => {
  try {
    window.localStorage.setItem(key(pathname), value);
  } catch {
    /* not remembering is not an error worth showing anyone */
  }
};

/**
 * Which view a screen opens on. Three inputs, one precedence, and it is the whole decision:
 *
 *   the URL  >  the view this user left behind  >  the screen's own default
 *
 * @returns the query string to restore, or `''` to leave the URL alone.
 */
export const chooseInitialView = (current: string, saved: string, fallback: string): string => {
  // Arriving with a query string means the address bar is the intent.
  if (current !== '') return '';
  return saved !== '' ? saved : fallback;
};

/**
 * The part of a URL a screen has declared worth keeping — everything else dropped.
 *
 * Ordered by the DECLARATION rather than by the URL, so the same view produces the same string
 * however the page happened to write it, and a stored value stays comparable across visits.
 */
export const rememberedOnly = (sp: URLSearchParams, remembered: readonly string[]): string => {
  const kept = new URLSearchParams();
  for (const name of remembered) {
    for (const value of sp.getAll(name)) {
      if (value !== '') kept.append(name, value);
    }
  }
  return kept.toString();
};

/** What the hook knows when a render commits. */
export interface FilterPass {
  /** Has the restore decision already been taken on an earlier pass? */
  settled: boolean;
  /** Did the previous pass navigate, so this one is showing the restored URL? */
  navigating: boolean;
  /** The whole query string as it stands. */
  current: string;
  /** What storage holds for this screen — only read while `settled` is false. */
  saved: string;
  fallback: string;
}

/** What that pass should do. */
export interface FilterAction {
  /** Query string to restore, or `''` for none. */
  restore: string;
  /** Whether this pass should record the view. */
  record: boolean;
}

/**
 * The whole sequencing decision, as a function, because the part that can be wrong is WHEN each of
 * the two things happens — and an effect that navigates is nearly impossible to assert on without a
 * browser, which this suite does not have.
 *
 * The subtle case is the pass that issues a restore. It still holds the BARE url it arrived with,
 * so recording it would erase the very value being restored before the navigation could put it
 * back. It has to sit out, and so does the pass after it, which is merely showing what storage
 * already holds.
 */
export const runFilterPass = ({
  settled,
  navigating,
  current,
  saved,
  fallback,
}: FilterPass): FilterAction => {
  if (settled) return { restore: '', record: !navigating };
  const restore = chooseInitialView(current, saved, fallback);
  return { restore, record: restore === '' };
};

export const useRememberedFilters = (
  [sp, setSp]: ReturnType<typeof useSearchParams>,
  /**
   * The params this screen keeps — its filters, plus the view preferences (`sort`, `size`, `view`)
   * where it has them. Pass a module-level constant: a fresh array each render stays correct, since
   * only the projected string is a dependency, but it is pointless work.
   *
   * `page` does not belong here and is not filtered out for you — a screen that lists it is stating
   * something the rest of the app disagrees with, and the coverage test says so.
   */
  remembered: readonly string[],
  /**
   * Where a screen starts when it has nothing else to go on — e.g. screening opens on the work that
   * is actually waiting rather than on every screening ever done. It is the LAST fallback, never an
   * override: a URL beats it, and so does the view this user left behind, because a default that
   * reimposes itself over either would be a bug wearing a helpful face.
   */
  fallback = '',
): void => {
  const { pathname } = useLocation();
  const settled = useRef(false);
  const navigating = useRef(false);
  // React Router rebuilds `setSp` whenever the params object changes, so it cannot be left out of
  // the dependencies and cannot be relied on to change only when the view does. Remembering what
  // was last written keeps a re-render from rewriting the same string on a busy list.
  const written = useRef<string | null>(null);
  const current = sp.toString();
  const keep = rememberedOnly(sp, remembered);

  useEffect(() => {
    const action = runFilterPass({
      settled: settled.current,
      navigating: navigating.current,
      current,
      saved: settled.current ? '' : read(pathname),
      fallback,
    });
    settled.current = true;
    navigating.current = action.restore !== '';
    if (action.restore !== '') {
      setSp(new URLSearchParams(action.restore), { replace: true });
      return;
    }
    const entry = `${pathname}\n${keep}`;
    if (!action.record || written.current === entry) return;
    written.current = entry;
    write(pathname, keep);
  }, [pathname, current, keep, fallback, setSp]);
};
