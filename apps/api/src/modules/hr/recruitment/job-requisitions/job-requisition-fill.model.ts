// One hire against one requisition — the fulfilment record (D-REQ-13).
//
// THE UNIQUE INDEX IS THE DESIGN, not a safeguard bolted on. Fulfilment is driven by the
// `hr.applicant.hired` event, and an event bus that guarantees at-least-once delivery will
// eventually deliver one twice. A `$inc` counter would quietly become wrong; a second insert of the
// same (requisition, applicant) pair fails instead, the handler treats the duplicate as the no-op
// it is, and the count — being a count of these rows — cannot drift.
//
// The record is written even when the requisition is no longer live: a hire happened, and a closed
// requisition does not un-hire anybody. What the record does NOT do is move a terminal status back
// (see `fulfilmentStatus`).
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface JobRequisitionFillDoc extends BaseDocFields {
  requisitionId: Types.ObjectId;
  applicantId: Types.ObjectId;
  /** Null when the hire event arrives before the employee record is readable; filled in later. */
  employeeId: Types.ObjectId | null;
  filledAt: Date;
}

const jobRequisitionFillSchema = new Schema<JobRequisitionFillDoc>(
  {
    requisitionId: { type: Schema.Types.ObjectId, required: true },
    applicantId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: Schema.Types.ObjectId, default: null },
    filledAt: { type: Date, required: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// One applicant fills one requisition once — the whole idempotency guarantee, in one line.
jobRequisitionFillSchema.index(
  { requisitionId: 1, applicantId: 1 },
  { name: 'ux_requisition_applicant', unique: true },
);

export const JobRequisitionFillModel = model<JobRequisitionFillDoc>(
  'HrJobRequisitionFill',
  jobRequisitionFillSchema,
  'hr_job_requisition_fills',
);
