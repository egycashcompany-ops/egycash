// The bell→API seam, checked against the API itself.
//
// WHY THIS EXISTS. The inbox shipped calling `/notifications` while the router is mounted at
// `/platform/notifications`. Every call 404'd, every query rejected, and the bell rendered its
// empty state — which is EXACTLY what it renders when there is genuinely nothing waiting. So the
// bug looked identical to correct behaviour from the outside, typechecked perfectly, passed lint,
// passed the component test (which seeds the cache and never touches the network), and could only
// ever be reported as "the notifications still don't show".
//
// A wrong path is not a kind of bug review catches. It is caught by comparing the two sources, and
// that needs no database, no server and no network — just both files.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_SRC = resolve(HERE, '../../../../api/src');
const read = (path: string): string => readFileSync(resolve(API_SRC, path), 'utf8');

/**
 * Source with comments removed.
 *
 * Prose naming the wrong path — the comment on `BASE` explaining what it is NOT — is not a call to
 * it, and a check that cannot tell the difference fails on the very documentation that prevents
 * the bug.
 */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const CLIENT = readFileSync(resolve(HERE, 'notification-api.ts'), 'utf8');
const BELL = readFileSync(resolve(HERE, 'NotificationBell.tsx'), 'utf8');
const INBOX = readFileSync(resolve(HERE, 'pages/NotificationsInboxPage.tsx'), 'utf8');
const ROUTES = read('platform/notifications/notification.routes.ts');
const APP = read('app.ts');

/** The verb+path pairs a router declares, e.g. `post /:id/read`. */
const declared = (routes: string): Set<string> => {
  const found = new Set<string>();
  for (const match of routes.matchAll(/router\.(get|post|patch|delete)\(\s*'([^']+)'/g)) {
    found.add(`${match[1]} ${match[2]}`);
  }
  return found;
};

describe('the inbox client targets endpoints the API actually serves', () => {
  it('uses the prefix app.ts mounts the router at', () => {
    // The whole bug, in one assertion.
    expect(APP).toContain("'/platform/notifications'");
    expect(CLIENT).toContain("const BASE = '/platform/notifications'");
  });

  it('does not call the unmounted bare prefix', () => {
    // `/notifications` is a real CLIENT route (the inbox page) and a wrong API path, which is
    // precisely why the mistake was easy to make and impossible to see.
    // Matched with a closing quote or a slash, not just a slash: the bug was `'/notifications'`
    // with no trailing segment, which a pattern requiring one walks straight past.
    expect(code(CLIENT)).not.toMatch(/['"`]\/notifications['"`/]/);
  });

  it.each([
    ['get', '/unread-count'],
    ['get', '/'],
    ['post', '/read-all'],
    ['post', '/:id/read'],
    ['delete', '/:id'],
  ])('%s %s is declared by the router', (verb, path) => {
    expect(declared(ROUTES)).toContain(`${verb} ${path}`);
  });
});

describe('nothing reaches past the client', () => {
  it.each([
    ['the bell', BELL],
    ['the inbox page', INBOX],
  ])('%s calls the API only through notification-api', (_what, source) => {
    // A component that builds its own URL is a second place for the prefix to be wrong, and it
    // would not be covered by the assertions above.
    expect(source).not.toMatch(/\bget<|\bpost<|\bdel<|\bgetPage</);
    expect(source).not.toContain('/platform/');
  });
});
