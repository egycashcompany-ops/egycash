// Application Sections group Applications INSIDE one category, so a module whose page list has
// outgrown a flat column reads as a few named groups instead.
//
// Organizational only: a section grants nothing, withholds nothing, and owns no permission key.
// It is also OPTIONAL — an application with no section renders directly under its module, which is
// what every application did before this collection existed.
import { Schema, model, type Types } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../shared/base/base.model';

export interface ApplicationSectionDoc extends BaseDocFields {
  name: LocalizedString;
  categoryId: Types.ObjectId;
  sortOrder: number;
  status: 'active' | 'inactive';
}

const localizedField = {
  ar: { type: String, required: true },
  en: { type: String, required: true },
} as const;

const applicationSectionSchema = new Schema<ApplicationSectionDoc>(
  {
    name: localizedField,
    categoryId: { type: Schema.Types.ObjectId, required: true },
    sortOrder: { type: Number, required: true, default: 0 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    ...baseFields,
  },
  baseSchemaOptions,
);
applicationSectionSchema.index({ categoryId: 1, sortOrder: 1 }, { name: 'ix_categoryId_sortOrder' });
applicationSectionSchema.index({ status: 1 }, { name: 'ix_status' });

export const ApplicationSectionModel = model<ApplicationSectionDoc>(
  'ApplicationSection',
  applicationSectionSchema,
  'application_sections',
);
