// `it_software_products` — the catalogue that deduplicates free-text software names (design §2.8).
//
// Its own collection rather than a third `it_catalog_items` kind, for two reasons the code makes
// plain: catalog names are `LocalizedString` and a product name is a proper noun ("Microsoft
// Office") that no locale translates; and a product carries a publisher and is referenced from two
// collections, which is more than a plain name-list.
import { Schema, model } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface ItSoftwareProductDoc extends BaseDocFields {
  name: string;
  publisher: string | null;
  active: boolean;
}

const productSchema = new Schema<ItSoftwareProductDoc>(
  {
    name: { type: String, required: true },
    publisher: { type: String, default: null },
    active: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The whole point of the catalogue: one row per name. Partial so an archived-then-deleted row
// frees its name.
productSchema.index(
  { name: 1 },
  { unique: true, name: 'ux_product_name', partialFilterExpression: { isDeleted: false } },
);
productSchema.index({ active: 1, name: 1 }, { name: 'ix_active_name' });

export const ItSoftwareProductModel = model<ItSoftwareProductDoc>(
  'ItSoftwareProduct',
  productSchema,
  'it_software_products',
);
