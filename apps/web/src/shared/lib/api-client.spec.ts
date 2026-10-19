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

  it('an ABORTED refresh is retried, leaves the person signed in, and releases the slot', async () => {
    // The in-flight refresh is killed mid-air (abort / network drop / offline — fetch REJECTS
    // instead of resolving). That is no answer about the session, so it must not sign anyone
    // out: the renewal is retried a bounded number of times, the waiters get their ORIGINAL
    // errors, and the slot is free for the next expiry.
    let refreshDies = true;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.includes('/auth/refresh')) {
        log.refreshCalls += 1;
        await settle(15);
        if (refreshDies) throw new DOMException('The operation was aborted.', 'AbortError');
        return okData({ accessToken: 'fresh-5' });
      }
      const auth = authOf(init);
      log.dataCalls.push({ auth });
      if (auth === 'Bearer fresh-5') return okData({ value: 42 });
      if (auth === null) return errData(401, 'UNAUTHENTICATED', 'Authentication required');
      return errData(401, 'AUTH_TOKEN_EXPIRED', 'Access token expired');
    });
    mod.setAccessToken('stale-5');
    const authLost = vi.fn();
    mod.setOnAuthLost(authLost);

    vi.useFakeTimers();
    const pending = Promise.allSettled(Array.from({ length: 3 }, () => mod.api('/things')));
    await vi.runAllTimersAsync();
    const outcomes = await pending;
    vi.useRealTimers();

    // One shared renewal, retried after each pause — never one per waiting request.
    expect(log.refreshCalls).toBe(1 + mod.REFRESH_RETRY_DELAYS_MS.length);
    expect(authLost).not.toHaveBeenCalled();
    for (const o of outcomes) {
      expect(o.status).toBe('rejected');
      expect((o as PromiseRejectedResult).reason).toMatchObject({ code: 'AUTH_TOKEN_EXPIRED' });
    }
    // The token was not thrown away: the person is still the same signed-in person.
    expect(log.dataCalls.at(-1)?.auth).toBe('Bearer stale-5');

    // The connection comes back; the next expiry refreshes normally — the slot was released.
    refreshDies = false;
    const before = log.refreshCalls;
    await expect(mod.api('/things')).resolves.toEqual({ value: 42 });
    expect(log.refreshCalls).toBe(before + 1);
  });

  it('a REFUSED refresh with a throwing auth-loss handler still releases the slot', async () => {
    // The definitive-loss path keeps its contract: one auth-loss call, waiters settle with their
    // ORIGINAL errors, and a handler that throws can strand nothing.
    let refused = true;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.includes('/auth/refresh')) {
        log.refreshCalls += 1;
        await settle(15);
        return refused
          ? errData(401, 'AUTH_SESSION_REVOKED', 'Session revoked')
          : okData({ accessToken: 'fresh-6' });
      }
      const auth = authOf(init);
      log.dataCalls.push({ auth });
      if (auth === 'Bearer fresh-6') return okData({ value: 42 });
      if (auth === null) return errData(401, 'UNAUTHENTICATED', 'Authentication required');
      return errData(401, 'AUTH_TOKEN_EXPIRED', 'Access token expired');
    });
    mod.setAccessToken('stale-6');
    const authLost = vi.fn(() => {
      throw new Error('handler exploded');
    });
    mod.setOnAuthLost(authLost);

    const outcomes = await Promise.allSettled(Array.from({ length: 3 }, () => mod.api('/things')));
    expect(log.refreshCalls).toBe(1);
    expect(authLost).toHaveBeenCalledTimes(1);
    for (const o of outcomes) {
      expect(o.status).toBe('rejected');
      expect((o as PromiseRejectedResult).reason).toMatchObject({ code: 'AUTH_TOKEN_EXPIRED' });
    }

    refused = false;
    mod.setAccessToken('stale-6');
    await expect(mod.api('/things')).resolves.toEqual({ value: 42 });
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

describe("renewal outcomes: only the server's own refusal signs a person out", () => {
  let mod: ApiClient;
  let refreshAnswers: (() => Response | Promise<Response>)[];
  let refreshCalls: number;

  const serveRefresh = (): void => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL): Promise<Response> => {
      if (!String(input).includes('/auth/refresh')) return okData({ value: 42 });
      refreshCalls += 1;
      const next = refreshAnswers.shift();
      if (next === undefined) throw new Error('unexpected extra refresh');
      return next();
    });
  };

  const renew = async (): Promise<ApiClientModule.RenewOutcome> => {
    vi.useFakeTimers();
    const pending = mod.renewSession();
    await vi.runAllTimersAsync();
    const outcome = await pending;
    vi.useRealTimers();
    return outcome;
  };

  beforeEach(async () => {
    vi.resetModules();
    refreshCalls = 0;
    mod = await import('./api-client');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('a rate-limited renewal (429) is retried and then reported as unavailable — nobody is signed out', async () => {
    refreshAnswers = [
      () => errData(429, 'RATE_LIMITED', 'Too many requests'),
      () => errData(429, 'RATE_LIMITED', 'Too many requests'),
      () => errData(429, 'RATE_LIMITED', 'Too many requests'),
    ];
    serveRefresh();
    mod.setAccessToken('live-1');
    const authLost = vi.fn();
    mod.setOnAuthLost(authLost);

    await expect(renew()).resolves.toBe('unavailable');
    expect(refreshCalls).toBe(3);
    expect(authLost).not.toHaveBeenCalled();
    expect(mod.getAccessToken()).toBe('live-1');
  });

  it('a 5xx while a deploy swaps instances is ridden out by the retry', async () => {
    refreshAnswers = [
      () => errData(503, 'UNAVAILABLE', 'Service unavailable'),
      () => okData({ accessToken: 'fresh-7', idleMinutes: 10 }),
    ];
    serveRefresh();
    mod.setAccessToken('live-2');

    await expect(renew()).resolves.toBe('renewed');
    expect(refreshCalls).toBe(2);
    expect(mod.getAccessToken()).toBe('fresh-7');
  });

  it("a gateway's HTML error page (not JSON) is no answer about the session", async () => {
    const html = (): Response =>
      new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } });
    refreshAnswers = [html, html, html];
    serveRefresh();
    mod.setAccessToken('live-3');
    const authLost = vi.fn();
    mod.setOnAuthLost(authLost);

    await expect(renew()).resolves.toBe('unavailable');
    expect(authLost).not.toHaveBeenCalled();
    expect(mod.getAccessToken()).toBe('live-3');
  });

  it('a refusal (401) signs out at once — no retries, the token cleared, auth loss raised once', async () => {
    refreshAnswers = [() => errData(401, 'AUTH_SESSION_REVOKED', 'Session revoked')];
    serveRefresh();
    mod.setAccessToken('dead-1');
    const authLost = vi.fn();
    mod.setOnAuthLost(authLost);

    await expect(renew()).resolves.toBe('signedOut');
    expect(refreshCalls).toBe(1);
    expect(authLost).toHaveBeenCalledTimes(1);
    expect(mod.getAccessToken()).toBeNull();
  });

  it('the bootstrap renewal reports a refusal but never raises auth loss — there is nothing to sign out of yet', async () => {
    refreshAnswers = [() => errData(401, 'AUTH_REFRESH_MISSING', 'No refresh cookie')];
    serveRefresh();
    const authLost = vi.fn();
    mod.setOnAuthLost(authLost);

    await expect(mod.refreshAtBootstrap()).resolves.toBe('signedOut');
    expect(authLost).not.toHaveBeenCalled();
  });
});
