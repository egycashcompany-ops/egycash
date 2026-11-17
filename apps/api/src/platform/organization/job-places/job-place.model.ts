// A job title's places in the company structure (P-ORG-3, ADR-038).
//
// One row per place: a company DEPARTMENT (its catalog entry), optionally narrowed to one of that
// department's SECTION entries. Catalog entries, never a branch's rows — «العمليات» is Operations in
// every branch, including one that opens next year, and a place held against rows would need one row
// per branch and none for a branch added later.
//
// DESCRIPTIVE. Nothing checks a person's registration against these rows, and nothing here counts,
// reserves or limits anything: no headcount, seat or vacancy (ADR-030). A job made inactive keeps its
// places; they are hidden while their department or section is stopped, never deleted for it.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface JobPlaceDoc extends BaseDocFields {
  jobTitleId: Types.ObjectId;
  departmentCatalogId: Types.ObjectId;
  /** null: directly under the department. */
  sectionCatalogId: Types.ObjectId | null;
}

const jobPlaceSchema = new Schema<JobPlaceDoc>(
  {
    jobTitleId: { type: Schema.Types.ObjectId, required: true },
    departmentCatalogId: { type: Schema.Types.ObjectId, required: true },
    sectionCatalogId: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

/** A job sits in one place once. */
jobPlaceSchema.index(
  { jobTitleId: 1, departmentCatalogId: 1, sectionCatalogId: 1 },
  {
    unique: true,
    name: 'ux_jobTitleId_departmentCatalogId_sectionCatalogId',
    partialFilterExpression: { isDeleted: false },
  },
);
jobPlaceSchema.index({ departmentCatalogId: 1 }, { name: 'ix_departmentCatalogId' });
jobPlaceSchema.index({ sectionCatalogId: 1 }, { name: 'ix_sectionCatalogId' });

export const JobPlaceModel = model<JobPlaceDoc>('JobPlace', jobPlaceSchema, 'job_title_places');
