// Automation executions (design §8) — one row per (matched workflow, triggering occurrence).
//
// Introduced at A-5, which writes the rows the trigger bridge produces. A-7 grows the lifecycle on
// top: retry, cancel, per-node results, redacted output snapshots, the stuck-execution sweep. The
// shape here is the subset A-5 needs and is additive-safe for A-7.
//
// The row is the audit of a DISPATCH: which workflow, which event caused it, who it ran as, what
// the provider said. `inputSnapshot` is redacted before it ever reaches this collection (A-4
// redaction) — a workflow authenticates with a credential, and the payload that reaches the
// provider must not leave the secret in a retained row.
import { Schema, model, type Types } from 'mongoose';
import { type AutomationExecutionStatus } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface AutomationExecutionDoc extends BaseDocFields {
  workflowId: Types.ObjectId;
  workflowKey: string;
  /** The execution id handed to the provider — correlates ECMS logs with provider logs. */
  executionId: string;
  trigger: {
    kind: string;
    eventName: string | null;
    /** The platform event id that caused this — the idempotency key with `workflowId`. */
    eventId: string | null;
  };
  status: AutomationExecutionStatus;
  providerRef: { providerId: string; ref: string } | null;
  /** The subject the run executes AS (§7.2) — never an automation superuser. */
  actorUserId: Types.ObjectId | null;
  branchId: Types.ObjectId | null;
  /** Re-entrancy depth (§7.4). Visible because a depth-capped run looks like a silent one. */
  depth: number;
  /** Redacted (A-4) before it arrives here. */
  inputSnapshot: unknown;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

const automationExecutionSchema = new Schema<AutomationExecutionDoc>(
  {
    workflowId: { type: Schema.Types.ObjectId, required: true },
    workflowKey: { type: String, required: true },
    executionId: { type: String, required: true },
    trigger: {
      _id: false,
      kind: { type: String, required: true },
      eventName: { type: String, default: null },
      eventId: { type: String, default: null },
    },
    status: { type: String, required: true },
    providerRef: { type: { providerId: String, ref: String }, default: null, _id: false },
    actorUserId: { type: Schema.Types.ObjectId, default: null },
    branchId: { type: Schema.Types.ObjectId, default: null },
    depth: { type: Number, required: true, default: 0 },
    inputSnapshot: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The idempotency guarantee the trigger bridge relies on: one execution per (event, workflow).
// A redelivered event — the bus retrying, or two workers draining the same message — cannot create
// a second run. Partial because manual/cron triggers have no eventId and must not collide on null.
automationExecutionSchema.index(
  { 'trigger.eventId': 1, workflowId: 1 },
  {
    name: 'ux_event_workflow',
    unique: true,
    partialFilterExpression: { 'trigger.eventId': { $type: 'string' } },
  },
);
automationExecutionSchema.index({ workflowId: 1, createdAt: -1 }, { name: 'ix_workflow_recent' });
automationExecutionSchema.index({ status: 1, createdAt: 1 }, { name: 'ix_status_sweep' });

export const AutomationExecutionModel = model<AutomationExecutionDoc>(
  'AutomationExecution',
  automationExecutionSchema,
  'automation_executions',
);
