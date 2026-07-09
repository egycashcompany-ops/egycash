// Auth endpoints — the only routes with the `/api/v1/auth` shortcut prefix
// (Naming Conventions §4). Strict Redis-backed rate limits (API Standards §9).
import { Router } from 'express';
import { asyncHandler } from '../../infrastructure/http/async-handler';
import { validate } from '../../infrastructure/http/validate';
import { rateLimit } from '../../infrastructure/redis/rate-limiter';
import {
  ActivateAccountSchema,
  ChangePasswordSchema,
  EnrollChallengeBodySchema,
  LoginSchema,
  SessionIdParamSchema,
  TotpChallengeSchema,
  TotpVerifySchema,
} from './auth.validation';
import {
  activate,
  changePassword,
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
  totpVerify,
} from './auth.controller';
import { authenticate } from './auth.middleware';

const strictLimit = (name: string) => rateLimit({ name, windowSeconds: 300, max: 10 });

export const buildAuthRouter = (): Router => {
  const router = Router();

  router.post(
    '/login',
    strictLimit('auth-login'),
    validate({ body: LoginSchema }),
    asyncHandler(login),
  );
  router.post(
    '/totp/challenge',
    strictLimit('auth-totp'),
    validate({ body: TotpChallengeSchema }),
    asyncHandler(totpChallenge),
  );
  router.post(
    '/totp/enroll-challenge',
    strictLimit('auth-totp-enroll'),
    validate({ body: EnrollChallengeBodySchema }),
    asyncHandler(totpEnrollWithChallenge),
  );
  router.post(
    '/refresh',
    rateLimit({ name: 'auth-refresh', windowSeconds: 300, max: 60 }),
    asyncHandler(refresh),
  );
  router.post(
    '/activate',
    strictLimit('auth-activate'),
    validate({ body: ActivateAccountSchema }),
    asyncHandler(activate),
  );

  router.post('/logout', authenticate, asyncHandler(logout));
  router.get('/me', authenticate, asyncHandler(me));
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
