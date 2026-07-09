// TanStack Query owns server state (ADR-013); this is the auth feature's api/ surface.
import { type LoginResponse, type MeDto } from '@ecms/contracts';
import { api, post, setAccessToken } from '../../shared/lib/api-client';

export const loginRequest = async (email: string, password: string): Promise<LoginResponse> => {
  const response = await post<LoginResponse>('/auth/login', { email, password });
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
