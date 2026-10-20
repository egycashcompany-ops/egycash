// Bring a collection into being, with its indexes, BEFORE the first write that needs them.
//
// `autoIndex` is off in production, so the unique indexes this register stands on — one number one
// line, one ICCID one card, one open interval per line, one paper per number — would otherwise
// never be built, and the duplicates they exist to refuse would go in. And the custody writes run
// inside a transaction: an insert there must not be what creates the collection, which older
// servers refuse outright. The receipt repository's `ensureCollection()`, once per collection.

/** What a model offers for this — named structurally, so no repository has to widen its type. */
interface Indexable {
  createIndexes(): Promise<unknown>;
}

/**
 * Once per process: the first caller builds, every later one waits on the same promise. A failure
 * is forgotten, so the next write tries again instead of inheriting the error forever.
 */
export const collectionReady = (model: Indexable): (() => Promise<void>) => {
  let ready: Promise<void> | null = null;
  return async () => {
    ready ??= model.createIndexes().then(
      () => undefined,
      (error: unknown) => {
        ready = null;
        throw error;
      },
    );
    await ready;
  };
};
