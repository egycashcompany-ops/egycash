// Which employment fields each personnel action writes (HR3-B). PURE.
//
// WHY THIS EXISTS. The design's C1 rule: *"creating an action touching fields a pending scheduled
// action also touches surfaces a warning; application order remains strict effective-date order."*
// A warning needs to know what "touching the same fields" means, and there was nowhere that said.
//
// WHAT "A FIELD" MEANS HERE, EXACTLY. The engine records every mutation it makes as a change
// entry — `changes.push({ field, from, to })` — and THAT is the list below, entry by entry,
// including the ones reached through `applyTransfer` / `applyExit` / `applyRehire` /
// `suspendLogin`. Not a fresh reading of what an action ought to change: `action-fields.spec.ts`
// reads the engine's source and fails if the two ever disagree in either direction.
//
// So a mutation the engine makes WITHOUT recording a change entry is deliberately absent —
// `employmentPeriods` is the notable one (an exit closes the open period, a rehire pushes a new
// one, `dataCorrection` rewrites the first one's `hiredAt`, and none of the three records it).
// Listing it would mean claiming a collision the change log cannot evidence.
//
// A WARNING, NEVER A BLOCK. Two actions may legitimately touch one field — a raise scheduled for
// the first and a promotion for the fifteenth is ordinary. Application order stays strictly by
// effective date; this only makes the overlap visible to whoever is about to add the second one.
import { type EmployeeActionType } from '@ecms/contracts';

/**
 * The change entries each type records, as the engine records them today.
 *
 * `hire` is recorded by the hire path (`employeeActionRepository.recordHire`) rather than created
 * through an action endpoint, so it can never be the NEW action in an overlap check, only the
 * existing one — and it is never `scheduled`, so in practice it is neither.
 */
export const ACTION_AFFECTED_FIELDS: Record<EmployeeActionType, readonly string[]> = {
  hire: ['status'],

  // Career.
  promotion: ['employment.jobTitleId', 'employment.salary'],
  // No `code` here: the Employee Code is frozen at hire and a transfer does not rewrite it
  // (ADR-017). `user.placement` is the linked login's org placement following the employee's.
  transfer: ['branchId', 'departmentId', 'sectionId', 'employment.managerId', 'user.placement'],
  managerChange: ['employment.managerId'],
  salaryChange: ['employment.salary', 'employment.allowances', 'employment.benefits'],

  // Probation. `probationFail` runs a full exit underneath (a termination), which is why it
  // carries the exit fields too — it is not merely a probation flag.
  probationConfirm: ['probation.confirmed', 'status'],
  probationExtend: ['probation.extendedTo'],
  probationFail: [
    'probation.failed',
    'status',
    'exit.type',
    'exit.eligibleForRehire',
    'user.status',
  ],

  // Lifecycle. Suspend/reinstate reach the linked login (D3).
  suspend: ['status', 'user.status'],
  reinstate: ['status', 'user.status'],
  leaveStart: ['status'],
  leaveEnd: ['status'],

  // Exits — one shared path, so one shared field set. `directReports` appears only when the
  // exiting employee actually manages someone, but the type CAN write it, which is the question
  // an overlap asks.
  resignation: ['directReports', 'status', 'exit.type', 'exit.eligibleForRehire', 'user.status'],
  termination: ['directReports', 'status', 'exit.type', 'exit.eligibleForRehire', 'user.status'],
  endOfContract: ['directReports', 'status', 'exit.type', 'exit.eligibleForRehire', 'user.status'],
  retirement: ['directReports', 'status', 'exit.type', 'exit.eligibleForRehire', 'user.status'],
  death: ['directReports', 'status', 'exit.type', 'exit.eligibleForRehire', 'user.status'],

  // Rehire relinks the offer and may revive the login. It does NOT touch `code`: the same person
  // is returning, so they keep the number — and the code — they were originally issued (ADR-017).
  rehire: ['jobOfferId', 'employment.jobTitleId', 'hiredAt', 'status', 'user.status'],

  dataCorrection: ['hiredAt'],
};

/** The fields two action types both write — empty when they cannot collide at all. */
export const overlappingFields = (
  a: EmployeeActionType,
  b: EmployeeActionType,
): string[] => {
  const other = new Set(ACTION_AFFECTED_FIELDS[b]);
  return ACTION_AFFECTED_FIELDS[a].filter((field) => other.has(field));
};
