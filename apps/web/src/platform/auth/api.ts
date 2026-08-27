// TanStack Query owns server state (ADR-013); this is the auth feature's api/ surface.
import {
  type LoginResponse,
  type MeDto,
  type SessionDto,
  type UpdateMyPreferences,
} from '@ecms/contracts';
import { api, del, patch, post, setAccessToken } from '../../shared/lib/api-client';

/** Login by ANY enabled identifier — username, employee code, or email (auth design 4.3). */
export const loginRequest = async (identifier: string, password: string): Promise<LoginResponse> => {
  const response = await post<LoginResponse>('/auth/login', { identifier, password });
  if (!response.totpRequired) setAccessToken(response.accessToken);
  return response;
};

export const totpChallengeRequest = async (
  challengeToken: string,
  code: string,
): Promise<LoginResponse> => {
  const response = await post<LoginResponse>('/auth/totp/challenge', { challengeToken, code });
  if (!response.totpRequired) setAccessToken(response.accessToken);
  return response;
};

/**
 * The applicant portal's sign-in, in two calls (P-HR-APP §4).
 *
 * `startPortalChallenge` ALWAYS resolves. That is not sloppiness: the server answers the same
 * `{accepted: true}` whether the two numbers matched a candidate, matched nobody, or matched
 * somebody who is simply rate-limited — so the screen cannot tell the caller which, and neither
 * can this function. `retryAfterSeconds` is the only thing that varies, and it is a courtesy for
 * the resend timer rather than a signal about who exists.
 */
export const startPortalChallenge = (
  subjectType: string,
  identifier: string,
  phone: string,
): Promise<{ accepted: true; retryAfterSeconds: number }> =>
  post('/auth/portal/challenge', { subjectType, identifier, phone });

/** Trade a correct code for a session. Every refusal is one refusal — see the service. */
export const completePortalChallenge = async (
  subjectType: string,
  identifier: string,
  phone: string,
  code: string,
): Promise<LoginResponse> => {
  const response = await post<LoginResponse>('/auth/portal/verify', {
    subjectType,
    identifier,
    phone,
    code,
  });
  if (!response.totpRequired) setAccessToken(response.accessToken);
  return response;
};

export const totpEnrollWithChallengeRequest = (
  challengeToken: string,
): Promise<{ secret: string; otpauthUrl: string }> =>
  post('/auth/totp/enroll-challenge', { challengeToken });

export const fetchMe = (): Promise<MeDto> => api('/auth/me');

/**
 * The user's own presentation preferences. The response is the whole `me`, so the caller can put
 * the session straight back into the store instead of patching a copy of it.
 *
 * Every field is optional and only what is passed gets written, so a control saves itself without
 * restating the other two — and without the race that restating them would create between two
 * toggles pressed in quick succession.
 */
export const updateMyPreferencesRequest = (
  preferences: UpdateMyPreferences,
): Promise<MeDto> => patch<MeDto>('/auth/me/preferences', preferences);

export const logoutRequest = async (): Promise<void> => {
  await post<void>('/auth/logout', {});
  setAccessToken(null);
};

/** Session bootstrap: try a silent refresh, then load the identity. */
export const bootstrapSession = async (): Promise<MeDto | null> => {
  try {
    const { accessToken } = await post<{ accessToken: string }>('/auth/refresh', {});
    setAccessToken(accessToken);
    return await fetchMe();
  } catch {
    return null;
  }
};

// ── Security page + first-login gate (auth design 4.2/4.4/4.5) ──────────────

/** Complete the one-time setup link: the user chooses their own password (§14). */
export const activateRequest = (token: string, password: string): Promise<void> =>
  post<void>('/auth/activate', { token, password });

export const changePasswordRequest = (currentPassword: string, newPassword: string): Promise<void> =>
  post<void>('/auth/password/change', { currentPassword, newPassword });

export const totpEnrollRequest = (): Promise<{ secret: string; otpauthUrl: string }> =>
  post('/auth/totp/enroll', {});

export const totpVerifyRequest = (code: string): Promise<{ enabled: true; backupCodes: string[] }> =>
  post('/auth/totp/verify', { code });

export const totpDisableRequest = (code: string): Promise<void> =>
  post<void>('/auth/totp/disable', { code });

export const listSessionsRequest = (): Promise<SessionDto[]> => api('/auth/sessions');

export const revokeSessionRequest = (id: string): Promise<void> => del<void>(`/auth/sessions/${id}`);
