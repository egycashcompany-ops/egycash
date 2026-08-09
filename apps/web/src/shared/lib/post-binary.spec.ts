// `postBinary` — the document-returning POST the IT label sheet needs.
//
// It sits outside the JSON-envelope path, which is exactly why it deserves its own suite: every
// guarantee the rest of `api-client` provides had to be re-established here by hand, and each one
// is a silent failure if it is missing.
//
//   • The Authorization header, and the one-shot silent refresh on a 401 — without it the first
//     print after an access token expires fails, and the user's only clue is a dead button.
//   • Reading the JSON error envelope on failure — the error path still speaks JSON even though
//     the success path does not, so a 409 must surface its real message rather than "failed".
//   • Returning `Content-Type` alongside the bytes — the caller branches on it (PDF → save,
//     HTML → print), and a dropped header would silently take the wrong branch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClientModule from './api-client';

type ApiClient = typeof ApiClientModule;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('postBinary', () => {
  let mod: ApiClient;

  beforeEach(async () => {
    vi.resetModules();
    mod = await import('./api-client');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the body as JSON with the bearer token and returns bytes + content type', async () => {
    const seen: { auth: string | null; body: string | null; method?: string }[] = [];
    vi.stubGlobal('fetch', (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        auth: new Headers(init?.headers).get('Authorization'),
        body: typeof init?.body === 'string' ? init.body : null,
        ...(init?.method === undefined ? {} : { method: init.method }),
      });
      return Promise.resolve(
        new Response('%PDF-1.7', { status: 200, headers: { 'Content-Type': 'application/pdf' } }),
      );
    });
    mod.setAccessToken('token-1');

    const result = await mod.postBinary('/it/assets/labels', { assetIds: ['a', 'b'] });

    expect(result.contentType).toContain('application/pdf');
    expect(await result.blob.text()).toBe('%PDF-1.7');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe('POST');
    expect(seen[0]?.auth).toBe('Bearer token-1');
    expect(seen[0]?.body).toBe(JSON.stringify({ assetIds: ['a', 'b'] }));
  });

  it('distinguishes the HTML fallback from a PDF by the content type', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response('<html>labels</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
      ),
    );

    const result = await mod.postBinary('/it/assets/labels', { assetIds: ['a'] });

    expect(result.contentType).toContain('text/html');
    expect(result.contentType).not.toContain('application/pdf');
    expect(await result.blob.text()).toContain('labels');
  });

  it('retries once through a silent refresh when the access token has expired', async () => {
    let refreshes = 0;
    let documents = 0;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/auth/refresh')) {
        refreshes += 1;
        return Promise.resolve(json(200, { success: true, data: { accessToken: 'fresh' } }));
      }
      documents += 1;
      const auth = new Headers(init?.headers).get('Authorization');
      if (auth !== 'Bearer fresh') {
        return Promise.resolve(
          json(401, { success: false, error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } }),
        );
      }
      return Promise.resolve(
        new Response('%PDF', { status: 200, headers: { 'Content-Type': 'application/pdf' } }),
      );
    });
    mod.setAccessToken('stale');

    const result = await mod.postBinary('/it/assets/labels', { assetIds: ['a'] });

    expect(await result.blob.text()).toBe('%PDF');
    expect(refreshes).toBe(1);
    expect(documents).toBe(2); // the 401, then the retry with the rotated token
  });

  it('surfaces the API error message from the JSON envelope on failure', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        json(404, {
          success: false,
          error: { code: 'NOT_FOUND', message: 'none of the requested assets exist' },
        }),
      ),
    );

    await expect(mod.postBinary('/it/assets/labels', { assetIds: ['x'] })).rejects.toMatchObject({
      message: 'none of the requested assets exist',
      status: 404,
    });
  });

  it('still throws a usable error when the failure body is not an envelope', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response('<h1>Bad Gateway</h1>', { status: 502 })),
    );

    await expect(mod.postBinary('/it/assets/labels', { assetIds: ['x'] })).rejects.toMatchObject({
      code: 'DOCUMENT_FAILED',
      status: 502,
    });
  });
});
