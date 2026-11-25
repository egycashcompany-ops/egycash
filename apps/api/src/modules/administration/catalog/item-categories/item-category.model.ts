// Item categories (design §2.3.3): «Category / Subcategory», as the owner's request lists an item's
// fields — two levels (OD-06 A). A top-level category has `parentId: null`; a subcategory names a
// top-level one. Organization-wide master data, never deleted: retiring a category hides it from
// new items and new subcategories, and its name stays taken under its parent while it is retired.
import { Schema, model, type Types } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';

export interface AdministrationItemCategoryDoc extends BaseDocFields {
  /** Typed (OD-05 A); null when none was given. */
  code: string | null;
  name: LocalizedString;
  /** `foldName(name.ar)`, written by the service on every create and rename (§2.1). */
  nameKey: string;
  parentId: Types.ObjectId | null;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
}

const itemCategorySchema = new Schema<AdministrationItemCategoryDoc>(
  {
    code: { type: String, default: null },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    nameKey: { type: String, required: true },
    parentId: { type: Schema.Types.ObjectId, default: null },
    description: { type: String, default: null },
    sortOrder: { type: Number, required: true, default: 0 },
    isActive: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// One name per parent among live rows — the race guard of one-name-one-category. A unique index
// treats `null` as one value, so the top-level names are unique among themselves too.
itemCategorySchema.index(
  { parentId: 1, nameKey: 1 },
  { unique: true, name: 'ux_parent_name_key', partialFilterExpression: { isDeleted: false } },
);
itemCategorySchema.index(
  { code: 1 },
  {
    unique: true,
    name: 'ux_code',
    partialFilterExpression: { code: { $type: 'string' }, isDeleted: false },
  },
);
itemCategorySchema.index(
  { parentId: 1, isActive: 1, sortOrder: 1 },
  { name: 'ix_parent_active_sort' },
);

export const AdministrationItemCategoryModel = model<AdministrationItemCategoryDoc>(
  'AdministrationItemCategory',
  itemCategorySchema,
  'administration_item_categories',
);
