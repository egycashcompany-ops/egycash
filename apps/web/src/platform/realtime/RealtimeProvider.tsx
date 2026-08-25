// Mounts the realtime connection for the signed-in session (ADR-029). Renders nothing — its
// whole output is cache invalidation: a coalesced batch of changed topics becomes one sweep of
// `invalidateQueries` over the registry's key prefixes, and TanStack Query refetches whatever is
// actually on screen through the normal authorized api. The socket is the same one the
// notification bell's live push rides; auth is the in-memory access token, re-read on every
// (re)connect attempt.
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { useAppSelector } from '../../store';
import { apiOrigin, getAccessToken } from '../../shared/lib/api-client';
import { createRealtimeClient, NOTIFICATIONS_TOPIC } from './realtime-client';
import { ALL_REALTIME_KEY_PREFIXES, keysForTopic, NOTIFICATION_KEYS } from './invalidation-registry';
import { setRealtimeConnected } from './realtime-status';

export const RealtimeProvider = (): null => {
  const queryClient = useQueryClient();
  const signedIn = useAppSelector((state) => state.auth.status === 'signedIn');

  useEffect(() => {
    if (!signedIn) return undefined;

    const invalidate = (prefixes: Iterable<readonly unknown[]>): void => {
      const unique = new Map<string, readonly unknown[]>();
      for (const prefix of prefixes) unique.set(JSON.stringify(prefix), prefix);
      for (const queryKey of unique.values()) void queryClient.invalidateQueries({ queryKey });
    };

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
        invalidate(prefixes);
      },
      // Anything could have changed while the connection was down — stale-mark the whole
      // realtime-covered set once; only mounted screens refetch now, the rest on next open.
      onReconnect: () => invalidate(ALL_REALTIME_KEY_PREFIXES),
      onConnectedChange: setRealtimeConnected,
    });

    client.start();
    return () => client.stop();
  }, [signedIn, queryClient]);

  return null;
};
