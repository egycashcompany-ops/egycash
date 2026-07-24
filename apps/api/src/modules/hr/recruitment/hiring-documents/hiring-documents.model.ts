// The Hiring Documents aggregate (Stage 6) — one per hired employee. It tracks the collected
// documents; the PDF bytes and their version history live in the platform Files service (the
// original is preserved, replacement adds a new version). Each item stores the CURRENT file
// version's id plus mirrored metadata (type, name, uploader, upload date, version). `status`
// is `inProgress` while documents are collected, then terminal `completed`; once completed the
// set is immutable except through the versioning (replace) workflow. `employeeCode`/`branchId`/
// `managerId` are denormalized from the employee.
import { Schema, model, type Types } from 'mongoose';
import {
  HIRING_DOCUMENTS_STATUSES,
  type HiringDocumentsStatus,
  type LocalizedString,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface HiringDocumentItem {
  typeId: Types.ObjectId;
  typeKey: string;
  typeName: LocalizedString;
  required: boolean;
  fileId: Types.ObjectId;
  fileName: string;
  fileVersion: number;
  notes: string | null;
  uploadedBy: Types.ObjectId | null;
  uploadedAt: Date;
}

export interface HiringDocumentsDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  employeeCode: string;
  /** null for a DIRECT-registration employee. */
  applicantId: Types.ObjectId | null;
  branchId: Types.ObjectId;
  /** Reporting manager, denormalized from the employee — null when the accepted offer set none. */
  managerId: Types.ObjectId | null;
  status: HiringDocumentsStatus;
  documents: HiringDocumentItem[];
  completedAt: Date | null;
  completedBy: Types.ObjectId | null;
}

const documentItemSchema = new Schema<HiringDocumentItem>(
  {
    typeId: { type: Schema.Types.ObjectId, required: true },
    typeKey: { type: String, required: true },
    typeName: { ar: { type: String, required: true }, en: { type: String, required: true } },
    required: { type: Boolean, required: true },
    fileId: { type: Schema.Types.ObjectId, required: true },
    fileName: { type: String, required: true },
    fileVersion: { type: Number, required: true },
    notes: { type: String, default: null },
    uploadedBy: { type: Schema.Types.ObjectId, default: null },
    uploadedAt: { type: Date, required: true },
  },
  { _id: false },
);

const hiringDocumentsSchema = new Schema<HiringDocumentsDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    employeeCode: { type: String, required: true },
    applicantId: { type: Schema.Types.ObjectId, default: null },
    branchId: { type: Schema.Types.ObjectId, required: true },
    managerId: { type: Schema.Types.ObjectId, default: null },
    status: { type: String, enum: HIRING_DOCUMENTS_STATUSES, required: true, default: 'inProgress' },
    documents: { type: [documentItemSchema], default: [] },
    completedAt: { type: Date, default: null },
    completedBy: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// One hiring-documents set per employee.
hiringDocumentsSchema.index(
  { employeeId: 1 },
  { unique: true, name: 'ux_employee', partialFilterExpression: { isDeleted: false } },
);
hiringDocumentsSchema.index({ status: 1, createdAt: -1 }, { name: 'ix_status_createdAt' });
hiringDocumentsSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branchId_status' });

export const HiringDocumentsModel = model<HiringDocumentsDoc>(
  'HiringDocuments',
  hiringDocumentsSchema,
  'hr_hiring_documents',
);
