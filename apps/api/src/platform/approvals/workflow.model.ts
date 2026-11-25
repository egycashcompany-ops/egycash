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

/**
 * Whether a write that pins a chain stores its rungs beside the id.
 *
 * Read through `get`, which a document answers with its own rungs and an update query run with
 * `context: 'query'` answers with the rungs the same update sets: a pin is written whole, both
 * fields in the write that starts a round (ADR-041 decision 4). Anything else that sets the id
 * shows no rungs, and is refused with it.
 */
function pinHasRungs(
  this: { get?: (path: string) => unknown } | null,
  workflowId: unknown,
): boolean {
  if (workflowId === null || workflowId === undefined) return true;
  const rungs = typeof this?.get === 'function' ? this.get('approvalChainShape') : undefined;
  return Array.isArray(rungs) && rungs.length > 0;
}

/**
 * The pin a host stores on each request it hands the engine: spread into its schema, as every
 * schema spreads `baseFields`.
 *
 * `approvalWorkflowId` is the row `chainFor` chose, null while the request is not pinned, and
 * `approvalChainShape` its rungs in order, captions included, stored in the chain row's own rung
 * schema so a pinned rung is held to exactly what a chain row's is. The rungs, not the people:
 * who stands on a pinned rung is still asked at every call. An id with no rungs is refused, because
 * such a pin could only read `noChain`, and a request would then name a chain it cannot be decided
 * on.
 */
export const approvalPinFields = {
  approvalWorkflowId: {
    type: Schema.Types.ObjectId,
    default: null,
    validate: {
      validator: pinHasRungs,
      message: 'a pinned approval chain must carry its rungs',
    },
  },
  // Not `as const`, unlike `baseFields`: a host schema typed with a required array field refuses a
  // readonly empty default.
  approvalChainShape: { type: [stepSchema], default: [] },
};

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
