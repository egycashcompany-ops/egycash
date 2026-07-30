// The n8n HTTP client (A-5).
//
// `fetch` is stubbed, so these test the transport CONTRACT — auth header, base-URL joining, retry
// on transport/5xx, no retry on 4xx, and health never throwing — without a live n8n. That is the
// whole point of the client: the network policy lives in one tested place.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { N8nClient, N8nRequestError } from './n8n.client';

const okResponse = (body: unknown = { ok: true }, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as Response;

const errorResponse = (status: number): Response =>
  ({ ok: false, status, text: () => Promise.resolve('') }) as unknown as Response;

afterEach(() => vi.restoreAllMocks());

const client = (over: Partial<ConstructorParameters<typeof N8nClient>[0]> = {}) =>
  new N8nClient({ baseUrl: 'https://n8n.example/', maxRetries: 2, timeoutMs: 5_000, ...over });

describe('requests', () => {
  it('joins the base URL and path without a double slash', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());
    await client().request('POST', '/webhook/abc', { a: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://n8n.example/webhook/abc',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sends the API key as X-N8N-API-KEY when configured, and not otherwise', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());

    await client({ apiKey: 'secret-key' }).request('GET', '/healthz');
    const withKey = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(withKey['x-n8n-api-key']).toBe('secret-key');

    await client({ apiKey: undefined }).request('GET', '/healthz');
    const withoutKey = (fetchMock.mock.calls[1]?.[1] as RequestInit).headers as Record<string, string>;
    expect(withoutKey['x-n8n-api-key']).toBeUndefined();
  });

  it('parses a JSON body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({ executionId: 'x' }));
    const res = await client().request('POST', '/webhook/a', {});
    expect(res.body).toEqual({ executionId: 'x' });
  });

  it('propagates the correlation id and idempotency key as headers, dropping undefined ones', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse());
    await client().request('POST', '/webhook/a', {}, {
      'x-request-id': 'req-123',
      'idempotency-key': 'ex-abc',
    });
    const withBoth = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(withBoth['x-request-id']).toBe('req-123');
    expect(withBoth['idempotency-key']).toBe('ex-abc');

    // A missing correlation id must not travel as the literal string "undefined".
    await client().request('POST', '/webhook/a', {}, { 'x-request-id': undefined, 'idempotency-key': 'ex-def' });
    const withoutReq = (fetchMock.mock.calls[1]?.[1] as RequestInit).headers as Record<string, string>;
    expect(withoutReq['x-request-id']).toBeUndefined();
    expect(withoutReq['idempotency-key']).toBe('ex-def');
  });
});

describe('retry policy', () => {
  it('retries a transport failure and then succeeds', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(okResponse());
    const res = await client().request('POST', '/webhook/a', {});
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a 503 and then gives up with a typed error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(errorResponse(503));
    await expect(client({ maxRetries: 1 }).request('POST', '/webhook/a', {})).rejects.toBeInstanceOf(
      N8nRequestError,
    );
    // Initial try + one retry.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a 4xx — it would fail identically', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(errorResponse(404));
    await expect(client().request('POST', '/webhook/missing', {})).rejects.toMatchObject({
      status: 404,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('health never throws', () => {
  it('reports reachable on a healthy instance', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({ status: 'ok' }));
    expect(await client().health()).toMatchObject({ reachable: true });
  });

  it('reports unreachable instead of throwing when n8n is down', async () => {
    // Health is how the platform LEARNS n8n is down; a throw would turn a signal into an outage.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const result = await client({ maxRetries: 0 }).health();
    expect(result.reachable).toBe(false);
    expect(result.detail).toBeTruthy();
  });
});
