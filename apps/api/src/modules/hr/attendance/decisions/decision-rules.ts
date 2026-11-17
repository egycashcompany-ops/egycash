// The decision rules — pure, because "who may decide what, about which day, and what happens
// next" is the part a dispute turns on, and it has to be provable without a database.
//
// The shape is deliberately NOT the regularization's two-step chain. A regularization is filed by
// an employee and judged by a manager; a decision is MADE by the manager, so they are step one.
// The only second step is age:
//
//   recent day  ── decide ──►  applied
//   old day     ── decide ──►  pendingHr ── approve ──►  applied
//                                   └───── reject ───►  rejected
//
// and any applied decision can later be REVOKED, which records a new row rather than erasing one.
import { type AttendanceDecisionStatus, type AttendanceDecisionType } from '@ecms/contracts';

/**
 * Whole days between a work date and today, both UTC-midnight date-only values. Negative for a
 * future date, which the caller refuses separately — a day that has not happened cannot be judged.
 */
export const daysBack = (workDate: Date, today: Date): number =>
  Math.round((today.getTime() - workDate.getTime()) / 86_400_000);

/**
 * Does this decision take effect now, or wait for HR?
 *
 * The threshold is INCLUSIVE of the boundary day: with the default of 7, a day seven days back is
 * still the manager's to decide and the eighth is not. A manager correcting last Tuesday from
 * memory is in a different position from one reconstructing a day three months old, and the
 * setting is where a branch says where that line falls for them.
 */
export const landsPendingHr = (input: {
  workDate: Date;
  today: Date;
  approvalAfterDays: number;
}): boolean => daysBack(input.workDate, input.today) > input.approvalAfterDays;

/**
 * Why this day may not be decided at all, or null when it may.
 *
 * A FUTURE DAY IS REFUSED, and this is not pedantry: marking somebody present tomorrow would mint
 * attendance for a day nobody has lived, and marking them absent would convict them of missing it.
 * Today is allowed — a manager sending somebody home at noon is the ordinary case.
 *
 * A FROZEN DAY IS REFUSED OUTRIGHT rather than recorded-and-ignored. Payroll has closed that
 * month and paid it; a correction cannot land on it, and recording one that silently does nothing
 * would let a manager believe they had fixed something. The message says which month and what to
 * do instead.
 */
export const dayProblem = (input: {
  workDate: Date;
  today: Date;
  frozen: boolean;
}): string | null => {
  if (input.workDate.getTime() > input.today.getTime()) {
    return 'a day that has not happened yet cannot be decided';
  }
  if (input.frozen) {
    return 'الشهر مغلق من المرتبات — لا يمكن تعديل هذا اليوم، والتسوية تمر كتعديل في شهر لاحق';
  }
  return null;
};

/**
 * Why this caller may not decide, or null when they may.
 *
 * NOBODY DECIDES THEIR OWN ATTENDANCE, whatever they hold. It is enforced here rather than by
 * withholding the grant, exactly as C7 does for leave: the grant is about scope — which employees
 * somebody covers — and a manager naturally covers themselves. The prohibition is about the act.
 */
export const decideProblem = (input: {
  isSubject: boolean;
  canDecide: boolean;
}): string | null => {
  if (!input.canDecide) return 'deciding an attendance day requires attendance.decide';
  if (input.isSubject) return 'you cannot decide your own attendance';
  return null;
};

/**
 * Why this pending decision may not be approved or rejected, or null when it may.
 *
 * The subject is barred here too, and so is the MANAGER WHO MADE IT: an approval step that the
 * person being approved can perform is not a step. That is the whole reason the old-day path
 * exists, so letting its author clear it would empty it of meaning.
 */
export const approveProblem = (input: {
  status: AttendanceDecisionStatus;
  isSubject: boolean;
  isAuthor: boolean;
  canApprove: boolean;
}): string | null => {
  if (input.status !== 'pendingHr') return 'this decision is not waiting for approval';
  if (!input.canApprove) return 'approving a decision requires attendance.decideApprove';
  if (input.isSubject) return 'you cannot approve a decision about your own attendance';
  if (input.isAuthor) return 'you cannot approve your own decision';
  return null;
};

/** Why this decision may not be revoked, or null when it may. Only a live one can be undone. */
export const revokeProblem = (input: {
  status: AttendanceDecisionStatus;
  type: AttendanceDecisionType;
  isSubject: boolean;
  canDecide: boolean;
}): string | null => {
  if (!input.canDecide) return 'revoking a decision requires attendance.decide';
  if (input.type === 'revoke') return 'a revocation is itself a record and is not revoked';
  if (input.status !== 'applied' && input.status !== 'pendingHr') {
    return 'only a decision that is in force or awaiting approval can be revoked';
  }
  if (input.isSubject) return 'you cannot revoke a decision about your own attendance';
  return null;
};
