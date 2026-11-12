// A28 — «مسميات الوظائف لدى التأمينات»: a job title's title as the social-insurance authority knows it,
// what «نموذج رقم (1)» prints for a person of that job. One row per job that has one.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface InsuranceJobTitleDoc extends BaseDocFields {
  jobTitleId: Types.ObjectId;
  title: string;
}

const insuranceJobTitleSchema = new Schema<InsuranceJobTitleDoc>(
  {
    jobTitleId: { type: Schema.Types.ObjectId, required: true },
    title: { type: String, required: true, trim: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

insuranceJobTitleSchema.index(
  { jobTitleId: 1 },
  { unique: true, name: 'ux_job_title', partialFilterExpression: { isDeleted: false } },
);

export const InsuranceJobTitleModel = model<InsuranceJobTitleDoc>(
  'HrInsuranceJobTitle',
  insuranceJobTitleSchema,
  'hr_insurance_job_titles',
);
