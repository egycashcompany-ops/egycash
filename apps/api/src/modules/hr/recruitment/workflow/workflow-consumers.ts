// Workflow event consumers (I15). Everything the engine does NOT do lives here: the timeline
// projection and the audit trail react to published facts. Neither writes workflow state back.
//
// Registered at module load; the dispatcher delivers to them after the producing transaction has
// committed, so a consumer failing leaves the event queued for retry rather than corrupting the
// pipeline.
import { Types } from 'mongoose';
import {
  RECRUITMENT_STAGE_KINDS,
  type LocalizedString,
  type RecruitmentStageKind,
  type RecruitmentTimelineType,
} from '@ecms/contracts';
import { auditService } from '../../../../platform/audit';
import { recruitmentTimelineService, type RecordTimelineInput } from '../timeline';
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

/**
 * WHICH round or phase the event was about, read off the payload the engine stamped.
 *
 * This is what the projection used to drop, and dropping it is what made the candidate's history
 * unreadable: every round projected the same «بدأت المقابلة», every phase the same «فُتح التقييم»,
 * so the security check and the medical check opening in the same minute looked like one event
 * written twice. The engine carries the identity on every stage event (`stageIdentityOf`), so the
 * entry can name the round — and `reconcileRecruitmentTimeline` rebuilds through this same
 * function, which means a repaired entry is named too.
 */
const stageOf = (event: WorkflowEventDoc): RecordTimelineInput['stage'] => {
  if (event.object === 'applicant') return undefined;
  const payload = event.payload as {
    stageKind?: unknown;
    stageRefId?: unknown;
    stageName?: unknown;
  };
  const kind = payload.stageKind;
  if (typeof kind !== 'string' || !RECRUITMENT_STAGE_KINDS.includes(kind as RecruitmentStageKind)) {
    return undefined;
  }
  return {
    kind: kind as RecruitmentStageKind,
    refId: typeof payload.stageRefId === 'string' ? payload.stageRefId : null,
    name:
      typeof payload.stageName === 'object' && payload.stageName !== null
        ? (payload.stageName as LocalizedString)
        : null,
  };
};

/** The timeline projection (I5/I15) — idempotent on the event's own id. */
export const projectToTimeline = async (event: WorkflowEventDoc): Promise<void> => {
  const stage = stageOf(event);
  await recruitmentTimelineService.record({
    ...(stage === undefined ? {} : { stage }),
    // The entry IS the event, as far as identity goes (I6): it takes the event's id, so the action
    // that published the event can echo the entry back without knowing when the projection ran.
    eventId: event.eventId,
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
