// Redis-backed fixed-window rate limiter (API Standards §9): strict on auth,
// standard on writes, generous on reads.
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
