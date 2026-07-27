// The legal-transition table for the recruitment workflow (I13) — PURE: no I/O, no clock, no
// database. This is the rulebook the engine enforces, kept separate so it can be unit-tested
// exhaustively and read as documentation of what the pipeline actually permits.
//
// Every workflow object exposes ONE status enum (I10) whose values are all persisted (I11), and
// every move between two of those values is declared here. A move that is not in this table
// cannot happen: `recruitmentWorkflowEngine.transition()` refuses it, and since no stage service
// may write a status (I13), there is no other way in.
import { type EvaluationStatus, type InterviewStatus, type OfferStatus, type ScreeningStatus } from '@ecms/contracts';

/**
 * The four STAGE objects. Each owns its own status enum and moves independently of the others and
 * of the applicant's lifecycle (I14).
 */
export const STAGE_OBJECTS = ['screening', 'interview', 'evaluation', 'offer'] as const;
export type StageObject = (typeof STAGE_OBJECTS)[number];

/**
 * The LIFECYCLE object — the applicant's final business outcome, deliberately NOT a stage (I14).
 * It appears in this table so its transitions are validated by the same engine, but nothing in the
 * stage machinery may move it: see `workflow-lifecycle.ts` for the closed set of events that can.
 */
export const LIFECYCLE_OBJECT = 'applicant' as const;

export const WORKFLOW_OBJECTS = [LIFECYCLE_OBJECT, ...STAGE_OBJECTS] as const;
export type WorkflowObject = (typeof WORKFLOW_OBJECTS)[number];

/** The applicant's own lifecycle. `hired` is terminal-successful (I13). */
export type ApplicantWorkflowStatus = 'new' | 'hired' | 'rejected' | 'withdrawn';

export type WorkflowStatus =
  | ApplicantWorkflowStatus
  | ScreeningStatus
  | InterviewStatus
  | EvaluationStatus
  | OfferStatus;

export interface TransitionDef {
  from: WorkflowStatus;
  to: WorkflowStatus;
  /** The business action that performs it — the audit action and the engine's dispatch key. */
  action: string;
  /** The move is refused without a reason (rejections, cancellations, withdrawals, returns). */
  requiresReason?: boolean;
  /**
   * A correction of an earlier decision rather than forward progress. Allowed, fully audited, and
   * never silently: the engine records the prior value and the reason on the timeline entry.
   */
  isCorrection?: boolean;
}

/**
 * The complete rulebook. Read it as: "for this object, these are the only moves that exist".
 *
 * Notes on the deliberate ones:
 *  • `scheduled → completed` is permitted alongside `inProgress → completed`: an interview held
 *    without anyone pressing Start must still be decidable, or the round becomes stuck.
 *  • self-transitions (`completed → completed`, `approved → approved`) are the re-decision paths
 *    (D7 "a decision is not final"); they carry `isCorrection` and demand a reason.
 *  • `cancelled` is terminal for its attempt — progress resumes on a NEW attempt materialized by
 *    the engine (I11/I12), never by reviving a cancelled row.
 *  • the offer's `superseded` is what a return-to-stage sets on a live offer (RW13); the record's
 *    `supersededAt` marker is stamped by the same engine step.
 */
