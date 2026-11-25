// Bring a collection into being, with its indexes, BEFORE the first write that needs them.
//
// A copy of Administrative Affairs' (`modules/administration/shared/collection-ready.ts`), not an
// import: a module imports no other module. `autoIndex` is off in production, and a folder's
// unique name index (`ux_name_key`) is the only race guard two people naming two folders alike at
// the same moment meet — so each repository awaits this before its first write, a failed build
// refuses the write, and the next write tries again.
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
