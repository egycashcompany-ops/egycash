// What a session may do next, and whether there is a seat — the two questions with no database in
// them (P-HR-TRN §4, D5).
//
// PURE ON PURPOSE, the same posture `loan-schedule.ts`, `compensation-rules.ts` and `leave-pay.ts`
// take: the arithmetic and the state machine are arguable without a Mongo instance, so they are
// argued here and the service is left with nothing but reading, writing and saying what happened.
import { type TrainingSessionStatus } from '@ecms/contracts';

/**
 * §4 — the session's state machine, written out rather than inferred.
 *
 * Both terminal states are terminal in the strong sense: nothing leaves them. A completed session
 * has already written its records (D7) and re-completing would write them twice; a cancelled one
 * taught nobody, and re-opening it would resurrect enrollments that were told not to come.
 */
const NEXT: Readonly<Record<TrainingSessionStatus, readonly TrainingSessionStatus[]>> = {
  scheduled: ['running', 'cancelled'],
  // A session that ran and was never marked complete is still cancellable — the day happened and
  // nobody was qualified by it, which is a real outcome and not an error to refuse.
  running: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

/**
 * The status each action asks for.
 *
 * `satisfies` rather than an annotation, so the values keep their literal types: a caller mapping
 * a transition onto its event gets exactly the three statuses a transition can produce, and does
 * not have to handle `scheduled` — which no action asks for and which nothing returns to.
 */
export const TARGET_OF = {
  start: 'running',
  complete: 'completed',
  cancel: 'cancelled',
} as const satisfies Readonly<Record<'start' | 'complete' | 'cancel', TrainingSessionStatus>>;

export const canTransition = (
  from: TrainingSessionStatus,
  to: TrainingSessionStatus,
): boolean => NEXT[from].includes(to);

/** Whether a session is still open to enrollments — a seat in a finished session is not a seat. */
export const acceptsEnrollments = (status: TrainingSessionStatus): boolean =>
  status === 'scheduled' || status === 'running';

/**
 * D5 — seats left, or `null` when the session named no capacity.
 *
 * `null` is UNLIMITED and is not zero. A session created without a number is one nobody has
 * counted seats for, and reading that as «full» would refuse every nomination while looking like a
 * system fault rather than a decision.
 *
 * Clamped at zero: a capacity lowered below the people already enrolled is a real state, and
 * reporting «-3 seats left» would be arithmetic pretending to be information.
 */
export const seatsLeft = (capacity: number | null, enrolled: number): number | null =>
  capacity === null ? null : Math.max(0, capacity - enrolled);

/** Whether one more person fits. Unlimited always fits; a full session never does. */
export const hasSeat = (capacity: number | null, enrolled: number): boolean => {
  const left = seatsLeft(capacity, enrolled);
  return left === null || left > 0;
};
