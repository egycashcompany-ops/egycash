// Key-value cache behind a small interface: Redis in dev/staging/production,
// in-memory in tests (keeps the suite hermetic — no Redis dependency).
import { Redis } from 'ioredis';
import { env, isTest } from '../config/env';
import { logger } from '../logging/logger';

export interface KeyValueCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(...keys: string[]): Promise<void>;
  delByPrefix(prefix: string): Promise<void>;
  /** Atomic increment used by the rate limiter; sets TTL on first hit. */
  incrWithTtl(key: string, ttlSeconds: number): Promise<{ count: number; ttl: number }>;
  close(): Promise<void>;
}

class RedisCache implements KeyValueCache {
  private readonly client: Redis;

  constructor(url: string) {
    this.client = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
    this.client.on('error', (error) => logger.error({ err: error }, 'redis error'));
  }

  get raw(): Redis {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds === undefined) await this.client.set(key, value);
    else await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length > 0) await this.client.del(...keys);
  }

  async delByPrefix(prefix: string): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) await this.client.del(...keys);
    } while (cursor !== '0');
  }

  async incrWithTtl(key: string, ttlSeconds: number): Promise<{ count: number; ttl: number }> {
    const count = await this.client.incr(key);
    if (count === 1) await this.client.expire(key, ttlSeconds);
    const ttl = await this.client.ttl(key);
    return { count, ttl: ttl > 0 ? ttl : ttlSeconds };
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

interface MemoryEntry {
  value: string;
  expiresAt: number | null;
}

export class MemoryCache implements KeyValueCache {
  private readonly store = new Map<string, MemoryEntry>();

  private live(key: string): MemoryEntry | undefined {
    const entry = this.store.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds === undefined ? null : Date.now() + ttlSeconds * 1000,
    });
  }

  async del(...keys: string[]): Promise<void> {
    for (const key of keys) this.store.delete(key);
  }

  async delByPrefix(prefix: string): Promise<void> {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  async incrWithTtl(key: string, ttlSeconds: number): Promise<{ count: number; ttl: number }> {
    const entry = this.live(key);
    const count = entry === undefined ? 1 : Number(entry.value) + 1;
    const expiresAt = entry?.expiresAt ?? Date.now() + ttlSeconds * 1000;
    this.store.set(key, { value: String(count), expiresAt });
    return { count, ttl: Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)) };
  }

  async close(): Promise<void> {
    this.store.clear();
  }
}

let cacheInstance: KeyValueCache | null = null;

export const getCache = (): KeyValueCache => {
  if (cacheInstance === null) {
    cacheInstance = isTest ? new MemoryCache() : new RedisCache(env.REDIS_URL);
  }
  return cacheInstance;
};

export const closeCache = async (): Promise<void> => {
  if (cacheInstance !== null) {
    await cacheInstance.close();
    cacheInstance = null;
  }
};
