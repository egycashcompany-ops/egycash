// Which timeline entries did THIS action produce? (I6)
//
// The envelope promises "the entries this action produced", and that is not something a caller can
// reconstruct afterwards: one service call can write several entries (a decision, the lifecycle
// event it raises, the stage closures that follow, the next stage it materializes), and a
// concurrent request on the same candidate would make a "written since I started" query answer
// with someone else's work.
//
// So each writer reports its entry as it writes, into a scope the request opens. Node's
// AsyncLocalStorage carries the scope across every await without threading a parameter through
// services that have no business knowing about HTTP responses — the same mechanism the platform
// already uses for the request id (ADR-012).
//
// Two kinds of writer report here, and both name the entry by its `eventId`:
//   • the workflow engine, at publish time — the id it stamps on the outbox event is the SAME id
//     the timeline projection gives the entry, so the report can happen before the entry exists.
//   • the timeline service, for the entries written outside the engine (an application, an
//     identity check, a placement change) — those have no outbox event to name them.
//
// Outside a scope, `noteTimelineEntry` is a no-op: the scheduled sweeps, the worker and the boot
// migration write history with nobody listening, exactly as before.
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<string[]>();

/**
 * Run `fn` with a collector active and return what it produced alongside its result. Nested scopes
 * are deliberate: an inner one collects its own entries, and the outer one still sees them, so a
 * bulk run can report the whole batch while each item reports its own.
 */
export const captureTimelineEntries = async <T>(
  fn: () => Promise<T>,
): Promise<{ result: T; entryIds: string[] }> => {
  const outer = storage.getStore();
  const entryIds: string[] = [];
  const result = await storage.run(entryIds, fn);
  // Bubble up, so an enclosing scope's list is the union of everything beneath it.
  if (outer !== undefined) outer.push(...entryIds);
  return { result, entryIds };
};

/** Report one entry by its `eventId`. No-op outside a scope. */
export const noteTimelineEntry = (eventId: string): void => {
  storage.getStore()?.push(eventId);
};
