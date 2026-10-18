// Auth endpoints — the only routes with the `/api/v1/auth` shortcut prefix
// (Naming Conventions §4). Strict Redis-backed rate limits (API Standards §9).
import { type Request, Router } from 'express';
import { asyncHandler } from '../../infrastructure/http/async-handler';
import { validate } from '../../infrastructure/http/validate';
import { env } from '../../infrastructure/config/env';
import { hashedKey, rateLimit } from '../../infrastructure/redis/rate-limiter';
import {
  ActivateAccountSchema,
  ChangePasswordSchema,
  CompletePortalChallengeSchema,
  EnrollChallengeBodySchema,
  LoginSchema,
  SessionIdParamSchema,
  StartPortalChallengeSchema,
  TotpChallengeSchema,
  TotpVerifySchema,
  UpdateMyPreferencesSchema,
} from './auth.validation';
import {
  activate,
  changePassword,
  completePortalChallenge,
  startPortalChallenge,
  listSessions,
  login,
  logout,
  me,
  refresh,
  revokeSession,
  totpChallenge,
  totpDisable,
  totpEnroll,
  totpEnrollWithChallenge,
  getPasswordPolicy,
  totpVerify,
  updateMyPreferences,
} from './auth.controller';
import { authenticate } from './auth.middleware';
import { verifiedChallengeClaims } from './auth.service';

const WINDOW_SECONDS = 300;

/** 10 per 5 minutes per client IP — for surfaces used from the caller's own connection. */
const strictLimit = (name: string) => rateLimit({ name, windowSeconds: WINDOW_SECONDS, max: 10 });

// Per-IP limits alone cap a whole office: everyone behind one office NAT shares the bucket, so a
// per-IP 60 renewals and 10 sign-ins per 5 minutes was a ceiling on how many people could work
// from one place at all — and a refused renewal signs the person out. Every staff-facing route
// below therefore carries TWO limits: a strict one on the thing that is actually being guessed or
// replayed (the account, the one-time token, the session), and a generous per-IP ceiling
// (env.AUTH_*_RATE_LIMIT_PER_IP) that still stops one machine from spraying many of them. Two of
// the strict limits live where their subject is known: failed sign-ins per address in the login
// controller (failed-sign-ins.ts), renewals per session in `authService.refresh`.
const perIpCeiling = (name: string, max: number) =>
  rateLimit({ name: `${name}-ip`, windowSeconds: WINDOW_SECONDS, max });

const perSubject = (name: string, max: number, keyOf: (req: Request) => string | null) =>
  rateLimit({ name, windowSeconds: WINDOW_SECONDS, max, keyOf });

const bodyString = (req: Request, field: string): string | null => {
  const value = (req.body as Record<string, unknown> | undefined)?.[field];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
};

/** The account a sign-in names, as the login itself reads it: identifier first, then e-mail. */
const accountKey = (req: Request): string | null => {
  const named = bodyString(req, 'identifier') ?? bodyString(req, 'email');
  return named === null ? null : hashedKey(named.trim().toLowerCase());
};

/** A one-time token in the body (setup link) — each token is its own bucket. */
const tokenKey =
  (field: string) =>
  (req: Request): string | null => {
    const token = bodyString(req, field);
    return token === null ? null : hashedKey(token);
  };

/**
 * The ACCOUNT a TOTP challenge token was issued to. A guessed code is aimed at the account's TOTP
 * secret, and every password sign-in mints a new token, so a bucket per token would hand out a
 * fresh set of guesses with each sign-in. The token is verified, not just decoded, so a forged one
 * naming somebody else cannot use up their guesses; one that does not verify gets a bucket of its
 * own, and the route refuses it anyway.
 *
 * The two kinds of bucket hash under different prefixes, so no string sent as a token can land in
 * an account's bucket: a raw `account:<id>` is hashed as `token:account:<id>`.
 */
const challengeAccountKey = (req: Request): string | null => {
  const token = bodyString(req, 'challengeToken');
  if (token === null) return null;
  const claims = verifiedChallengeClaims(token);
  return claims === null ? hashedKey(`token:${token}`) : hashedKey(`account:${claims.sub}`);
};

/** The caller's bearer token, for the one authenticated route limited before `authenticate`. */
const bearerKey = (req: Request): string | null => {
  const header = req.get('authorization');
  return header === undefined || header === '' ? null : hashedKey(header);
};

