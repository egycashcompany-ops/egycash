// One opening or one download of a Compliance file by a person it was shared with (design §7):
// «المسئول يشوف هما عملوا Seen ولا لأ وكام مره بالتوقيت والتاريخ». Written once and never changed —
// a record of what happened, not a state — so the seen report is read from these rows alone and
// can always be recounted.
import { Schema, model, type Types } from 'mongoose';
import { COMPLIANCE_ACCESS_ACTIONS, type ComplianceAccessAction } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface ComplianceAccessDoc extends BaseDocFields {
  documentId: Types.ObjectId;
  folderId: Types.ObjectId;
  userId: Types.ObjectId;
  action: ComplianceAccessAction;
  at: Date;
}

const accessSchema = new Schema<ComplianceAccessDoc>(
  {
    documentId: { type: Schema.Types.ObjectId, required: true },
    folderId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    action: { type: String, enum: COMPLIANCE_ACCESS_ACTIONS, required: true },
    at: { type: Date, required: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The seen report of one file: each person's rows, newest first.
accessSchema.index({ documentId: 1, userId: 1, at: -1 }, { name: 'ix_document_user_at' });

export const ComplianceAccessModel = model<ComplianceAccessDoc>(
  'ComplianceAccess',
  accessSchema,
  'compliance_document_access',
);
