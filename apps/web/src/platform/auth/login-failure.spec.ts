// Every way a sign-in can fail, and the sentence each one earns.
//
// This is where the feature actually lives: the screen only prints what `loginFailure` returns,
// and there is no jsdom here to click a form with. So every branch is asserted by name —
// including the two the owner asked to be told apart, which a previous version of this file
// asserted must NOT be.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { translate } from '../localization/i18n';
import { loginFailure, LOGIN_FAILURE_KEYS } from './login-failure';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGIN_PAGE = readFileSync(resolve(HERE, 'LoginPage.tsx'), 'utf8');
const AUTH_SERVICE = readFileSync(
  resolve(HERE, '../../../../api/src/platform/auth/auth.service.ts'),
  'utf8',
);

/** What the api client throws: a class, but only these fields are read. */
const apiError = (code: string, status = 401): unknown => ({ code, message: code, status });

describe('the two the owner asked to be named separately', () => {
  it('an unregistered identifier says so, and names all three things it may be', () => {
    expect(loginFailure(apiError('AUTH_IDENTIFIER_UNKNOWN'), true).key).toBe(
      'platform.auth.login.unknownIdentifier',
    );
    const ar = translate('ar', 'platform.auth.login.unknownIdentifier');
    expect(ar).toContain('لا يوجد حساب');
    // The first box takes any of three things, and a person who typed the wrong KIND needs to
    // know that as much as somebody who typed the wrong value.
    for (const kind of ['البريد الإلكتروني', 'اسم المستخدم', 'الكود الوظيفي']) {
      expect(ar, kind).toContain(kind);
    }
  });

  it('a wrong password says so, and warns that repeating it locks the account', () => {
    expect(loginFailure(apiError('AUTH_INVALID_CREDENTIALS'), true).key).toBe(
      'platform.auth.login.wrongPassword',
    );
    // The lock is real (`AUTH_ACCOUNT_LOCKED`), so meeting it should never be a surprise.
    expect(translate('ar', 'platform.auth.login.wrongPassword')).toContain('قفل الحساب');
    expect(translate('en', 'platform.auth.login.wrongPassword')).toContain('lock');
  });

  it('the SERVER is what tells them apart — the screen cannot invent the difference', () => {
    // Both used to arrive as AUTH_INVALID_CREDENTIALS, so this mapping would have been dead
    // code without the service change that goes with it.
    expect(AUTH_SERVICE).toContain('ErrorCodes.AUTH_IDENTIFIER_UNKNOWN');
    // And the reasoning for a decision this consequential is recorded beside it.
    expect(AUTH_SERVICE).toContain("strictLimit('auth-login')");
  });
});

describe('every other cause has its own sentence too', () => {
  it.each([
    ['AUTH_ACCOUNT_LOCKED', 'platform.auth.login.locked'],
    ['AUTH_ACCOUNT_NOT_ACTIVATED', 'platform.auth.login.notActivated'],
    ['AUTH_ACCOUNT_NOT_ACTIVE', 'platform.auth.login.notActive'],
    ['AUTH_TOTP_INVALID', 'platform.auth.login.badCode'],
    ['AUTH_TOTP_REQUIRED', 'platform.auth.login.badCode'],
    ['RATE_LIMITED', 'platform.auth.login.tooMany'],
  ])('%s reads as its own reason', (code, key) => {
    expect(loginFailure(apiError(code), true).key).toBe(key);
  });

  it('a 429 is «too many attempts» even under a code this does not know', () => {
    expect(loginFailure({ code: 'SOMETHING_NEW', status: 429 }, true).key).toBe(
      'platform.auth.login.tooMany',
    );
  });

  it('any 5xx is the server’s fault, never phrased as the person’s', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(loginFailure({ code: 'INTERNAL', status }, true).key, String(status)).toBe(
        'platform.auth.login.serverError',
      );
    }
  });
});

describe('when nothing came back at all', () => {
  it('names the connection when the browser knows it is offline', () => {
    expect(loginFailure(new TypeError('Failed to fetch'), false).key).toBe(
      'platform.auth.login.offline',
    );
    // Offline wins over everything: a stale server code is not the story when the Wi-Fi is off.
    expect(loginFailure(apiError('AUTH_INVALID_CREDENTIALS'), false).key).toBe(
      'platform.auth.login.offline',
    );
  });

  it('names the server when the connection is fine but the request died', () => {
    expect(loginFailure(new TypeError('Failed to fetch'), true).key).toBe(
      'platform.auth.login.unreachable',
    );
  });

  it('treats a gateway’s HTML error page as a server fault, not a rejected password', () => {
    // `response.json()` throws a SyntaxError when a proxy answers with HTML — which used to read
    // to the person as though their password had been refused.
    expect(loginFailure(new SyntaxError('Unexpected token <'), true).key).toBe(
      'platform.auth.login.serverError',
    );
  });
});

describe('even the last resort is not vague', () => {
  it('hands over the reference number the API returned', () => {
    const failure = loginFailure({ code: 'NOPE', status: 418, requestId: 'req_9f3a' }, true);
    expect(failure.key).toBe('platform.auth.login.unexpectedWithRef');
    expect(failure.params).toEqual({ requestId: 'req_9f3a' });
    for (const locale of ['ar', 'en'] as const) {
      expect(translate(locale, failure.key, failure.params)).toContain('req_9f3a');
    }
  });

  it('falls back to the plain sentence when there is no reference to give', () => {
    for (const odd of [null, undefined, 'a string', 42, {}, { code: 'NOPE', status: 418 }]) {
      expect(loginFailure(odd, true).key, JSON.stringify(odd) ?? 'undefined').toBe(
        'platform.auth.login.unexpected',
      );
    }
  });
});

describe('the wording, and the wiring around it', () => {
  it('every key it can return is translated in ar and en', () => {
    for (const key of LOGIN_FAILURE_KEYS) {
      for (const locale of ['ar', 'en'] as const) {
        const text = translate(locale, key);
        // `translate` hands back the key itself when it has no entry, which on screen is a raw
        // `platform.auth.login.locked` where a sentence should be.
        expect(text, `${key} in ${locale}`).not.toBe(key);
        expect(text.trim().length, `${key} in ${locale}`).toBeGreaterThan(20);
      }
    }
  });

  it('is written formally — no colloquial forms anywhere in these messages', () => {
    // «خلى الرسائل رسميه». These are the tells of the Egyptian register the earlier draft used,
    // and they have no place in a message the whole company reads.
    const colloquial = [' مش ', 'استنى', 'جرّب', 'كلّم', ' ده ', ' دي ', 'عشان', 'كمان'];
    for (const key of LOGIN_FAILURE_KEYS) {
      const ar = ` ${translate('ar', key)} `;
      for (const word of colloquial) {
        expect(ar, `${key} contains «${word.trim()}»`).not.toContain(word);
      }
    }
  });

  it('is what the login screen actually uses, on both steps', () => {
    // A mapping nothing calls is a mapping that does not exist. Both the password step and the
    // two-factor step must go through it — the second one printed the generic line too.
    expect(LOGIN_PAGE.match(/loginFailure\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    // And it must be told whether the browser thinks it is online, or the offline case is dead.
    expect(LOGIN_PAGE).toContain('navigator.onLine');
    // The reference number only reaches the screen if the params travel with the key.
    expect(LOGIN_PAGE).toContain('failure.params');
  });
});
