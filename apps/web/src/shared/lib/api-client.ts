// Platform API client: envelope-aware fetch wrapper with in-memory access token
// and silent refresh on expiry (ADR-006 — the token never touches storage APIs).
import {
  type ApiEnvelope,
  type ApiErrorDetail,
  type PageMeta,
  type Paginated,
  type WorkflowEnvelopeDto,
} from '@ecms/contracts';

const BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000/api/v1';

let accessToken: string | null = null;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};

/**
 * The branch the command bar's switcher has narrowed to, sent on every request.
 *
 * A header rather than a query parameter because it applies to EVERY call the application makes,
 * and threading it through each one would be a change nobody could keep up to date. The server
 * treats it as a narrowing of the caller's own grants and never as a widening, so it carries no
 * authority — a request that omits it simply sees everything the account may see.
 */
let activeBranch: string | null = null;

export const setActiveBranch = (branchId: string | null): void => {
  activeBranch = branchId;
};

// Definitive auth loss (refresh failed mid-session): the app registers ONE handler here
// (main.tsx) that signs Redux out and clears the query cache, so RequireAuth redirects to
// /login instead of stranding the user on an error screen. Registered as a callback to keep
// this module free of store/react imports.
let onAuthLost: (() => void) | null = null;

export const setOnAuthLost = (handler: (() => void) | null): void => {
  onAuthLost = handler;
};

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: ApiErrorDetail[],
    /**
     * The server's own id for this exact request (`ApiFailure.requestId`, also on the
     * `X-Request-Id` header). Carried because a failure the user can only describe as "something
     * went wrong" is a failure nobody can look up — with this, one line from a screenshot finds
     * the request in the API log.
     */
    readonly requestId?: string,
  ) {
    super(message);
  }
}

const rawRequest = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (accessToken !== null) headers.set('Authorization', `Bearer ${accessToken}`);
  if (activeBranch !== null) headers.set('X-Active-Branch', activeBranch);

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include', // the refresh cookie rides only on /auth paths
  });
  if (response.status === 204) return undefined as T;

  const body = (await response.json()) as ApiEnvelope<T>;
  if (body.success) return body.data;
  throw new ApiError(
      body.error.code,
      body.error.message,
      response.status,
      body.error.details,
      body.error.requestId,
    );
};

const refreshOnce = async (): Promise<boolean> => {
  try {
    const data = await rawRequest<{ accessToken: string }>('/auth/refresh', { method: 'POST' });
    setAccessToken(data.accessToken);
    return true;
  } catch {
    setAccessToken(null);
    return false;
  }
};

// SINGLE-FLIGHT (refresh-race fix): the refresh token is single-use and rotates server-side,
// so N concurrent 401s firing N refreshes make the client race itself — one wins the rotation,
// the rest are rejected and the session can be revoked as token reuse. All concurrent callers
// therefore share ONE in-flight refresh; the slot is released the moment it settles (no lock
// outlives the request), and a failed refresh reports auth loss exactly once — from the shared
// promise, never from each waiter.
let refreshPromise: Promise<boolean> | null = null;

const tryRefresh = (): Promise<boolean> => {
  refreshPromise ??= refreshOnce()
    .then((ok) => {
      if (!ok) {
        try {
          onAuthLost?.();
        } catch {
          // A throwing auth-loss handler must never poison the shared promise: every waiter
          // still settles with its ORIGINAL error and the slot still releases below.
        }
      }
      return ok;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
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

export const get = <T>(path: string): Promise<T> => api<T>(path);

/** List fetch that preserves the pagination `meta` envelope (API Standards §4). */
const rawPage = async <T>(path: string): Promise<Paginated<T>> => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (accessToken !== null) headers.set('Authorization', `Bearer ${accessToken}`);
  if (activeBranch !== null) headers.set('X-Active-Branch', activeBranch);
  const response = await fetch(`${BASE_URL}${path}`, { headers, credentials: 'include' });
  const body = (await response.json()) as ApiEnvelope<T[]>;
  if (!body.success) {
    throw new ApiError(
      body.error.code,
      body.error.message,
      response.status,
      body.error.details,
      body.error.requestId,
    );
  }
  const items = body.data;
  const meta: PageMeta = body.meta ?? {
    page: 1,
    pageSize: items.length,
    totalItems: items.length,
    totalPages: 1,
  };
  return { items, meta };
};

export const getPage = async <T>(path: string): Promise<Paginated<T>> => {
  try {
    return await rawPage<T>(path);
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.code === 'AUTH_TOKEN_EXPIRED' || error.code === 'AUTH_TOKEN_INVALID')
    ) {
      if (await tryRefresh()) return rawPage<T>(path);
    }
    throw error;
  }
};

