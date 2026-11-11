// The realtime rules added when the API was measured query-bound (2026-11), the ATM board its
// busiest read — every viewer re-read every board on every signal, hidden tabs included:
//
//   · the ATM topics ride their own lane: a trailing 1.5 s debounce, a 4 s ceiling, and a 0–1.5 s
//     offset drawn once per client — one bulk action is one refetch, and the viewers' refetches do
//     not reach the server at one instant (fake timers);
//   · a hidden tab refetches nothing: signals only mark stale, and showing the tab refetches what is
//     on screen and went stale, once;
//   · the boards' dropdowns and done ranges are only marked stale by a signal, never refetched;
//   · the rest of the sweep, and the fleet dashboard's throttle, are what they were.
//
// The cache half runs over a real QueryClient with mounted (observed) and unmounted queries.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { ENTITY_CHANGED_EVENT } from '@ecms/contracts';
import { createDebouncedCoalescer } from './coalescer';
import {
  HEAVY_DEBOUNCE_MS,
  HEAVY_JITTER_MAX_MS,
  HEAVY_MAX_WAIT_MS,
  createRealtimeClient,
  type RealtimeSocket,
} from './realtime-client';
import {
  HEAVY_REALTIME_TOPICS,
  THROTTLED_KEY_PREFIXES,
  isStaleOnlyKey,
  keysForTopic,
} from './invalidation-registry';
import { createRealtimeInvalidator } from './invalidator';
import { listKey } from '../../shared/lib/query-keys';

// ── The heavy lane ──────────────────────────────────────────────────────────
describe('the heavy lane’s coalescer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const lane = (jitterMs = 0) => {
    const flushes: string[][] = [];
    const coalescer = createDebouncedCoalescer(
      { debounceMs: HEAVY_DEBOUNCE_MS, maxWaitMs: HEAVY_MAX_WAIT_MS, jitterMs },
      (topics) => flushes.push([...topics].sort()),
    );
    return { flushes, coalescer };
  };

  it('is 1.5 s quiet, 4 s at most, and up to 1.5 s of offset', () => {
    expect([HEAVY_DEBOUNCE_MS, HEAVY_MAX_WAIT_MS, HEAVY_JITTER_MAX_MS]).toEqual([1500, 4000, 1500]);
  });

  it('turns one bulk action — two hundred signals over a second — into ONE flush, after it ends', () => {
    const { flushes, coalescer } = lane();
    for (let i = 0; i < 200; i += 1) {
      coalescer.push(i % 2 === 0 ? 'atm.replenishment' : 'atm.maintenance');
      vi.advanceTimersByTime(5); // 200 signals over one second
    }
    expect(flushes).toEqual([]);
    vi.advanceTimersByTime(HEAVY_DEBOUNCE_MS - 6);
    expect(flushes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(flushes).toEqual([['atm.maintenance', 'atm.replenishment']]);
    vi.advanceTimersByTime(60_000);
    expect(flushes).toHaveLength(1);
  });

  it('flushes a stream that never goes quiet at most every 4 s', () => {
    const { flushes, coalescer } = lane();
    for (let second = 0; second < 20; second += 1) {
      coalescer.push('atm.replenishment');
      vi.advanceTimersByTime(500);
      coalescer.push('atm.replenishment');
      vi.advanceTimersByTime(500);
    }
    // Twenty seconds of a signal every half second: one flush per 4-second ceiling, not forty.
    expect(flushes.length).toBeGreaterThanOrEqual(4);
    expect(flushes.length).toBeLessThanOrEqual(5);
    vi.advanceTimersByTime(HEAVY_DEBOUNCE_MS);
    expect(flushes.length).toBeLessThanOrEqual(6);
  });

  it('adds the client’s offset to the flush', () => {
    const { flushes, coalescer } = lane(900);
    coalescer.push('atm.mailTicket');
    vi.advanceTimersByTime(HEAVY_DEBOUNCE_MS + 899);
    expect(flushes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(flushes).toEqual([['atm.mailTicket']]);
  });

  it('a cancelled lane never fires', () => {
    const { flushes, coalescer } = lane();
    coalescer.push('atm.replenishment');
    coalescer.cancel();
    vi.advanceTimersByTime(HEAVY_MAX_WAIT_MS * 3);
    expect(flushes).toEqual([]);
  });
});