export const WORKFLOW_TRANSITIONS: Record<WorkflowObject, readonly TransitionDef[]> = {
  applicant: [
    { from: 'new', to: 'hired', action: 'hire' },
    { from: 'new', to: 'rejected', action: 'reject', requiresReason: true },
    { from: 'new', to: 'withdrawn', action: 'withdraw', requiresReason: true },
    { from: 'rejected', to: 'new', action: 'reactivate', requiresReason: true, isCorrection: true },
    { from: 'withdrawn', to: 'new', action: 'restore', requiresReason: true, isCorrection: true },
  ],

  screening: [
    { from: 'waiting', to: 'accepted', action: 'accept' },
    { from: 'waiting', to: 'rejected', action: 'reject', requiresReason: true },
    { from: 'accepted', to: 'rejected', action: 'redecide', requiresReason: true, isCorrection: true },
    { from: 'rejected', to: 'accepted', action: 'redecide', requiresReason: true, isCorrection: true },
  ],

  interview: [
    { from: 'waiting', to: 'scheduled', action: 'schedule' },
    // "Start now" from the queue: the round goes straight to in-progress (RW12/A3).
    { from: 'waiting', to: 'inProgress', action: 'start' },
    { from: 'waiting', to: 'cancelled', action: 'cancel', requiresReason: true },
    { from: 'scheduled', to: 'inProgress', action: 'start' },
    { from: 'scheduled', to: 'completed', action: 'decide' },
    { from: 'scheduled', to: 'cancelled', action: 'cancel', requiresReason: true },
    { from: 'inProgress', to: 'completed', action: 'decide' },
    { from: 'inProgress', to: 'cancelled', action: 'cancel', requiresReason: true },
    { from: 'completed', to: 'completed', action: 'redecide', requiresReason: true, isCorrection: true },
  ],

  evaluation: [
    { from: 'waiting', to: 'approved', action: 'approve' },
    { from: 'waiting', to: 'rejected', action: 'reject', requiresReason: true },
    { from: 'approved', to: 'rejected', action: 'redecide', requiresReason: true, isCorrection: true },
    { from: 'rejected', to: 'approved', action: 'redecide', requiresReason: true, isCorrection: true },
    // Re-open a decided phase for another look (the approver's "Approved → Waiting").
    { from: 'approved', to: 'waiting', action: 'reopen', requiresReason: true, isCorrection: true },
    { from: 'rejected', to: 'waiting', action: 'reopen', requiresReason: true, isCorrection: true },
  ],

  offer: [
    { from: 'waiting', to: 'draft', action: 'draft' },
    { from: 'waiting', to: 'superseded', action: 'supersede', requiresReason: true },
    { from: 'draft', to: 'sent', action: 'send' },
    { from: 'draft', to: 'withdrawn', action: 'withdraw', requiresReason: true },
    { from: 'draft', to: 'superseded', action: 'supersede', requiresReason: true },
    { from: 'sent', to: 'accepted', action: 'accept' },
    { from: 'sent', to: 'rejected', action: 'reject', requiresReason: true },
    { from: 'sent', to: 'expired', action: 'expire' },
    { from: 'sent', to: 'withdrawn', action: 'withdraw', requiresReason: true },
    { from: 'sent', to: 'superseded', action: 'supersede', requiresReason: true },
    // After acceptance the package is the legal source of truth (RW3/OQ-3): the only ways out are
    // withdrawing it (then re-offering) or superseding it — never an edit in place.
    { from: 'accepted', to: 'withdrawn', action: 'withdraw', requiresReason: true },
    { from: 'accepted', to: 'superseded', action: 'supersede', requiresReason: true },
  ],
};

/** The moves available from a state — drives `availableActions` in the workflow envelope (I6). */
export const transitionsFrom = (object: WorkflowObject, from: WorkflowStatus): TransitionDef[] =>
  WORKFLOW_TRANSITIONS[object].filter((t) => t.from === from);

export const findTransition = (
  object: WorkflowObject,
  from: WorkflowStatus,
  to: WorkflowStatus,
): TransitionDef | null => WORKFLOW_TRANSITIONS[object].find((t) => t.from === from && t.to === to) ?? null;

export const canTransition = (
  object: WorkflowObject,
  from: WorkflowStatus,
  to: WorkflowStatus,
): boolean => findTransition(object, from, to) !== null;

/** Why a move was refused — surfaced verbatim to the caller and to bulk partial-success rows. */
export type TransitionRefusal =
  | { ok: true; transition: TransitionDef }
  | { ok: false; code: 'ILLEGAL_TRANSITION' | 'REASON_REQUIRED'; message: string };

/**
 * The single validation the engine runs before touching anything. Pure, so the whole rulebook is
 * exercised in unit tests rather than through the database.
 */
export const validateTransition = (
  object: WorkflowObject,
  from: WorkflowStatus,
  to: WorkflowStatus,
  reason?: string | null,
): TransitionRefusal => {
  const transition = findTransition(object, from, to);
  if (transition === null) {
    return {
      ok: false,
      code: 'ILLEGAL_TRANSITION',
      message: `${object} cannot move from "${from}" to "${to}"`,
    };
  }
  if (transition.requiresReason === true && (reason === undefined || reason === null || reason.trim() === '')) {
    return {
      ok: false,
      code: 'REASON_REQUIRED',
      message: `a reason is required to ${transition.action} this ${object}`,
    };
  }
  return { ok: true, transition };
};

/** Every state an object can be in — the enum, derived from the rulebook, for exhaustive tests. */
export const statesOf = (object: WorkflowObject): WorkflowStatus[] => [
  ...new Set(WORKFLOW_TRANSITIONS[object].flatMap((t) => [t.from, t.to])),
];
