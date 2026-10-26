// Interleaving points for the race tests (docs/12-planning/atm-settlements-phase1.md §10.3
// "Interleaving"): a test registers a callback at one named point, the service runs it ONCE when it
// gets there — after its checks, before the write that depends on them — and the callback commits
// another session's change in between. The map's `setSyncBeforeWriteForTests` precedent. In
// production nothing is registered and every point is a no-op.
//
// Each point sits OUTSIDE a transaction, so the change the callback commits never waits on a lock
// the paused request holds.
export type SettlementHookPoint =
  | 'layoutImport.afterRunInsert'
  | 'layoutImport.beforeRow'
  | 'plan.update.beforeWrite'
  | 'plan.issue.beforeWrite'
  | 'plan.reopen.beforeWrite'
  | 'print.notes.beforeWrite'
  | 'preparation.save.beforeWrite'
  | 'preparation.prepared.beforeWrite'
  | 'control.assign.beforeWrite';

const hooks = new Map<SettlementHookPoint, () => Promise<void>>();

export const setSettlementHookForTests = (
  point: SettlementHookPoint,
  hook: (() => Promise<void>) | null,
): void => {
  if (hook === null) hooks.delete(point);
  else hooks.set(point, hook);
};

/** Runs the point's callback once, if any, and forgets it (a nested call never re-enters it). */
export const runSettlementHook = async (point: SettlementHookPoint): Promise<void> => {
  const hook = hooks.get(point);
  if (hook === undefined) return;
  hooks.delete(point);
  await hook();
};
