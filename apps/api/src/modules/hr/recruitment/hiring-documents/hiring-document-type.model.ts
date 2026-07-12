// Hiring document type catalog (Stage 6) — the administrator-defined set of documents a new
// hire must (required) or may (optional) provide. Localized, extensible, deactivated (never
// hard-deleted) so historical hiring sets keep referencing a type.
import { Schema, model } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface HiringDocumentTypeDoc extends BaseDocFields {
  key: string;
  name: LocalizedString;
  required: boolean;
  active: boolean;
}

const hiringDocumentTypeSchema = new Schema<HiringDocumentTypeDoc>(
  {
    key: { type: String, required: true, trim: true },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    required: { type: Boolean, required: true, default: false },
    active: { type: Boolean, required: true, default: true },
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
