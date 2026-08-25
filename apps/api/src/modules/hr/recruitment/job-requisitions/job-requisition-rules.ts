// The requisition rulebook — PURE, no mongoose, no services (D-REQ-10, D-REQ-11, D-REQ-15).
//
// Everything a dispute turns on lives here: who may decide which step, what an edit costs, and how
// fulfilment moves the state. `regularization-rules.ts` is the precedent and the shape is
// deliberately the same one — a two-step decision is not a new idea in this codebase, and giving it
// a second implementation is how two implementations drift.
//
//   draft → pendingManager → pendingHr → open → partiallyFilled → filled
//                    │            │
//                    └── reject ──┴──► rejected      close/cancel ──► closed / cancelled
//
// No step is skippable: approving at the manager step lands on `pendingHr`, always. And nothing
// leaves a terminal state — there is no `reopen` here, because ADR-030 says a new need is a new
// requisition, not a resurrected one.
import {
  LINKABLE_JOB_REQUISITION_STATUSES,
  TERMINAL_JOB_REQUISITION_STATUSES,
  type JobRequisitionStatus,
} from '@ecms/contracts';

export type RequisitionStep = 'manager' | 'hr';

const isTerminal = (status: JobRequisitionStatus): boolean =>
  (TERMINAL_JOB_REQUISITION_STATUSES as readonly string[]).includes(status);

export const isLinkable = (status: JobRequisitionStatus): boolean =>
  (LINKABLE_JOB_REQUISITION_STATUSES as readonly string[]).includes(status);

/** Which approval step a requisition is waiting on, or null when it waits on none. */
export const stepOf = (status: JobRequisitionStatus): RequisitionStep | null =>
  status === 'pendingManager' ? 'manager' : status === 'pendingHr' ? 'hr' : null;

/**
 * Why a caller may not decide, or null when they may (D-REQ-11).
 *
 * The manager step authorizes by RELATIONSHIP — the department's effective manager, which already
 * honours the acting-manager delegation window (Review R11). A holder of `jobRequisition.approve`
 * may also act there, which is the deadlock escape for a department with no manager or an absent
 * one; it substitutes INSIDE step one and never skips step two.
 *
 * The requester decides nothing on their own requisition, whatever they hold: a permission says
 * what you MAY do, not who you are.
 */
export const decisionProblem = (input: {
  status: JobRequisitionStatus;
  isRequester: boolean;
  isDepartmentManager: boolean;
  canApprove: boolean;
}): string | null => {
  const step = stepOf(input.status);
  if (step === null) return 'this requisition is not waiting for a decision';
  if (input.isRequester) return 'you cannot decide your own requisition';
  if (step === 'manager' && !input.isDepartmentManager && !input.canApprove) {
    return 'only the department manager or HR may decide this step';
  }
  if (step === 'hr' && !input.canApprove) return 'this step requires jobRequisition.approve';
  return null;
};

/** The one transition table for a decision. Approval never jumps a step. */
export const nextStatusAfterDecision = (
  status: JobRequisitionStatus,
  verdict: 'approve' | 'reject',
): JobRequisitionStatus => {
  if (verdict === 'reject') return 'rejected';
  return status === 'pendingManager' ? 'pendingHr' : 'open';
};

/**
 * Where fulfilment puts a LIVE requisition (D-REQ-3, D-REQ-5).
 *
 * Called after every hire and after an approval lands on `open`, so a requisition approved with
 * hires already against it (the re-approval case, D-REQ-15) does not sit in `open` claiming to be
 * empty. A requisition that is not live — closed, cancelled, rejected, or still being approved —
 * is returned unchanged: a hire is a fact and gets recorded, but it does not reopen anything.
 */
export const fulfilmentStatus = (
  status: JobRequisitionStatus,
  filledCount: number,
  quantity: number,
): JobRequisitionStatus => {
  if (status !== 'open' && status !== 'partiallyFilled') return status;
  if (filledCount >= quantity) return 'filled';
  return filledCount > 0 ? 'partiallyFilled' : 'open';
};