export const patch = <T>(path: string, body: unknown): Promise<T> =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

/** Fetch a raw text response (endpoints outside the JSON envelope, e.g. document HTML). */
export const getText = async (path: string): Promise<string> => {
  const authHeaders = (): Headers => {
    const h = new Headers();
    if (accessToken !== null) h.set('Authorization', `Bearer ${accessToken}`);
    return h;
  };
  let response = await fetch(`${BASE_URL}${path}`, { headers: authHeaders(), credentials: 'include' });
  if (response.status === 401 && (await tryRefresh())) {
    response = await fetch(`${BASE_URL}${path}`, { headers: authHeaders(), credentials: 'include' });
  }
  if (!response.ok) throw new ApiError('FETCH_FAILED', 'text fetch failed', response.status);
  return response.text();
};

/**
 * `body` is optional and almost never wanted — a DELETE names what it removes in its path.
 *
 * The exception it exists for is a resource whose identifier is a URL: a Web Push endpoint is up
 * to 2048 characters of somebody else's origin, which is not something to put in a path segment or
 * a query string. Callers that identify a resource by id keep passing nothing and are unaffected.
 */
export const del = <T>(path: string, body?: unknown): Promise<T> =>
  api<T>(path, {
    method: 'DELETE',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });


/** Build a `?a=1&b=2` query string, dropping empty/undefined values (API Standards §4). */
/** What a list endpoint's query may carry. Arrays are the multi-valued filters. */
export type QueryParams = Record<
  string,
  string | number | boolean | readonly string[] | undefined | null
>;

export const buildQuery = (params: QueryParams): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    // A multi-valued filter travels as ONE comma-separated parameter, which is what `listQuery`
    // in the contracts parses. An empty list is an absent filter, not "match nothing".
    if (Array.isArray(value)) {
      if (value.length > 0) search.set(key, value.join(','));
      continue;
    }
    search.set(key, String(value));
  }
  const query = search.toString();
  return query === '' ? '' : `?${query}`;
};

const rawUpload = async <T>(path: string, form: FormData): Promise<T> => {
  const headers = new Headers();
  if (accessToken !== null) headers.set('Authorization', `Bearer ${accessToken}`);
  if (activeBranch !== null) headers.set('X-Active-Branch', activeBranch);
  // No Content-Type: the browser sets the multipart boundary itself.
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: form,
    credentials: 'include',
  });
  if (response.status === 204) return undefined as T;
  const body = (await response.json()) as ApiEnvelope<T>;
  if (body.success) return body.data;
  throw new ApiError(
      body.error.code,
      body.error.message,
      response.status,
      body.error.details,
      body.error.requestId,
    );
};

/** Hand a blob to the browser as a download. Shared by every binary path below. */
export const saveBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

/**
 * GET a binary response and hand back the bytes, with the same one-shot silent-refresh retry as
 * `api`. What the caller does with them is the caller's business — save, render, embed.
 *
 * Separate from `downloadBlob` because a private image is NOT a download: it has to reach an
 * `<img>`, and an `<img src>` cannot carry the bearer token this request needs. Fetching the bytes
 * here and handing the caller an object URL is what lets an authorized image render at all.
 */
export const fetchBlob = async (path: string): Promise<Blob> => {
  const authHeaders = (): Headers => {
    const h = new Headers();
    if (accessToken !== null) h.set('Authorization', `Bearer ${accessToken}`);
    return h;
  };
  let response = await fetch(`${BASE_URL}${path}`, { headers: authHeaders(), credentials: 'include' });
  if (response.status === 401 && (await tryRefresh())) {
    response = await fetch(`${BASE_URL}${path}`, { headers: authHeaders(), credentials: 'include' });
  }
  if (!response.ok) throw new ApiError('EXPORT_FAILED', 'export failed', response.status);
  return response.blob();
};

