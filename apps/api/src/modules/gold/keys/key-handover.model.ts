// Handing a drawer's key to a customer's delegate (gold `models/KeyHandover.js`).
// One key per drawer: a drawer with a live handover cannot have its key handed over again until
// it is returned, and that rule is enforced both here (index) and in the service.
import { Schema, model, type Types } from 'mongoose';
import { GOLD_KEY_STATUSES, type GoldKeyStatus } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface GoldKeyHandoverDoc extends BaseDocFields {
  companyId: Types.ObjectId;
  representativeId: Types.ObjectId;
  vaultId: Types.ObjectId;
  drawerId: Types.ObjectId;
  handedOverByUserId: Types.ObjectId | null;
  handoverDate: Date;
  status: GoldKeyStatus;
  returnedAt: Date | null;
  returnedByUserId: Types.ObjectId | null;
  branchId: Types.ObjectId | null;
  notes: string | null;
}

const keySchema = new Schema<GoldKeyHandoverDoc>(
  {
    companyId: { type: Schema.Types.ObjectId, required: true },
    representativeId: { type: Schema.Types.ObjectId, required: true },
    vaultId: { type: Schema.Types.ObjectId, required: true },
    drawerId: { type: Schema.Types.ObjectId, required: true },
    handedOverByUserId: { type: Schema.Types.ObjectId, default: null },
    handoverDate: { type: Date, required: true, default: Date.now },
    status: { type: String, enum: GOLD_KEY_STATUSES, required: true, default: 'active' },
    returnedAt: { type: Date, default: null },
    returnedByUserId: { type: Schema.Types.ObjectId, default: null },
    branchId: { type: Schema.Types.ObjectId, default: null },
    notes: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The DB half of "one key per drawer": at most one live, un-returned handover per drawer.
keySchema.index(
  { drawerId: 1 },
  {
    unique: true,
    name: 'ux_active_key_per_drawer',
    partialFilterExpression: { isDeleted: false, status: 'active' },
  },
);
keySchema.index({ branchId: 1, status: 1 }, { name: 'ix_branch_status' });
keySchema.index({ vaultId: 1 }, { name: 'ix_vault' });

export const GoldKeyHandoverModel = model<GoldKeyHandoverDoc>(
  'GoldKeyHandover',
  keySchema,
  'gold_key_handovers',
);
