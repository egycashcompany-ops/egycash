// The cash shipment — the legacy `transactions` document after the approved SPLIT (design §15):
// this row is the shipment itself. Crew legs (leader1/leader2 + vehicles), execution sequencing
// and vault custody (vault_no/seals/treasurers) are separate entities in later slices; the dead
// legacy fields (spe1_*, spe2_*, driver1/2 — never written, discovery §3.1) are dropped (Q4).
//
// Parallel arrays `currencies[]`/`values[]` (string amounts, Q5-Q8) are normalized to `lines`
// with integer minor units — the platform money convention (hr-payroll-money), deliberately
// instead of the design's Decimal128 sketch: one money discipline per repo.
import { Schema, model, type Types } from 'mongoose';
import {
  type OperationsSecuredPickedUpBy,
  type OperationsShipmentStatus,
  type OperationsShipmentType,
  OPERATIONS_SECURED_PICKED_UP_BY,
  OPERATIONS_SHIPMENT_STATUSES,
  OPERATIONS_SHIPMENT_TYPES,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface OperationsShipmentLine {
  currencyId: Types.ObjectId;
  /** Integer minor units (piasters for EGP) — never a float, never a string (Q8 NORMALIZE). */
  amountMinor: number;
}

/**
 * The photo of the paper receipt («صورة الإيصال») — the Fleet receipts' twin. Files owns the bytes
 * (ADR-023); the row only keeps the link and what the board prints without fetching them.
 */
export interface OperationsShipmentReceiptImage {
  fileId: Types.ObjectId;
  fileName: string;
  mime: string;
  size: number;
  uploadedAt: Date;
}

/**
 * Round 10 — WHO confirmed collecting a SECURED shipment, and when: the shipment's ONE pickup
 * record («ممكن القائد اللى يعمل صح انه استلم او العمليات»). The captain's ✓ in the app writes it
 * (`captain`, his user), the Operations desk's ✓ writes it (`operations`, the desk user), and the
 * desk's undo clears it to null whoever wrote it. The secured stage reads it (secured-stage.ts).
 */
export interface OperationsShipmentPickup {
  by: OperationsSecuredPickedUpBy;
  at: Date;
  /** The USER who pressed ✓ (from the token) — a user id, not an employee id. */
  userId: Types.ObjectId;
}

export interface OperationsShipmentDoc extends BaseDocFields {
  shipmentType: OperationsShipmentType;
  status: OperationsShipmentStatus;
  mainBankId: Types.ObjectId;
  secondaryBankId: Types.ObjectId | null;
  originBranchId: Types.ObjectId;
  destinationBranchId: Types.ObjectId;
  areaName: string | null;
  lines: OperationsShipmentLine[];
  /** Normalized to UTC midnight — legacy matches this date by exact equality (Q15). */
  collectionDate: Date;
  deliveryDate: Date | null;
  receiptNumber: string | null;
  vaultReceiptNumber: string | null;
  serialTracked: boolean;
  notes: string | null;
  receivedById: Types.ObjectId | null;
  receivedAt: Date | null;
  /**
   * Optional because rows written before the receipt column carry no such field, and the board
   * reads `.lean()` — absent reads as "no image", so no migration is needed.
   */
  receiptImage?: OperationsShipmentReceiptImage | null;
  /**
   * Round 10 — the pickup record (`OperationsShipmentPickup`), or null when nobody has confirmed
   * the pickup (and on every daily shipment).
   *
   * ABSENT IS NOT NULL, deliberately. A row written before Round 10 has no such field at all, and
   * reads `.lean()`, so it comes back `undefined`: "never written". Only such a row falls back to
   * its pickup leg (picked up in the app → the captain's) — exactly what its stage said before the
   * record existed. Every row written since carries the field (the schema defaults it to null), and
   * the desk's undo writes an explicit null, so a ✓ taken back can never be revived from the leg.
   * Hence: no `$unset` of this field anywhere, and no read of it through a hydrated document (which
   * would apply the default and turn "never written" into null).
   */
  pickup?: OperationsShipmentPickup | null;
}

const lineSchema = new Schema<OperationsShipmentLine>(
  {
    currencyId: { type: Schema.Types.ObjectId, required: true },
    amountMinor: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const receiptImageSchema = new Schema<OperationsShipmentReceiptImage>(
  {
    fileId: { type: Schema.Types.ObjectId, required: true },
    fileName: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedAt: { type: Date, required: true },
  },
  { _id: false },
);

const pickupSchema = new Schema<OperationsShipmentPickup>(
  {
    by: { type: String, required: true, enum: OPERATIONS_SECURED_PICKED_UP_BY },
    at: { type: Date, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const shipmentSchema = new Schema<OperationsShipmentDoc>(
  {
    shipmentType: { type: String, required: true, enum: OPERATIONS_SHIPMENT_TYPES },
    status: {
      type: String,
      required: true,
      enum: OPERATIONS_SHIPMENT_STATUSES,
      default: 'draft',
    },
    mainBankId: { type: Schema.Types.ObjectId, required: true },
    secondaryBankId: { type: Schema.Types.ObjectId, default: null },
    originBranchId: { type: Schema.Types.ObjectId, required: true },
    destinationBranchId: { type: Schema.Types.ObjectId, required: true },
    areaName: { type: String, default: null },
    lines: { type: [lineSchema], required: true },
    collectionDate: { type: Date, required: true },
    deliveryDate: { type: Date, default: null },
    receiptNumber: { type: String, default: null },
    vaultReceiptNumber: { type: String, default: null },
    serialTracked: { type: Boolean, required: true, default: false },
    notes: { type: String, default: null },
    receivedById: { type: Schema.Types.ObjectId, default: null },
    receivedAt: { type: Date, default: null },
    receiptImage: { type: receiptImageSchema, default: null },
    // Default null: a row created from now on says "nobody yet" explicitly — only a pre-Round-10
    // row is ever without the field (see the interface).
    pickup: { type: pickupSchema, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The two legacy day queries, as indexes: dailies by rec_date (main_ops :263), secured by
// del_date + status (deliver/tash4ela :1690). Reports add the type+status+date shape (§12).
shipmentSchema.index({ shipmentType: 1, collectionDate: 1 }, { name: 'ix_type_collection_date' });
shipmentSchema.index(
  { shipmentType: 1, deliveryDate: 1, status: 1 },
  { name: 'ix_type_delivery_date_status' },
);
shipmentSchema.index({ status: 1 }, { name: 'ix_status' });
// Round 8: the secured screen (every open محصنة, newest first) and the vault's receive queue (the
// محصنات not received yet) both ask "secured, in these statuses" and read newest-created first.
shipmentSchema.index(
  { shipmentType: 1, status: 1, createdAt: -1 },
  { name: 'ix_type_status_created' },
);
// Round 10 needs no new index: «صرف الخزينة» (every secured shipment `inVault`, optionally on one
// delivery date) is served by `ix_type_status_created` without a date and by
// `ix_type_delivery_date_status` with one.

export const OperationsShipmentModel = model<OperationsShipmentDoc>(
  'OperationsShipment',
  shipmentSchema,
  'operations_shipments',
);
