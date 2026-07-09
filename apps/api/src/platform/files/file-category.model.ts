// Admin-managed catalog with per-category intake rules (Platform Core §7):
// allowed mime types, max size, retention.
import { Schema, model } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../shared/base/base.model';

export interface FileCategoryDoc extends BaseDocFields {
  key: string;
  name: LocalizedString;
  allowedMimeTypes: string[];
  maxSizeMb: number;
  retentionDays: number | null;
  status: 'active' | 'inactive';
}

const fileCategorySchema = new Schema<FileCategoryDoc>(
  {
    key: { type: String, required: true, lowercase: true, trim: true },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    allowedMimeTypes: { type: [String], required: true },
    maxSizeMb: { type: Number, required: true, min: 1 },
    retentionDays: { type: Number, default: null },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    ...baseFields,
  },
  baseSchemaOptions,
);
fileCategorySchema.index(
  { key: 1 },
  { unique: true, name: 'ux_key', partialFilterExpression: { isDeleted: false } },
);

export const FileCategoryModel = model<FileCategoryDoc>(
  'FileCategory',
  fileCategorySchema,
  'file_categories',
);
