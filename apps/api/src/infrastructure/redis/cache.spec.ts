// The lease primitives (docs/12-planning/atm-map-zones.md §5.1, DM-47): taken in one atomic step
// that always carries its TTL, and released only by the holder. Runs on the in-memory cache the
// test environment uses; the Redis implementation is the same contract in one `SET … NX EX` and one
// compare-and-delete script.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryCache } from './cache';

afterEach(() => {
  vi.useRealTimers();
});

describe('setIfAbsent / delIfValue', () => {
  it('takes a free key once, and refuses it while it is held', async () => {
    const cache = new MemoryCache();
    expect(await cache.setIfAbsent('lock:x', 'run-a', 60)).toBe(true);
    expect(await cache.setIfAbsent('lock:x', 'run-b', 60)).toBe(false);
    expect(await cache.get('lock:x')).toBe('run-a');
  });

  it('frees itself when its TTL ends, so a holder that dies cannot keep it', async () => {
    vi.useFakeTimers();
    const cache = new MemoryCache();
    expect(await cache.setIfAbsent('lock:x', 'run-a', 60)).toBe(true);
    vi.advanceTimersByTime(60_001);
    expect(await cache.setIfAbsent('lock:x', 'run-b', 60)).toBe(true);
    expect(await cache.get('lock:x')).toBe('run-b');
  });

  it('a release deletes only the holder’s own value — never a successor’s', async () => {
    const cache = new MemoryCache();
    await cache.setIfAbsent('lock:x', 'run-a', 60);
    await cache.delIfValue('lock:x', 'run-b');
    expect(await cache.get('lock:x')).toBe('run-a');
    await cache.delIfValue('lock:x', 'run-a');
    expect(await cache.get('lock:x')).toBeNull();
  });
});
