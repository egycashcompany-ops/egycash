// Every way a sign-in can fail, and the sentence each one earns.
//
// This is where the feature actually lives: the screen only prints what `loginFailureKey`
// returns, and there is no jsdom here to click a form with. So every branch is asserted by name,
// including the two that must NOT be told apart.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { translate } from '../localization/i18n';
import { loginFailureKey, LOGIN_FAILURE_KEYS } from './login-failure';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGIN_PAGE = readFileSync(resolve(HERE, 'LoginPage.tsx'), 'utf8');

/** What the api client throws: a class, but only these two fields are read. */
const apiError = (code: string, status = 401): unknown => ({ code, message: code, status });

describe('the server already said why, and now the screen says it too', () => {
  it.each([
    ['AUTH_ACCOUNT_LOCKED', 'platform.auth.login.locked'],
    ['AUTH_ACCOUNT_NOT_ACTIVATED', 'platform.auth.login.notActivated'],
    ['AUTH_ACCOUNT_NOT_ACTIVE', 'platform.auth.login.notActive'],
    ['AUTH_TOTP_INVALID', 'platform.auth.login.badCode'],
    ['AUTH_TOTP_REQUIRED', 'platform.auth.login.badCode'],
    ['RATE_LIMITED', 'platform.auth.login.tooMany'],
  ])('%s reads as its own reason', (code, key) => {
    expect(loginFailureKey(apiError(code), true)).toBe(key);
  });

  it('a 429 is «too many attempts» even if the code is one this does not know', () => {
    expect(loginFailureKey({ code: 'SOMETHING_NEW', status: 429 }, true)).toBe(
      'platform.auth.login.tooMany',
    );
  });

  it('any 5xx is the server’s fault, never phrased as the user’s', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(loginFailureKey({ code: 'INTERNAL', status }, true), String(status)).toBe(
        'platform.auth.login.serverDown',
      );
    }
  });
});

describe('a wrong password and an unknown account are ONE answer', () => {
  // The control this protects: `auth.service.login()` answers AUTH_INVALID_CREDENTIALS for an
  // unknown identifier, a wrong password, and an account whose password an administrator just
  // cleared. If the screen split them, anyone who can reach the login page could discover which
  // accounts exist — which is the list an attacker wants before they start.
  it('says the details are wrong without saying which half', () => {
    const key = loginFailureKey(apiError('AUTH_INVALID_CREDENTIALS'), true);
    expect(key).toBe('platform.auth.login.badCredentials');
    for (const locale of ['ar', 'en'] as const) {
      const text = translate(locale, key).toLowerCase();
      // No wording that confirms or denies the existence of an account.
      for (const leak of ['غير موجود', 'مش موجود', 'not found', 'no such', 'unknown user']) {
        expect(text, `${locale} must not reveal existence`).not.toContain(leak.toLowerCase());
      }
    }
  });

  it('still tells the person what to check', () => {
    // Vague about WHICH is wrong, specific about what to do — the previous «فشل تسجيل الدخول»
    // was neither.
    expect(translate('ar', 'platform.auth.login.badCredentials').length).toBeGreaterThan(40);
    expect(translate('en', 'platform.auth.login.badCredentials')).toContain('employee code');
  });
});

describe('when nothing came back at all', () => {
  it('names the connection when the browser knows it is offline', () => {
    expect(loginFailureKey(new TypeError('Failed to fetch'), false)).toBe(
      'platform.auth.login.offline',
    );
    // Offline wins over everything: a stale ApiError is not the story when the Wi-Fi is off.
    expect(loginFailureKey(apiError('AUTH_INVALID_CREDENTIALS'), false)).toBe(
      'platform.auth.login.offline',
    );
  });

  it('names the server when the connection is fine but the request died', () => {
    expect(loginFailureKey(new TypeError('Failed to fetch'), true)).toBe(
      'platform.auth.login.unreachable',
    );
  });

  it('treats a gateway’s HTML error page as a server problem, not a rejected password', () => {
    // `response.json()` throws a SyntaxError when a proxy answers with HTML — which used to read
    // to the user as though their password had been refused.
    expect(loginFailureKey(new SyntaxError('Unexpected token <'), true)).toBe(
      'platform.auth.login.serverDown',
    );
  });
});

describe('the fallback, and the wiring around it', () => {
  it('falls back to the generic line only for something genuinely unrecognised', () => {
    for (const odd of [null, undefined, 'a string', 42, {}, { code: 'NOPE', status: 418 }]) {
      expect(loginFailureKey(odd, true), JSON.stringify(odd) ?? 'undefined').toBe(
        'platform.auth.login.failed',
      );
    }
  });

  it('every key it can return is translated in ar and en', () => {
    for (const key of LOGIN_FAILURE_KEYS) {
      for (const locale of ['ar', 'en'] as const) {
        const text = translate(locale, key);
        // `translate` hands back the key itself when it has no entry, which on screen is a raw
        // `platform.auth.login.locked` where a sentence should be.
        expect(text, `${key} in ${locale}`).not.toBe(key);
        expect(text.trim().length, `${key} in ${locale}`).toBeGreaterThan(3);
      }
    }
  });

  it('is what the login screen actually uses, on both steps', () => {
    // A mapping nothing calls is a mapping that does not exist. Both the password step and the
    // two-factor step must go through it — the second one printed the generic line too.
    expect(LOGIN_PAGE.match(/loginFailureKey\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    // And it must be told whether the browser thinks it is online, or the offline case is dead.
    expect(LOGIN_PAGE).toContain('navigator.onLine');
  });
});
