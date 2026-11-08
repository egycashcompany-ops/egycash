// Mounts the realtime connection for the signed-in session (ADR-029). Renders nothing — its
// whole output is cache invalidation: a coalesced batch of changed topics becomes one sweep of
// `invalidateQueries` over the registry's key prefixes, and TanStack Query refetches whatever is
// actually on screen through the normal authorized api. The socket is the same one the
// notification bell's live push rides; auth is the in-memory access token, re-read on every
// (re)connect attempt. The few prefixes the registry marks as throttled (D13: the fleet dashboard's
// live reads) are not swept: they are marked stale at once and refetched at most once per window.
//
// Since 2026-11 (the API was measured query-bound, the ATM board its busiest read): the ATM topics
// ride the client's debounced heavy lane (`HEAVY_REALTIME_TOPICS`); the boards' dropdowns and done
// ranges are only marked stale (`isStaleOnlyKey`); and a HIDDEN tab refetches nothing — it marks,
// and refetches what went stale once it is shown again (`invalidator.ts`). The reader's own writes
// are untouched: their hooks refetch at once, outside realtime.
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { useAppSelector } from '../../store';
import { apiOrigin, getAccessToken } from '../../shared/lib/api-client';
import { createRealtimeClient, NOTIFICATIONS_TOPIC } from './realtime-client';
import {
  ALL_REALTIME_KEY_PREFIXES,
  HEAVY_REALTIME_TOPICS,
  isStaleOnlyKey,
  keysForTopic,
  NOTIFICATION_KEYS,
  THROTTLED_KEY_PREFIXES,
} from './invalidation-registry';
import { createRealtimeInvalidator } from './invalidator';
import { setRealtimeConnected } from './realtime-status';

/**
 * Is the page hidden — another tab, a minimised window? Read at call time and only from effects
 * and listeners, never at module load or render: the specs render this tree in node.
 */
const pageHidden = (): boolean =>
  typeof document !== 'undefined' && document.visibilityState === 'hidden';

export const RealtimeProvider = (): null => {
  const queryClient = useQueryClient();
  const signedIn = useAppSelector((state) => state.auth.status === 'signedIn');

  useEffect(() => {
    if (!signedIn) return undefined;

    const invalidator = createRealtimeInvalidator(queryClient, {
      isHidden: pageHidden,
      throttled: THROTTLED_KEY_PREFIXES,
      isStaleOnly: isStaleOnlyKey,
    });

    const client = createRealtimeClient({
      connectSocket: () =>
        io(apiOrigin(), {
          // Callback form on purpose: evaluated per connection ATTEMPT, so a reconnect after a
          // silent refresh presents the fresh token, not the one from page load.
          auth: (cb) => cb({ token: getAccessToken() ?? '' }),
          transports: ['websocket', 'polling'],
        }),
      onTopics: (topics) => {
        const prefixes = [...topics].flatMap((topic) =>
          topic === NOTIFICATIONS_TOPIC ? NOTIFICATION_KEYS : keysForTopic(topic),
        );
        invalidator.invalidate(prefixes);
      },
      // Anything could have changed while the connection was down — stale-mark the whole
      // realtime-covered set once; only mounted screens refetch now, the rest on next open.
      onReconnect: () => invalidator.invalidate(ALL_REALTIME_KEY_PREFIXES),
      onConnectedChange: setRealtimeConnected,
      heavyTopics: HEAVY_REALTIME_TOPICS,
    });

    // Realtime is an ENHANCEMENT: without it screens still fetch on navigation and staleness.
    // So nothing here may ever reach the error boundary — an effect that throws at App level
    // takes down every page, which is exactly what a bad api origin did once (relative
    // VITE_API_BASE_URL through `new URL`). One broken socket must cost live updates, nothing more.
    try {
      client.start();
    } catch {
      // Swallowed, not reported: the fallback is fully defined behaviour, not a degraded state
      // needing a decision. `setRealtimeConnected` was never called, so the bell keeps its
      // one-minute poll and every screen keeps fetching on navigation — the platform as it was
      // before realtime existed. There is no user action to prompt and no logger on the web.
      return undefined;
    }

    // Back from hidden: what is on screen and went stale meanwhile is refetched, once.
    const onVisibility = (): void => {
      if (!pageHidden()) invalidator.visible();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      invalidator.cancel();
      try {
        client.stop();
      } catch {
        /* teardown of an already-broken socket is not the page's problem */
      }
    };
  }, [signedIn, queryClient]);

  return null;
};