// ── The client routes the ATM topics to it ──────────────────────────────────
type Handler = (payload: unknown) => void;

const fakeSocket = (): RealtimeSocket & { fire: (event: string, payload?: unknown) => void } => {
  const handlers = new Map<string, Handler[]>();
  return {
    on: (event, listener) => {
      handlers.set(event, [...(handlers.get(event) ?? []), listener]);
    },
    disconnect: () => undefined,
    fire: (event, payload) => {
      for (const handler of handlers.get(event) ?? []) handler(payload);
    },
  };
};

const signal = (module: string, entity: string) => ({
  module,
  entity,
  entityId: 'e1',
  action: 'update',
  at: '2026-11-04T10:00:00.000Z',
});

describe('the realtime client’s two lanes', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const viewer = (draw: number) => {
    const socket = fakeSocket();
    const batches: { at: number; topics: string[] }[] = [];
    const client = createRealtimeClient({
      connectSocket: () => socket,
      onTopics: (topics) => batches.push({ at: Date.now(), topics: [...topics].sort() }),
      onReconnect: () => undefined,
      onConnectedChange: () => undefined,
      flushMs: 300,
      heavyTopics: HEAVY_REALTIME_TOPICS,
      random: () => draw,
    });
    client.start();
    socket.fire('connect');
    return { socket, batches, client };
  };

  it('keeps a light topic on the 300 ms window, and holds an ATM topic for its own lane', () => {
    const { socket, batches } = viewer(0);
    const start = Date.now();
    socket.fire(ENTITY_CHANGED_EVENT, signal('hr', 'employee'));
    socket.fire(ENTITY_CHANGED_EVENT, signal('atm', 'replenishment'));
    vi.advanceTimersByTime(300);
    expect(batches).toEqual([{ at: start + 300, topics: ['hr.employee'] }]);
    vi.advanceTimersByTime(HEAVY_DEBOUNCE_MS - 300);
    expect(batches[1]).toEqual({ at: start + HEAVY_DEBOUNCE_MS, topics: ['atm.replenishment'] });
  });

  it('sends every ATM board topic through the heavy lane — a mail decision too', () => {
    const { socket, batches } = viewer(0);
    for (const entity of ['replenishment', 'maintenance', 'mailTicket']) {
      socket.fire(ENTITY_CHANGED_EVENT, signal('atm', entity));
    }
    vi.advanceTimersByTime(300);
    expect(batches).toEqual([]);
    vi.advanceTimersByTime(HEAVY_DEBOUNCE_MS);
    expect(batches.map((batch) => batch.topics)).toEqual([
      ['atm.mailTicket', 'atm.maintenance', 'atm.replenishment'],
    ]);
  });

  it('two viewers of one signal refetch at different moments — each at its own offset', () => {
    const first = viewer(0.1);
    const second = viewer(0.9);
    const start = Date.now();
    first.socket.fire(ENTITY_CHANGED_EVENT, signal('atm', 'maintenance'));
    second.socket.fire(ENTITY_CHANGED_EVENT, signal('atm', 'maintenance'));
    vi.advanceTimersByTime(HEAVY_DEBOUNCE_MS + HEAVY_JITTER_MAX_MS);
    expect(first.batches[0]?.at).toBe(start + HEAVY_DEBOUNCE_MS + 150);
    expect(second.batches[0]?.at).toBe(start + HEAVY_DEBOUNCE_MS + 1350);
  });

  it('stop() silences the heavy lane too', () => {
    const { socket, batches, client } = viewer(0);
    socket.fire(ENTITY_CHANGED_EVENT, signal('atm', 'replenishment'));
    client.stop();
    vi.advanceTimersByTime(HEAVY_MAX_WAIT_MS * 2);
    expect(batches).toEqual([]);
  });
});

