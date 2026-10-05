// A tab that outlives a deploy.
//
// «لما بسيب الموقع مدة طويلة وأرجع بلاقى… Failed to fetch dynamically imported module». Every
// deploy renames the build's chunks — Vite puts a hash of each file's contents in its name — and
// the new container carries only the new names. A tab opened before the deploy is still running
// the OLD `index-*.js`, which knows only the OLD names, so the first screen it has not opened yet
// asks for a file that no longer exists anywhere and the screen dies. Coming back after a long
// absence is the usual way to meet it, because an absence is when deploys happen.
//
// Nothing in that tab can be repaired in place: the code it is running is the old build's. The
// cure is the one a person would reach for — load the page again, which brings the new shell and
// with it the new names — so this does it for them.
//
// ONCE. A chunk that is missing from the CURRENT build too (a broken deploy, a server that is
// down) fails again after the reload, and reloading on every failure would spin forever. So one
// automatic reload per tab within the cooldown, recorded where the reload cannot erase it; after
// that the ordinary error screen, whose button leaves the next attempt to the person.

/** What each browser says when a lazily-loaded chunk cannot be fetched or evaluated. */
const STALE_CHUNK_MESSAGES = [
  'Failed to fetch dynamically imported module', // Chromium
  'error loading dynamically imported module', // Firefox
  'Importing a module script failed', // Safari
  'Unable to preload CSS', // Vite's preload helper, for a stylesheet chunk
] as const;

/** True for the error a lazily-loaded chunk of an older build raises. */
export const isStaleBuildError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return STALE_CHUNK_MESSAGES.some((known) => message.includes(known));
};

/** Within this long of an automatic reload, another is refused. */
export const STALE_BUILD_RELOAD_COOLDOWN_MS = 60_000;

/** sessionStorage: per tab, and it survives the reload it is recording. */
const RELOADED_AT = 'ecms.staleBuild.reloadedAt';

/**
 * Whether this failure may reload the page — and, when it may, the record that it did.
 *
 * Fails closed. Without storage there is no way to know a reload already happened, so none is
 * attempted: an error screen with a button is a nuisance, a page that reloads forever is broken.
 */
export const mayReloadForNewBuild = (
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  now: number,
): boolean => {
  if (storage === null) return false;
  try {
    const last = Number(storage.getItem(RELOADED_AT));
    if (Number.isFinite(last) && last > 0 && now - last < STALE_BUILD_RELOAD_COOLDOWN_MS) {
      return false;
    }
    storage.setItem(RELOADED_AT, String(now));
    return true;
  } catch {
    return false;
  }
};

let reloading = false;

const sessionStore = (): Storage | null => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

/**
 * Reload into the current build when that is allowed. True while a reload is under way.
 *
 * Asked twice for one failure — by the `vite:preloadError` listener and by the error boundary
 * the same failure then reaches — so it is idempotent within a page: one reload, and the second
 * caller learns that one is already happening.
 */
export const reloadIntoNewBuild = (): boolean => {
  if (reloading) return true;
  if (!mayReloadForNewBuild(sessionStore(), Date.now())) return false;
  reloading = true;
  window.location.reload();
  return true;
};
