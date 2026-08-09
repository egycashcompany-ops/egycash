// `it_spare_parts` — the IT store's catalogue (design §2.7, ADR-024).
//
// `onHandQty` is DENORMALIZED from the movement ledger, written by the same atomic `$inc` that
// inserts the movement so the two can never disagree by a partial write. It is a store record,
// not inventory accounting: no valuation, no locations, no reservations.
import { Schema, model } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface ItSparePartDoc extends BaseDocFields {
  partCode: string;
  name: string;
  unit: string;
  onHandQty: number;
  minQty: number | null;
  active: boolean;
}

const partSchema = new Schema<ItSparePartDoc>(
  {
    partCode: { type: String, required: true },
    name: { type: String, required: true },
    unit: { type: String, required: true },
    onHandQty: { type: Number, required: true, default: 0, min: 0 },
    minQty: { type: Number, default: null },
    active: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The code identifies the part to a human at the shelf; two rows with one code is an ambiguity
// nobody can resolve. Partial so a deleted row frees its code.
partSchema.index(
  { partCode: 1 },
  { unique: true, name: 'ux_part_code', partialFilterExpression: { isDeleted: false } },
);
partSchema.index({ active: 1, name: 1 }, { name: 'ix_active_name' });

export const ItSparePartModel = model<ItSparePartDoc>('ItSparePart', partSchema, 'it_spare_parts');
