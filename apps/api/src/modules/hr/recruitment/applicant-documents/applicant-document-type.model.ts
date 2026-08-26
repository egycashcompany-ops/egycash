// The document catalogue (D-APP-4) — what the company asks a candidate for, as rows.
//
// Four for everyone and a fifth for drivers is TODAY'S answer. Employment paperwork changes on a
// ministry's timetable, not on this repository's, so the answer is data that an administrator can
// change rather than a constant that needs a release. Rows are deactivated, never hard-deleted: a
// set handed in last year must still be able to name the type it was handed in against.
import { Schema, model } from 'mongoose';
import {
  APPLICANT_DOCUMENT_APPLICABILITIES,
  type ApplicantDocumentApplicability,
  type LocalizedString,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface ApplicantDocumentTypeDoc extends BaseDocFields {
  key: string;
  name: LocalizedString;
  applicability: ApplicantDocumentApplicability;
  required: boolean;
  licenseClassRequired: boolean;
  order: number;
  active: boolean;
}

const applicantDocumentTypeSchema = new Schema<ApplicantDocumentTypeDoc>(
  {
    key: { type: String, required: true, trim: true },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    applicability: {
      type: String,
      enum: APPLICANT_DOCUMENT_APPLICABILITIES,
      required: true,
      default: 'all',
    },
    required: { type: Boolean, required: true, default: true },
    licenseClassRequired: { type: Boolean, required: true, default: false },
    order: { type: Number, required: true, default: 0 },
    active: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

applicantDocumentTypeSchema.index(
  { key: 1 },
  { unique: true, name: 'ux_key', partialFilterExpression: { isDeleted: false } },
);
applicantDocumentTypeSchema.index({ active: 1, order: 1 }, { name: 'ix_active_order' });

export const ApplicantDocumentTypeModel = model<ApplicantDocumentTypeDoc>(
  'ApplicantDocumentType',
  applicantDocumentTypeSchema,
  'hr_applicant_document_types',
);
