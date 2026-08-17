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
  type OperationsShipmentStatus,
  type OperationsShipmentType,
  OPERATIONS_SHIPMENT_STATUSES,
  OPERATIONS_SHIPMENT_TYPES,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface OperationsShipmentLine {
  currencyId: Types.ObjectId;
  /** Integer minor units (piasters for EGP) — never a float, never a string (Q8 NORMALIZE). */
  amountMinor: number;
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
}

const lineSchema = new Schema<OperationsShipmentLine>(
  {
    currencyId: { type: Schema.Types.ObjectId, required: true },
    amountMinor: { type: Number, required: true, min: 0 },
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

export const OperationsShipmentModel = model<OperationsShipmentDoc>(
  'OperationsShipment',
  shipmentSchema,
  'operations_shipments',
);
