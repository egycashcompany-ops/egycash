// What a nomination may do next, and who may not decide it (P-HR-TRN D3, D4).
//
// PURE, like `session-rules.ts` beside it: the state machine and the two-person rule are arguable
// without a database, so they are argued here and the service is left reading, writing, auditing
// and emitting.
import { type TrainingEnrollmentStatus, type TrainingNominationStatus } from '@ecms/contracts';

/**
 * D3 — the approval machine, the same shape P-HR-04 uses.
 *
 * All three ends are terminal. A rejected nomination is not re-decided: somebody nominates again,
 * and the refusal stays on the record as the thing that happened. Re-deciding would leave the
 * timeline saying two different things about one request.
 */
const NEXT: Readonly<Record<TrainingNominationStatus, readonly TrainingNominationStatus[]>> = {
  draft: ['pendingApproval', 'withdrawn'],
  pendingApproval: ['approved', 'rejected', 'withdrawn'],
  approved: [],
  rejected: [],
  withdrawn: [],
};

export const canTransition = (
  from: TrainingNominationStatus,
  to: TrainingNominationStatus,
): boolean => NEXT[from].includes(to);

/** Waiting on somebody. What the queue is, and what `pendingOnly` means. */
export const isPending = (status: TrainingNominationStatus): boolean =>
  status === 'pendingApproval';

/**
 * D3 — THE RULE A PERMISSION CANNOT EXPRESS.
 *
 * `trainingNomination.decide` says a person may decide nominations. It cannot say «but not their
 * own», because a key describes an ability and this describes a relationship. So it is checked
 * here, against the two ids, exactly as `employeeLoan.decide` refuses its own submitter.
 *
 * D4 rides on this and needs no rule of its own: self-NOMINATION is allowed precisely because
 * self-APPROVAL is not. One rule doing two jobs cannot disagree with itself.
 */
export const mayDecide = (nominatedBy: string | null, decider: string): boolean =>
  nominatedBy === null || nominatedBy !== decider;

/**
 * Which enrollment statuses still occupy a seat.
 *
 * `cancelled` is the only one that frees one. An `absent` seat was still taken — the person did not
 * come, but nobody else could have been in it — and counting it as free would let a session
 * quietly overfill on the day it runs. T4's statuses are listed here rather than left to be
 * remembered when it lands.
 */
const FREES_A_SEAT: readonly TrainingEnrollmentStatus[] = ['cancelled'];

export const occupiesSeat = (status: TrainingEnrollmentStatus): boolean =>
  !FREES_A_SEAT.includes(status);

/** Whether a seat may still be taken back — a settled one is history (T4's statuses included). */
export const mayCancelEnrollment = (status: TrainingEnrollmentStatus): boolean =>
  status === 'enrolled';
