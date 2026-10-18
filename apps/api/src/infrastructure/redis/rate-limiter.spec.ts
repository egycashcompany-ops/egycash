// The limiter's shapes: a bucket per client IP (the default) and a bucket per subject — an
// account, a one-time token, a session — which is what lets a whole office behind one address
// keep working while each guessed or replayed thing stays strictly limited; and a limit that
// counts only failed attempts. Runs on the in-memory cache the test environment uses.
import { type NextFunction, type Request, type Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RateLimitedError } from '../../shared/errors';
import { hashedKey, rateLimit, startCountedAttempt } from './rate-limiter';

const fakeReq = (ip: string, subject?: string): Request =>
  ({ ip, headers: {}, body: subject === undefined ? {} : { subject } }) as unknown as Request;

/** Runs one middleware call and reports what it passed to `next`. */
const hit = (mw: ReturnType<typeof rateLimit>, req: Request): Promise<unknown> =>
  new Promise((resolve) => {
    mw(
      req,
      {} as Response,
      ((error?: unknown) => {
        resolve(error);
      }) as NextFunction,
    );
  });

let seq = 0;
const freshName = (): string => `spec-${String(Date.now())}-${String(seq++)}`;

describe('rate limiting per subject', () => {
  it('keeps one bucket per subject, so colleagues on the same IP do not share a limit', async () => {
    const mw = rateLimit({
      name: freshName(),
      windowSeconds: 300,
      max: 2,
      keyOf: (req) => (req.body as { subject?: string }).subject ?? null,
    });
    // Two people behind one office address, two attempts each: nobody is limited.
    for (const subject of ['a@x', 'b@x']) {
      expect(await hit(mw, fakeReq('203.0.113.7', subject))).toBeUndefined();
      expect(await hit(mw, fakeReq('203.0.113.7', subject))).toBeUndefined();
    }
    // A third attempt on ONE subject is limited — wherever it comes from.
    expect(await hit(mw, fakeReq('198.51.100.1', 'a@x'))).toBeInstanceOf(RateLimitedError);
  });

  it('skips a request with no subject rather than lumping them all into one bucket', async () => {
    const mw = rateLimit({ name: freshName(), windowSeconds: 300, max: 1, keyOf: () => null });
    for (let i = 0; i < 5; i += 1) {
      expect(await hit(mw, fakeReq('203.0.113.7'))).toBeUndefined();
    }
  });

  it('still limits per client IP when no subject function is given', async () => {
    const mw = rateLimit({ name: freshName(), windowSeconds: 300, max: 2 });
    expect(await hit(mw, fakeReq('203.0.113.9'))).toBeUndefined();
    expect(await hit(mw, fakeReq('203.0.113.9'))).toBeUndefined();
    expect(await hit(mw, fakeReq('203.0.113.9'))).toBeInstanceOf(RateLimitedError);
    expect(await hit(mw, fakeReq('203.0.113.10'))).toBeUndefined();
  });
});

// The limit behind failed sign-ins per address: successes cost nothing, failures and attempts
// still running do.
describe('a limit that counts only failed attempts', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const rule = (max: number) => ({ name: freshName(), windowSeconds: 300, max });

  it('lets successes through freely and refuses once the failures reach the limit', async () => {
    const limit = rule(2);
    for (let i = 0; i < 5; i += 1) {
      const success = await startCountedAttempt(limit, '203.0.113.7');
      expect(success.allowed).toBe(true);
      await success.settle(false);
    }
    for (let i = 0; i < 2; i += 1) {
      const failure = await startCountedAttempt(limit, '203.0.113.7');
      expect(failure.allowed).toBe(true);
      await failure.settle(true);
    }
    const refused = await startCountedAttempt(limit, '203.0.113.7');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfter).toBeGreaterThan(0);
    expect(refused.retryAfter).toBeLessThanOrEqual(300);
    // Another address keeps its own count.
    expect((await startCountedAttempt(limit, '203.0.113.8')).allowed).toBe(true);
  });

  it('counts attempts still running, so a parallel burst cannot pass a check made before any failed', async () => {
    const limit = rule(2);
    const burst = await Promise.all(
      [1, 2, 3, 4].map(() => startCountedAttempt(limit, '203.0.113.7')),
    );
    expect(burst.filter((attempt) => attempt.allowed)).toHaveLength(2);
  });

  it('frees the slot of a running attempt that succeeds, even if attempts were refused meanwhile', async () => {
    const limit = rule(1);
    const running = await startCountedAttempt(limit, '203.0.113.7');
    expect(running.allowed).toBe(true);
    expect((await startCountedAttempt(limit, '203.0.113.7')).allowed).toBe(false);
    expect((await startCountedAttempt(limit, '203.0.113.7')).allowed).toBe(false);
    await running.settle(false);
    expect((await startCountedAttempt(limit, '203.0.113.7')).allowed).toBe(true);
  });

  it('counts a settled attempt once, however often it is settled', async () => {
    const limit = rule(1);
    const failure = await startCountedAttempt(limit, '203.0.113.7');
    await failure.settle(true);
    await failure.settle(false);
    expect((await startCountedAttempt(limit, '203.0.113.7')).allowed).toBe(false);
  });

  it('starts again when the window turns over, and a late success goes back to its own window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-18T10:04:59.000Z'));
    const limit = rule(1);
    const late = await startCountedAttempt(limit, '203.0.113.7');
    expect(late.allowed).toBe(true);
    expect(late.retryAfter).toBe(1);
    expect((await startCountedAttempt(limit, '203.0.113.7')).allowed).toBe(false);

    vi.setSystemTime(new Date('2026-10-18T10:05:00.500Z'));
    const fresh = await startCountedAttempt(limit, '203.0.113.7');
    expect(fresh.allowed).toBe(true);
    await fresh.settle(true);
    // The attempt begun in the last window succeeds now: that must not free a slot in this one.
    await late.settle(false);
    expect((await startCountedAttempt(limit, '203.0.113.7')).allowed).toBe(false);
  });
});

describe('hashedKey', () => {
  it('is stable, short, and never the value itself', () => {
    const cookie = 'refresh-token-value-that-must-never-sit-in-redis';
    expect(hashedKey(cookie)).toBe(hashedKey(cookie));
    expect(hashedKey(cookie)).toMatch(/^[0-9a-f]{32}$/);
    expect(hashedKey(cookie)).not.toContain('refresh');
    expect(hashedKey('a')).not.toBe(hashedKey('b'));
  });
});
