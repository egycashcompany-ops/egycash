// IT simple catalogs (design §2.4): one collection, kind-discriminated — asset categories, ticket
// categories and consumable types today, any future plain name-list as a new kind, never a new
// collection. Catalogs that carry behaviour (ticket priorities with SLA targets) get their own
// collection; a single boolean on one kind is a field (`requiresCounterReading`, Fleet's
// `countsForAlarm` the precedent).
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
  /**
   * `consumableType` only — «يتطلب عداد الطباعة»: an item of this type is issued onto a printer,
   * with that printer's counter reading (design §2.11). False on every other row. A row written
   * before the field (2026-11-19) has no key at all, and a lean read applies no default: read it
   * as `?? false`.
   */
  requiresCounterReading: boolean;
}

const catalogItemSchema = new Schema<ItCatalogItemDoc>(
  {
    kind: { type: String, required: true, enum: IT_CATALOG_KINDS },
    code: { type: String, default: null },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    description: { type: String, default: null },
    sortOrder: { type: Number, required: true, default: 0 },
    isActive: { type: Boolean, required: true, default: true },
    requiresCounterReading: { type: Boolean, required: true, default: false },
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
