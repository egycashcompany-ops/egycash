// Job Titles are organization-level catalogs (ADR-015) — no hierarchy, no managers.
import { Schema, model } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';
import { localizedField } from '../shared/org-unit';

export interface JobTitleDoc extends BaseDocFields {
  code: string;
  name: LocalizedString;
  status: 'active' | 'inactive';
}

const jobTitleSchema = new Schema<JobTitleDoc>(
  {
    code: { type: String, required: true, uppercase: true, trim: true },
    name: localizedField,
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    ...baseFields,
  },
  baseSchemaOptions,
);
jobTitleSchema.index(
  { code: 1 },
  { unique: true, name: 'ux_code', partialFilterExpression: { isDeleted: false } },
);

export const JobTitleModel = model<JobTitleDoc>('JobTitle', jobTitleSchema, 'job_titles');
