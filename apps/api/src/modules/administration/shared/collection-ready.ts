// Bring a collection into being, with its indexes, BEFORE the first write that needs them.
//
// A copy of IT's (`modules/it/mobile-lines/ensure-collection.ts`), not an import: this module
// imports no other module (design §3.7). The reason is the same as there. `autoIndex` is off in
// production and the deploy's index step only reports unless an operator switches it on, while a
// unique index is the only race guard this module has for one-name-one-row (`ux_*_name_key`):
// two people typing «قطعه» and «قطعة» at the same moment both pass the service's own check. The
// seed builds every index first (`syncDeclaredIndexes`), but that build never throws, so each
// repository holds one of these and awaits it before its first write: a failed build refuses the
// write instead of letting the duplicates in, and the next write tries again (§15.3.2, RK-03).

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
