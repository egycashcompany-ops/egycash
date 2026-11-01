// Why a fingerprint / Face ID attempt did not work, as a message — or nothing, when there is
// nothing to say (ADR-035).
//
// Two kinds of failure reach here. The DEVICE's: the person cancelled the prompt, the device has no
// passkey for this site, or it is already registered — these arrive as DOM errors (re-thrown by the
// browser library with a `code`). The SERVER's: a passkey it would not accept, the feature switched
// off, the account not allowed — these are `ApiError`s with our codes. Anything else is a sign-in
// failure like any other, and `loginFailure` already names those precisely.
//
// Pure on purpose, like `loginFailure`: no browser library import, no `navigator`, so every branch
// is asserted by name in node.
import { loginFailure, type LoginFailure } from './login-failure';

/** Every message this can ask for. The spec checks each one exists in ar and en. */
export const PASSKEY_FAILURE_KEYS = [
  'platform.auth.passkey.invalid',
  'platform.auth.passkey.expired',
  'platform.auth.passkey.disabled',
  'platform.auth.passkey.notAllowed',
  'platform.auth.passkey.limit',
  'platform.auth.passkey.alreadyAdded',
  'platform.auth.passkey.cancelled',
  'platform.auth.passkey.deviceFailed',
] as const;

const BY_SERVER_CODE: Readonly<Record<string, string>> = {
  AUTH_PASSKEY_INVALID: 'platform.auth.passkey.invalid',
  AUTH_PASSKEY_EXPIRED: 'platform.auth.passkey.expired',
  AUTH_PASSKEYS_DISABLED: 'platform.auth.passkey.disabled',
  AUTH_PASSKEY_NOT_ALLOWED: 'platform.auth.passkey.notAllowed',
  AUTH_PASSKEY_LIMIT: 'platform.auth.passkey.limit',
};

/** The names the WebAuthn spec gives the device's refusals (DOMException names). */
const DEVICE_ERRORS = new Set([
  'AbortError',
  'ConstraintError',
  'InvalidStateError',
  'NotAllowedError',
  'NotSupportedError',
  'SecurityError',
  'UnknownError',
]);

const field = (error: unknown, name: string): unknown =>
  typeof error === 'object' && error !== null
    ? (error as Record<string, unknown>)[name]
    : undefined;

/**
 * Why this attempt failed.
 *
 * Null means say nothing: the prompt was withdrawn by the page itself (another attempt started, or
 * the page closed), which the person never saw as a failure. The autofill suggestion's own device
 * errors never reach here at all — it runs in the background whether or not anybody looks at it —
 * only the server's answer once the person has picked a passkey.
 */
export const passkeyFailure = (error: unknown, online: boolean): LoginFailure | null => {
  const name = field(error, 'name');
  const code = field(error, 'code');

  // The page withdrew the prompt: a new attempt replaced it, or the person left. Never a message.
  if (name === 'AbortError' || code === 'ERROR_CEREMONY_ABORTED') return null;

  if (typeof code === 'string' && BY_SERVER_CODE[code] !== undefined) {
    return { key: BY_SERVER_CODE[code] };
  }
  if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
    return { key: 'platform.auth.passkey.alreadyAdded' };
  }
  if (typeof name === 'string' && DEVICE_ERRORS.has(name)) {
    // The person closed the prompt, let it time out, or has no passkey for this site on this
    // device. The browser does not say which — on purpose — so neither can we; the sentence
    // covers all three without blaming anyone.
    return name === 'NotAllowedError'
      ? { key: 'platform.auth.passkey.cancelled' }
      : { key: 'platform.auth.passkey.deviceFailed' };
  }
  return loginFailure(error, online);
};
