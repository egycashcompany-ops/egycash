// A28 — «مستندات الوظائف»: what a job prints, as HR set it beside every paper. Kept as what was added
// to, and taken off, the papers the templates give the job (their «الوظائف»), so a paper published
// later for every job still reaches a job that was changed here.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

/** A job's papers as «مستندات الوظائف» saved them, against what the templates give it. */
export interface JobPaperOverride {
  /** Template keys the job prints that its templates do not give it. */
  added: readonly string[];
  /** Template keys its templates give it that it does not print. */
  removed: readonly string[];
}

export interface JobPapersDoc extends BaseDocFields {
  departmentId: Types.ObjectId | null;
  jobTitleId: Types.ObjectId;
  added: string[];
  removed: string[];
}

const jobPapersSchema = new Schema<JobPapersDoc>(
  {
    departmentId: { type: Schema.Types.ObjectId, default: null },
    jobTitleId: { type: Schema.Types.ObjectId, required: true },
    added: { type: [String], default: [] },
    removed: { type: [String], default: [] },
    ...baseFields,
  },
  baseSchemaOptions,
);

jobPapersSchema.index(
  { departmentId: 1, jobTitleId: 1 },
  { unique: true, name: 'ux_department_job', partialFilterExpression: { isDeleted: false } },
);

export const JobPapersModel = model<JobPapersDoc>('HrJobPapers', jobPapersSchema, 'hr_job_papers');
