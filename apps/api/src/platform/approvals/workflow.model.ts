// One approval chain, and where it applies.
//
// The record is deliberately thin: a request type, a place it applies to, and an ordered list of
// rungs. Everything that makes a rung mean something — who holds the key, how far their authority
// reaches, whether anybody holds it at all — is resolved at decision time against the permission
// layer, never copied here. A workflow that stored people would be stale the first time somebody
// changed jobs, and a workflow that stored titles would be back to «مدير» and «HR».
import { Schema, model, type Types } from 'mongoose';
import { APPROVAL_LEVELS, type ApprovalLevel } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../shared/base/base.model';

export interface WorkflowStep {
  permissionKey: string;
  level: ApprovalLevel;
  label: { ar: string; en: string } | null;
}

export interface ApprovalWorkflowDoc extends BaseDocFields {
  /** The registered request type this chain runs for — `hr.leave`, `hr.regularization`, … */
  requestType: string;
  /**
   * Where it applies. `null` in either field means «any», and resolution prefers the most
   * specific match, so a company-wide default is one row and an exception is one more.
   */
  departmentCatalogId: Types.ObjectId | null;
  branchId: Types.ObjectId | null;
  steps: WorkflowStep[];
  isActive: boolean;
}

const stepSchema = new Schema<WorkflowStep>(
  {
    permissionKey: { type: String, required: true },
    level: { type: String, enum: APPROVAL_LEVELS, required: true },
    label: {
      type: { ar: { type: String }, en: { type: String } },
      default: null,
      _id: false,
    },
  },
  { _id: false },
);

const workflowSchema = new Schema<ApprovalWorkflowDoc>(
  {
    requestType: { type: String, required: true },
    departmentCatalogId: { type: Schema.Types.ObjectId, default: null },
    branchId: { type: Schema.Types.ObjectId, default: null },
    steps: { type: [stepSchema], required: true, default: [] },
    isActive: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// Resolution reads every live chain for one request type and picks among them in memory: there are
// a handful per type, and the alternative is four queries in specificity order on every decision.
workflowSchema.index({ requestType: 1, isActive: 1 }, { name: 'ix_requestType_isActive' });
// One chain per (type, department, branch). Two rows for the same place would make resolution a
// coin toss, and a coin toss about who may approve is not a thing to leave to an index-free table.
workflowSchema.index(
  { requestType: 1, departmentCatalogId: 1, branchId: 1 },
  {
    unique: true,
    name: 'ux_requestType_department_branch',
    partialFilterExpression: { isDeleted: false },
  },
);

export const ApprovalWorkflowModel = model<ApprovalWorkflowDoc>('ApprovalWorkflow', workflowSchema, 'approval_workflows');