export interface RequisitionShape {
  jobTitleId: string;
  departmentId: string;
  branchId: string;
  sectionId: string | null;
  quantity: number;
}

/**
 * Does this edit cost a fresh approval? (D-REQ-15)
 *
 * Raising the quantity, or moving the placement, changes the thing that was signed for — what a
 * manager approved was *this number for this job, here*. Lowering the quantity, or editing the
 * reason, priority or needed-by date, does not: none of them asks for more than was granted.
 */
export const requiresReapproval = (before: RequisitionShape, after: RequisitionShape): boolean =>
  after.quantity > before.quantity ||
  after.jobTitleId !== before.jobTitleId ||
  after.departmentId !== before.departmentId ||
  after.branchId !== before.branchId ||
  after.sectionId !== before.sectionId;

/**
 * Why this edit is refused, or null when it stands.
 *
 * Two refusals, and the second is the one that protects the record: the quantity may not drop below
 * what has already been hired against it, because that would make `filledCount > quantity` a state
 * the system produced itself rather than an outcome somebody has to explain.
 */
export const editProblem = (input: {
  status: JobRequisitionStatus;
  filledCount: number;
  after: RequisitionShape;
}): string | null => {
  if (isTerminal(input.status)) return `a ${input.status} requisition cannot be edited`;
  if (input.after.quantity < input.filledCount) {
    return `quantity cannot be lower than the ${input.filledCount} already filled`;
  }
  return null;
};

/**
 * Where an edit leaves the status (D-REQ-15).
 *
 * A draft stays a draft and a requisition still at step one stays there — neither has an approval
 * to invalidate. Everything past that goes back to `pendingManager` when the edit needs approving
 * again: not to `pendingHr`, because the manager's signature is the one that stopped covering it.
 */
export const statusAfterEdit = (
  status: JobRequisitionStatus,
  needsReapproval: boolean,
): JobRequisitionStatus => {
  if (!needsReapproval) return status;
  if (status === 'draft' || status === 'pendingManager') return status;
  return 'pendingManager';
};

/** Why this requisition cannot be submitted for approval, or null. */
export const submitProblem = (status: JobRequisitionStatus): string | null =>
  status === 'draft' ? null : 'only a draft requisition can be submitted';

/**
 * Why this requisition cannot be closed or cancelled, or null (D-REQ-4).
 *
 * `close` ends a live, approved requisition early; `cancel` withdraws one that never opened. Both
 * are refused on a terminal state, and neither is reversible.
 */
export const closeProblem = (status: JobRequisitionStatus): string | null => {
  if (isTerminal(status)) return `this requisition is already ${status}`;
  if (!isLinkable(status)) return 'only an open requisition can be closed — cancel it instead';
  return null;
};

export const cancelProblem = (status: JobRequisitionStatus): string | null =>
  isTerminal(status) ? `this requisition is already ${status}` : null;

/**
 * Why this requisition may not be deleted, or null.
 *
 * A DRAFT ONLY. Once a requisition has been submitted it has been read by somebody, and once it has
 * been decided it carries a signature; deleting either would erase a record rather than end a
 * request. Those are cancelled, which says the same thing and keeps the history.
 */
export const deleteProblem = (status: JobRequisitionStatus): string | null =>
  status === 'draft' ? null : 'only a draft can be deleted — cancel it instead';

/**
 * Why an applicant may not be linked to this requisition, or null (D-REQ-13, §6 of the design).
 *
 * This constrains WHICH link is valid, never WHETHER one is required: ADR-016's rule that an
 * applicant may carry no requisition at all is untouched — a null reference never reaches here.
 */
export const linkProblem = (status: JobRequisitionStatus): string | null =>
  isLinkable(status) ? null : `requisition is ${status} — only an open one accepts applicants`;
