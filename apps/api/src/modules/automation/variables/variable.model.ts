// Automation variables (design §8) — non-secret configuration a workflow reads at run time:
// an approver's email, a threshold, a channel name. Editable without touching the graph, which
// is the point: changing a threshold should not require a workflow edit and a re-enable.
//
// Secrets do NOT live here. They live in `automation_credentials` (A-4), sealed, write-only.
// The separation is deliberate — a variable is readable by anyone with `variable.view`, and a
// value that must not be readable therefore cannot be a variable.
import { Schema, model, type Types } from 'mongoose';
import { type AutomationVariableScope } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface AutomationVariableDoc extends BaseDocFields {
  key: string;
  value: string;
  scope: AutomationVariableScope;
  branchId: Types.ObjectId | null;
  workflowId: Types.ObjectId | null;
}

const automationVariableSchema = new Schema<AutomationVariableDoc>(
  {
    key: { type: String, required: true, trim: true },
    value: { type: String, required: true, default: '' },
    scope: { type: String, enum: ['global', 'branch', 'workflow'], required: true },
    branchId: { type: Schema.Types.ObjectId, default: null },
    workflowId: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// One value per (key, scope, target). Without this, two rows for the same key resolve
// non-deterministically and a workflow reads whichever the index happened to return first.
automationVariableSchema.index(
  { key: 1, scope: 1, branchId: 1, workflowId: 1 },
  { name: 'ux_scoped_key', unique: true, partialFilterExpression: { isDeleted: false } },
);

export const AutomationVariableModel = model<AutomationVariableDoc>(
  'AutomationVariable',
  automationVariableSchema,
  'automation_variables',
);