export const buildAuthRouter = (): Router => {
  const router = Router();
  const authIpMax = env.AUTH_RATE_LIMIT_PER_IP;

  // FIX-2. Unauthenticated by design — see the controller. Limited so it cannot be used as a
  // free-running probe, but per IP and generously: it answers the same thing to everyone, and the
  // activation and password-change screens of a whole office ask for it.
  router.get(
    '/password-policy',
    rateLimit({ name: 'auth-password-policy', windowSeconds: WINDOW_SECONDS, max: 120 }),
    asyncHandler(getPasswordPolicy),
  );

  // 10 attempts per ACCOUNT, on top of the account lockout (5 wrong passwords lock it for 15
  // minutes), and a ceiling per IP for one machine trying many accounts. The controller also
  // limits FAILED sign-ins per IP (env.AUTH_FAILED_LOGIN_LIMIT_PER_IP), which is what bounds
  // testing which identifiers exist and spraying one password across many accounts.
  router.post(
    '/login',
    perIpCeiling('auth-login', authIpMax),
    perSubject('auth-login', 10, accountKey),
    validate({ body: LoginSchema }),
    asyncHandler(login),
  );
  // The applicant portal's sign-in (P-HR-APP §4). Under `/auth` on purpose: an external account
  // may reach this router by construction, which is what lets a candidate sign in at all.
  // Per IP: candidates and portal customers sign in from their own connections, not from one
  // office, and the challenge itself is also limited per account by its own rules.
  router.post(
    '/portal/challenge',
    strictLimit('auth-portal-challenge'),
    validate({ body: StartPortalChallengeSchema }),
    asyncHandler(startPortalChallenge),
  );
  router.post(
    '/portal/verify',
    strictLimit('auth-portal-verify'),
    validate({ body: CompletePortalChallengeSchema }),
    asyncHandler(completePortalChallenge),
  );
  // 10 codes per ACCOUNT per 5 minutes, however many times the password is entered to get new
  // challenge tokens.
  router.post(
    '/totp/challenge',
    perIpCeiling('auth-totp', authIpMax),
    perSubject('auth-totp', 10, challengeAccountKey),
    validate({ body: TotpChallengeSchema }),
    asyncHandler(totpChallenge),
  );
  router.post(
    '/totp/enroll-challenge',
    perIpCeiling('auth-totp-enroll', authIpMax),
    perSubject('auth-totp-enroll', 10, challengeAccountKey),
    validate({ body: EnrollChallengeBodySchema }),
    asyncHandler(totpEnrollWithChallenge),
  );
  // Only the ceiling per IP here. The limit per session (60 renewals per 5 minutes) is applied in
  // `authService.refresh`, once the session is found: the cookie changes on every renewal, so it
  // cannot name the session at this point.
  router.post(
    '/refresh',
    perIpCeiling('auth-refresh', env.AUTH_REFRESH_RATE_LIMIT_PER_IP),
    asyncHandler(refresh),
  );
  router.post(
    '/activate',
    perIpCeiling('auth-activate', authIpMax),
    perSubject('auth-activate', 10, tokenKey('token')),
    validate({ body: ActivateAccountSchema }),
    asyncHandler(activate),
  );

  router.post('/logout', authenticate, asyncHandler(logout));
  router.get('/me', authenticate, asyncHandler(me));
  // Self-service by construction: the subject is always the caller, so there is no
  // permission to check and nothing to scope.
  // Generous rather than strict: a toggle in the shell bar is meant to be pressed, and the write
  // is bounded to three enumerated fields on the caller's own row. This is a runaway-client guard,
  // not a credential guard — 60 per caller, with the same per-IP ceiling as renewal so an office
  // pressing toggles at once is not one shared bucket.
  router.patch(
    '/me/preferences',
    perIpCeiling('auth-me-preferences', env.AUTH_REFRESH_RATE_LIMIT_PER_IP),
    perSubject('auth-me-preferences', 60, bearerKey),
    authenticate,
    validate({ body: UpdateMyPreferencesSchema }),
    asyncHandler(updateMyPreferences),
  );
  router.post(
    '/password/change',
    authenticate,
    validate({ body: ChangePasswordSchema }),
    asyncHandler(changePassword),
  );
  router.get('/sessions', authenticate, asyncHandler(listSessions));
  router.delete(
    '/sessions/:id',
    authenticate,
    validate({ params: SessionIdParamSchema }),
    asyncHandler(revokeSession),
  );
  router.post('/totp/enroll', authenticate, asyncHandler(totpEnroll));
  router.post(
    '/totp/verify',
    authenticate,
    validate({ body: TotpVerifySchema }),
    asyncHandler(totpVerify),
  );
  router.post(
    '/totp/disable',
    authenticate,
    validate({ body: TotpVerifySchema }),
    asyncHandler(totpDisable),
  );
  return router;
};
