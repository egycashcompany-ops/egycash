// The parts of the inactivity rule that are wiring rather than arithmetic.
//
// The arithmetic is `idle-session.spec.ts`. What is left is the things a pure function cannot
// hold and a DOM-less suite cannot click: that the dialog's words exist in BOTH languages, that
// the guard is actually mounted on the signed-in route, and — the one worth a test of its own —
// that the browser's countdown is fed by the server rather than by a number written here.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { translate } from '../localization/i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(resolve(HERE, path), 'utf8');

const GUARD = read('IdleSessionGuard.tsx');
const REQUIRE_AUTH = read('../router/RequireAuth.tsx');
const API_CLIENT = read('../../shared/lib/api-client.ts');
const AUTH_API = read('api.ts');

describe('the inactivity dialog speaks both languages', () => {
  const KEYS = [
    'auth.idle.warningTitle',
    'auth.idle.warningBody',
    'auth.idle.warningHint',
    'auth.idle.staySignedIn',
    'auth.idle.signOutNow',
    'auth.idle.signedOutNotice',
  ];

  it.each(KEYS)('%s is translated in ar and en', (key) => {
    for (const locale of ['ar', 'en'] as const) {
      const text = translate(locale, key);
      // `translate` hands back the KEY when it has no entry, which on screen is the raw
      // `auth.idle.warningTitle` a user once met on a recruitment badge.
      expect(text, `${key} in ${locale}`).not.toBe(key);
      expect(text.trim()).not.toBe('');
    }
  });

  it('counts the seconds down in the sentence itself, in both languages', () => {
    expect(translate('en', 'auth.idle.warningBody', { seconds: 42 })).toContain('42');
    expect(translate('ar', 'auth.idle.warningBody', { seconds: 42 })).toContain('42');
  });

  it('every key the dialog asks for is one of the keys above', () => {
    const asked = [...GUARD.matchAll(/t\('(auth\.idle\.[a-zA-Z.]+)'/g)].map((m) => m[1]);
    expect(asked.length).toBeGreaterThan(0);
    for (const key of asked) expect(KEYS).toContain(key);
  });
});

describe('the guard is wired where a session exists', () => {
  it('is mounted on the signed-in branch of the route guard', () => {
    expect(REQUIRE_AUTH).toContain('IdleSessionGuard');
    // AFTER the redirect and the first-login gate: mounting it above them would start counting
    // for somebody who is not signed in at all.
    const mount = REQUIRE_AUTH.indexOf('<IdleSessionGuard>');
    expect(mount).toBeGreaterThan(REQUIRE_AUTH.indexOf("Navigate to=\"/login\""));
    expect(mount).toBeGreaterThan(REQUIRE_AUTH.indexOf('ForcePasswordChangePage />'));
  });

  it('sends the person to the sign-in screen with a reason, not a bare form', () => {
    expect(GUARD).toContain("'/login?reason=idle'");
  });
});

describe('the window is the SERVER’s number', () => {
  it('is read from the api client, never hard-coded in the component', () => {
    expect(GUARD).toContain('getIdleMinutes()');
    // A literal window here would drift from `SESSION_IDLE_MINUTES` the first time an operator
    // changed it, and the two failure modes are both bad: signing a live session out, or leaving
    // a dead one on screen until the next save fails.
    expect(GUARD).not.toMatch(/idleM(s|inutes)\s*=\s*\d/);
  });

  it('is relearned on every renewal and at every way in', () => {
    // The refresh response carries it, so a deployment that changes the number is obeyed within
    // one cycle rather than at the next full page load.
    expect(API_CLIENT).toContain('setIdleMinutes(data.idleMinutes)');
    // …and login, TOTP and the portal all learn it at the same moment they learn the token.
    expect(AUTH_API.match(/setIdleMinutes\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it('renews through the shared single-flight, so it cannot race the lazy refresh', () => {
    // Two rotations of a single-use refresh token read as replay server-side, which revokes the
    // session — the exact opposite of what this feature is for.
    expect(GUARD).toContain('renewSession()');
    expect(API_CLIENT).toContain('export const renewSession = (): Promise<boolean> => tryRefresh()');
  });
});
