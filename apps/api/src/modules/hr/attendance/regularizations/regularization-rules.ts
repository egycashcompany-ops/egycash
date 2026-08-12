// The two-step decision rules (v1.1 §7, D7 as ruled) — pure, because "who may decide which step,
// and what happens next" is the part a dispute turns on, and it must be provable without a
// database.
//
//   pendingManager ── approve ──► pendingHr ── approve ──► approved
//        │                            │
//        └────────── reject ──────────┴──────────► rejected
//
// No step is skippable: an approval at the manager step lands on `pendingHr`, always. The
// self-decision prohibition binds the SUBJECT (the leave C7 rule): whoever the request is about
// decides nothing on it, whatever they hold.
import { type AttendanceRegularizationStatus } from '@ecms/contracts';

export type RegularizationStep = 'manager' | 'hr';

export const stepOf = (
  status: AttendanceRegularizationStatus,
): RegularizationStep | null =>
  status === 'pendingManager' ? 'manager' : status === 'pendingHr' ? 'hr' : null;

/**
 * Why a caller may not decide, or null when they may.
 *
 * The manager step authorizes by RELATIONSHIP (the subject's current manager); a holder of
 * `attendance.decideRegularization` may also act there — the Leave R9 deadlock escape for a
 * missing or absent manager — but that never skips the HR step, it only substitutes for the
 * manager inside step one.
 */
export const decisionProblem = (input: {
  status: AttendanceRegularizationStatus;
  isSubject: boolean;
  isManager: boolean;
  canDecide: boolean;
}): string | null => {
  const step = stepOf(input.status);
  if (step === null) return 'this request has already been decided';
  if (input.isSubject) return 'you cannot decide your own regularization';
  if (step === 'manager' && !input.isManager && !input.canDecide) {
    return 'only the current manager or HR may decide this step';
  }
  if (step === 'hr' && !input.canDecide) {
    return 'this step requires attendance.decideRegularization';
  }
  return null;
};

/** The one transition table. Approval never jumps a step. */
export const nextStatus = (
  status: AttendanceRegularizationStatus,
  verdict: 'approve' | 'reject',
): AttendanceRegularizationStatus => {
  if (verdict === 'reject') return 'rejected';
  return status === 'pendingManager' ? 'pendingHr' : 'approved';
};
