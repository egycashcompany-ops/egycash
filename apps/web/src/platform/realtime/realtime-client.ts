// The socket lifecycle, kept pure enough to test with a fake socket (ADR-029). What this owns:
// connect/reconnect bookkeeping, payload validation, and turning transport events into coalesced
// topic sets. What it deliberately does NOT own: URLs, auth tokens, React, or the query cache —
// those arrive as dependencies.
import { ENTITY_CHANGED_EVENT, EntityChangedPayloadSchema, realtimeTopic } from '@ecms/contracts';
import { createCoalescer, createDebouncedCoalescer, type Coalescer } from './coalescer';

/** Sentinel topic for the personal notification channel (`notification:new` / `:read`). */
export const NOTIFICATIONS_TOPIC = '__notifications__';

const FLUSH_MS = 300;

/**
 * The heavy lane (`createDebouncedCoalescer`): a burst of a heavy topic is one refetch once it has
 * been quiet for 1.5 s, at most 4 s after it began — then up to 1.5 s more, this client's own draw.
 */
export const HEAVY_DEBOUNCE_MS = 1_500;
export const HEAVY_MAX_WAIT_MS = 4_000;
export const HEAVY_JITTER_MAX_MS = 1_500;

export interface RealtimeSocket {
  on: (event: string, listener: (payload: unknown) => void) => unknown;
  disconnect: () => unknown;
}

export interface RealtimeClientDeps {
  /** Opens a NEW socket, already pointed at the api origin with auth attached. */
  connectSocket: () => RealtimeSocket;
  /** One coalesced batch of changed topics — invalidate their keys. */
  onTopics: (topics: ReadonlySet<string>) => void;
  /**
   * The connection came BACK after being lost. The caller must reconcile — everything missed
   * while offline is unknowable, so the whole realtime-covered key set goes stale at once
   * (mounted screens refetch, the rest refetch when next opened). Not fired on first connect:
   * the app just fetched everything it shows.
   */
  onReconnect: () => void;
  onConnectedChange: (connected: boolean) => void;
  flushMs?: number;
  /**
   * Topics whose refetch is a heavy read (the registry's `HEAVY_REALTIME_TOPICS`): batched in their
   * own debounced lane instead of the 300 ms window. Their flush reaches `onTopics` like any other.
   */
  heavyTopics?: ReadonlySet<string>;
  /** `[0, 1)` — this client's jitter draw (`Math.random` unless a spec pins it). */
  random?: () => number;
}

export interface RealtimeClient {
  start: () => void;
  stop: () => void;
}

export const createRealtimeClient = (deps: RealtimeClientDeps): RealtimeClient => {
  let socket: RealtimeSocket | null = null;
  let coalescers: Coalescer[] = [];
  let everConnected = false;
  const heavyTopics = deps.heavyTopics ?? new Set<string>();

  const start = (): void => {
    if (socket !== null) return;
    everConnected = false;
    const batch = createCoalescer(deps.flushMs ?? FLUSH_MS, deps.onTopics);
    // Drawn once per client: every viewer of a board heard the same signal at the same moment, and
    // this offset is what keeps their refetches from reaching the server together.
    const jitterMs = Math.floor((deps.random ?? Math.random)() * HEAVY_JITTER_MAX_MS);
    const heavy = createDebouncedCoalescer(
      { debounceMs: HEAVY_DEBOUNCE_MS, maxWaitMs: HEAVY_MAX_WAIT_MS, jitterMs },
      deps.onTopics,
    );
    coalescers = [batch, heavy];
    const opened = deps.connectSocket();
    socket = opened;

    opened.on('connect', () => {
      deps.onConnectedChange(true);
      if (everConnected) deps.onReconnect();
      everConnected = true;
    });
    opened.on('disconnect', () => deps.onConnectedChange(false));
    opened.on(ENTITY_CHANGED_EVENT, (raw: unknown) => {
      const parsed = EntityChangedPayloadSchema.safeParse(raw);
      // An unparseable signal is a version skew, never a reason to break the page.
      if (!parsed.success) return;
      const topic = realtimeTopic(parsed.data.module, parsed.data.entity);
      (heavyTopics.has(topic) ? heavy : batch).push(topic);
    });
    opened.on('notification:new', () => batch.push(NOTIFICATIONS_TOPIC));
    opened.on('notification:read', () => batch.push(NOTIFICATIONS_TOPIC));
  };

  const stop = (): void => {
    for (const lane of coalescers) lane.cancel();
    coalescers = [];
    socket?.disconnect();
    socket = null;
    deps.onConnectedChange(false);
  };

  return { start, stop };
};
