// Signal coalescing (ADR-029): a burst of N signals inside one window becomes ONE invalidation
// sweep. This is what makes duplicates and bulk operations free — 500 imported rows, or the
// same change arriving twice, cost exactly one refetch per affected screen. It also makes
// ordering irrelevant by construction: a flush hands over a SET of topics, and the refetch reads
// whatever is newest at that moment, so an old signal can never re-apply an old state.

export interface Coalescer {
  push: (topic: string) => void;
  /** Drain synchronously — used on teardown so nothing fires after unmount. */
  cancel: () => void;
}

export const createCoalescer = (
  flushMs: number,
  onFlush: (topics: ReadonlySet<string>) => void,
): Coalescer => {
  let pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    timer = null;
    const topics = pending;
    pending = new Set();
    if (topics.size > 0) onFlush(topics);
  };

  return {
    push: (topic) => {
      pending.add(topic);
      timer ??= setTimeout(flush, flushMs);
    },
    cancel: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = new Set();
    },
  };
};

/** The heavy lane's timing — see `createDebouncedCoalescer`. */
export interface DebounceTiming {
  /** A burst is over once no signal has come for this long. */
  debounceMs: number;
  /** …but a burst that never stops is flushed this long after its first signal all the same. */
  maxWaitMs: number;
  /** Added to every flush — this client's own offset, so viewers do not all refetch at once. */
  jitterMs: number;
}

/**
 * The coalescer for topics whose refetch is a HEAVY read (the ATM boards, 2026-11): a TRAILING
 * debounce with a ceiling, plus a per-client offset.
 *
 * The 300 ms window above suits a list a signal or two moves. It did not suit the ATM boards: a
 * bulk close or a 700-line paste lands as a stream of writes over seconds, and each 300 ms window
 * of it was another whole-board refetch — by every viewer, at the same instant, since they all
 * heard the same signal. Measured in production the board read was the API's busiest. So here a
 * flush waits until the signals have stopped for `debounceMs` (one bulk action, one refetch), never
 * longer than `maxWaitMs` after the burst's first signal (a board under a steady stream still
 * moves), and then `jitterMs` more — drawn once per client by the caller — which spreads the
 * viewers' refetches over a window instead of a spike.
 */
export const createDebouncedCoalescer = (
  timing: DebounceTiming,
  onFlush: (topics: ReadonlySet<string>) => void,
): Coalescer => {
  let pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let burstStartedAt: number | null = null;

  const flush = (): void => {
    timer = null;
    burstStartedAt = null;
    const topics = pending;
    pending = new Set();
    if (topics.size > 0) onFlush(topics);
  };

  return {
    push: (topic) => {
      const now = Date.now();
      pending.add(topic);
      burstStartedAt ??= now;
      if (timer !== null) clearTimeout(timer);
      const due =
        Math.min(now + timing.debounceMs, burstStartedAt + timing.maxWaitMs) + timing.jitterMs;
      timer = setTimeout(flush, Math.max(0, due - now));
    },
    cancel: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      burstStartedAt = null;
      pending = new Set();
    },
  };
};
