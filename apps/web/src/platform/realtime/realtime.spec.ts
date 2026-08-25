// The client half of ADR-029, held to its four promises: an update signal reaches the right
// query keys (user test 2), a lost connection reconciles on return (6), duplicates cost one
// refetch (7), and ordering cannot matter (8) — plus the seam that keeps the two registries,
// server and client, from drifting apart.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENTITY_CHANGED_EVENT } from '@ecms/contracts';
import { createCoalescer } from './coalescer';
import { createRealtimeClient, NOTIFICATIONS_TOPIC, type RealtimeSocket } from './realtime-client';
import {
  ALL_REALTIME_KEY_PREFIXES,
  INVALIDATION_REGISTRY,
  keysForTopic,
  NOTIFICATION_KEYS,
} from './invalidation-registry';

// ── Coalescer ───────────────────────────────────────────────────────────────
describe('coalescer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('turns a burst of duplicates into one flush with one topic', () => {
    const flushes: ReadonlySet<string>[] = [];
    const coalescer = createCoalescer(300, (topics) => flushes.push(topics));
    for (let i = 0; i < 50; i += 1) coalescer.push('gold.bar');
    vi.advanceTimersByTime(299);
    expect(flushes).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(flushes).toHaveLength(1);
    expect([...(flushes[0] ?? [])]).toEqual(['gold.bar']);
  });

  it('a cancelled coalescer never fires', () => {
    const onFlush = vi.fn();
    const coalescer = createCoalescer(300, onFlush);
    coalescer.push('gold.bar');
    coalescer.cancel();
    vi.advanceTimersByTime(1000);
    expect(onFlush).not.toHaveBeenCalled();
  });
});

// ── Client over a fake socket ───────────────────────────────────────────────
type Handler = (payload: unknown) => void;

const fakeSocket = (): RealtimeSocket & {
  fire: (event: string, payload?: unknown) => void;
  disconnected: () => boolean;
} => {
  const handlers = new Map<string, Handler[]>();
  let disconnected = false;
  return {
    on: (event, listener) => {
      handlers.set(event, [...(handlers.get(event) ?? []), listener]);
    },
    disconnect: () => {
      disconnected = true;
    },
    fire: (event, payload) => {
      for (const handler of handlers.get(event) ?? []) handler(payload);
    },
    disconnected: () => disconnected,
  };
};

const payload = (over: Partial<Record<'module' | 'entity' | 'entityId' | 'action' | 'at', string>> = {}) => ({
  module: 'hr',
  entity: 'employee',
  entityId: 'e1',
  action: 'update',
  at: '2026-08-25T10:00:00.000Z',
  ...over,
});

