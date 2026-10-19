// Redis-backed fixed-window rate limiter (API Standards §9): strict on auth,
// standard on writes, generous on reads. Also a limit that counts only failed attempts.
import { createHash } from 'node:crypto';
import { type NextFunction, type Request, type Response } from 'express';
import { RateLimitedError } from '../../shared/errors';
import { getCache } from './cache';

export interface RateLimitRule {
  /** Rule name — part of the Redis key. */
  name: string;
  windowSeconds: number;
  max: number;
  /** Extracts the client key; return null to skip limiting for this request. */
  keyOf?: (req: Request) => string | null;
}

/**
 * A bucket name for a value that must never sit in Redis as itself — a refresh cookie, a one-time
 * token, an e-mail address. One-way and stable, so the same value always lands in the same bucket.
 */
export const hashedKey = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 32);

export const consumeRateLimit = async (
  rule: RateLimitRule,
  clientKey: string,
): Promise<{ allowed: boolean; retryAfter: number }> => {
  const { count, ttl } = await getCache().incrWithTtl(
    `rl:${rule.name}:${clientKey}`,
    rule.windowSeconds,
  );
  return { allowed: count <= rule.max, retryAfter: ttl };
};

/** One attempt under a limit that counts only the attempts that fail. */
export interface CountedAttempt {
  allowed: boolean;
  /** Seconds until the window ends. */
  retryAfter: number;
  /** Say how the attempt ended. Anything but a failure hands its slot back. */
  settle(failed: boolean): Promise<void>;
}

/**
 * A limit on FAILED attempts, for a route whose successes must stay free (sign-in).
 *
 * Each attempt takes a slot when it starts and hands it back unless it fails, so the slots in use
 * are the failures plus the attempts still running. Counting the running ones is what stops a
 * burst of parallel requests from all passing a check made before any of them had failed. Once
 * `max` slots are in use, every further attempt is refused until the window ends.
 *
 * The windows are fixed slots of the clock, and both counters are named after their slot, so an
 * attempt that ends after the slot has turned over hands its slot back to its own window and not
 * to the next one.
 */
export const startCountedAttempt = async (
  rule: Omit<RateLimitRule, 'keyOf'>,
  clientKey: string,
): Promise<CountedAttempt> => {
  const windowMs = rule.windowSeconds * 1000;
  const now = Date.now();
  const slot = Math.floor(now / windowMs);
  const retryAfter = Math.max(1, Math.ceil(((slot + 1) * windowMs - now) / 1000));
  const cache = getCache();
  const takenKey = `rl:${rule.name}:${clientKey}:${String(slot)}:taken`;
  const returnedKey = `rl:${rule.name}:${clientKey}:${String(slot)}:returned`;
  const handBack = async (): Promise<void> => {
    await cache.incrWithTtl(returnedKey, retryAfter);
  };

  // Read what was handed back BEFORE taking the slot. Both counters only grow, so a hand-back that
  // lands between the two calls — from this process or another replica — can only make the count
  // of slots in use look higher than it is, never lower: near the limit an attempt may be refused
  // one early, but the limit itself can never be passed. Read after the increment, a concurrent
  // hand-back would make it look lower and let an attempt through over the limit.
  const returned = Number((await cache.get(returnedKey)) ?? 0);
  const { count: taken } = await cache.incrWithTtl(takenKey, retryAfter);
  if (taken - returned > rule.max) {
    // A refused attempt is not a failure: without this, attempts refused while others were still
    // running would keep the address blocked after those others turned out to succeed.
    await handBack();
    return { allowed: false, retryAfter, settle: async () => undefined };
  }
  let settled = false;
  return {
    allowed: true,
    retryAfter,
    settle: async (failed) => {
      if (settled) return;
      settled = true;
      if (!failed) await handBack();
    },
  };
};

export const rateLimit = (rule: RateLimitRule) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const clientKey = rule.keyOf === undefined ? (req.ip ?? 'unknown') : rule.keyOf(req);
    if (clientKey === null) {
      next();
      return;
    }
    consumeRateLimit(rule, clientKey)
      .then(({ allowed, retryAfter }) => {
        if (allowed) next();
        else next(new RateLimitedError(retryAfter));
      })
      .catch(next);
  };
};
