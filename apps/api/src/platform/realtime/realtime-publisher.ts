// The realtime publisher (ADR-029): turns an audit record into topic-room signals. Runs in
// whichever process recorded the change — `emitToRoom` already delivers locally in the api and
// relays through Redis from the worker — and is BEST-EFFORT END TO END: nothing here may ever
// fail, slow, or reorder the mutation it rides on.
import {
  ACTIVITY_STREAM_TOPIC,
  AUDIT_STREAM_TOPIC,
  ENTITY_CHANGED_EVENT,
  REALTIME_BROADCAST_ACTIONS,
  branchTopicRoom,
  realtimeTopic,
  topicRoom,
  type AuditAction,
  type EntityChangedPayload,
  type EntityRef,
} from '@ecms/contracts';
import { env } from '../../infrastructure/config/env';
import { logger } from '../../infrastructure/logging/logger';
import { emitToRoom } from '../../infrastructure/realtime/socket-server';
import { REALTIME_EXCLUDED_ENTITIES, REALTIME_TOPICS } from './realtime-registry';

const BROADCAST_ACTIONS: ReadonlySet<string> = new Set(REALTIME_BROADCAST_ACTIONS);

/** Warn once per unclassified entity — the guard spec makes this unreachable from CI-green code. */
const warnedUnknownTopics = new Set<string>();

export interface AuditedChange {
  entityRef: EntityRef;
  action: AuditAction;
  /** ISO timestamp, the same one the audit row will carry. */
  at: string;
  /**
   * The branch the CHANGED RECORD belongs to, when the call site knows it. Optional on purpose:
   * without it the signal still reaches organization-wide viewers, and branch-scoped viewers
   * simply wait for their normal fetch — fail-closed, never cross-branch.
   */
  branchId?: string | null;
}

export const publishAuditedChange = (change: AuditedChange): void => {
  if (!env.REALTIME_ENABLED) return;
  try {
    const payload: EntityChangedPayload = {
      module: change.entityRef.moduleId,
      entity: change.entityRef.entityType,
      entityId: change.entityRef.entityId,
      action: change.action,
      at: change.at,
    };

    // Every record, whatever its action, feeds the audit screen's live stream.
    emitToRoom(topicRoom(AUDIT_STREAM_TOPIC), ENTITY_CHANGED_EVENT, payload);

    // Entity topics carry data changes only — telemetry actions (logins, exports…) stop here.
    if (!BROADCAST_ACTIONS.has(change.action)) return;
    const topic = realtimeTopic(payload.module, payload.entity);
    if (topic === AUDIT_STREAM_TOPIC || topic === ACTIVITY_STREAM_TOPIC) return; // already sent
    if (topic in REALTIME_EXCLUDED_ENTITIES) return;
    if (!(topic in REALTIME_TOPICS)) {
      if (!warnedUnknownTopics.has(topic)) {
        warnedUnknownTopics.add(topic);
        logger.warn({ topic }, 'audited entity has no realtime classification — not broadcast');
      }
      return;
    }

    emitToRoom(topicRoom(topic), ENTITY_CHANGED_EVENT, payload);
    if (change.branchId !== null && change.branchId !== undefined && change.branchId !== '') {
      emitToRoom(branchTopicRoom(topic, change.branchId), ENTITY_CHANGED_EVENT, payload);
    }
  } catch (error) {
    logger.warn({ err: error }, 'realtime publish failed — change delivered by refetch instead');
  }
};

/** Activity timeline entries stream to their own topic; they never touch entity topics. */
export const publishActivity = (entityRef: EntityRef, at: string): void => {
  if (!env.REALTIME_ENABLED) return;
  try {
    const payload: EntityChangedPayload = {
      module: entityRef.moduleId,
      entity: entityRef.entityType,
      entityId: entityRef.entityId,
      action: 'update',
      at,
    };
    emitToRoom(topicRoom(ACTIVITY_STREAM_TOPIC), ENTITY_CHANGED_EVENT, payload);
  } catch (error) {
    logger.warn({ err: error }, 'realtime activity publish failed');
  }
};
