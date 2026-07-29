// The automation workflow registry (ADR-018 · design §8) — the ECMS-side record of an automation.
//
// ECMS owns this row; the provider owns the graph. `providerRef` is an opaque handle and is never
// interpreted here, which is what lets the provider be replaced without a data migration (D-A4).
//
// The engine that runs the graph is NOT the source of truth for anything in this document. If the
// provider is rebuilt from scratch, every workflow's identity, ownership, trigger and history
// survive here.
import { Schema, model, type Types } from 'mongoose';
import { type AutomationWorkflowStatus, type DataScope, type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface WorkflowTriggerSubdoc {
  kind: string;
  event: string | null;
  cron: string | null;
  runAt: Date | null;
  timezone: string;
  filters: { field: string; op: string; value?: unknown }[];
}

export interface AutomationWorkflowDoc extends BaseDocFields {
  key: string;
  name: LocalizedString;
  description: LocalizedString | null;
  status: AutomationWorkflowStatus;
  trigger: WorkflowTriggerSubdoc;
  /** The principal the workflow runs AS (§7.2). Not decoration — it bounds what it can do. */
  ownerUserId: Types.ObjectId;
  /** Denormalized from the owner at save time; the branch filter every list applies. */
  branchId: Types.ObjectId | null;
  branchScope: DataScope;
  providerRef: { providerId: string; ref: string } | null;
  template: { key: string; version: string } | null;
  aiOptIn: string[];
  /** Why the PLATFORM suspended it — always set when `status === 'suspended'`. */
  suspendedReason: string | null;
}

const localizedField = {
  ar: { type: String, required: true },
  en: { type: String, required: true },
} as const;

const automationWorkflowSchema = new Schema<AutomationWorkflowDoc>(
  {
    key: { type: String, required: true, trim: true },
    name: localizedField,
    description: { type: { ar: String, en: String }, default: null, _id: false },
    status: {
      type: String,
      enum: ['draft', 'active', 'disabled', 'suspended'],
      required: true,
      default: 'draft',
    },
    trigger: {
      _id: false,
      kind: { type: String, required: true },
      event: { type: String, default: null },
      cron: { type: String, default: null },
      runAt: { type: Date, default: null },
      timezone: { type: String, required: true, default: 'Africa/Cairo' },
      filters: {
        type: [{ _id: false, field: String, op: String, value: Schema.Types.Mixed }],
        default: [],
      },
    },
    ownerUserId: { type: Schema.Types.ObjectId, required: true },
    branchId: { type: Schema.Types.ObjectId, default: null },
    branchScope: {
      type: String,
      enum: ['own', 'section', 'department', 'branch', 'organization'],
      required: true,
      default: 'branch',
    },
    providerRef: {
      type: { providerId: String, ref: String },
      default: null,
      _id: false,
    },
    template: { type: { key: String, version: String }, default: null, _id: false },
    aiOptIn: { type: [String], default: [] },
    suspendedReason: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The key is the join target for template installs and for exports moving between environments,
// so it has to be unique among live workflows — but a soft-deleted one must not block reuse.
automationWorkflowSchema.index(
  { key: 1 },
  { name: 'ux_key', unique: true, partialFilterExpression: { isDeleted: false } },
);

// The dispatch lookup (design §8): "which active workflows listen to this event, in this branch?"
// It runs on every published event, so it is the one index that must not be missing.
automationWorkflowSchema.index(
  { 'trigger.event': 1, status: 1, branchId: 1 },
  { name: 'ix_dispatch' },
);
automationWorkflowSchema.index({ ownerUserId: 1, status: 1 }, { name: 'ix_owner' });

export const AutomationWorkflowModel = model<AutomationWorkflowDoc>(
  'AutomationWorkflow',
  automationWorkflowSchema,
  'automation_workflows',
);
