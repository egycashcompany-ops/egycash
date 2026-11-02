// One registry answer per narrowing per DASHBOARD READ (plan §5.11, the vehicle set R-13 / D9).
//
// A dashboard read calls six owning modules with the same filter, and each resolves it exactly as
// its own screen does — `resolveVehicleFilterIds` for «النوع / التشغيل / الفرع», `idsByCodes` for the
// codes. Inside `withVehicleFilterMemo` the same question («the cars of these types», «the cars with
// these codes») is asked of the registry once and shared by every module; each caller still gets
// its own copy of the answer. Outside it — every screen's own request — nothing is cached at all.
//
// Its own module, below both the repository and the vehicle set, so either can use it without an
// import cycle.
import { AsyncLocalStorage } from 'node:async_hooks';

const requestMemo = new AsyncLocalStorage<Map<string, Promise<string[]>>>();

/** Runs `read` with a per-request memo of the vehicle-filter resolution (the dashboard's reads). */
export const withVehicleFilterMemo = <T>(read: () => Promise<T>): Promise<T> =>
  requestMemo.run(new Map(), read);

/** `resolve(ids)`, answered once per `kind` + id list inside a memoised read. */
export const memoisedVehicleIds = (
  kind: string,
  ids: readonly string[],
  resolve: (ids: readonly string[]) => Promise<string[]>,
): Promise<string[]> => {
  const store = requestMemo.getStore();
  if (store === undefined) return resolve(ids);
  const key = `${kind}:${[...ids].sort().join(',')}`;
  let pending = store.get(key);
  if (pending === undefined) {
    pending = resolve(ids);
    store.set(key, pending);
    // A failed read is not remembered: the next module asks again.
    pending.catch(() => store.delete(key));
  }
  // Each caller gets its own copy: an intersection may keep the list it was handed.
  return pending.then((answer) => [...answer]);
};
