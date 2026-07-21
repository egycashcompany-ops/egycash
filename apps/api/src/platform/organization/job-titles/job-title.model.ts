// Job Titles are organization-level catalogs (ADR-015) — no hierarchy, no managers. They carry
// the role *definition* (grade, salary band, hiring requirements); linking a title to a concrete
// Branch/Department/Section is the job of Job Positions (a later phase), never the title itself.
import { Schema, model } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';
import { localizedField } from '../shared/org-unit';

export interface JobTitleDoc extends BaseDocFields {
  code: string;
  name: LocalizedString;
  jobGrade: string;
  description: LocalizedString | null;
  salaryMin: number | null;
  salaryMax: number | null;
  requiredQualifications: LocalizedString | null;
  requiredExperienceYears: number | null;
  status: 'active' | 'inactive';
}

const localizedSubSchema = new Schema(localizedField, { _id: false });

const jobTitleSchema = new Schema<JobTitleDoc>(
  {
    code: { type: String, required: true, uppercase: true, trim: true },
    name: localizedField,
    jobGrade: { type: String, required: true, trim: true },
    description: { type: localizedSubSchema, default: null },
    salaryMin: { type: Number, default: null, min: 0 },
    salaryMax: { type: Number, default: null, min: 0 },
    requiredQualifications: { type: localizedSubSchema, default: null },
    requiredExperienceYears: { type: Number, default: null, min: 0 },
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
