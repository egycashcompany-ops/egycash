/*
 * The ECMS service worker.
 *
 * WHY IT EXISTS. Chrome will only offer "Install as app" — a real app window rather than a
 * shortcut — for a page that carries a web app manifest, and it only offers the install PROMPT
 * for one whose service worker has a fetch handler. This is that fetch handler. The manifest
 * beside it (`manifest.webmanifest`) is what makes the menu entry appear at all.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. ECMS is an authenticated, permission-scoped system that is
 * useless without the server: every screen is server data, narrowed by who is asking. So this
 * worker caches NO response from the API. Not with a short TTL, not "just the GETs" — none. A
 * cached API response is one user's data sitting in a shared browser profile, and a stale one is
 * an RBAC decision the server has since changed. Requests it does not name below are never
 * answered from cache; they are not intercepted at all and go straight to the network.
 *
 * WHAT IT CACHES, AND WHY THAT IS SAFE.
 *   • The HTML shell — NETWORK FIRST. It holds no user data (it is the same bytes for everybody),
 *     and going to the network first means a deploy is live on the very next load, exactly as the
 *     `no-cache` header on it already guarantees. The copy in the cache answers only when the
 *     network does not, which is what lets the installed app open offline instead of erroring.
 *   • The build's `/assets/` output — CACHE FIRST. Vite content-hashes those filenames, so a name
 *     that hits is the same bytes forever and a new build asks for new names.
 *
 * Everything is keyed off `registration.scope`, so a subpath deployment (VITE_BASE_PATH) works
 * with nothing to configure: the worker at /ecms/sw.js scopes, caches and matches under /ecms/.
 */

const VERSION = 'ecms-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

/** The deployment root: '/' normally, '/ecms/' under a BASE_PATH. */
const BASE = new URL(self.registration.scope).pathname;

/** The one navigation entry every route falls back to — this is an SPA. */
const SHELL_URL = BASE;

/** Paths the worker must never touch: the API and the platform health probes. */
const isReserved = (pathname) =>
  pathname.startsWith(`${BASE}api/`) || pathname.startsWith(`${BASE}health/`) || pathname.startsWith('/health/');

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // `reload` so installing a new worker re-reads the shell from the network rather than
      // adopting whatever the HTTP cache happens to be holding.
      .then((cache) => cache.add(new Request(SHELL_URL, { cache: 'reload' })))
      // Taking over immediately is safe here precisely BECAUSE the shell is network-first and the
      // assets are content-hashed: there is no stale answer for the new worker to start serving.
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

const networkFirstShell = async (request) => {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      const cache = await caches.open(SHELL_CACHE);
      // Stored under the shell's own URL, not the deep link's: every route renders from this one
      // document, so one entry answers /employees and /payroll/runs alike.
      await cache.put(SHELL_URL, copy);
    }
    return response;
  } catch (networkError) {
    const cached = await caches.match(SHELL_URL, { cacheName: SHELL_CACHE });
    if (cached !== undefined) return cached;
    throw networkError;
  }
};

const cacheFirstAsset = async (request) => {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  if (hit !== undefined) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isReserved(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request));
    return;
  }

  if (url.pathname.startsWith(`${BASE}assets/`)) {
    event.respondWith(cacheFirstAsset(request));
  }
});
