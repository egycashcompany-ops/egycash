// What a review may do next, and who may be the one writing it (P-HR-PRF §4, D5, D6).
//
// PURE ON PURPOSE, the same posture `cycle-rules.ts` and `goal-rules.ts` take. The service is left
// with reading, writing and saying what happened.
import { type PerformanceReviewStatus } from '@ecms/contracts';

/**
 * §4 — the review's state machine.
 *
 * `returned` is a TRANSITION, not a state: it moves a submitted review back to `draft` with a
 * reason attached. Making it a fourth state would give the evaluator's queue two words for «this
 * is yours to write», and every filter downstream would have to remember both.
 *
 * `excused` is reachable from EITHER open state, because the reasons for it — somebody left, went
 * on long leave, joined too late — arrive on their own schedule rather than at a convenient point
 * in the workflow.
 */
const NEXT: Readonly<Record<PerformanceReviewStatus, readonly PerformanceReviewStatus[]>> = {
  draft: ['submitted', 'excused'],
  submitted: ['draft', 'finalized', 'excused'],
  finalized: [],
  excused: [],
};

export const canTransition = (
  from: PerformanceReviewStatus,
  to: PerformanceReviewStatus,
): boolean => NEXT[from].includes(to);

/** The two the cycle may close over (§4) — the machine's own answer, so the two cannot drift. */
export const isTerminal = (status: PerformanceReviewStatus): boolean => NEXT[status].length === 0;

/**
 * D5 — nobody reviews themselves.
 *
 * The third copy of «a key says what you may do, not who you are», after `employeeLoan.approve`
 * and `trainingNomination.decide». No permission ever makes this sensible, so it is a rule in the
 * service rather than a grant somebody could be given.
 */
export const mayEvaluate = (subjectId: string, evaluatorId: string): boolean =>
  subjectId !== evaluatorId;

/**
 * Whether this caller is the person the review was assigned to.
 *
 * SEPARATE FROM `mayEvaluate`, because the two fail for different reasons and a caller deserves to
 * be told which: one is «nobody reviews themselves», the other is «this is not your review to
 * write». A single predicate returning false for both would produce one message that is wrong half
 * the time.
 *
 * Null on either side is false. A review with no evaluator is not one anybody may submit — that is
 * what the assign endpoint is for.
 */
export const isAssignedEvaluator = (
  assignedId: string | null,
  callerEmployeeId: string | null,
): boolean => assignedId !== null && callerEmployeeId !== null && assignedId === callerEmployeeId;
