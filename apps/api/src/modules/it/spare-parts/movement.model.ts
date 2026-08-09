// `it_spare_part_movements` — the append-only ledger (ADR-024).
//
// Positive on receipt, negative on consumption, and **consumption always carries an `orderId`**
// (FR-9). Append-only in the strongest sense available here: the repository exposes no update and
// no delete, and their absence is the cheapest enforcement of that.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface ItSparePartMovementDoc extends BaseDocFields {
  partId: Types.ObjectId;
  qty: number;
  orderId: Types.ObjectId | null;
  at: Date;
  byUserId: Types.ObjectId | null;
  note: string | null;
}

const movementSchema = new Schema<ItSparePartMovementDoc>(
  {
    partId: { type: Schema.Types.ObjectId, required: true },
    qty: { type: Number, required: true },
    orderId: { type: Schema.Types.ObjectId, default: null },
    at: { type: Date, required: true },
    byUserId: { type: Schema.Types.ObjectId, default: null },
    note: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// One part's history, newest first — the movements panel.
movementSchema.index({ partId: 1, at: -1 }, { name: 'ix_part_at' });
// "What did this order consume" — the question ADR-024 exists to answer.
movementSchema.index({ orderId: 1 }, { name: 'ix_order', sparse: true });

export const ItSparePartMovementModel = model<ItSparePartMovementDoc>(
  'ItSparePartMovement',
  movementSchema,
  'it_spare_part_movements',
);
