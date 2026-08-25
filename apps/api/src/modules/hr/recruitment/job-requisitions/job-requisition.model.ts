// A job requisition (P-HR-REQ) — one request to hire, for one job, in one department.
//
// The placement is ON this document (ADR-029): there is no seat collection to point at, and the
// four fields here are the same four `PlacementSchema` and `OfferTerms` carry, so the requisition
// is the SOURCE of a placement rather than a pointer to one.
//
// `branchId` and `departmentId` are both real scope axes here — not denormalized snapshots of
// somebody else's row, but the request's own subject — which is why the repository declares BOTH
// fields from the first commit (D-REQ-14). P-SCOPE-1's finding was that a repository which forgets
// one does not warn and does not narrow, and a request that names a department is exactly the row
// a department-scoped reader must be confined to.
//
// `filledCount` is NOT stored. It is counted from the link records (D-REQ-13) so that replaying
// `hr.applicant.hired` cannot inflate it.
import { Schema, model, type Types } from 'mongoose';
import { JOB_REQUISITION_PRIORITIES, JOB_REQUISITION_STATUSES, type JobRequisitionPriority, type JobRequisitionStatus } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface JobRequisitionDoc extends BaseDocFields {
  /** `REQ-2026-000123`, allocated once at creation and unique for life. */
  code: string;
  jobTitleId: Types.ObjectId;
  departmentId: Types.ObjectId;
  branchId: Types.ObjectId;
  /** Optional, and validated by the service to belong to `departmentId`. */
  sectionId: Types.ObjectId | null;
  quantity: number;
  reason: string;
  priority: JobRequisitionPriority;
  /** A date of need, not an expiry: nothing in this module lapses a requisition (D-REQ-17/§10). */
  neededBy: Date | null;
  status: JobRequisitionStatus;
  requestedBy: Types.ObjectId;
  managerDecidedBy: Types.ObjectId | null;
  managerDecidedAt: Date | null;
  managerComment: string | null;
  hrDecidedBy: Types.ObjectId | null;
  hrDecidedAt: Date | null;
  hrComment: string | null;
  closedBy: Types.ObjectId | null;
  closedAt: Date | null;
  /** Required by the schema of the act, not by this schema: the service refuses a close without one. */
  closeReason: string | null;
}

const jobRequisitionSchema = new Schema<JobRequisitionDoc>(
  {
    code: { type: String, required: true },
    jobTitleId: { type: Schema.Types.ObjectId, required: true },
    departmentId: { type: Schema.Types.ObjectId, required: true },
    branchId: { type: Schema.Types.ObjectId, required: true },
    sectionId: { type: Schema.Types.ObjectId, default: null },
    quantity: { type: Number, required: true, min: 1 },
    reason: { type: String, required: true },
    priority: { type: String, enum: JOB_REQUISITION_PRIORITIES, required: true, default: 'normal' },
    neededBy: { type: Date, default: null },
    status: { type: String, enum: JOB_REQUISITION_STATUSES, required: true, default: 'draft' },
    requestedBy: { type: Schema.Types.ObjectId, required: true },
    managerDecidedBy: { type: Schema.Types.ObjectId, default: null },
    managerDecidedAt: { type: Date, default: null },
    managerComment: { type: String, default: null },
    hrDecidedBy: { type: Schema.Types.ObjectId, default: null },
    hrDecidedAt: { type: Date, default: null },
    hrComment: { type: String, default: null },
    closedBy: { type: Schema.Types.ObjectId, default: null },
    closedAt: { type: Date, default: null },
    closeReason: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The code is the human handle; two requisitions may never share one.
jobRequisitionSchema.index({ code: 1 }, { name: 'ux_code', unique: true });
// The two queues this collection is read as: a department's requests, and everything waiting on a
// decision. Both are status-first reads over a scope axis the request itself carries.
jobRequisitionSchema.index({ departmentId: 1, status: 1 }, { name: 'ix_department_status' });
jobRequisitionSchema.index({ status: 1, priority: 1 }, { name: 'ix_status_priority' });

export const JobRequisitionModel = model<JobRequisitionDoc>(
  'HrJobRequisition',
  jobRequisitionSchema,
  'hr_job_requisitions',
);
