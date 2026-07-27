// Contract templates (frozen design D4/A17/A19). ONE DOCUMENT PER VERSION: the version
// chain per `key` is append-only and fully recoverable — published versions are never
// edited in place (edits fork the next draft), so a generated contract's pinned version
// can always be re-read byte-identically.
import { Schema, model, type Types } from 'mongoose';
import {
  type ContractTemplateLanguage,
  type ContractTemplateStatus,
  type LocalizedString,
  type SignatureBlock,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface ContractTemplateDoc extends BaseDocFields {
  /** Stable identity shared by every version of one template. */
  key: string;
  name: LocalizedString;
  language: ContractTemplateLanguage;
  /** Null while a DRAFT is being authored — the publish gate requires a type. */
  contractTypeId: Types.ObjectId | null;
  status: ContractTemplateStatus;
  templateVersion: number;
  sections: { header: string; body: string; footer: string };
  logoFileId: Types.ObjectId | null;
  signatures: SignatureBlock[];
  /** Derived on save — placeholder keys the sections use (D5 validation + A16 resolver). */
  placeholders: string[];
  changedBy: Types.ObjectId | null;
}

// Drafts may be incomplete while being authored (names/type/body/labels empty —
// `required` would even reject '' on String paths); publish() is the completeness gate.
const localized = { ar: { type: String, default: '' }, en: { type: String, default: '' } };

const contractTemplateSchema = new Schema<ContractTemplateDoc>(
  {
    key: { type: String, required: true },
    name: localized,
    language: { type: String, enum: ['ar', 'en'], required: true },
    contractTypeId: { type: Schema.Types.ObjectId, default: null },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
    templateVersion: { type: Number, required: true },
    sections: {
      header: { type: String, default: '' },
      body: { type: String, default: '' },
      footer: { type: String, default: '' },
    },
    logoFileId: { type: Schema.Types.ObjectId, default: null },
    signatures: {
      type: [
        {
          _id: false,
          key: { type: String, required: true },
          label: { type: String, default: '' },
          name: { type: String },
          title: { type: String },
        },
      ],
      default: [],
    },
    placeholders: { type: [String], default: [] },
    changedBy: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

contractTemplateSchema.index({ key: 1, templateVersion: 1 }, { unique: true, name: 'ux_key_version' });
contractTemplateSchema.index({ key: 1, status: 1 }, { name: 'ix_key_status' });

export const ContractTemplateModel = model<ContractTemplateDoc>(
  'HrContractTemplate',
  contractTemplateSchema,
  'hr_contract_templates',
);
