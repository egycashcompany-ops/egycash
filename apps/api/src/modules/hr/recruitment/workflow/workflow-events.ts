// The event catalog (I15) — PURE, like the rulebook and the lifecycle table beside it.
//
// The engine validates a transition, updates the aggregate, and publishes ONE event. This module
// answers "which event?" for every transition the rulebook declares, so the mapping is total,
// reviewable and testable without a database. Consumers — timeline, audit, notifications,
// counters, badges, file generation, integrations, analytics — subscribe to these names; none of
// them may write workflow state back (I15: events are facts, not commands).
//
// A transition emits exactly one event. The state it left travels as `from` in the payload, so a
// consumer never has to correlate a pair or dedupe.
import { type LifecycleEvent } from './workflow-lifecycle';
import {
  WORKFLOW_TRANSITIONS,
  type StageObject,
  type WorkflowObject,
  type WorkflowStatus,
} from './workflow-transitions';

/**
 * Every event the recruitment workflow publishes (ADR-008 `<module>.<entity>.<event>`).
 * `stageEntered` / `stageLeft` are the two generic facts that have no object-specific name: a
 * record being materialized (I11), and a record being retired by a return to an earlier stage
 * (RW13).
 */
export const WorkflowEvents = {
  StageEntered: 'hr.recruitment.stageEntered',
  StageLeft: 'hr.recruitment.stageLeft',

  ScreeningAccepted: 'hr.screening.accepted',
  ScreeningRejected: 'hr.screening.rejected',
  ScreeningRedecided: 'hr.screening.redecided',

  InterviewScheduled: 'hr.interview.scheduled',
  InterviewStarted: 'hr.interview.started',
  InterviewCompleted: 'hr.interview.completed',
  InterviewCancelled: 'hr.interview.cancelled',
  InterviewRedecided: 'hr.interview.redecided',

  EvaluationApproved: 'hr.evaluation.approved',
  EvaluationRejected: 'hr.evaluation.rejected',
  EvaluationRedecided: 'hr.evaluation.redecided',
  EvaluationReopened: 'hr.evaluation.reopened',

  OfferCreated: 'hr.jobOffer.created',
  OfferSent: 'hr.jobOffer.sent',
  OfferAccepted: 'hr.jobOffer.accepted',
  OfferRejected: 'hr.jobOffer.rejected',
  OfferWithdrawn: 'hr.jobOffer.withdrawn',
  OfferExpired: 'hr.jobOffer.expired',
  OfferSuperseded: 'hr.jobOffer.superseded',

  ApplicantHired: 'hr.applicant.hired',
  ApplicantRejected: 'hr.applicant.rejected',
  ApplicantWithdrawn: 'hr.applicant.withdrawn',
  ApplicantReactivated: 'hr.applicant.reactivated',
} as const;
export type WorkflowEventName = (typeof WorkflowEvents)[keyof typeof WorkflowEvents];

const key = (object: WorkflowObject, from: WorkflowStatus, to: WorkflowStatus): string =>
  `${object}:${from}->${to}`;

/**
 * The complete transition → event mapping. Exhaustive over `WORKFLOW_TRANSITIONS`, which a unit
 * test asserts: adding a transition without naming its event fails the build's test run rather
 * than silently publishing nothing.
 *
 * Several transitions share a name when they are the same fact — `rejected → new` and
 * `withdrawn → new` are both a reactivation; flipping a decision either way is one `redecided`.
 */
