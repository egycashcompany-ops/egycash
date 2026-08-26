// One candidate's handed-in documents — a single set per applicant.
//
// The bytes and their history live in the platform Files service; an item mirrors the CURRENT
// version plus the one thing the Files service has no opinion about: what HR made of it.
//
// NO AGGREGATE VERSION FIELD IS USED FOR CONCURRENCY HERE. Two parties write to this set — the
// candidate uploads, HR reviews — and an aggregate version would make every review collide with
// every upload for no gain. Each write instead names the slot it changes and the state that slot
// must still be in, which is both narrower and a stronger statement of the actual rule.
import { Schema, model, type Types } from 'mongoose';
import {
  APPLICANT_DOCUMENT_REVIEW_STATUSES,
  PROFESSIONAL_DRIVING_LICENSE_CLASSES,
  type ApplicantDocumentReviewStatus,
  type LocalizedString,
  type ProfessionalDrivingLicenseClass,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface ApplicantDocumentItem {
  typeId: Types.ObjectId;
  typeKey: string;
  typeName: LocalizedString;
  required: boolean;
  status: ApplicantDocumentReviewStatus;
  fileId: Types.ObjectId;
  fileName: string;
  fileVersion: number;
  /** Stated by the candidate, and only where the type asks for one (D-APP-6). */
  licenseClass: ProfessionalDrivingLicenseClass | null;
  uploadedAt: Date;
  reviewedBy: Types.ObjectId | null;
  reviewedAt: Date | null;
  /** Why it was refused. The candidate is shown this — they are the one asked to fix it. */
  reviewNote: string | null;
}

export interface ApplicantDocumentSetDoc extends BaseDocFields {
  applicantId: Types.ObjectId;
  applicantCode: string;
  applicantName: string;
  documents: ApplicantDocumentItem[];
}

const itemSchema = new Schema<ApplicantDocumentItem>(
  {
    typeId: { type: Schema.Types.ObjectId, required: true },
    typeKey: { type: String, required: true },
    typeName: { ar: { type: String, required: true }, en: { type: String, required: true } },
    required: { type: Boolean, required: true },
    status: {
      type: String,
      enum: APPLICANT_DOCUMENT_REVIEW_STATUSES,
      required: true,
      default: 'pending',
    },
    fileId: { type: Schema.Types.ObjectId, required: true },
    fileName: { type: String, required: true },
    fileVersion: { type: Number, required: true },
    licenseClass: { type: String, enum: PROFESSIONAL_DRIVING_LICENSE_CLASSES, default: null },
    uploadedAt: { type: Date, required: true },
    reviewedBy: { type: Schema.Types.ObjectId, default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: null },
  },
  { _id: false },
);

const applicantDocumentSetSchema = new Schema<ApplicantDocumentSetDoc>(
  {
    applicantId: { type: Schema.Types.ObjectId, required: true },
    applicantCode: { type: String, required: true },
    applicantName: { type: String, required: true },
    documents: { type: [itemSchema], default: [] },
    ...baseFields,
  },
  baseSchemaOptions,
);

// One set per applicant — the uniqueness that makes "open or create" idempotent.
applicantDocumentSetSchema.index(
  { applicantId: 1 },
  { unique: true, name: 'ux_applicant', partialFilterExpression: { isDeleted: false } },
);
// The queue HR works: sets holding something still waiting on a decision.
applicantDocumentSetSchema.index({ 'documents.status': 1, updatedAt: -1 }, { name: 'ix_status_updatedAt' });

export const ApplicantDocumentSetModel = model<ApplicantDocumentSetDoc>(
  'ApplicantDocumentSet',
  applicantDocumentSetSchema,
  'hr_applicant_document_sets',
);
