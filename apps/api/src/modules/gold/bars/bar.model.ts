// A single bar of metal — the thing the whole module exists to track (gold `models/Bar.js`).
//
// The serial number is globally unique among live bars: the gold system refuses to confirm a
// receipt whose serials already exist, and that guarantee is what makes the bar's history readable
// as one continuous life. `history` is an append-only trail written by every operation that moves
// or changes the bar, and it is deliberately embedded — a bar's story is bounded and is always
// read with the bar.
import { Schema, model, type Types } from 'mongoose';
import {
  GOLD_BAR_STATUSES,
  GOLD_METAL_TYPES,
  type GoldBarStatus,
  type GoldMetalType,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface GoldBarHistorySub {
  /** received | transferred | delivered | modified | revert-* — free vocabulary, as in gold. */
  action: string;
  fromVaultId: Types.ObjectId | null;
  fromDrawerId: Types.ObjectId | null;
  toVaultId: Types.ObjectId | null;
  toDrawerId: Types.ObjectId | null;
  /** The receipt / transfer number this movement belongs to. */
  reference: string | null;
  byUserId: Types.ObjectId | null;
  at: Date;
  notes: string | null;
}

export interface GoldBarDoc extends BaseDocFields {
  serialNumber: string;
  companyId: Types.ObjectId | null;
  branchId: Types.ObjectId | null;
  parentCompanyId: Types.ObjectId | null;
  metalType: GoldMetalType;
  brand: string | null;
  purity: string | null;
  weight: number;
  sealed: boolean;
  weightBeforeSeal: number | null;
  weightAfterSeal: number | null;
  currentVaultId: Types.ObjectId | null;
  currentDrawerId: Types.ObjectId | null;
  status: GoldBarStatus;
  notes: string | null;
  history: GoldBarHistorySub[];
}

const historySchema = new Schema<GoldBarHistorySub>(
  {
    action: { type: String, required: true },
    fromVaultId: { type: Schema.Types.ObjectId, default: null },
    fromDrawerId: { type: Schema.Types.ObjectId, default: null },
    toVaultId: { type: Schema.Types.ObjectId, default: null },
    toDrawerId: { type: Schema.Types.ObjectId, default: null },
    reference: { type: String, default: null },
    byUserId: { type: Schema.Types.ObjectId, default: null },
    at: { type: Date, required: true, default: Date.now },
    notes: { type: String, default: null },
  },
  { _id: false },
);

const barSchema = new Schema<GoldBarDoc>(
  {
    serialNumber: { type: String, required: true, trim: true },
    companyId: { type: Schema.Types.ObjectId, default: null },
    branchId: { type: Schema.Types.ObjectId, default: null },
    parentCompanyId: { type: Schema.Types.ObjectId, default: null },
    metalType: { type: String, enum: GOLD_METAL_TYPES, required: true, default: 'gold' },
    brand: { type: String, trim: true, default: null },
    purity: { type: String, trim: true, default: null },
    weight: { type: Number, required: true, min: 0 },
    sealed: { type: Boolean, required: true, default: false },
    weightBeforeSeal: { type: Number, min: 0, default: null },
    weightAfterSeal: { type: Number, min: 0, default: null },
    currentVaultId: { type: Schema.Types.ObjectId, default: null },
    currentDrawerId: { type: Schema.Types.ObjectId, default: null },
    status: { type: String, enum: GOLD_BAR_STATUSES, required: true, default: 'in_vault' },
    notes: { type: String, default: null },
    history: { type: [historySchema], required: true, default: [] },
    ...baseFields,
  },
  baseSchemaOptions,
);

// Unique among LIVE bars: a reverted receipt archives its bars (soft delete), and the serial must
// become usable again — otherwise a mistyped receipt would burn a serial number for ever.
barSchema.index(
  { serialNumber: 1 },
  { unique: true, name: 'ux_serial', partialFilterExpression: { isDeleted: false } },
);
barSchema.index({ companyId: 1, status: 1 }, { name: 'ix_company_status' });
barSchema.index({ currentDrawerId: 1, status: 1 }, { name: 'ix_drawer_status' });
barSchema.index({ currentVaultId: 1, status: 1 }, { name: 'ix_vault_status' });
barSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branch_status' });
barSchema.index({ metalType: 1 }, { name: 'ix_metal' });

export const GoldBarModel = model<GoldBarDoc>('GoldBar', barSchema, 'gold_bars');
