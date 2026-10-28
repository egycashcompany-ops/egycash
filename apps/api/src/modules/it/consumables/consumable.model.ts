// `it_consumables` — the IT team's consumables store (FR-20): «حبارات - كابلات بأنواعها - كونفرترات
// (محولات) بأنواعها - ماوس - كيبرود - رامات - هاردات - فلاشات - وهكذا».
//
// ONE ROW PER ITEM PER BRANCH. «Each branch keeps its own stock» (the plan the owner approved), so
// the HDMI cable in the Mohandessin store and the one in the October store are two rows with two
// quantities, each read and written under its own branch's scope. The branch IS the store, and an
// item never moves between stores: no write path changes `branchId`.
//
// A register of its own beside the spare parts, not rows inside them: a spare part leaves the store
// only through a maintenance order (FR-9), a consumable is handed to a PERSON, on a memo they sign.
//
// The three counters are DENORMALIZED from the movement ledger (`it_consumable_movements`), the
// spare parts' rule (ADR-024): moved by the same atomic `$inc` that goes with each movement, inside
// one transaction, and on no write schema — «Stock إيه من كل واحده وإيه الهالك» is read here, and
// only a movement moves it. The item names no person, so a workforce reset never touches it.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface ItConsumableDoc extends BaseDocFields {
  /** «CON-00001» — server-allocated, permanent (`consumable-number.ts`). */
  code: string;
  /** «حبر HP 85A», «كابل HDMI 3 متر» — as the IT team calls it. One per name in a store. */
  name: string;
  /** An IT catalog row of kind `consumableType` («حبارات», «كابلات» …). */
  typeId: Types.ObjectId;
  /** «قطعة», «علبة», «متر». */
  unit: string;
  /** The store that keeps it — the data-scope anchor, as an asset's branch is. */
  branchId: Types.ObjectId;
  minQty: number | null;
  notes: string | null;
  /** A retired item takes no new stock and is issued to nobody; its history stays. */
  active: boolean;
  /** What the store holds now. Never below zero: the take is guarded in the update's filter. */
  onHandQty: number;
  /** Everything ever issued from it. */
  issuedQty: number;
  /** Everything ever scrapped — from the store, and the damaged units replacements took back. */
  scrappedQty: number;
}

const consumableSchema = new Schema<ItConsumableDoc>(
  {
    code: { type: String, required: true },
    name: { type: String, required: true },
    typeId: { type: Schema.Types.ObjectId, required: true },
    unit: { type: String, required: true },
    branchId: { type: Schema.Types.ObjectId, required: true },
    minQty: { type: Number, default: null },
    notes: { type: String, default: null },
    active: { type: Boolean, required: true, default: true },
    onHandQty: { type: Number, required: true, default: 0, min: 0 },
    issuedQty: { type: Number, required: true, default: 0, min: 0 },
    scrappedQty: { type: Number, required: true, default: 0, min: 0 },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The code names the item at the shelf and on every memo: one item, one code, for ever.
consumableSchema.index({ code: 1 }, { unique: true, name: 'ux_code' });
// One stock per item per store. Two rows called «Mouse» in one branch would split its quantity in
// two, and nobody could say which is right — so the database holds it, and two people adding the
// same item at once get a conflict instead of two rows. Another branch's «Mouse» is its own stock.
consumableSchema.index(
  { branchId: 1, name: 1 },
  { unique: true, name: 'ux_branch_name', partialFilterExpression: { isDeleted: false } },
);
// «النوع» — the register's type filter, and the ledger's (which matches the items of a type).
consumableSchema.index({ typeId: 1, branchId: 1 }, { name: 'ix_type_branch' });

export const ItConsumableModel = model<ItConsumableDoc>(
  'ItConsumable',
  consumableSchema,
  'it_consumables',
);
