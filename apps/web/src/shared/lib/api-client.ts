// Platform API client: envelope-aware fetch wrapper with in-memory access token
// and silent refresh on expiry (ADR-006 — the token never touches storage APIs).
import { type ApiEnvelope } from '@ecms/contracts';

const BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000/api/v1';

let accessToken: string | null = null;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const rawRequest = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (accessToken !== null) headers.set('Authorization', `Bearer ${accessToken}`);

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include', // the refresh cookie rides only on /auth paths
  });
  if (response.status === 204) return undefined as T;

  const body = (await response.json()) as ApiEnvelope<T>;
  if (body.success) return body.data;
  throw new ApiError(body.error.code, body.error.message, response.status);
};

const tryRefresh = async (): Promise<boolean> => {
  try {
    const data = await rawRequest<{ accessToken: string }>('/auth/refresh', { method: 'POST' });
    setAccessToken(data.accessToken);
    return true;
  } catch {
    setAccessToken(null);
    return false;
  }
};

/** Request with one silent-refresh retry on an expired/invalid access token. */
export const api = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  try {
    return await rawRequest<T>(path, init);
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.code === 'AUTH_TOKEN_EXPIRED' || error.code === 'AUTH_TOKEN_INVALID') &&
      !path.startsWith('/auth/refresh')
    ) {
      if (await tryRefresh()) return rawRequest<T>(path, init);
    }
    throw error;
  }
};

export const post = <T>(path: string, body: unknown): Promise<T> =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