describe('the registry’s heavy topics and stale-only keys', () => {
  it('names exactly the ATM board topics, each one a mapped topic', () => {
    expect([...HEAVY_REALTIME_TOPICS].sort()).toEqual([
      'atm.mailTicket',
      'atm.maintenance',
      'atm.replenishment',
    ]);
    for (const topic of HEAVY_REALTIME_TOPICS)
      expect(keysForTopic(topic).length).toBeGreaterThan(0);
  });

  it('marks only the boards’ dropdowns and done ranges stale-only — never the board itself', () => {
    for (const feature of ['replenishments', 'maintenances']) {
      expect(isStaleOnlyKey(listKey('atm', feature, { kind: 'facets', banks: [] }))).toBe(true);
      expect(
        isStaleOnlyKey(listKey('atm', feature, { kind: 'done', whole: true, from: 'a', to: 'b' })),
      ).toBe(true);
      expect(
        isStaleOnlyKey(
          listKey('atm', feature, { kind: 'open', whole: true, banks: [], areas: [] }),
        ),
      ).toBe(false);
    }
    expect(isStaleOnlyKey(listKey('atm', 'mailTickets', { kind: 'pending', whole: true }))).toBe(
      false,
    );
    expect(isStaleOnlyKey(listKey('atm', 'leaders', { kind: 'options' }))).toBe(false);
    expect(isStaleOnlyKey(listKey('fleet', 'vehicles', { kind: 'done' }))).toBe(false);
    expect(isStaleOnlyKey(['atm', 'replenishments'])).toBe(false);
    // The Operations shipments history — a whole range of day boards — is marked stale only; the
    // day board itself, a single day, is still refetched.
    expect(
      isStaleOnlyKey(['operations', 'dayBoard', 'history', { from: '2026-11-01', to: '2026-11-11' }]),
    ).toBe(true);
    // ...and so are its deleted shipments, the same range over deleted rows. One shipment's log
    // is a small read and is refetched like the day board, so an open log follows another desk.
    expect(
      isStaleOnlyKey(['operations', 'dayBoard', 'deleted', { from: '2026-11-01', to: '2026-11-11' }]),
    ).toBe(true);
    expect(isStaleOnlyKey(['operations', 'dayBoard', 'log', { id: 's1' }])).toBe(false);
    expect(isStaleOnlyKey(listKey('operations', 'dayBoard', { date: 'today' }))).toBe(false);
  });
});

// ── The cache: hidden tabs and stale-only keys ──────────────────────────────
const BOARD = listKey('atm', 'replenishments', {
  kind: 'open',
  whole: true,
  banks: [],
  areas: [],
});
const FACETS = listKey('atm', 'replenishments', { kind: 'facets', banks: [] });
const DONE = listKey('atm', 'replenishments', {
  kind: 'done',
  whole: true,
  from: '2026-11-04',
  to: '2026-11-04',
});
const MAIL = listKey('atm', 'mailTickets', { kind: 'pending', whole: true });
const DASHBOARD_NOW = [...(THROTTLED_KEY_PREFIXES[0] ?? []), { tab: 1 }];

