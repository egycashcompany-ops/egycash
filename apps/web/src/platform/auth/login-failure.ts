// Why the sign-in did not work, in words the person can act on.
//
// The screen used to say «فشل تسجيل الدخول» to everything — a wrong password, a suspended
// account, a locked one, a dead Wi-Fi, a server that was down. One sentence for six situations,
// five of which the SERVER had already named: the API answers `AUTH_ACCOUNT_LOCKED`,
// `AUTH_ACCOUNT_NOT_ACTIVE`, `RATE_LIMITED` and the rest, and the login screen threw the code
// away and printed the generic line. This is the mapping it should have had.
//
// ONE THING STAYS DELIBERATELY VAGUE, and it is not an oversight. «هذا البريد غير موجود» and
// «كلمة المرور غير صحيحة» are the same answer here, because telling them apart tells ANYBODY who
// can reach the login page which accounts exist. That is how an attacker builds a list of real
// employees to attack, and it is why `auth.service.login()` answers `AUTH_INVALID_CREDENTIALS`
// for an unknown identifier, a wrong password and an account whose password was just cleared by
// an administrator — three different truths, one answer, on purpose.
//
// What CAN be improved without leaking is the wording: «البيانات غير صحيحة» plus a reminder of
// what may be typed in the first box beats «فشل تسجيل الدخول», and helps the honest person who
// typed their email into a system expecting their employee code.
//
// Pure on purpose: there is no jsdom in this suite, so the decision lives here where it can be
// tested against every code, and the screen only renders what it returns.

/** The shape this reads off an `ApiError` without importing it (it is a class, this is data). */
export interface FailureLike {
  code?: unknown;
  status?: unknown;
}

/** Every message this can ask for. The guard spec checks each one exists in ar and en. */
export const LOGIN_FAILURE_KEYS = [
  'platform.auth.login.failed',
  'platform.auth.login.badCredentials',
  'platform.auth.login.locked',
  'platform.auth.login.notActivated',
  'platform.auth.login.notActive',
  'platform.auth.login.badCode',
  'platform.auth.login.tooMany',
  'platform.auth.login.serverDown',
  'platform.auth.login.offline',
  'platform.auth.login.unreachable',
] as const;

const BY_CODE: Readonly<Record<string, string>> = {
  // Three different truths, one answer — see the note at the top of this file.
  AUTH_INVALID_CREDENTIALS: 'platform.auth.login.badCredentials',
  AUTH_ACCOUNT_LOCKED: 'platform.auth.login.locked',
  AUTH_ACCOUNT_NOT_ACTIVATED: 'platform.auth.login.notActivated',
  AUTH_ACCOUNT_NOT_ACTIVE: 'platform.auth.login.notActive',
  AUTH_TOTP_INVALID: 'platform.auth.login.badCode',
  AUTH_TOTP_REQUIRED: 'platform.auth.login.badCode',
  RATE_LIMITED: 'platform.auth.login.tooMany',
};

/**
 * The message key for a failed sign-in attempt.
 *
 * `online` is passed in rather than read from `navigator` so this stays a pure function: the
 * caller hands it `navigator.onLine`, the tests hand it either answer. It matters because the two
 * failures look identical to `fetch` and need opposite advice — «شوف النت بتاعك» is useless to
 * somebody whose connection is fine and whose server is down.
 */
export const loginFailureKey = (error: unknown, online: boolean): string => {
  // NOTHING CAME BACK. `fetch` rejects with a TypeError for a dead connection, a refused socket
  // and a DNS failure alike, so the browser's own idea of being online is what separates them.
  if (!online) return 'platform.auth.login.offline';
  if (error instanceof TypeError) return 'platform.auth.login.unreachable';

  // SOMETHING CAME BACK, BUT NOT OURS. `response.json()` throws a SyntaxError when a proxy or a
  // restarting container answers with an HTML error page instead of the API envelope — which is
  // a server problem, and reads to the user as one rather than as a rejected password.
  if (error instanceof SyntaxError) return 'platform.auth.login.serverDown';

  if (typeof error !== 'object' || error === null) return 'platform.auth.login.failed';
  const { code, status } = error as FailureLike;

  if (typeof code === 'string' && code in BY_CODE) {
    return BY_CODE[code] ?? 'platform.auth.login.failed';
  }
  // A 5xx is the server's fault whatever it called the code, so it never reads as the user's.
  if (typeof status === 'number' && status >= 500) return 'platform.auth.login.serverDown';
  if (status === 429) return 'platform.auth.login.tooMany';

  return 'platform.auth.login.failed';
};
