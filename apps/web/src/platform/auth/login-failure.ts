// Why the sign-in did not work, named precisely, in the register the rest of the product uses.
//
// The screen used to answer «فشل تسجيل الدخول» to everything: a mistyped address, a wrong
// password, a locked account, a suspended one, a dead connection, a server that was down. Most of
// those the SERVER had already named — `AUTH_IDENTIFIER_UNKNOWN`, `AUTH_ACCOUNT_LOCKED`,
// `AUTH_ACCOUNT_NOT_ACTIVE`, `RATE_LIMITED` and the rest — and the login screen read the code,
// ignored it, and printed the one generic line. This is the mapping it should have had.
//
// NOTHING HERE IS VAGUE, BY THE OWNER'S INSTRUCTION. An unknown identifier and a wrong password
// are two different sentences, not one. That was a deliberate merge once — answering identically
// meant nobody could discover which accounts exist by trying addresses at the login page — and
// the owner weighed it against staff who could not tell which of the two boxes they had got
// wrong, and decided. The trade-off, and what still limits the abuse (the route's ten-per-five-
// minutes rate limit, and an audit row for every attempt), is recorded where the server makes
// the decision, in `auth.service.login()`.
//
// Even the last-resort message names something: it carries the request id the API returned, so
// «حاول مرة أخرى» is not the end of the conversation with the support desk.
//
// Pure on purpose: there is no jsdom in this suite, so the decision lives here where every code
// can be asserted by name, and the screen only renders what it returns.

/** The shape this reads off an `ApiError` without importing it (it is a class; this is data). */
export interface FailureLike {
  code?: unknown;
  status?: unknown;
  requestId?: unknown;
}

/** What the screen needs to print one failure. */
export interface LoginFailure {
  key: string;
  /** Filled for the last-resort message only, where the reference number is the actionable part. */
  params?: Record<string, string>;
}

/** Every message this can ask for. The spec checks each one exists in ar and en. */
export const LOGIN_FAILURE_KEYS = [
  'platform.auth.login.unexpected',
  'platform.auth.login.unexpectedWithRef',
  'platform.auth.login.unknownIdentifier',
  'platform.auth.login.wrongPassword',
  'platform.auth.login.locked',
  'platform.auth.login.notActivated',
  'platform.auth.login.notActive',
  'platform.auth.login.badCode',
  'platform.auth.login.tooMany',
  'platform.auth.login.serverError',
  'platform.auth.login.offline',
  'platform.auth.login.unreachable',
] as const;

const BY_CODE: Readonly<Record<string, string>> = {
  // The two the owner asked to be told apart.
  AUTH_IDENTIFIER_UNKNOWN: 'platform.auth.login.unknownIdentifier',
  AUTH_INVALID_CREDENTIALS: 'platform.auth.login.wrongPassword',

  AUTH_ACCOUNT_LOCKED: 'platform.auth.login.locked',
  AUTH_ACCOUNT_NOT_ACTIVATED: 'platform.auth.login.notActivated',
  AUTH_ACCOUNT_NOT_ACTIVE: 'platform.auth.login.notActive',
  AUTH_TOTP_INVALID: 'platform.auth.login.badCode',
  AUTH_TOTP_REQUIRED: 'platform.auth.login.badCode',
  RATE_LIMITED: 'platform.auth.login.tooMany',
};

/** The last resort, which still hands over a reference number when the API sent one. */
const unexpected = (requestId: unknown): LoginFailure =>
  typeof requestId === 'string' && requestId !== ''
    ? { key: 'platform.auth.login.unexpectedWithRef', params: { requestId } }
    : { key: 'platform.auth.login.unexpected' };

/**
 * Why this sign-in attempt failed.
 *
 * `online` is passed in rather than read from `navigator` so this stays a pure function: the
 * screen hands it `navigator.onLine`, the tests hand it either answer. It matters because a dead
 * connection and an unreachable server are indistinguishable to `fetch` and need opposite
 * instructions — telling somebody to check a connection that is working wastes their time.
 */
export const loginFailure = (error: unknown, online: boolean): LoginFailure => {
  // NOTHING CAME BACK. `fetch` rejects with a TypeError for a dead connection, a refused socket
  // and a DNS failure alike, so the browser's own idea of being online is what separates them.
  if (!online) return { key: 'platform.auth.login.offline' };
  if (error instanceof TypeError) return { key: 'platform.auth.login.unreachable' };

  // SOMETHING CAME BACK, BUT NOT OURS. `response.json()` throws a SyntaxError when a proxy or a
  // restarting container answers with an HTML error page instead of the API envelope. That is a
  // server fault, and must not read to the person as though their password had been refused.
  if (error instanceof SyntaxError) return { key: 'platform.auth.login.serverError' };

  if (typeof error !== 'object' || error === null) return unexpected(undefined);
  const { code, status, requestId } = error as FailureLike;

  if (typeof code === 'string' && code in BY_CODE) {
    const key = BY_CODE[code];
    if (key !== undefined) return { key };
  }
  // A 5xx is the server's fault whatever it called the code, so it never reads as the person's.
  if (typeof status === 'number' && status >= 500) return { key: 'platform.auth.login.serverError' };
  if (status === 429) return { key: 'platform.auth.login.tooMany' };

  return unexpected(requestId);
};
