// A floor of the building, used to group vaults on the visual board (gold `models/Floor.js`).
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface GoldFloorDoc extends BaseDocFields {
  name: string;
  order: number;
  /** ECMS organization branch (integration 3) — the gold `branches` collection is gone. */
  branchId: Types.ObjectId | null;
}

const floorSchema = new Schema<GoldFloorDoc>(
  {
    name: { type: String, required: true, trim: true },
    order: { type: Number, required: true, default: 0 },
    branchId: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

floorSchema.index({ branchId: 1, order: 1 }, { name: 'ix_branch_order' });

export const GoldFloorModel = model<GoldFloorDoc>('GoldFloor', floorSchema, 'gold_floors');
