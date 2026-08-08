// IT simple catalogs (design §2.4): one collection, kind-discriminated — asset categories and
// ticket categories today, any future plain name-list as a new kind, never a new collection.
// Catalogs that carry behaviour (ticket priorities with SLA targets) get their own collection.
import { Schema, model } from 'mongoose';
import { IT_CATALOG_KINDS, type ItCatalogKind, type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface ItCatalogItemDoc extends BaseDocFields {
  kind: ItCatalogKind;
  code: string | null;
  name: LocalizedString;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
}

const catalogItemSchema = new Schema<ItCatalogItemDoc>(
  {
    kind: { type: String, required: true, enum: IT_CATALOG_KINDS },
    code: { type: String, default: null },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    description: { type: String, default: null },
    sortOrder: { type: Number, required: true, default: 0 },
    isActive: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

catalogItemSchema.index(
  { kind: 1, 'name.ar': 1 },
  { unique: true, name: 'ux_kind_name_ar', partialFilterExpression: { isDeleted: false } },
);
catalogItemSchema.index({ kind: 1, isActive: 1, sortOrder: 1 }, { name: 'ix_kind_active_sort' });

export const ItCatalogItemModel = model<ItCatalogItemDoc>(
  'ItCatalogItem',
  catalogItemSchema,
  'it_catalog_items',
);