/** Let the cache's fetch promises settle. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const cache = async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
  const reads = new Map<string, number>();
  const mounted = (queryKey: readonly unknown[]) => {
    const name = JSON.stringify(queryKey);
    const observer = new QueryObserver(qc, {
      queryKey,
      queryFn: () => {
        reads.set(name, (reads.get(name) ?? 0) + 1);
        return Promise.resolve(reads.get(name));
      },
    });
    return observer.subscribe(() => undefined);
  };
  const stops = [BOARD, FACETS, DONE, MAIL, DASHBOARD_NOW].map(mounted);
  await settle();
  // One the reader is NOT on: in the cache, no observer.
  const UNMOUNTED = listKey('atm', 'maintenances', { kind: 'open', whole: true });
  qc.setQueryData(UNMOUNTED, 'cached');
  let hidden = false;
  const invalidator = createRealtimeInvalidator(qc, {
    isHidden: () => hidden,
    throttled: THROTTLED_KEY_PREFIXES,
    isStaleOnly: isStaleOnlyKey,
  });
  return {
    qc,
    invalidator,
    readsOf: (key: readonly unknown[]) => reads.get(JSON.stringify(key)) ?? 0,
    invalidated: (key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated ?? false,
    UNMOUNTED,
    hide: () => {
      hidden = true;
    },
    show: () => {
      hidden = false;
      invalidator.visible();
    },
    stop: () => {
      invalidator.cancel();
      for (const stop of stops) stop();
    },
  };
};

describe('a signal, in the cache', () => {
  it('refetches the board on screen, and only MARKS its dropdowns and done range stale', async () => {
    const view = await cache();
    expect(view.readsOf(BOARD)).toBe(1);
    view.invalidator.invalidate(keysForTopic('atm.replenishment'));
    await settle();
    expect(view.readsOf(BOARD)).toBe(2);
    expect(view.readsOf(FACETS)).toBe(1);
    expect(view.readsOf(DONE)).toBe(1);
    expect(view.invalidated(FACETS)).toBe(true);
    expect(view.invalidated(DONE)).toBe(true);
    // A board the reader is not on is marked, and read when next opened.
    expect(view.invalidated(view.UNMOUNTED)).toBe(false);
    view.invalidator.invalidate(keysForTopic('atm.maintenance'));
    await settle();
    expect(view.invalidated(view.UNMOUNTED)).toBe(true);
    view.stop();
  });

  it('in a hidden tab refetches nothing — and showing it refetches what went stale, once', async () => {
    const view = await cache();
    view.hide();
    view.invalidator.invalidate(keysForTopic('atm.replenishment'));
    view.invalidator.invalidate(keysForTopic('atm.mailTicket'));
    view.invalidator.invalidate(keysForTopic('atm.replenishment'));
    await settle();
    expect(view.readsOf(BOARD)).toBe(1);
    expect(view.readsOf(MAIL)).toBe(1);
    expect(view.invalidated(BOARD)).toBe(true);
    expect(view.invalidated(MAIL)).toBe(true);

    view.show();
    await settle();
    // Three signals while hidden: ONE refetch of each screen on show.
    expect(view.readsOf(BOARD)).toBe(2);
    expect(view.readsOf(MAIL)).toBe(2);
    // Still only marked: the dropdowns and the done range wait for their next read.
    expect(view.readsOf(FACETS)).toBe(1);
    expect(view.readsOf(DONE)).toBe(1);
    // A second show with nothing missed costs nothing.
    view.hide();
    view.show();
    await settle();
    expect(view.readsOf(BOARD)).toBe(2);
    view.stop();
  });

  it('a reconnect’s whole sweep while hidden waits for the tab too', async () => {
    const view = await cache();
    view.hide();
    view.invalidator.invalidate([
      ['atm', 'replenishments'],
      ['atm', 'mailTickets'],
    ]);
    await settle();
    expect(view.readsOf(BOARD)).toBe(1);
    view.show();
    await settle();
    expect(view.readsOf(BOARD)).toBe(2);
    expect(view.readsOf(MAIL)).toBe(2);
    view.stop();
  });

  it('showing a tab that missed nothing refetches nothing', async () => {
    const view = await cache();
    view.hide();
    view.show();
    await settle();
    expect(view.readsOf(BOARD)).toBe(1);
    view.stop();
  });
});

describe('the fleet dashboard’s throttle, with a hidden tab', () => {
  it('still refetches at once when visible, and not at all while hidden', async () => {
    const view = await cache();
    const prefix = THROTTLED_KEY_PREFIXES[0] ?? [];
    view.invalidator.invalidate([prefix]);
    await settle();
    expect(view.readsOf(DASHBOARD_NOW)).toBe(2);

    const hidden = await cache();
    hidden.hide();
    hidden.invalidator.invalidate([prefix]);
    await settle();
    expect(hidden.readsOf(DASHBOARD_NOW)).toBe(1);
    hidden.show();
    await settle();
    expect(hidden.readsOf(DASHBOARD_NOW)).toBe(2);
    view.stop();
    hidden.stop();
  });

  it('a trailing refetch that falls due while hidden waits for the tab', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const refetch = vi.spyOn(qc, 'refetchQueries');
    let hidden = false;
    const invalidator = createRealtimeInvalidator(qc, {
      isHidden: () => hidden,
      throttled: THROTTLED_KEY_PREFIXES,
      isStaleOnly: isStaleOnlyKey,
      throttleMs: 20,
    });
    const prefix = THROTTLED_KEY_PREFIXES[0] ?? [];
    invalidator.invalidate([prefix]); // refetches now, opens the window
    invalidator.invalidate([prefix]); // remembered for the window's end
    expect(refetch).toHaveBeenCalledTimes(1);
    hidden = true;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(refetch).toHaveBeenCalledTimes(1);
    hidden = false;
    invalidator.visible();
    expect(refetch).toHaveBeenCalledTimes(2);
    invalidator.cancel();
  });
});
