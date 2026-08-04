// Audit + activity streams (ADR-012). Append-only: no update/delete API exists,
// and the collection is additionally protected by a restricted DB role in production.
import { Schema, model, type Types } from 'mongoose';
import { AUDIT_ACTIONS, type AuditAction, type AuditChange, type EntityRef } from '@ecms/contracts';

/**
 * The actor as recorded when the event happened. History states what was true then; resolving a
 * User at read time would let a rename, a transfer or a deletion silently rewrite the past.
 */
export interface ActorSnapshotDoc {
  displayName: { ar: string; en: string };
  jobTitle: { ar: string; en: string } | null;
  avatarFileId: string | null;
  deletedAt: Date | null;
}

const actorSnapshotSchema = {
  _id: false,
  displayName: { ar: { type: String, required: true }, en: { type: String, required: true } },
  jobTitle: { ar: { type: String }, en: { type: String } },
  avatarFileId: { type: String, default: null },
  deletedAt: { type: Date, default: null },
};

export interface AuditLogDoc {
  _id: Types.ObjectId;
  entityRef: EntityRef;
  action: AuditAction;
  changes: AuditChange[];
  actor: { userId: Types.ObjectId | null; ip: string | null; userAgent: string | null };
  /** Who they were AT THE TIME. Absent on rows written before actor snapshots existed. */
  actorSnapshot?: ActorSnapshotDoc | null;
  requestId: string | null;
  at: Date;
}

const entityRefFields = {
  moduleId: { type: String, required: true },
  entityType: { type: String, required: true },
  entityId: { type: String, required: true },
} as const;

const auditLogSchema = new Schema<AuditLogDoc>(
  {
    entityRef: entityRefFields,
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    changes: [
      {
        _id: false,
        field: { type: String, required: true },
        old: { type: Schema.Types.Mixed, default: null },
        new: { type: Schema.Types.Mixed, default: null },
      },
    ],
    actor: {
      userId: { type: Schema.Types.ObjectId, default: null },
      ip: { type: String, default: null },
      userAgent: { type: String, default: null },
    },
    actorSnapshot: { type: actorSnapshotSchema, default: null },
    requestId: { type: String, default: null },
    at: { type: Date, required: true },
  },
  { strict: true, versionKey: false },
);
auditLogSchema.index(
  { 'entityRef.entityType': 1, 'entityRef.entityId': 1, at: -1 },
  { name: 'ix_entityRef_at' },
);
auditLogSchema.index({ 'actor.userId': 1, at: -1 }, { name: 'ix_actor_at' });
// F5 (Sprint 3.2): covers moduleId-filtered list/export queries.
auditLogSchema.index({ 'entityRef.moduleId': 1, at: -1 }, { name: 'ix_moduleId_at' });

export const AuditLogModel = model<AuditLogDoc>('AuditLog', auditLogSchema, 'audit_logs');

export interface ActivityLogDoc {
  _id: Types.ObjectId;
  entityRef: EntityRef;
  messageKey: string;
  params: Record<string, string>;
  actorId: Types.ObjectId | null;
  actorSnapshot?: ActorSnapshotDoc | null;
  at: Date;
}

const activityLogSchema = new Schema<ActivityLogDoc>(
  {
    entityRef: entityRefFields,
    messageKey: { type: String, required: true },
    params: { type: Schema.Types.Mixed, default: {} },
    actorId: { type: Schema.Types.ObjectId, default: null },
    actorSnapshot: { type: actorSnapshotSchema, default: null },
    at: { type: Date, required: true },
  },
  { strict: true, versionKey: false },
);
activityLogSchema.index(
  { 'entityRef.entityType': 1, 'entityRef.entityId': 1, at: -1 },
  { name: 'ix_entityRef_at' },
);
// F4 (Sprint 3.2): covers the retention job's age-based batch scan.
activityLogSchema.index({ at: 1 }, { name: 'ix_at' });

export const ActivityLogModel = model<ActivityLogDoc>(
  'ActivityLog',
  activityLogSchema,
  'activity_logs',
);