/** Fetch a binary response (e.g. a CSV export) and trigger a browser download. */
export const downloadBlob = async (path: string, filename: string): Promise<void> => {
  saveBlob(await fetchBlob(path), filename);
};

/**
 * POST that answers with a DOCUMENT rather than the JSON envelope, returning the body and the
 * content type the server chose.
 *
 * `downloadBlob` cannot serve this: the request carries a body, and the caller has to branch on
 * what came back. The IT label sheet is the first such endpoint — it renders a PDF when the
 * chromium driver is configured and the identical HTML when it is not, and the two want different
 * treatment (save vs. open-and-print). Deciding here, from `Content-Type`, keeps that branch out
 * of the module.
 */
export const postBinary = async (
  path: string,
  body: unknown,
): Promise<{ contentType: string; blob: Blob }> => {
  const request = (): RequestInit => {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (accessToken !== null) headers.set('Authorization', `Bearer ${accessToken}`);
  if (activeBranch !== null) headers.set('X-Active-Branch', activeBranch);
    return { method: 'POST', headers, body: JSON.stringify(body), credentials: 'include' };
  };
  let response = await fetch(`${BASE_URL}${path}`, request());
  if (response.status === 401 && (await tryRefresh())) {
    response = await fetch(`${BASE_URL}${path}`, request());
  }
  if (!response.ok) {
    // The error path still speaks the JSON envelope, so the real message survives.
    const message = await response
      .clone()
      .json()
      .then((payload: ApiEnvelope<unknown>) =>
        payload.success ? 'request failed' : payload.error.message,
      )
      .catch(() => 'request failed');
    throw new ApiError('DOCUMENT_FAILED', message, response.status);
  }
  return {
    contentType: response.headers.get('Content-Type') ?? '',
    blob: await response.blob(),
  };
};

/** Multipart upload with the same one-shot silent-refresh retry as `api`. */
export const upload = async <T>(path: string, form: FormData): Promise<T> => {
  try {
    return await rawUpload<T>(path, form);
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.code === 'AUTH_TOKEN_EXPIRED' || error.code === 'AUTH_TOKEN_INVALID')
    ) {
      if (await tryRefresh()) return rawUpload<T>(path, form);
    }
    throw error;
  }
};

// ── Workflow endpoints (I6) ─────────────────────────────────────────────────
//
// A recruitment workflow endpoint answers with `{ data, workflow, timeline, counters }`, and these
// helpers hand the WHOLE envelope to the caller. That is the point of the invariant: the response
// already contains everything the client needs to redraw — the updated aggregate, where the
// candidate now stands, the history the act wrote, and the refreshed queue counters — so there is
// nothing left to go and ask for.
//
// Typing them separately from `post`/`patch`/`upload` is deliberate: a workflow endpoint and an
// ordinary one no longer have the same response shape, and the type should say so at the call site.

export const postWorkflow = <T>(path: string, body: unknown): Promise<WorkflowEnvelopeDto<T>> =>
  post<WorkflowEnvelopeDto<T>>(path, body);

export const patchWorkflow = <T>(path: string, body: unknown): Promise<WorkflowEnvelopeDto<T>> =>
  patch<WorkflowEnvelopeDto<T>>(path, body);

/** The multipart counterpart — evaluation files and hiring documents are workflow actions too. */
export const uploadWorkflow = <T>(path: string, form: FormData): Promise<WorkflowEnvelopeDto<T>> =>
  upload<WorkflowEnvelopeDto<T>>(path, form);

/** DELETE with a body — the evaluation-file removal, which is a workflow action like any other. */
export const delWorkflow = <T>(path: string, body: unknown): Promise<WorkflowEnvelopeDto<T>> =>
  api<WorkflowEnvelopeDto<T>>(path, { method: 'DELETE', body: JSON.stringify(body) });
