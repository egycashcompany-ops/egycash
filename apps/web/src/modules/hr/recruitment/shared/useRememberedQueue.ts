// A queue remembers how you left it.
//
// A recruiter works one slice of the pipeline all morning — "waiting screenings in Maadi, newest
// first" — and every visit through the sidebar used to drop them back on the unfiltered list, so
// they set the same filters again. The queues already encode filters, sort and page size in the
// URL, so remembering that one string remembers all three at once.
//
// The rule that keeps this from becoming a bug: a URL that already says something WINS. Arriving
// with a query string — a shared link, a bookmark, a back-button — means the address bar is the
// intent, and silently replacing it with yesterday's filters would break every link anyone sends.
// Restoring only happens on a bare arrival, and it replaces the history entry rather than pushing,
// so Back still leaves the page instead of bouncing between remembered and bare.
import { useEffect, useRef } from 'react';
import { type useSearchParams } from 'react-router-dom';

const key = (screen: string): string => `ecms.queue.${screen}`;

/** Same prefix the locale and theme preferences use — client-side, per browser, no server round trip. */
const read = (screen: string): string => {
  try {
    return window.localStorage.getItem(key(screen)) ?? '';
  } catch {
    // Private mode, or storage disabled. A queue that cannot remember still works.
    return '';
  }
};

const write = (screen: string, value: string): void => {
  try {
    window.localStorage.setItem(key(screen), value);
  } catch {
    /* not remembering is not an error worth showing anyone */
  }
};

/**
 * Which view a queue opens on. Three inputs, one precedence, and it is the whole decision:
 *
 *   the URL  >  the view this user left behind  >  the queue's own default
 *
 * Pulled out of the effect because it is the part that can be wrong, and an effect that navigates
 * is nearly impossible to assert on without a browser.
 *
 * @returns the query string to restore, or `''` to leave the URL alone.
 */
export const chooseInitialView = (current: string, saved: string, fallback: string): string => {
  // Arriving with a query string means the address bar is the intent.
  if (current !== '') return '';
  return saved !== '' ? saved : fallback;
};

export const useRememberedQueue = (
  screen: string,
  [sp, setSp]: ReturnType<typeof useSearchParams>,
  /**
   * Where a queue starts when it has nothing else to go on — e.g. screening opens on the work
   * that is actually waiting rather than on every screening ever done. It is the LAST fallback,
   * never an override: a URL beats it, and so does the view this user left behind, because a
   * default that reimposes itself over either would be a bug wearing a helpful face.
   */
  fallback = '',
): void => {
  const restored = useRef(false);
  const current = sp.toString();

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const next = chooseInitialView(current, read(screen), fallback);
    if (next !== '') setSp(new URLSearchParams(next), { replace: true });
  }, [screen, current, fallback, setSp]);

  useEffect(() => {
    // Don't record the empty state produced by the restore effect's own first pass, or a reset
    // would be indistinguishable from never having filtered.
    if (!restored.current) return;
    write(screen, current);
  }, [screen, current]);
};
