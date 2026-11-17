// Hiring document type catalog (Stage 6) — the administrator-defined set of documents a new
// hire must (required) or may (optional) provide. Localized, extensible, deactivated (never
// hard-deleted) so historical hiring sets keep referencing a type.
import { Schema, model, type Types } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface HiringDocumentTypeDoc extends BaseDocFields {
  key: string;
  name: LocalizedString;
  required: boolean;
  active: boolean;
  /**
   * A27, stage 3 — collected for every job, or only for `jobTitleIds`. OPTIONAL on the stored row:
   * one written before has neither, and reads are lean, so read them through `jobScope`.
   */
  allJobs?: boolean;
  jobTitleIds?: Types.ObjectId[];
}

const hiringDocumentTypeSchema = new Schema<HiringDocumentTypeDoc>(
  {
    key: { type: String, required: true, trim: true },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    required: { type: Boolean, required: true, default: false },
    active: { type: Boolean, required: true, default: true },
    allJobs: { type: Boolean, default: true },
    jobTitleIds: { type: [Schema.Types.ObjectId], default: [] },
    ...baseFields,
  },
  baseSchemaOptions,
);

hiringDocumentTypeSchema.index(
  { key: 1 },
  { unique: true, name: 'ux_key', partialFilterExpression: { isDeleted: false } },
);

export const HiringDocumentTypeModel = model<HiringDocumentTypeDoc>(
  'HiringDocumentType',
  hiringDocumentTypeSchema,
  'hr_hiring_document_types',
);

/** The jobs a type is collected for, a row written before A27 read as what it was: every job. */
export const jobScope = (
  doc: Pick<HiringDocumentTypeDoc, 'allJobs' | 'jobTitleIds'>,
): { allJobs: boolean; jobTitleIds: Types.ObjectId[] } => ({
  allJobs: doc.allJobs ?? true,
  jobTitleIds: doc.jobTitleIds ?? [],
});

/** Is a type collected from an employee whose job is `jobTitleId` (null: the job is unknown)? */
export const collectsFor = (
  doc: Pick<HiringDocumentTypeDoc, 'allJobs' | 'jobTitleIds'>,
  jobTitleId: string | null,
): boolean => {
  const scope = jobScope(doc);
  return scope.allJobs || (jobTitleId !== null && scope.jobTitleIds.some((id) => String(id) === jobTitleId));
};
