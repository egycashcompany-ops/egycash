// A folder on the Compliance files shelf (design §3.1): its name, the picture on its front, and the
// people it is shown to. The files inside are their own records (`compliance_documents`), each
// naming its folder; a folder holds no copy of them.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface ComplianceFolderCoverSub {
  fileId: Types.ObjectId;
  setAt: Date;
}

export interface ComplianceFolderDoc extends BaseDocFields {
  name: string;
  /** `foldName(name)`, written by the service on every create and rename: one name, one folder. */
  nameKey: string;
  cover: ComplianceFolderCoverSub | null;
  /** The user accounts the folder is shown to. The responsible person sees every folder anyway. */
  viewerUserIds: Types.ObjectId[];
}

const coverSchema = new Schema<ComplianceFolderCoverSub>(
  {
    fileId: { type: Schema.Types.ObjectId, required: true },
    setAt: { type: Date, required: true },
  },
  { _id: false },
);

const folderSchema = new Schema<ComplianceFolderDoc>(
  {
    name: { type: String, required: true },
    nameKey: { type: String, required: true },
    cover: { type: coverSchema, default: null },
    viewerUserIds: { type: [Schema.Types.ObjectId], required: true, default: [] },
    ...baseFields,
  },
  baseSchemaOptions,
);

// One live folder per name — the race guard of two people naming two folders alike at once.
folderSchema.index(
  { nameKey: 1 },
  { unique: true, name: 'ux_name_key', partialFilterExpression: { isDeleted: false } },
);
// A reader's shelf: the folders whose list names them.
folderSchema.index({ viewerUserIds: 1, isDeleted: 1 }, { name: 'ix_viewer' });

export const ComplianceFolderModel = model<ComplianceFolderDoc>(
  'ComplianceFolder',
  folderSchema,
  'compliance_folders',
);
