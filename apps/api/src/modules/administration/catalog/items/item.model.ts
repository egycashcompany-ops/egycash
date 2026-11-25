// Items (design §2.3.4): the one item master every store, request and order will name — «الأصناف».
// Organization-wide master data, never deleted: retiring an item is an edit (`isActive: false`),
// and its name and barcode stay taken while it is retired. No stock figure lives here: from P5 an
// item's stock is the ledger's and its projection's alone (ADR-024).
//
// The code is generated, «ITM-00001» (OD-05 A), taken inside the create's transaction from the
// module's counter, so a create that rolls back gives its number back. It is permanent and unique
// across every row ever written, retired or not, like IT's asset and consumable codes.
//
// An item is a stock item or a non-stock one (`stockTracked`, OD-14 C, from P2.1), so a purchase
// request names a service as it names any item.
import { Schema, model, type Types } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';

export interface AdministrationItemDoc extends BaseDocFields {
  /** «ITM-00001», generated (OD-05 A). Never changes. */
  code: string;
  /** A printed or supplier barcode (OD-05); null when none. One item per barcode among live rows. */
  barcode: string | null;
  name: LocalizedString;
  /** `foldName(name.ar)`, written by the service on every create and rename (§2.1). */
  nameKey: string;
  /** A subcategory whenever its category has active ones (OD-06 (i)), else a top-level category. */
  categoryId: Types.ObjectId;
  /** The base unit (OD-07): every quantity of the item is a whole number of it (OD-08). */
  unitId: Types.ObjectId;
  /** OD-09 (C, starting with A): on the item, where set min ≤ reorder point ≤ max. */
  minQty: number | null;
  reorderPointQty: number | null;
  maxQty: number | null;
  description: string | null;
  notes: string | null;
  /**
   * The item's kind (OD-14 C): a stock item, or — false — a non-stock one, a service or a good no
   * store keeps. Absent on a row written before P2.1, which reads as a stock item, as every item
   * was then (§2.3.4, absence-safe): reads are lean and apply no default, so every reader says
   * `stockTracked ?? true`, and no row is rewritten.
   */
  stockTracked?: boolean;
  isActive: boolean;
}

const itemSchema = new Schema<AdministrationItemDoc>(
  {
    code: { type: String, required: true },
    barcode: { type: String, default: null },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    nameKey: { type: String, required: true },
    categoryId: { type: Schema.Types.ObjectId, required: true },
    unitId: { type: Schema.Types.ObjectId, required: true },
    minQty: { type: Number, default: null, min: 0 },
    reorderPointQty: { type: Number, default: null, min: 0 },
    maxQty: { type: Number, default: null, min: 0 },
    description: { type: String, default: null },
    notes: { type: String, default: null },
    // Not required: an older row lacks it, and an edit of that row must not fail validation.
    stockTracked: { type: Boolean, default: true },
    isActive: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// A generated code is unique across EVERY row, not only live ones: it is never reused, so not even
// a deleted row frees it (§2.1). It is also what the counter's floor is read through, by prefix.
itemSchema.index({ code: 1 }, { unique: true, name: 'ux_code' });
// One name among live items — two rows with one name would split one stock (IT's reason). The
// race guard of one-name-one-item: two spellings typed at once both pass the service's check.
itemSchema.index(
  { nameKey: 1 },
  { unique: true, name: 'ux_name_key', partialFilterExpression: { isDeleted: false } },
);
// One item per barcode (OD-05 (i)), so a scan resolves to one row. The ONLY check on a barcode:
// the service runs none before the write, and this refusal inside the create's transaction is
// answered as the duplicate it is (§5.15).
itemSchema.index(
  { barcode: 1 },
  {
    unique: true,
    name: 'ux_barcode',
    partialFilterExpression: { barcode: { $type: 'string' }, isDeleted: false },
  },
);
// The register's filters: by category (and the subcategories under it), by unit, by status.
itemSchema.index({ categoryId: 1, isActive: 1 }, { name: 'ix_category_active' });
itemSchema.index({ unitId: 1, isActive: 1 }, { name: 'ix_unit_active' });

export const AdministrationItemModel = model<AdministrationItemDoc>(
  'AdministrationItem',
  itemSchema,
  'administration_items',
);
