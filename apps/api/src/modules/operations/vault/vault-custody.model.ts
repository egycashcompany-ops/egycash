// Custody of a secured shipment while it is with the treasury — the legacy vault fields lifted
// off `transactions` into their own row (the approved SPLIT, design §15).
//
// DROPPED from the legacy schema (never written with a value in ANY code path — verified):
// `vault_no`, `Rack_no`, `vault_receipt_num`. Carrying dead columns forward would document a
// capability the business never had. Vault LOCATION can return as a real field the day the
// business asks for it; inventing it now would be inventing a rule.
//
// Q2 NORMALIZE lives here: legacy wrote `treasurer_receive` as `""` on every save and only ever
// recorded ONE treasurer (contad_app.js:1211/1266), so the two-man rule was decorative. Both
// receivers are required and must differ. Q3 too: `treasurer_delivery*` were declared and never
// written; `releasedBy/releasedAt` are written for real on dispatch.
import { Schema, model, type Types } from 'mongoose';
import { OPERATIONS_CUSTODY_STATES, type OperationsCustodyState } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface OperationsVaultCustodyDoc extends BaseDocFields {
  shipmentId: Types.ObjectId;
  state: OperationsCustodyState;
  receiptNumber: string;
  bagCount: number;
  cartonCount: number;
  boxCount: number;
  bagSeals: string[];
  boxSeals: string[];
  receivedByPrimaryId: Types.ObjectId;
  receivedBySecondaryId: Types.ObjectId;
  receivedAt: Date;
  releasedById: Types.ObjectId | null;
  releasedAt: Date | null;
  /**
   * Round 10 — a CANCELLED receipt («صلاحية خاصة تقدر تلغى استلام الخزينة»). The row is voided, never
   * erased: it keeps everything the treasury stamped, gains when/who/why here, and is soft-deleted
   * in the same write, so every live read (which all ask `isDeleted: false`) stops seeing it and
   * `ux_shipment` frees the shipment for a fresh receipt. Optional: rows written before Round 10
   * have none of the three, and absent reads as "not cancelled".
   */
  cancelledAt?: Date | null;
  cancelledById?: Types.ObjectId | null;
  cancelReason?: string | null;
}

const custodySchema = new Schema<OperationsVaultCustodyDoc>(
  {
    shipmentId: { type: Schema.Types.ObjectId, required: true },
    state: { type: String, required: true, enum: OPERATIONS_CUSTODY_STATES, default: 'held' },
    receiptNumber: { type: String, required: true },
    bagCount: { type: Number, required: true, default: 0 },
    cartonCount: { type: Number, required: true, default: 0 },
    boxCount: { type: Number, required: true, default: 0 },
    bagSeals: { type: [String], required: true, default: [] },
    boxSeals: { type: [String], required: true, default: [] },
    receivedByPrimaryId: { type: Schema.Types.ObjectId, required: true },
    receivedBySecondaryId: { type: Schema.Types.ObjectId, required: true },
    receivedAt: { type: Date, required: true },
    releasedById: { type: Schema.Types.ObjectId, default: null },
    releasedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledById: { type: Schema.Types.ObjectId, default: null },
    cancelReason: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// One custody record per shipment — the DB half of "a shipment cannot be received twice".
custodySchema.index(
  { shipmentId: 1 },
  { unique: true, name: 'ux_shipment', partialFilterExpression: { isDeleted: false } },
);
custodySchema.index({ state: 1 }, { name: 'ix_state' });
// Round 8: the vault's receive queue lists what was received TODAY — a window on `receivedAt`.
custodySchema.index({ receivedAt: -1 }, { name: 'ix_received_at' });
// Round 10: a shipment's WHOLE custody history, a cancelled receipt included, oldest first — the
// action log reads it. `ux_shipment` cannot serve it: it is partial on `isDeleted: false`, and a
// cancelled receipt is exactly the row it leaves out.
custodySchema.index({ shipmentId: 1, receivedAt: 1 }, { name: 'ix_shipment_received' });

export const OperationsVaultCustodyModel = model<OperationsVaultCustodyDoc>(
  'OperationsVaultCustody',
  custodySchema,
  'operations_vault_custody',
);
