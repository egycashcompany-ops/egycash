// Lifecycle ≠ workflow (I14) — PURE, like the transition rulebook beside it.
//
// `applicant.status` is the FINAL BUSINESS OUTCOME and nothing else. Stage objects own their own
// independent status enums; a stage moving never drags the lifecycle with it. This module is the
// complete, closed answer to one question: "does this stage transition constitute a lifecycle
// event, and if so which one?" — so the engine can never invent one, and reporting can trust that
// a candidate's outcome does not shift because somebody rescheduled an interview.
import { type InterviewOutcome } from '@ecms/contracts';
import { type ApplicantWorkflowStatus, type StageObject, type WorkflowStatus } from './workflow-transitions';

/** The only events permitted to move the applicant lifecycle. */
export const LIFECYCLE_EVENTS = ['hire', 'permanentRejection', 'withdrawal', 'reactivation'] as const;
export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];

export interface LifecycleRule {
  event: LifecycleEvent;
  from: readonly ApplicantWorkflowStatus[];
  to: ApplicantWorkflowStatus;
  requiresReason: boolean;
}

export const LIFECYCLE_RULES: Record<LifecycleEvent, LifecycleRule> = {
  /** The candidate became an Employee. Not a stage transition at all — the hire raises it. */
  hire: { event: 'hire', from: ['new'], to: 'hired', requiresReason: false },
  /** A stage decision ended the candidacy. */
  permanentRejection: {
    event: 'permanentRejection',
    from: ['new'],
    to: 'rejected',
    requiresReason: true,
  },
  /** The candidate withdrew. */
  withdrawal: { event: 'withdrawal', from: ['new'], to: 'withdrawn', requiresReason: true },
  /** An explicit, reasoned HR action returning someone to the pipeline. Never automatic (I14). */
  reactivation: {
    event: 'reactivation',
    from: ['rejected', 'withdrawn'],
    to: 'new',
    requiresReason: true,
  },
};

/**
 * THE table (I14). Given a stage transition, does it constitute a lifecycle event?
 *
 * The `null` answers are as deliberate as the others:
 *  • an interview passed, an offer accepted — forward progress, not an outcome;
 *  • an offer REJECTED means the candidate declined the package, which says nothing about the
 *    person: HR may revise and re-offer, so the lifecycle stays `new`;
 *  • an offer withdrawn / expired / superseded is HR's or the clock's doing, not the candidate's;
 *  • a RETURN to an earlier stage never touches the lifecycle — the rule I14 exists to guarantee.
 */
export const lifecycleEffectOf = (
  object: StageObject,
  to: WorkflowStatus,
  outcome?: InterviewOutcome | null,
): LifecycleEvent | null => {
  if (object === 'screening') return to === 'rejected' ? 'permanentRejection' : null;
  if (object === 'evaluation') return to === 'rejected' ? 'permanentRejection' : null;
  if (object === 'interview') {
    return to === 'completed' && outcome === 'failed' ? 'permanentRejection' : null;
  }
  // Offers never move the lifecycle: acceptance is followed by a separate hire event, and every
  // other terminal offer state leaves the candidate exactly where they were.
  return null;
};

/**
 * Returning to a previous stage is NEVER a lifecycle event (I14). Kept as a named constant rather
 * than an implicit `null` so the guarantee is greppable and directly testable.
 */
export const RETURN_TO_STAGE_LIFECYCLE_EFFECT: LifecycleEvent | null = null;

export type LifecycleRefusal =
  | { ok: true; rule: LifecycleRule }
  | { ok: false; code: 'ILLEGAL_LIFECYCLE_TRANSITION' | 'REASON_REQUIRED'; message: string };

/** The engine's check before it touches `applicant.status` — the only place that ever does. */
export const validateLifecycleEvent = (
  event: LifecycleEvent,
  from: ApplicantWorkflowStatus,
  reason?: string | null,
): LifecycleRefusal => {
  const rule = LIFECYCLE_RULES[event];
  if (!rule.from.includes(from)) {
    return {
      ok: false,
      code: 'ILLEGAL_LIFECYCLE_TRANSITION',
      message: `an applicant that is "${from}" cannot undergo ${event}`,
    };
  }
  if (rule.requiresReason && (reason === undefined || reason === null || reason.trim() === '')) {
    return { ok: false, code: 'REASON_REQUIRED', message: `a reason is required to record ${event}` };
  }
  return { ok: true, rule };
};
