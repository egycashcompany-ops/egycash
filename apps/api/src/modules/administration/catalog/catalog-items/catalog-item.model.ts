// Administrative Affairs simple catalogs (design §2.3.2): one collection, kind-discriminated — units
// of measure in Phase 1 («قطعة», «علبة», «متر»), any later plain name list as a new kind, never a new
// collection (IT's rule). IT keeps an item's unit as free text; a managed list with a folded-name
// index is what stops «قطعه» and «قطعة» from becoming two units here.
//
// Organization-wide master data, never deleted: a unit retires with `isActive: false`, and items
// that already name it keep it. Its name and code stay taken while retired — reactivate it.
import { Schema, model } from 'mongoose';
import {
  ADMINISTRATION_CATALOG_KINDS,
  type AdministrationCatalogKind,
  type LocalizedString,
} from '@ecms/contracts';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';

export interface AdministrationCatalogItemDoc extends BaseDocFields {
  kind: AdministrationCatalogKind;
  /** The unit's short symbol, typed (OD-05 A); null when none was given. */
  code: string | null;
  name: LocalizedString;
  /**
   * `foldName(name.ar)`, written by the service on every create and rename, never by a client.
   * It is what two spellings of one name share, and the unique index below is built on it.
   */
  nameKey: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
}

const catalogItemSchema = new Schema<AdministrationCatalogItemDoc>(
  {
    kind: { type: String, required: true, enum: ADMINISTRATION_CATALOG_KINDS },
    code: { type: String, default: null },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    nameKey: { type: String, required: true },
    description: { type: String, default: null },
    sortOrder: { type: Number, required: true, default: 0 },
    isActive: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// One name per kind among live rows — the race guard of one-name-one-unit. Partial on live rows,
// which is every row (nothing is deleted), so a retired unit's name stays taken.
catalogItemSchema.index(
  { kind: 1, nameKey: 1 },
  { unique: true, name: 'ux_kind_name_key', partialFilterExpression: { isDeleted: false } },
);
// A typed code is optional, so only rows that carry one compete for it.
catalogItemSchema.index(
  { kind: 1, code: 1 },
  {
    unique: true,
    name: 'ux_kind_code',
    partialFilterExpression: { code: { $type: 'string' }, isDeleted: false },
  },
);
catalogItemSchema.index({ kind: 1, isActive: 1, sortOrder: 1 }, { name: 'ix_kind_active_sort' });

export const AdministrationCatalogItemModel = model<AdministrationCatalogItemDoc>(
  'AdministrationCatalogItem',
  catalogItemSchema,
  'administration_catalog_items',
);
