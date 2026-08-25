// The socket lifecycle, kept pure enough to test with a fake socket (ADR-029). What this owns:
// connect/reconnect bookkeeping, payload validation, and turning transport events into coalesced
// topic sets. What it deliberately does NOT own: URLs, auth tokens, React, or the query cache —
// those arrive as dependencies.
import { ENTITY_CHANGED_EVENT, EntityChangedPayloadSchema, realtimeTopic } from '@ecms/contracts';
import { createCoalescer, type Coalescer } from './coalescer';

/** Sentinel topic for the personal notification channel (`notification:new` / `:read`). */
export const NOTIFICATIONS_TOPIC = '__notifications__';

const FLUSH_MS = 300;

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
}

export interface RealtimeClient {
  start: () => void;
  stop: () => void;
}

export const createRealtimeClient = (deps: RealtimeClientDeps): RealtimeClient => {
  let socket: RealtimeSocket | null = null;
  let coalescer: Coalescer | null = null;
  let everConnected = false;

  const start = (): void => {
    if (socket !== null) return;
    everConnected = false;
    const batch = createCoalescer(deps.flushMs ?? FLUSH_MS, deps.onTopics);
    coalescer = batch;
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
      batch.push(realtimeTopic(parsed.data.module, parsed.data.entity));
    });
    opened.on('notification:new', () => batch.push(NOTIFICATIONS_TOPIC));
    opened.on('notification:read', () => batch.push(NOTIFICATIONS_TOPIC));
  };

  const stop = (): void => {
    coalescer?.cancel();
    coalescer = null;
    socket?.disconnect();
    socket = null;
    deps.onConnectedChange(false);
  };

  return { start, stop };
};
