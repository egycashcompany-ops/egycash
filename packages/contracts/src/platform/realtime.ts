// Realtime invalidation vocabulary (ADR-029) — shared by the api's publisher and the web's
// subscriber so neither side can drift on names.
//
// The one idea that keeps this safe: THE SIGNAL IS NOT DATA. A broadcast says only that an
// entity of some type changed — module, entity, id, action, timestamp — never a field of the
// record itself. Clients react by refetching through the normal authorized API, which applies
// their own permissions and data scope, so nothing sensitive ever rides the socket and a stale
// or out-of-order signal cannot write an older state over a newer one.
import { z } from 'zod';

/** The single server→client Socket.IO event all entity-change signals travel on. */
export const ENTITY_CHANGED_EVENT = 'entity.changed';

/**
 * The audit actions that describe a DATA change and therefore broadcast to entity topics.
 * Everything else in the audit vocabulary (logins, lockouts, exports, denied requests…) is
 * security/usage telemetry: it still reaches the audit-stream topic, never an entity topic.
 */
export const REALTIME_BROADCAST_ACTIONS = [
  'create',
  'update',
  'delete',
  'statusChange',
  'settingChanged',
  'roleAssigned',
  'roleRevoked',
] as const;

export const EntityChangedPayloadSchema = z.object({
  /** The owning module, e.g. `hr`, `gold`, `platform`. */
  module: z.string().min(1),
  /** The audited entity type inside that module, e.g. `employee`, `bar`. */
  entity: z.string().min(1),
  entityId: z.string().min(1),
  /** An audit action name — clients must tolerate values they do not know. */
  action: z.string().min(1),
  /** ISO timestamp of the change, informational only — ordering is NOT derived from it. */
  at: z.string().min(1),
});
export type EntityChangedPayload = z.infer<typeof EntityChangedPayloadSchema>;

/** Topic key for an entity type: `<module>.<entity>`, mirroring audit's `entityRef`. */
export const realtimeTopic = (module: string, entity: string): string => `${module}.${entity}`;

/** Socket.IO room carrying a topic's organization-wide signals. */
export const topicRoom = (topic: string): string => `topic:${topic}`;

/** Socket.IO room carrying one branch's slice of a topic — branch-scoped viewers join these. */
export const branchTopicRoom = (topic: string, branchId: string): string =>
  `topic:${topic}:branch:${branchId}`;

/**
 * Every audit record — whatever its action — also lands on this stream so the audit screen is
 * live. Its room is gated by `auditLog.view`, same as the screen itself.
 */
export const AUDIT_STREAM_TOPIC = 'platform.auditLog';

/** Activity timeline entries (`recordActivity`) stream here, gated by `activityLog.view`. */
export const ACTIVITY_STREAM_TOPIC = 'platform.activityLog';
