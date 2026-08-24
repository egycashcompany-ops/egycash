// One physical drawer inside a vault (gold `models/Drawer.js`).
//
// `barsCount` / `totalWeight` are DENORMALIZED counters, recomputed from the bars that physically
// sit in the drawer after every operation that could move one. They exist because the visual board
// draws a fill bar for every drawer in the building at once; they are never the source of truth.
import { Schema, model, type Types } from 'mongoose';
import { GOLD_DRAWER_STATUSES, type GoldDrawerStatus } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface GoldDrawerDoc extends BaseDocFields {
  vaultId: Types.ObjectId;
  branchId: Types.ObjectId | null;
  row: number;
  col: number;
  /** Operator-facing sequence number produced by the numbering engine. */
  number: number;
  label: string;
  status: GoldDrawerStatus;
  barsCount: number;
  totalWeight: number;
  weightLimit: number;
}

const drawerSchema = new Schema<GoldDrawerDoc>(
  {
    vaultId: { type: Schema.Types.ObjectId, required: true },
    branchId: { type: Schema.Types.ObjectId, default: null },
    row: { type: Number, required: true },
    col: { type: Number, required: true },
    number: { type: Number, required: true },
    label: { type: String, required: true },
    status: { type: String, enum: GOLD_DRAWER_STATUSES, required: true, default: 'empty' },
    barsCount: { type: Number, required: true, default: 0 },
    totalWeight: { type: Number, required: true, default: 0 },
    weightLimit: { type: Number, required: true, default: 0 },
    ...baseFields,
  },
  baseSchemaOptions,
);

// A physical cell, and a printed number, are each unique within their vault.
drawerSchema.index({ vaultId: 1, row: 1, col: 1 }, { unique: true, name: 'ux_cell' });
drawerSchema.index({ vaultId: 1, number: 1 }, { unique: true, name: 'ux_number' });

export const GoldDrawerModel = model<GoldDrawerDoc>('GoldDrawer', drawerSchema, 'gold_drawers');
