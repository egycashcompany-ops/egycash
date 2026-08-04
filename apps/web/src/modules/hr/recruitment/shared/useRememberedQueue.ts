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

export const useRememberedQueue = (
  screen: string,
  [sp, setSp]: ReturnType<typeof useSearchParams>,
): void => {
  const restored = useRef(false);
  const current = sp.toString();

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    // Only a bare arrival gets yesterday's view back.
    if (current !== '') return;
    const saved = read(screen);
    if (saved !== '') setSp(new URLSearchParams(saved), { replace: true });
  }, [screen, current, setSp]);

  useEffect(() => {
    // Don't record the empty state produced by the restore effect's own first pass, or a reset
    // would be indistinguishable from never having filtered.
    if (!restored.current) return;
    write(screen, current);
  }, [screen, current]);
};
