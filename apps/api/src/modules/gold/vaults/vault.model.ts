// A physical vault and its drawer grid (gold `models/Vault.js`). The layout is not decoration: it
// is what the numbering engine turns into the numbers painted on the drawers, so it is stored on
// the vault and only ever changed through generate / reshape.
import { Schema, model, type Types } from 'mongoose';
import {
  GOLD_H_DIRECTIONS,
  GOLD_ORIENTATIONS,
  GOLD_VAULT_STATUSES,
  GOLD_V_DIRECTIONS,
  type GoldHDirection,
  type GoldOrientation,
  type GoldVDirection,
  type GoldVaultStatus,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';
import { GOLD_DEFAULT_LAYOUT } from '../shared/drawer-numbering';

export interface GoldVaultLayoutSub {
  rows: number;
  cols: number;
  orientation: GoldOrientation;
  horizontalDirection: GoldHDirection;
  verticalDirection: GoldVDirection;
  startNumber: number;
  /** Grams; 0 = no limit. Indicative and exceedable — the gold rule, unchanged. */
  drawerWeightLimit: number;
}

export interface GoldVaultDoc extends BaseDocFields {
  name: string;
  code: string;
  description: string | null;
  status: GoldVaultStatus;
  layout: GoldVaultLayoutSub | null;
  drawersGenerated: boolean;
  floorId: Types.ObjectId | null;
  order: number;
  branchId: Types.ObjectId | null;
}

const layoutSchema = new Schema<GoldVaultLayoutSub>(
  {
    rows: { type: Number, required: true, min: 1 },
    cols: { type: Number, required: true, min: 1 },
    orientation: {
      type: String,
      enum: GOLD_ORIENTATIONS,
      default: GOLD_DEFAULT_LAYOUT.orientation,
    },
    horizontalDirection: {
      type: String,
      enum: GOLD_H_DIRECTIONS,
      default: GOLD_DEFAULT_LAYOUT.horizontalDirection,
    },
    verticalDirection: {
      type: String,
      enum: GOLD_V_DIRECTIONS,
      default: GOLD_DEFAULT_LAYOUT.verticalDirection,
    },
    startNumber: { type: Number, default: 1, min: 1 },
    drawerWeightLimit: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const vaultSchema = new Schema<GoldVaultDoc>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    status: { type: String, enum: GOLD_VAULT_STATUSES, required: true, default: 'active' },
    layout: { type: layoutSchema, default: null },
    drawersGenerated: { type: Boolean, required: true, default: false },
    floorId: { type: Schema.Types.ObjectId, default: null },
    order: { type: Number, required: true, default: 0 },
    branchId: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The code is what every drawer label is built from, so it is unique among live vaults.
vaultSchema.index(
  { code: 1 },
  { unique: true, name: 'ux_code', partialFilterExpression: { isDeleted: false } },
);
vaultSchema.index({ branchId: 1, order: 1 }, { name: 'ix_branch_order' });

export const GoldVaultModel = model<GoldVaultDoc>('GoldVault', vaultSchema, 'gold_vaults');
