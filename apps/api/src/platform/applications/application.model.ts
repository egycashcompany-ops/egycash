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
  /**
   * The section within that category, or null when the application hangs directly off the module.
   * Nullable is the backward-compatibility contract: every row catalogued before sections existed
   * reads as null and renders exactly where it always did.
   */
  sectionId: Types.ObjectId | null;
  sortOrder: number;
  /** Permission required to open it — what the navigation resolver filters on. Null = open. */
  permissionKey: string | null;
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
    sectionId: { type: Schema.Types.ObjectId, default: null },
    sortOrder: { type: Number, required: true, default: 0 },
    permissionKey: { type: String, default: null, trim: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    ...baseFields,
  },
  baseSchemaOptions,
);
applicationSchema.index({ categoryId: 1, sortOrder: 1 }, { name: 'ix_categoryId_sortOrder' });
// The navigation read groups by section within a category, and the board reorders one bucket.
applicationSchema.index(
  { categoryId: 1, sectionId: 1, sortOrder: 1 },
  { name: 'ix_categoryId_sectionId_sortOrder' },
);
applicationSchema.index({ status: 1 }, { name: 'ix_status' });
// The route IS the catalog identity (the boot sync keys on it) — live duplicates would break
// both routing and idempotency, so the DB enforces it even under concurrent boots.
applicationSchema.index(
  { route: 1 },
  { unique: true, name: 'ux_route', partialFilterExpression: { isDeleted: false } },
);

export const ApplicationModel = model<ApplicationDoc>('Application', applicationSchema, 'applications');