const TRANSITION_EVENTS: Record<string, WorkflowEventName> = {
  // ── Lifecycle (I14) ───────────────────────────────────────────────────────
  [key('applicant', 'new', 'hired')]: WorkflowEvents.ApplicantHired,
  [key('applicant', 'new', 'rejected')]: WorkflowEvents.ApplicantRejected,
  [key('applicant', 'new', 'withdrawn')]: WorkflowEvents.ApplicantWithdrawn,
  [key('applicant', 'rejected', 'new')]: WorkflowEvents.ApplicantReactivated,
  [key('applicant', 'withdrawn', 'new')]: WorkflowEvents.ApplicantReactivated,

  // ── Screening ─────────────────────────────────────────────────────────────
  [key('screening', 'waiting', 'accepted')]: WorkflowEvents.ScreeningAccepted,
  [key('screening', 'waiting', 'rejected')]: WorkflowEvents.ScreeningRejected,
  [key('screening', 'accepted', 'rejected')]: WorkflowEvents.ScreeningRedecided,
  [key('screening', 'rejected', 'accepted')]: WorkflowEvents.ScreeningRedecided,

  // ── Interview ─────────────────────────────────────────────────────────────
  [key('interview', 'waiting', 'scheduled')]: WorkflowEvents.InterviewScheduled,
  [key('interview', 'waiting', 'inProgress')]: WorkflowEvents.InterviewStarted,
  [key('interview', 'waiting', 'cancelled')]: WorkflowEvents.InterviewCancelled,
  [key('interview', 'scheduled', 'inProgress')]: WorkflowEvents.InterviewStarted,
  [key('interview', 'scheduled', 'completed')]: WorkflowEvents.InterviewCompleted,
  [key('interview', 'scheduled', 'cancelled')]: WorkflowEvents.InterviewCancelled,
  [key('interview', 'inProgress', 'completed')]: WorkflowEvents.InterviewCompleted,
  [key('interview', 'inProgress', 'cancelled')]: WorkflowEvents.InterviewCancelled,
  [key('interview', 'completed', 'completed')]: WorkflowEvents.InterviewRedecided,

  // ── Evaluation ────────────────────────────────────────────────────────────
  [key('evaluation', 'waiting', 'approved')]: WorkflowEvents.EvaluationApproved,
  [key('evaluation', 'waiting', 'rejected')]: WorkflowEvents.EvaluationRejected,
  [key('evaluation', 'approved', 'rejected')]: WorkflowEvents.EvaluationRedecided,
  [key('evaluation', 'rejected', 'approved')]: WorkflowEvents.EvaluationRedecided,
  [key('evaluation', 'approved', 'waiting')]: WorkflowEvents.EvaluationReopened,
  [key('evaluation', 'rejected', 'waiting')]: WorkflowEvents.EvaluationReopened,

  // ── Offer ─────────────────────────────────────────────────────────────────
  [key('offer', 'waiting', 'draft')]: WorkflowEvents.OfferCreated,
  [key('offer', 'waiting', 'superseded')]: WorkflowEvents.OfferSuperseded,
  [key('offer', 'draft', 'sent')]: WorkflowEvents.OfferSent,
  [key('offer', 'draft', 'withdrawn')]: WorkflowEvents.OfferWithdrawn,
  [key('offer', 'draft', 'superseded')]: WorkflowEvents.OfferSuperseded,
  [key('offer', 'sent', 'accepted')]: WorkflowEvents.OfferAccepted,
  [key('offer', 'sent', 'rejected')]: WorkflowEvents.OfferRejected,
  [key('offer', 'sent', 'expired')]: WorkflowEvents.OfferExpired,
  [key('offer', 'sent', 'withdrawn')]: WorkflowEvents.OfferWithdrawn,
  [key('offer', 'sent', 'superseded')]: WorkflowEvents.OfferSuperseded,
  [key('offer', 'accepted', 'withdrawn')]: WorkflowEvents.OfferWithdrawn,
  [key('offer', 'accepted', 'superseded')]: WorkflowEvents.OfferSuperseded,
};

/** The event a transition publishes; `null` only for a move the rulebook does not declare. */
export const eventForTransition = (
  object: WorkflowObject,
  from: WorkflowStatus,
  to: WorkflowStatus,
): WorkflowEventName | null => TRANSITION_EVENTS[key(object, from, to)] ?? null;

/** Materializing a stage record (I11) — the one fact with no prior state. */
export const eventForMaterialization = (): WorkflowEventName => WorkflowEvents.StageEntered;

/** Retiring a stage record by a return to an earlier stage (RW13/A8). */
export const eventForSupersede = (): WorkflowEventName => WorkflowEvents.StageLeft;

/** The lifecycle event a lifecycle transition publishes (I14) — one per lifecycle event kind. */
const LIFECYCLE_EVENT_NAMES: Record<LifecycleEvent, WorkflowEventName> = {
  hire: WorkflowEvents.ApplicantHired,
  permanentRejection: WorkflowEvents.ApplicantRejected,
  withdrawal: WorkflowEvents.ApplicantWithdrawn,
  reactivation: WorkflowEvents.ApplicantReactivated,
};

export const eventForLifecycle = (event: LifecycleEvent): WorkflowEventName =>
  LIFECYCLE_EVENT_NAMES[event];

/**
 * The immutable fact the engine writes and publishes. Stored in the append-only outbox in the
 * SAME transaction as the aggregate change (I15), then dispatched after commit — which is how
 * I4's atomicity and I5's replayable timeline survive side effects moving into consumers.
 */
export interface WorkflowEventRecord {
  /** Immutable public identity; consumers dedupe and projections stay idempotent on it (I9). */
  eventId: string;
  name: WorkflowEventName;
  occurredAt: Date;
  actorUserId: string | null;
  applicantId: string;
  applicantCode: string;
  object: WorkflowObject;
  /** The aggregate this fact is about; absent for pure lifecycle events. */
  entityType: string | null;
  entityId: string | null;
  attempt: number | null;
  /** Where it came from and went to — a consumer never correlates two events for one move. */
  from: WorkflowStatus | null;
  to: WorkflowStatus;
  reason: string | null;
  /** Groups the events of one episode, and of one command that produced several (I9). */
  correlationId: string;
  branchId: string | null;
  payload: Record<string, unknown>;
}

/** Every transition the rulebook declares must name an event — asserted by the unit tests. */
export const unmappedTransitions = (): string[] => {
  const missing: string[] = [];
  for (const object of Object.keys(WORKFLOW_TRANSITIONS) as WorkflowObject[]) {
    for (const t of WORKFLOW_TRANSITIONS[object]) {
      if (eventForTransition(object, t.from, t.to) === null) missing.push(key(object, t.from, t.to));
    }
  }
  return missing;
};

/** Stage objects whose events consumers may subscribe to by prefix (`hr.interview.*`). */
export const eventPrefixFor = (object: StageObject): string =>
  object === 'offer' ? 'hr.jobOffer.' : `hr.${object}.`;
