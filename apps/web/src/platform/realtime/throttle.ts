// Refetch throttling for the expensive reads (D13). The coalescer turns a burst of signals into one
// sweep per 300 ms; that is right for a list, and wrong for a dashboard that counts over every
// fleet screen at once: on a busy morning each save, seconds apart, would re-read the whole of it.
//
// So a throttled prefix is handled in two halves:
//   · every signal marks it stale AT ONCE, without refetching (`refetchType: 'none'`) — a query
//     that is not on screen reads fresh the next time it is opened, exactly as with the sweep;
//   · what IS on screen is refetched at most once per window: the first signal refetches now and
//     opens the window; any signal inside it is remembered, and when the window closes the prefix
//     is refetched once more (and a new window opens). A quiet window closes with no refetch.
// Each prefix keeps its own window. Nothing here knows a module: the prefixes come from the
// registry (`THROTTLED_KEY_PREFIXES`), the cache calls from the provider.

type KeyPrefix = readonly unknown[];

/** The window: a throttled read is refetched by realtime at most once per 30 seconds. */
export const REALTIME_THROTTLE_MS = 30_000;

export interface ThrottleTarget {
  /** Mark every query under the prefix stale, refetching nothing (`refetchType: 'none'`). */
  markStale: (prefix: KeyPrefix) => void;
  /** Refetch the queries under the prefix that are on screen now (`type: 'active'`). */
  refetch: (prefix: KeyPrefix) => void;
}

export interface RefetchThrottle {
  /** Is this prefix one the throttle owns (rather than the plain invalidation sweep)? */
  owns: (prefix: KeyPrefix) => boolean;
  /** A signal for a throttled prefix. */
  push: (prefix: KeyPrefix) => void;
  /** Stop every window — used on teardown so nothing fires after unmount. */
  cancel: () => void;
}

interface Lane {
  prefix: KeyPrefix;
  timer: ReturnType<typeof setTimeout>;
  /** A signal arrived after the window opened: refetch once when it closes. */
  pending: boolean;
}

export const createRefetchThrottle = (
  target: ThrottleTarget,
  prefixes: readonly KeyPrefix[],
  windowMs: number = REALTIME_THROTTLE_MS,
): RefetchThrottle => {
  const keyOf = (prefix: KeyPrefix): string => JSON.stringify(prefix);
  const owned = new Set(prefixes.map(keyOf));
  const windows = new Map<string, Lane>();

  const open = (key: string, prefix: KeyPrefix): void => {
    windows.set(key, {
      prefix,
      pending: false,
      timer: setTimeout(() => close(key), windowMs),
    });
  };

  const close = (key: string): void => {
    const lane = windows.get(key);
    if (lane === undefined) return;
    windows.delete(key);
    if (!lane.pending) return;
    // The trailing refetch: it reads whatever is newest now, so every signal of the window is in it.
    target.refetch(lane.prefix);
    open(key, lane.prefix);
  };

  return {
    owns: (prefix) => owned.has(keyOf(prefix)),
    push: (prefix) => {
      const key = keyOf(prefix);
      target.markStale(prefix);
      const lane = windows.get(key);
      if (lane !== undefined) {
        lane.pending = true;
        return;
      }
      target.refetch(prefix);
      open(key, prefix);
    },
    cancel: () => {
      for (const lane of windows.values()) clearTimeout(lane.timer);
      windows.clear();
    },
  };
};
