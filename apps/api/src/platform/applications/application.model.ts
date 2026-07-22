// Applications (Modules) are a standalone platform catalog — the future source of navigation and
// module access. Each carries a bilingual name, an icon + client route, an owning Application
// Category (`categoryId`) and an ascending sort order.
import { Schema, model, type Types } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../shared/base/base.model';

export interface ApplicationDoc extends BaseDocFields {
  name: LocalizedString;
  icon: string;
  route: string;
  categoryId: Types.ObjectId;
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
    categoryId: { type: Schema.Types.ObjectId, required: true },
    sortOrder: { type: Number, required: true, default: 0 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    ...baseFields,
  },
  baseSchemaOptions,
);
applicationSchema.index({ categoryId: 1, sortOrder: 1 }, { name: 'ix_categoryId_sortOrder' });
applicationSchema.index({ status: 1 }, { name: 'ix_status' });

export const ApplicationModel = model<ApplicationDoc>('Application', applicationSchema, 'applications');
