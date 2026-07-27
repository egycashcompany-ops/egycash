// Event name → timeline entry type (I5) — PURE, like the rulebook and the event catalog beside it.
//
// The mapping must be TOTAL over `WorkflowEvents`. An unmapped event still reaches the timeline,
// but as a generic `note`, which is worse than a crash: the candidate's history shows a blank line
// where a real workflow fact happened, and nothing fails. `unmappedWorkflowEvents()` is asserted by
// a unit test, so adding an event without naming its entry fails the test run instead.
import { type RecruitmentTimelineType } from '@ecms/contracts';
import { WorkflowEvents, type WorkflowEventName } from './workflow-events';
import { type StageObject } from './workflow-transitions';

/**
 * `StageEntered` is deliberately absent: it is the one event whose entry depends on WHICH stage
 * was materialized, so it is answered by `stageEnteredType` rather than by a fixed value.
 */
const TIMELINE_TYPES: Partial<Record<WorkflowEventName, RecruitmentTimelineType>> = {
  [WorkflowEvents.StageLeft]: 'returnedToStage',

  [WorkflowEvents.ScreeningAccepted]: 'screeningDecided',
  [WorkflowEvents.ScreeningRejected]: 'screeningDecided',
  // A lifecycle exit CLOSES an undecided screening (I14) — that is not a decision, and calling it
  // one would put a rejection on the history of someone who simply withdrew.
  [WorkflowEvents.ScreeningCancelled]: 'screeningCancelled',
  [WorkflowEvents.ScreeningRedecided]: 'screeningDecided',

  [WorkflowEvents.InterviewScheduled]: 'interviewScheduled',
  [WorkflowEvents.InterviewStarted]: 'interviewStarted',
  [WorkflowEvents.InterviewCompleted]: 'interviewCompleted',
  [WorkflowEvents.InterviewCancelled]: 'interviewCancelled',
  [WorkflowEvents.InterviewRedecided]: 'interviewCompleted',

  [WorkflowEvents.EvaluationApproved]: 'evaluationDecided',
  [WorkflowEvents.EvaluationRejected]: 'evaluationDecided',
  [WorkflowEvents.EvaluationCancelled]: 'evaluationCancelled',
  [WorkflowEvents.EvaluationRedecided]: 'evaluationDecided',
  [WorkflowEvents.EvaluationReopened]: 'evaluationOpened',

  [WorkflowEvents.OfferCreated]: 'offerDrafted',
  [WorkflowEvents.OfferSent]: 'offerSent',
  [WorkflowEvents.OfferAccepted]: 'offerAccepted',
  [WorkflowEvents.OfferRejected]: 'offerRejected',
  [WorkflowEvents.OfferWithdrawn]: 'offerWithdrawn',
  [WorkflowEvents.OfferExpired]: 'offerExpired',
  [WorkflowEvents.OfferSuperseded]: 'offerWithdrawn',

  [WorkflowEvents.ApplicantHired]: 'hired',
  [WorkflowEvents.ApplicantRejected]: 'rejected',
  [WorkflowEvents.ApplicantWithdrawn]: 'withdrawn',
  [WorkflowEvents.ApplicantReactivated]: 'restored',
};

/** Materializing a record (I11) names the stage it opened, not a generic "entered". */
export const stageEnteredType = (object: StageObject): RecruitmentTimelineType => {
  if (object === 'screening') return 'screeningOpened';
  if (object === 'interview') return 'interviewScheduled';
  if (object === 'offer') return 'offerDrafted';
  return 'evaluationOpened';
};

/** The entry type an event projects to; `null` for an event nobody named (see the guard below). */
export const timelineTypeForEvent = (name: WorkflowEventName): RecruitmentTimelineType | null =>
  TIMELINE_TYPES[name] ?? null;

/** Every published event must name its timeline entry type — asserted by the unit tests (I5). */
export const unmappedWorkflowEvents = (): string[] =>
  Object.values(WorkflowEvents).filter(
    (name) => name !== WorkflowEvents.StageEntered && TIMELINE_TYPES[name] === undefined,
  );
