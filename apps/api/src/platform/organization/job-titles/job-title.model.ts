// Job Titles are organization-level catalogs (ADR-015) — no hierarchy, no managers. They carry
// the role *definition* (grade, salary band, hiring requirements); where a job sits belongs to the
// record that holds it — an employee's department, section and branch — never to the title itself.
import { Schema, model, type Types } from 'mongoose';
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
  requiresDrivingTest: boolean;
  /** P-HR-22 — the default an assignment copies. Not the band above; that one prices nothing. */
  fixedSalary: { amount: number; currency: string } | null;
  /** P-HR-22 — shifts this job may be worked on. A candidate list, not concurrent assignments. */
  defaultShiftIds: Types.ObjectId[];
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
    // Defaults false so every title that predates the flag keeps today's behaviour.
    requiresDrivingTest: { type: Boolean, default: false },
    // Both default to "the job states nothing", so every title that predates P-HR-22 supplies no
    // default and changes no behaviour until somebody fills one in. No backfill, by construction.
    fixedSalary: {
      type: new Schema<{ amount: number; currency: string }>(
        { amount: { type: Number, required: true }, currency: { type: String, required: true } },
        { _id: false },
      ),
      default: null,
    },
    defaultShiftIds: { type: [Schema.Types.ObjectId], default: [] },
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
