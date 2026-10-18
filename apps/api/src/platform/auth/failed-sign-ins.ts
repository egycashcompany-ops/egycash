// Failed sign-ins per client address (API Standards §9).
//
// The sign-in tells an unknown identifier apart from a wrong password (an owner decision, see
// `authService.login`), and its per-account limit gives every guessed identifier a fresh bucket.
// Without a limit on the ADDRESS, one machine could test identifiers or spray passwords across
// accounts up to the generous per-IP ceiling. This limit counts only the sign-ins that fail, so an
// office signing in together after an idle sign-out is not held back by it.
//
// THE PRICE: anyone who shares the address — a colleague, a guest on the office Wi-Fi, malware on
// one PC — can use the limit up on purpose with 30 wrong sign-ins, and then every sign-in from that
// address is refused, correct passwords included, until the five-minute slot ends. The limit it
// replaced (ten sign-in attempts of any kind per address) allowed the same, more cheaply. Keying
// known browsers by a device cookie instead of the address would remove it; that is not built.
import { ErrorCodes } from '@ecms/contracts';
import { env } from '../../infrastructure/config/env';
import { logger } from '../../infrastructure/logging/logger';
import { startCountedAttempt } from '../../infrastructure/redis/rate-limiter';
import { RateLimitedError, UnauthenticatedError } from '../../shared/errors';

/** Length of the window, in seconds. The windows are fixed five-minute slots of the clock. */
export const FAILED_SIGN_IN_WINDOW_SECONDS = 300;

/**
 * The refusals that count: an unknown identifier and a wrong password (which includes an account
 * whose password an admin cleared, because it answers exactly like a wrong password).
 *
 * A locked, not-yet-activated or suspended account does not count. Those answers come before any
 * password is checked, so they test nothing; and counting them would let somebody who locks a few
 * colleagues' accounts turn the colleagues' own retries into a block on their whole office.
 */
const COUNTED_REFUSALS: ReadonlySet<string> = new Set([
  ErrorCodes.AUTH_IDENTIFIER_UNKNOWN,
  ErrorCodes.AUTH_INVALID_CREDENTIALS,
]);

export const isFailedSignIn = (error: unknown): boolean =>
  error instanceof UnauthenticatedError && COUNTED_REFUSALS.has(error.code);

/**
 * Run one sign-in under the limit. Refused with a 429 before anything is checked once `address`
 * has failed `AUTH_FAILED_LOGIN_LIMIT_PER_IP` times in the current 5-minute window, even when the
 * password would have been right.
 */
export const withFailedSignInLimit = async <T>(
  address: string,
  signIn: () => Promise<T>,
): Promise<T> => {
  const attempt = await startCountedAttempt(
    {
      name: 'auth-login-failed-ip',
      windowSeconds: FAILED_SIGN_IN_WINDOW_SECONDS,
      max: env.AUTH_FAILED_LOGIN_LIMIT_PER_IP,
    },
    address,
  );
  if (!attempt.allowed) throw new RateLimitedError(attempt.retryAfter);
  let failed = false;
  try {
    return await signIn();
  } catch (error) {
    failed = isFailedSignIn(error);
    throw error;
  } finally {
    // The answer to the person stands either way. If the slot cannot be handed back, the attempt
    // simply counts as a failure until the window ends.
    await attempt.settle(failed).catch((error: unknown) => {
      logger.warn({ err: error }, 'failed sign-in limit: could not hand a slot back');
    });
  }
};
