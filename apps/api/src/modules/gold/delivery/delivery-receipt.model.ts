// عمليات الخروج — the order that releases bars out of the vault (gold `models/DeliveryReceipt.js`).
// Unlike receiving, a delivery references bars that already exist: the draft holds the selection,
// and confirming is what marks each bar `delivered` and empties its drawer slot.
import { Schema, model, type Types } from 'mongoose';
import {
  GOLD_DOCUMENT_STATUSES,
  GOLD_METAL_TYPES,
  type GoldDocumentStatus,
  type GoldMetalType,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface GoldDeliveryReceiptDoc extends BaseDocFields {
  receiptNumber: string;
  status: GoldDocumentStatus;
  printCount: number;
  lastPrintedAt: Date | null;
  receiptDate: Date;
  branchId: Types.ObjectId | null;
  companyId: Types.ObjectId | null;
  metalType: GoldMetalType | null;
  supervisor1EmployeeId: Types.ObjectId | null;
  supervisor1Name: string | null;
  supervisor2EmployeeId: Types.ObjectId | null;
  supervisor2Name: string | null;
  representativeId: Types.ObjectId | null;
  nationalId: string | null;
  keyHolder: string | null;
  totalWeight: number;
  barsCount: number;
  barIds: Types.ObjectId[];
  notes: string | null;
}

const deliverySchema = new Schema<GoldDeliveryReceiptDoc>(
  {
    receiptNumber: { type: String, required: true },
    status: { type: String, enum: GOLD_DOCUMENT_STATUSES, required: true, default: 'draft' },
    printCount: { type: Number, required: true, default: 0 },
    lastPrintedAt: { type: Date, default: null },
    receiptDate: { type: Date, required: true, default: Date.now },
    branchId: { type: Schema.Types.ObjectId, default: null },
    companyId: { type: Schema.Types.ObjectId, default: null },
    metalType: { type: String, enum: [...GOLD_METAL_TYPES, null], default: null },
    supervisor1EmployeeId: { type: Schema.Types.ObjectId, default: null },
    supervisor1Name: { type: String, default: null },
    supervisor2EmployeeId: { type: Schema.Types.ObjectId, default: null },
    supervisor2Name: { type: String, default: null },
    representativeId: { type: Schema.Types.ObjectId, default: null },
    nationalId: { type: String, trim: true, default: null },
    keyHolder: { type: String, trim: true, default: null },
    totalWeight: { type: Number, required: true, default: 0 },
    barsCount: { type: Number, required: true, default: 0 },
    barIds: { type: [Schema.Types.ObjectId], required: true, default: [] },
    notes: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

deliverySchema.index(
  { receiptNumber: 1 },
  { unique: true, name: 'ux_number', partialFilterExpression: { isDeleted: false } },
);
deliverySchema.index({ branchId: 1, receiptDate: -1 }, { name: 'ix_branch_date' });
deliverySchema.index({ companyId: 1, status: 1 }, { name: 'ix_company_status' });

export const GoldDeliveryReceiptModel = model<GoldDeliveryReceiptDoc>(
  'GoldDeliveryReceipt',
  deliverySchema,
  'gold_delivery_receipts',
);
