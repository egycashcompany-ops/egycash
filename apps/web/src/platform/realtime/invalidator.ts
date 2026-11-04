// What a coalesced batch of realtime topics DOES to the query cache (ADR-029) — kept out of the
// provider so it can be held to its rules over a real QueryClient in a node spec. Three rules sit
// on top of the plain sweep (every prefix invalidated, what is on screen refetched):
//
//   · THROTTLED prefixes (D13, the fleet dashboard's live reads) go through `throttle.ts`: marked
//     stale at once, refetched at most once per window. Unchanged.
//   · STALE-ONLY keys (`isStaleOnlyKey`: the ATM boards' dropdowns and done ranges) are marked
//     stale and never refetched by a signal — the next read of them is the reader's own.
//   · A HIDDEN TAB refetches nothing: every signal only marks its keys stale, and the moment the
//     tab is shown again what is on screen and went stale meanwhile is refetched ONCE. A board left
//     open in a background tab all day used to re-read itself on every signal anybody caused.
//
// None of this touches the reader's OWN writes: a mutation's `onSuccess` invalidates its keys
// directly, with a refetch, whatever the tab or the key.
import { type Query, type QueryClient } from '@tanstack/react-query';
import { createRefetchThrottle } from './throttle';

type KeyPrefix = readonly unknown[];

export interface RealtimeInvalidatorOptions {
  /** Is the page hidden now (`document.visibilityState === 'hidden'`)? Asked per batch. */
  isHidden: () => boolean;
  /** The prefixes the refetch throttle owns (`THROTTLED_KEY_PREFIXES`). */
  throttled: readonly KeyPrefix[];
  /** Keys a signal only marks stale (`isStaleOnlyKey`). */
  isStaleOnly: (queryKey: readonly unknown[]) => boolean;
  /** The throttle's window — the platform's unless a spec shortens it. */
  throttleMs?: number;
}

export interface RealtimeInvalidator {
  /** One coalesced batch's key prefixes (a reconnect's whole set included). */
  invalidate: (prefixes: Iterable<KeyPrefix>) => void;
  /** The page became visible: refetch, once, what is on screen and went stale while hidden. */
  visible: () => void;
  /** Teardown — no throttle window fires after it. */
  cancel: () => void;
}

export const createRealtimeInvalidator = (
  queryClient: Pick<QueryClient, 'invalidateQueries' | 'refetchQueries'>,
  options: RealtimeInvalidatorOptions,
): RealtimeInvalidator => {
  /** A signal was swallowed while hidden: showing the tab owes the screen a refetch. */
  let missedWhileHidden = false;

  const markStale = (queryKey: KeyPrefix): void =>
    void queryClient.invalidateQueries({ queryKey, refetchType: 'none' });

  const refetchable = (query: Query): boolean => !options.isStaleOnly(query.queryKey);

  const throttle = createRefetchThrottle(
    {
      markStale,
      // A trailing refetch that falls due while the tab is hidden waits for it to be shown.
      // `cancelRefetch: false`: it joins a read already in flight instead of restarting it.
      refetch: (queryKey) => {
        if (options.isHidden()) {
          missedWhileHidden = true;
          return;
        }
        void queryClient.refetchQueries({ queryKey, type: 'active' }, { cancelRefetch: false });
      },
    },
    options.throttled,
    options.throttleMs,
  );

  /** The plain sweep: everything under the prefix stale, what is on screen refetched — bar the stale-only keys. */
  const sweep = (queryKey: KeyPrefix): void => {
    markStale(queryKey);
    void queryClient.refetchQueries({ queryKey, type: 'active', predicate: refetchable });
  };

  return {
    invalidate: (prefixes) => {
      const unique = new Map<string, KeyPrefix>();
      for (const prefix of prefixes) unique.set(JSON.stringify(prefix), prefix);
      const hidden = options.isHidden();
      for (const queryKey of unique.values()) {
        if (hidden) {
          markStale(queryKey);
          missedWhileHidden = true;
        } else if (throttle.owns(queryKey)) {
          throttle.push(queryKey);
        } else {
          sweep(queryKey);
        }
      }
    },
    visible: () => {
      if (!missedWhileHidden) return;
      missedWhileHidden = false;
      void queryClient.refetchQueries(
        {
          type: 'active',
          predicate: (query) => query.state.isInvalidated && refetchable(query),
        },
        { cancelRefetch: false },
      );
    },
    cancel: () => throttle.cancel(),
  };
};
