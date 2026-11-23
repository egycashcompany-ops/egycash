// Working through the bulk upload's photos: a few at a time, and stoppable.
//
// Two at a time by default: each photo is first cut around its face in the browser (CPU work on
// this machine) and then sent, so two overlap one's cut with the other's upload without starving
// the page. A stop finishes the photos already under way and starts no new one — a photo is never
// left half-written, because each is one request the server either takes whole or refuses.

export interface RunOptions {
  concurrency?: number;
  /** Asked before each new item: true stops the run after the ones under way. */
  shouldStop?: () => boolean;
}

/** Run `work` over `items`, at most `concurrency` at once. Resolves when all started ones end. */
export const runQueue = async <T>(
  items: readonly T[],
  work: (item: T) => Promise<void>,
  { concurrency = 2, shouldStop = () => false }: RunOptions = {},
): Promise<void> => {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length && !shouldStop()) {
      const item = items[next] as T;
      next += 1;
      try {
        await work(item);
      } catch {
        // `work` records its own failure on the item; one failed photo never stops the others.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, lane));
};
