// The limiter's two shapes: a bucket per client IP (the default) and a bucket per subject — an
// account, a one-time token, a session — which is what lets a whole office behind one address
// keep working while each guessed or replayed thing stays strictly limited. Runs on the in-memory
// cache the test environment uses.
import { type NextFunction, type Request, type Response } from 'express';
import { describe, expect, it } from 'vitest';
import { RateLimitedError } from '../../shared/errors';
import { hashedKey, rateLimit } from './rate-limiter';

const fakeReq = (ip: string, subject?: string): Request =>
  ({ ip, headers: {}, body: subject === undefined ? {} : { subject } }) as unknown as Request;

/** Runs one middleware call and reports what it passed to `next`. */
const hit = (mw: ReturnType<typeof rateLimit>, req: Request): Promise<unknown> =>
  new Promise((resolve) => {
    mw(req, {} as Response, ((error?: unknown) => {
      resolve(error);
    }) as NextFunction);
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

describe('hashedKey', () => {
  it('is stable, short, and never the value itself', () => {
    const cookie = 'refresh-token-value-that-must-never-sit-in-redis';
    expect(hashedKey(cookie)).toBe(hashedKey(cookie));
    expect(hashedKey(cookie)).toMatch(/^[0-9a-f]{32}$/);
    expect(hashedKey(cookie)).not.toContain('refresh');
    expect(hashedKey('a')).not.toBe(hashedKey('b'));
  });
});
