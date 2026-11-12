// A28 — «مسميات الوظائف لدى التأمينات»: a row HR types by hand — the company's job title, its title at
// the social-insurance authority, and its occupation code. «نموذج رقم (1)» prints the row's title and
// code for a person whose job carries the row's title (folded, as job names are matched).
import { Schema, model } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface InsuranceJobTitleDoc extends BaseDocFields {
  /** The company's job title, as typed. */
  jobTitle: string;
  /** `jobTitle` folded (`jobKey`) — what a person's job is matched on. */
  nameKey: string;
  insuranceTitle: string;
  /** «123/456», or up to six digits. */
  occupationCode: string;
}

const insuranceJobTitleSchema = new Schema<InsuranceJobTitleDoc>(
  {
    jobTitle: { type: String, required: true, trim: true },
    nameKey: { type: String, required: true },
    insuranceTitle: { type: String, default: '', trim: true },
    occupationCode: { type: String, default: '', trim: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

insuranceJobTitleSchema.index(
  { nameKey: 1 },
  { unique: true, name: 'ux_name_key', partialFilterExpression: { isDeleted: false } },
);

export const InsuranceJobTitleModel = model<InsuranceJobTitleDoc>(
  'HrInsuranceJobTitle',
  insuranceJobTitleSchema,
  'hr_insurance_job_titles',
);
