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
