// What a goal may do next — the state machine, with no database in it (P-HR-PRF §4, D9).
//
// PURE ON PURPOSE, the same posture `cycle-rules.ts` and `session-rules.ts` take.
//
// THE INTERESTING PART IS WHAT IS NOT HERE. There is no `outcomeOf(current, target)`, no
// `isOnTrack`, and no function that takes a due date and returns a status. Each would be one line
// and each would be the module deciding an outcome a person is supposed to decide (D9) — and once
// a helper like that exists, the service that calls it is a small refactor away from calling it
// automatically.
import { type PerformanceGoalStatus } from '@ecms/contracts';

/**
 * §4 — `active → achieved | missed | dropped`, and the three closed states are terminal.
 *
 * Terminal in the strong sense: a goal that ended did not un-end. Re-opening one would let a
 * closed round's record change after the fact, and «it was achieved, then it wasn't» is not a
 * thing that happens to a goal — it is a thing that happens to somebody's account of it.
 */
const NEXT: Readonly<Record<PerformanceGoalStatus, readonly PerformanceGoalStatus[]>> = {
  active: ['achieved', 'missed', 'dropped'],
  achieved: [],
  missed: [],
  dropped: [],
};

export const canTransition = (from: PerformanceGoalStatus, to: PerformanceGoalStatus): boolean =>
  NEXT[from].includes(to);

/** Whether the goal still accepts a definition change or a progress note. */
export const isOpen = (status: PerformanceGoalStatus): boolean => status === 'active';
