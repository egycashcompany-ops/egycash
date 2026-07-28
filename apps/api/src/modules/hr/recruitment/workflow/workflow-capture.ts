// Which events did THIS action produce? (I6)
//
// The envelope promises "the entries this action produced", and that is not something a caller can
// reconstruct afterwards: one service call can publish several events (a decision, the lifecycle
// event it raises, the stage closures that follow), and a concurrent request on the same candidate
// would make a "written since I started" query answer with someone else's work.
//
// So the engine reports each event as it publishes, into a scope the request opens. Node's
// AsyncLocalStorage carries the scope across every await without threading a parameter through
// services that have no business knowing about HTTP responses — the same mechanism the platform
// already uses for the request id (ADR-012).
//
// Outside a scope, `noteWorkflowEvent` is a no-op: the scheduled sweeps, the worker and the boot
// migration publish events with nobody listening, exactly as before.
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<string[]>();

/**
 * Run `fn` with a collector active and return what it produced alongside its result. Nested scopes
 * are deliberate: an inner one collects its own events, and the outer one still sees them, so a
 * bulk run can report the whole batch while each item reports its own.
 */
export const captureWorkflowEvents = async <T>(
  fn: () => Promise<T>,
): Promise<{ result: T; eventIds: string[] }> => {
  const outer = storage.getStore();
  const eventIds: string[] = [];
  const result = await storage.run(eventIds, fn);
  // Bubble up, so an enclosing scope's list is the union of everything beneath it.
  if (outer !== undefined) outer.push(...eventIds);
  return { result, eventIds };
};

/** Called by the engine for every event it writes to the outbox. No-op outside a scope. */
export const noteWorkflowEvent = (eventId: string): void => {
  storage.getStore()?.push(eventId);
};
