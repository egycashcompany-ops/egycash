// Applications (Modules) are a standalone platform catalog — the future source of navigation and
// module access. Each carries a bilingual name, an icon + client route, a free-form grouping
// category and an ascending sort order. This slice is the master entity CRUD only.
import { Schema, model } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../shared/base/base.model';

export interface ApplicationDoc extends BaseDocFields {
  name: LocalizedString;
  icon: string;
  route: string;
  category: string;
  sortOrder: number;
  status: 'active' | 'inactive';
}

const localizedField = {
  ar: { type: String, required: true },
  en: { type: String, required: true },
} as const;

const applicationSchema = new Schema<ApplicationDoc>(
  {
    name: localizedField,
    icon: { type: String, required: true, trim: true },
    route: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    sortOrder: { type: Number, required: true, default: 0 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    ...baseFields,
  },
  baseSchemaOptions,
);
applicationSchema.index({ category: 1, sortOrder: 1 }, { name: 'ix_category_sortOrder' });
applicationSchema.index({ status: 1 }, { name: 'ix_status' });

export const ApplicationModel = model<ApplicationDoc>('Application', applicationSchema, 'applications');
