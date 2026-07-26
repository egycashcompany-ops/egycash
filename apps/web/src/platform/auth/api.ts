// TanStack Query owns server state (ADR-013); this is the auth feature's api/ surface.
import { type LoginResponse, type MeDto, type SessionDto } from '@ecms/contracts';
import { api, del, post, setAccessToken } from '../../shared/lib/api-client';

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

export const totpEnrollWithChallengeRequest = (
  challengeToken: string,
): Promise<{ secret: string; otpauthUrl: string }> =>
  post('/auth/totp/enroll-challenge', { challengeToken });

export const fetchMe = (): Promise<MeDto> => api('/auth/me');

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
