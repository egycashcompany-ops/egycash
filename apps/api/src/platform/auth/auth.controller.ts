import { type Request, type Response } from 'express';
import {
  ErrorCodes,
  type ActivateAccount,
  type ChangePassword,
  type Login,
  type TotpChallenge,
  type TotpVerify,
} from '@ecms/contracts';
import { env } from '../../infrastructure/config/env';
import { ok, noContent } from '../../infrastructure/http/respond';
import { validated } from '../../infrastructure/http/validate';
import { UnauthenticatedError } from '../../shared/errors';
import { userService } from '../users';
import { authService, type IssuedTokens } from './auth.service';
import { authContext } from './auth.middleware';

// The refresh cookie is scoped to the auth endpoints only (ADR-006):
// httpOnly + Secure + SameSite=Strict, never readable by the SPA.
const REFRESH_COOKIE = 'ecms_refresh';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

const setRefreshCookie = (res: Response, tokens: IssuedTokens): void => {
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    expires: tokens.refreshExpiresAt,
  });
};

const clearRefreshCookie = (res: Response): void => {
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
};

export const login = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<Login>(req);
  const identifier = body.identifier ?? body.email ?? '';
  const { response, tokens } = await authService.login(identifier, body.password);
  if (tokens !== undefined) setRefreshCookie(res, tokens);
  ok(res, response);
};

export const totpChallenge = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<TotpChallenge>(req);
  const { response, tokens, backupCodes } = await authService.completeTotpChallenge(
    body.challengeToken,
    body.code,
  );
  setRefreshCookie(res, tokens);
  ok(res, backupCodes === undefined ? response : { ...response, backupCodes });
};

export const refresh = async (req: Request, res: Response): Promise<void> => {
  const presented = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];
  if (presented === undefined) {
    throw new UnauthenticatedError(ErrorCodes.AUTH_TOKEN_INVALID, 'No refresh token');
  }
  const tokens = await authService.refresh(presented);
  setRefreshCookie(res, tokens);
  ok(res, { accessToken: tokens.accessToken });
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  await authService.logout(authContext(req));
  clearRefreshCookie(res);
  noContent(res);
};

export const me = async (req: Request, res: Response): Promise<void> => {
  ok(res, await authService.me(authContext(req)));
};

export const activate = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<ActivateAccount>(req);
  await userService.activateWithToken(body.token, body.password);
  noContent(res);
};

export const changePassword = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<ChangePassword>(req);
  await authService.changePassword(authContext(req), body.currentPassword, body.newPassword);
  noContent(res);
};

export const listSessions = async (req: Request, res: Response): Promise<void> => {
  ok(res, await authService.listSessions(authContext(req)));
};

export const revokeSession = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, { id: string }>(req);
  await authService.revokeOwnSession(authContext(req), params.id);
  noContent(res);
};

/** Voluntary enrollment for an authenticated user. */
export const totpEnroll = async (req: Request, res: Response): Promise<void> => {
  ok(res, await authService.startTotpEnrollment(authContext(req).userId));
};

/** Mid-login enrollment for privileged accounts (Review R13) — proven by the challenge token. */
export const totpEnrollWithChallenge = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<{ challengeToken: string }>(req);
  ok(res, await authService.startTotpEnrollmentWithChallenge(body.challengeToken));
};

export const totpVerify = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<TotpVerify>(req);
  ok(res, await authService.verifyTotpEnrollment(authContext(req).userId, body.code));
};

export const totpDisable = async (req: Request, res: Response): Promise<void> => {
  const { body } = validated<TotpVerify>(req);
  await authService.disableTotp(authContext(req), body.code);
  noContent(res);
};
