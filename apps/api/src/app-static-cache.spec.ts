// Which files of the web bundle this process lets a browser freeze, and which it makes it
// revalidate.
//
// WHY A TEST. The static middleware serves the whole bundle with `max-age=1y, immutable` and then
// carves exceptions out in `setHeaders`. `immutable` is a promise the SERVER cannot take back: a
// browser holding one is entitled to never ask again, so a file that gets the header wrongly is
// not fixed by the next deploy, or the one after. That failure is invisible from here — the
// server keeps serving the right bytes to anyone who asks, and the affected browsers never ask.
//
// It became load-bearing with the installable-app work (`apps/web/public/sw.js`): a service
// worker frozen for a year would keep running the fetch and caching rules of whatever deploy a
// browser met first, and a service worker is precisely the thing you cannot correct from the
// server afterwards.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { answersWithShell, isHashedAsset } from './app';

/** How express.static addresses a file: an absolute path under the bundle root. */
const inBundle = (...segments: string[]): string => path.join(path.sep, 'srv', 'web', ...segments);

describe('the build’s hashed output may be frozen', () => {
  it('recognises a hashed script and stylesheet', () => {
    // Vite puts the content hash in the NAME, so these bytes can never change under this URL.
    expect(isHashedAsset(inBundle('assets', 'index-CsOY0Zb2.js'))).toBe(true);
    expect(isHashedAsset(inBundle('assets', 'index-D4n1ElSg.css'))).toBe(true);
  });

  it('recognises a lazily-loaded route chunk and a hashed font', () => {
    expect(isHashedAsset(inBundle('assets', 'routes-HOyyI5a_.js'))).toBe(true);
    expect(isHashedAsset(inBundle('assets', 'Cairo-BXn9K2Qd.woff2'))).toBe(true);
  });
});

describe('everything with a stable name must revalidate', () => {
  // Each of these keeps its name across every deploy, so `immutable` would pin a browser to the
  // first copy it ever downloaded.
  it.each([
    ['the HTML shell', ['index.html']],
    ['the service worker', ['sw.js']],
    ['the web app manifest', ['manifest.webmanifest']],
    ['an app icon', ['icons', 'icon-512.png']],
    ['the apple touch icon', ['apple-touch-icon.png']],
  ])('does not freeze %s', (_what, segments) => {
    expect(isHashedAsset(inBundle(...segments))).toBe(false);
  });

  it('does not mistake a file merely NAMED like the assets directory', () => {
    // `assets` has to be a path SEGMENT. A file called `assets.js`, or a route chunk for an
    // "assets" screen, is not build output and must not inherit its caching.
    expect(isHashedAsset(inBundle('assets.js'))).toBe(false);
    expect(isHashedAsset(inBundle('my-assets', 'thing.js'))).toBe(false);
  });
});

// «لما بسيب الموقع مدة طويلة وأرجع… Failed to fetch dynamically imported module». A tab opened
// before a deploy asks for a chunk the OLD build named, which the new container does not have.
// The SPA fallback used to answer that with the HTML shell and a 200 — a web page handed over as a
// script, which the browser rejects without an honest reason and a cache-first service worker can
// file under the chunk's name for good.
describe('which unmatched GETs get the HTML shell', () => {
  it('every client route does — a deep link or a refresh renders the app', () => {
    for (const route of ['/', '/employees', '/employees/42', '/fleet/vehicles', '/login']) {
      expect(answersWithShell(route, ''), route).toBe(true);
    }
  });

  it('a missing build file does not: it is a 404, so the import fails at once and is never cached', () => {
    expect(answersWithShell('/assets/routes-Mp_nHbTf.js', '')).toBe(false);
    expect(answersWithShell('/assets/index-D4n1ElSg.css', '')).toBe(false);
  });

  it('nor does the API or a health probe, as before', () => {
    expect(answersWithShell('/api/v1/hr/employees', '')).toBe(false);
    expect(answersWithShell('/health/ready', '')).toBe(false);
  });

  it('under a subpath deployment, the same rules at the prefix', () => {
    expect(answersWithShell('/ecms/employees', '/ecms')).toBe(true);
    expect(answersWithShell('/ecms', '/ecms')).toBe(true);
    expect(answersWithShell('/ecms/assets/routes-Mp_nHbTf.js', '/ecms')).toBe(false);
    expect(answersWithShell('/ecms/api/v1/x', '/ecms')).toBe(false);
    // And nothing outside the prefix is this app's to answer.
    expect(answersWithShell('/employees', '/ecms')).toBe(false);
  });

  it('does not mistake a route merely NAMED like the assets directory', () => {
    // `assets` has to be the build directory under the base — the IT module's asset register
    // (`/it/assets`) is a client route, and it must keep rendering.
    expect(answersWithShell('/it/assets', '')).toBe(true);
    expect(answersWithShell('/it/assets/123', '')).toBe(true);
  });
});
