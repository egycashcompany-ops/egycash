// A file in a Compliance folder (design §3.2): the link to the bytes Files keeps, under the name the
// responsible person gives it. Renaming changes `name` only — the bytes and the name the file had on
// the uploader's computer (`fileName`) stay as they were.
import { Schema, model, type Types } from 'mongoose';
import { COMPLIANCE_DOCUMENT_KINDS, type ComplianceDocumentKind } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface ComplianceDocumentDoc extends BaseDocFields {
  folderId: Types.ObjectId;
  fileId: Types.ObjectId;
  name: string;
  fileName: string;
  kind: ComplianceDocumentKind;
  mime: string;
  size: number;
  uploadedByUserId: Types.ObjectId;
  uploadedAt: Date;
}

const documentSchema = new Schema<ComplianceDocumentDoc>(
  {
    folderId: { type: Schema.Types.ObjectId, required: true },
    fileId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    fileName: { type: String, required: true },
    kind: { type: String, enum: COMPLIANCE_DOCUMENT_KINDS, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedByUserId: { type: Schema.Types.ObjectId, required: true },
    uploadedAt: { type: Date, required: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// A folder's files, newest first — the one read the folder makes.
documentSchema.index({ folderId: 1, isDeleted: 1, uploadedAt: -1 }, { name: 'ix_folder_uploaded' });

export const ComplianceDocumentModel = model<ComplianceDocumentDoc>(
  'ComplianceDocument',
  documentSchema,
  'compliance_documents',
);
