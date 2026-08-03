// Refresh-race regression suite. The refresh token is single-use and rotates server-side
// (auth design §6): N concurrent 401s must share ONE silent refresh, the slot must be
// released the moment it settles, and a failed refresh must report auth loss exactly once —
// the empirically traced failure was N parallel refreshes racing each other, the losers
// nulling the token, and every later request leaving without an Authorization header.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClientModule from './api-client';

type ApiClient = typeof ApiClientModule;

const envelope = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const okData = (data: unknown): Response => envelope(200, { success: true, data });
const errData = (status: number, code: string, message: string): Response =>
  envelope(status, { success: false, error: { code, message } });

const authOf = (init?: RequestInit): string | null => new Headers(init?.headers).get('Authorization');
const settle = async (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface FetchLog {
  refreshCalls: number;
  dataCalls: { auth: string | null }[];
}

/** Fake server: expired-token data calls 401 until a refresh mints `freshToken`. */
const fakeServer = (
  log: FetchLog,
  opts: { refreshOutcome: 'ok' | 'revoked'; freshToken: string },
): ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) => {
  return async (input, init) => {
    const url = String(input);
    if (url.includes('/auth/refresh')) {
      log.refreshCalls += 1;
      await settle(25); // in-flight window: every concurrent 401 lands while this one runs
      return opts.refreshOutcome === 'ok'
        ? okData({ accessToken: opts.freshToken })
        : errData(401, 'AUTH_SESSION_REVOKED', 'Session revoked');
    }
    const auth = authOf(init);
    log.dataCalls.push({ auth });
    if (auth === `Bearer ${opts.freshToken}`) return okData({ value: 42 });
    if (auth === null) return errData(401, 'UNAUTHENTICATED', 'Authentication required');
    return errData(401, 'AUTH_TOKEN_EXPIRED', 'Access token expired');
  };
};

describe('single-flight silent refresh (refresh-race fix)', () => {
  let mod: ApiClient;
  let log: FetchLog;

  beforeEach(async () => {
    vi.resetModules(); // fresh module state: accessToken, refreshPromise, onAuthLost
    log = { refreshCalls: 0, dataCalls: [] };
    mod = await import('./api-client');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('10 concurrent expired-token requests share exactly ONE refresh and all complete', async () => {
    vi.stubGlobal('fetch', fakeServer(log, { refreshOutcome: 'ok', freshToken: 'fresh-1' }));
    mod.setAccessToken('stale-1');

    const results = await Promise.all(
      Array.from({ length: 10 }, () => mod.api<{ value: number }>('/things')),
    );

    expect(results).toHaveLength(10);
    for (const r of results) expect(r).toEqual({ value: 42 });
    expect(log.refreshCalls).toBe(1); // the fix: one rotation, no self-race
    // 10 initial 401s + 10 retries, every retry carrying the ROTATED token.
    expect(log.dataCalls).toHaveLength(20);
    const retries = log.dataCalls.filter((c) => c.auth === 'Bearer fresh-1');
    expect(retries).toHaveLength(10);
  });

  it('a failed refresh reports auth loss exactly ONCE, not once per waiting request', async () => {
    vi.stubGlobal('fetch', fakeServer(log, { refreshOutcome: 'revoked', freshToken: 'never' }));
    mod.setAccessToken('stale-2');
    const authLost = vi.fn();
    mod.setOnAuthLost(authLost);

    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, () => mod.api('/things')),
    );

    expect(log.refreshCalls).toBe(1);
    expect(authLost).toHaveBeenCalledTimes(1); // one logout, one redirect — not ten
    // Every waiter rejects with its ORIGINAL error; nothing hangs on the released promise.
    for (const o of outcomes) {
      expect(o.status).toBe('rejected');
      expect((o as PromiseRejectedResult).reason).toMatchObject({ code: 'AUTH_TOKEN_EXPIRED' });
    }
  });

  it('releases the single-flight slot on settle — a later expiry refreshes again (no global lock)', async () => {
    vi.stubGlobal('fetch', fakeServer(log, { refreshOutcome: 'ok', freshToken: 'fresh-3' }));
    mod.setAccessToken('stale-3');
    await Promise.all(Array.from({ length: 3 }, () => mod.api('/things')));
    expect(log.refreshCalls).toBe(1);

    // The token expires AGAIN later (next idle period) — the slot must be free to refresh anew.
    mod.setAccessToken('stale-3b');
    await Promise.all(Array.from({ length: 3 }, () => mod.api('/things')));
    expect(log.refreshCalls).toBe(2);
  });

  it('after a failed refresh the token is cleared — the aftermath request carries no header', async () => {
    vi.stubGlobal('fetch', fakeServer(log, { refreshOutcome: 'revoked', freshToken: 'never' }));
    mod.setAccessToken('stale-4');
    mod.setOnAuthLost(vi.fn());
    await Promise.allSettled([mod.api('/things')]);

    // This is the traced production aftermath: Authorization ABSENT → UNAUTHENTICATED —
    // now answered by an organized sign-out instead of a stranded error screen.
    await expect(mod.api('/things')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(log.dataCalls.at(-1)?.auth).toBeNull();
  });
});
