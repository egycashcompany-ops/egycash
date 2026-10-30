// Application Categories group Applications in the sidebar (bilingual name, optional icon, ascending
// sort order, status). A standalone platform catalog referenced by Applications via `categoryId`.
import { Schema, model } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../shared/base/base.model';

export interface ApplicationCategoryDoc extends BaseDocFields {
  name: LocalizedString;
  icon: string | null;
  sortOrder: number;
  status: 'active' | 'inactive';
  /**
   * Which revision of the navigation catalog's icon this tile has taken (`seed-navigation.ts`,
   * `iconRevision`). Not part of the API: it only tells the boot sync that a deliberate icon change
   * was already applied, so an administrator's later choice is not overwritten. Absent = 0.
   */
  iconRevision?: number;
}

const localizedField = {
  ar: { type: String, required: true },
  en: { type: String, required: true },
} as const;

const applicationCategorySchema = new Schema<ApplicationCategoryDoc>(
  {
    name: localizedField,
    icon: { type: String, default: null, trim: true },
    sortOrder: { type: Number, required: true, default: 0 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    iconRevision: { type: Number, default: 0 },
    ...baseFields,
  },
  baseSchemaOptions,
);
applicationCategorySchema.index({ sortOrder: 1 }, { name: 'ix_sortOrder' });
applicationCategorySchema.index({ status: 1 }, { name: 'ix_status' });

export const ApplicationCategoryModel = model<ApplicationCategoryDoc>(
  'ApplicationCategory',
  applicationCategorySchema,
  'application_categories',
);
