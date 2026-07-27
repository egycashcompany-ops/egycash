// Workflow event consumers (I15). Everything the engine does NOT do lives here: the timeline
// projection and the audit trail react to published facts. Neither writes workflow state back.
//
// Registered at module load; the dispatcher delivers to them after the producing transaction has
// committed, so a consumer failing leaves the event queued for retry rather than corrupting the
// pipeline.
import { Types } from 'mongoose';
import { type RecruitmentTimelineType } from '@ecms/contracts';
import { auditService } from '../../../../platform/audit';
import { recruitmentTimelineService } from '../timeline';
import { onWorkflowEvent } from './workflow-dispatcher';
import { WorkflowEvents, type WorkflowEventName } from './workflow-events';
import { stageEnteredType, timelineTypeForEvent } from './workflow-timeline-map';
import { type StageObject } from './workflow-transitions';
import { type WorkflowEventDoc } from './workflow-event.model';

const timelineType = (event: WorkflowEventDoc): RecruitmentTimelineType => {
  if (event.name === WorkflowEvents.StageEntered) return stageEnteredType(event.object as StageObject);
  // `note` is unreachable while the mapping stays total, which a unit test enforces.
  return timelineTypeForEvent(event.name as WorkflowEventName) ?? 'note';
};

const correlationTypeOf = (event: WorkflowEventDoc): 'applicant' | 'screening' | 'interview' | 'evaluation' | 'offer' => {
  if (event.object === 'applicant') return 'applicant';
  return event.object;
};

/** The timeline projection (I5/I15) — idempotent on the event's own id. */
export const projectToTimeline = async (event: WorkflowEventDoc): Promise<void> => {
  await recruitmentTimelineService.record({
    applicantId: String(event.applicantId),
    applicantCode: event.applicantCode,
    type: timelineType(event),
    correlation: { type: correlationTypeOf(event), id: event.correlationId },
    actorUserId: event.actorUserId === null ? null : String(event.actorUserId),
    at: event.occurredAt,
    fromStatus: event.from,
    toStatus: event.to,
    ...(event.entityType === null || event.entityId === null
      ? {}
      : { entity: { type: event.entityType, id: String(event.entityId) } }),
    reason: event.reason,
    branchId: event.branchId,
    // The event id makes the projection idempotent: replaying it produces the same source key.
    discriminator: event.eventId,
    metadata: { eventId: event.eventId, eventName: event.name, ...event.payload },
  });
};

/** The audit trail (I15) — every workflow transition is recorded as a status change. */
export const auditWorkflowEvent = async (event: WorkflowEventDoc): Promise<void> => {
  if (event.entityType === null || event.entityId === null) return;
  await auditService.record({
    entityRef: {
      moduleId: 'hr',
      entityType: event.entityType,
      entityId: String(event.entityId),
    },
    action: 'statusChange',
    changes: [
      { field: 'status', old: event.from, new: event.to },
      ...(event.reason === null ? [] : [{ field: 'reason', old: null, new: event.reason }]),
    ],
  });
};

let registered = false;

/** Wire the built-in consumers. Idempotent — safe to call from module load and from tests. */
export const registerRecruitmentWorkflowConsumers = (): void => {
  if (registered) return;
  registered = true;
  onWorkflowEvent('recruitment.timeline', '*', projectToTimeline);
  onWorkflowEvent('recruitment.audit', '*', auditWorkflowEvent);
};

/** Test seam. */
export const resetRecruitmentWorkflowConsumerRegistration = (): void => {
  registered = false;
};

export const objectIdOrNull = (value: string | null): Types.ObjectId | null =>
  value === null || !Types.ObjectId.isValid(value) ? null : new Types.ObjectId(value);