describe('realtime client', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const build = () => {
    const socket = fakeSocket();
    const batches: ReadonlySet<string>[] = [];
    const onReconnect = vi.fn();
    const onConnectedChange = vi.fn();
    const client = createRealtimeClient({
      connectSocket: () => socket,
      onTopics: (topics) => batches.push(topics),
      onReconnect,
      onConnectedChange,
      flushMs: 300,
    });
    return { socket, batches, onReconnect, onConnectedChange, client };
  };

  it('an update signal becomes the topic that names its screens', () => {
    const { socket, batches, client } = build();
    client.start();
    socket.fire('connect');
    socket.fire(ENTITY_CHANGED_EVENT, payload());
    vi.advanceTimersByTime(300);
    expect(batches).toHaveLength(1);
    expect([...(batches[0] ?? [])]).toEqual(['hr.employee']);
  });

  it('fifty duplicate signals cost one batch — and out-of-order arrival changes nothing', () => {
    const { socket, batches, client } = build();
    client.start();
    socket.fire('connect');
    // Newest first, oldest last — a client that trusted arrival order would regress here. The
    // batch is a SET of topics with no state at all, so there is nothing to regress.
    socket.fire(ENTITY_CHANGED_EVENT, payload({ at: '2026-08-25T12:00:00.000Z' }));
    for (let i = 0; i < 49; i += 1) {
      socket.fire(ENTITY_CHANGED_EVENT, payload({ at: '2026-08-25T09:00:00.000Z' }));
    }
    socket.fire(ENTITY_CHANGED_EVENT, payload({ entity: 'contract' }));
    vi.advanceTimersByTime(300);
    expect(batches).toHaveLength(1);
    expect([...(batches[0] ?? [])].sort()).toEqual(['hr.contract', 'hr.employee']);
  });

  it('a malformed signal is dropped, not thrown', () => {
    const { socket, batches, client } = build();
    client.start();
    socket.fire('connect');
    expect(() => socket.fire(ENTITY_CHANGED_EVENT, { junk: true })).not.toThrow();
    vi.advanceTimersByTime(300);
    expect(batches).toHaveLength(0);
  });

  it('reconnect — and only RE-connect — asks for reconciliation', () => {
    const { socket, onReconnect, onConnectedChange, client } = build();
    client.start();
    socket.fire('connect');
    expect(onReconnect).not.toHaveBeenCalled(); // first connect: everything was just fetched
    socket.fire('disconnect');
    expect(onConnectedChange).toHaveBeenLastCalledWith(false);
    socket.fire('connect');
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(onConnectedChange).toHaveBeenLastCalledWith(true);
  });

  it('notification pushes ride the same pipe under their own topic', () => {
    const { socket, batches, client } = build();
    client.start();
    socket.fire('connect');
    socket.fire('notification:new', { id: 'n1' });
    socket.fire('notification:read', { id: 'n0' });
    vi.advanceTimersByTime(300);
    expect([...(batches[0] ?? [])]).toEqual([NOTIFICATIONS_TOPIC]);
  });

  it('stop() silences everything, including a batch already pending', () => {
    const { socket, batches, onConnectedChange, client } = build();
    client.start();
    socket.fire('connect');
    socket.fire(ENTITY_CHANGED_EVENT, payload());
    client.stop();
    vi.advanceTimersByTime(1000);
    expect(batches).toHaveLength(0);
    expect(socket.disconnected()).toBe(true);
    expect(onConnectedChange).toHaveBeenLastCalledWith(false);
  });
});

// ── Registry integrity, including against the api's own source ─────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const API_REGISTRY = readFileSync(
  resolve(HERE, '../../../../api/src/platform/realtime/realtime-registry.ts'),
  'utf8',
);
const code = API_REGISTRY.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const serverTopics = [...code.matchAll(/'([a-z][a-zA-Z]*\.[a-zA-Z]+)':\s*\{\s*permission:/g)].map(
  (match) => match[1] ?? '',
);
const serverExcluded = [...code.matchAll(/'([a-z][a-zA-Z]*\.[a-zA-Z]+)':\s*'[^']/g)].map(
  (match) => match[1] ?? '',
);

describe('invalidation registry ↔ api registry', () => {
  it('read both sides', () => {
    expect(serverTopics.length).toBeGreaterThan(80);
    expect(serverExcluded.length).toBeGreaterThan(0);
  });

  it('maps every topic the server can broadcast', () => {
    const unmapped = serverTopics.filter(
      (topic) =>
        // The two stream topics map to the audit/activity screens like any other row.
        keysForTopic(topic).length === 0,
    );
    expect(unmapped).toEqual([]);
  });

  it('names no topic the server does not know', () => {
    const known = new Set([...serverTopics, ...serverExcluded]);
    const phantom = Object.keys(INVALIDATION_REGISTRY).filter((topic) => !known.has(topic));
    expect(phantom).toEqual([]);
  });

  it('every mapped prefix is a non-empty key path, and the reconnect sweep covers them all', () => {
    const sweep = new Set(ALL_REALTIME_KEY_PREFIXES.map((prefix) => JSON.stringify(prefix)));
    for (const prefixes of Object.values(INVALIDATION_REGISTRY)) {
      expect(prefixes.length).toBeGreaterThan(0);
      for (const prefix of prefixes) {
        expect(prefix.length).toBeGreaterThan(0);
        expect(sweep.has(JSON.stringify(prefix))).toBe(true);
      }
    }
    for (const prefix of NOTIFICATION_KEYS) {
      expect(sweep.has(JSON.stringify(prefix))).toBe(true);
    }
  });
});
