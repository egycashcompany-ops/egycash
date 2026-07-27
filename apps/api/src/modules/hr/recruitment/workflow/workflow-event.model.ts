// The workflow event outbox (I15). Append-only: the engine writes the aggregate change and the
// event record in ONE transaction, and the dispatcher publishes to subscribers after commit.
// Never updated except to stamp dispatch bookkeeping.
import { Schema, model, type Types } from 'mongoose';
import { WORKFLOW_OBJECTS, type WorkflowObject } from './workflow-transitions';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface WorkflowEventDoc extends BaseDocFields {
  eventId: string;
  name: string;
  occurredAt: Date;
  actorUserId: Types.ObjectId | null;
  applicantId: Types.ObjectId;
  applicantCode: string;
  object: WorkflowObject;
  entityType: string | null;
  entityId: Types.ObjectId | null;
  attempt: number | null;
  from: string | null;
  to: string;
  reason: string | null;
  correlationId: string;
  branchId: Types.ObjectId | null;
  payload: Record<string, unknown>;
  /** Dispatch bookkeeping — the only fields ever written after insert. */
  dispatchedAt: Date | null;
  dispatchAttempts: number;
  dispatchError: string | null;
}

const workflowEventSchema = new Schema<WorkflowEventDoc>(
  {
    eventId: { type: String, required: true },
    name: { type: String, required: true },
    occurredAt: { type: Date, required: true },
    actorUserId: { type: Schema.Types.ObjectId, default: null },
    applicantId: { type: Schema.Types.ObjectId, required: true },
    applicantCode: { type: String, required: true, default: '' },
    object: { type: String, enum: WORKFLOW_OBJECTS, required: true },
    entityType: { type: String, default: null },
    entityId: { type: Schema.Types.ObjectId, default: null },
    attempt: { type: Number, default: null },
    from: { type: String, default: null },
    to: { type: String, required: true },
    reason: { type: String, default: null },
    correlationId: { type: String, required: true },
    branchId: { type: Schema.Types.ObjectId, default: null },
    payload: { type: Schema.Types.Mixed, required: true, default: {} },
    dispatchedAt: { type: Date, default: null },
    dispatchAttempts: { type: Number, required: true, default: 0 },
    dispatchError: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

workflowEventSchema.index({ eventId: 1 }, { unique: true, name: 'ux_eventId' });
workflowEventSchema.index({ applicantId: 1, occurredAt: -1 }, { name: 'ix_applicant_occurredAt' });
// The dispatcher's queue: undispatched events, oldest first.
workflowEventSchema.index({ dispatchedAt: 1, occurredAt: 1 }, { name: 'ix_dispatch_queue' });
workflowEventSchema.index({ name: 1, occurredAt: -1 }, { name: 'ix_name_occurredAt' });

export const WorkflowEventModel = model<WorkflowEventDoc>(
  'RecruitmentWorkflowEvent',
  workflowEventSchema,
  'hr_recruitment_events',
);
