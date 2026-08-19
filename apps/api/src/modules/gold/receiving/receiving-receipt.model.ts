// عمليات الدخول — the receipt that brings metal into the vault (gold `models/ReceivingReceipt.js`).
//
// The embedded `lines` are the receipt's own record of the bars BEFORE any bar exists. Bars become
// documents only on confirm, so a draft keeps every keystroke the operator typed, can be printed
// and re-opened, and is the single thing that has to be right before approval. That ordering is
// the gold system's central rule and the port changes nothing about it.
//
// Integration 1 and 2 live in this schema: `teamLeaderEmployeeId` / `vehicleId` /
// `supervisor1EmployeeId` / `supervisor2EmployeeId` are ECMS references, each beside the display
// snapshot that keeps an already-printed receipt readable for ever.
import { Schema, model, type Types } from 'mongoose';
import {
  GOLD_DOCUMENT_STATUSES,
  GOLD_METAL_TYPES,
  type GoldDocumentStatus,
  type GoldMetalType,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface GoldReceivingLineSub {
  serialNumber: string;
  metalType: GoldMetalType;
  purity: string | null;
  weight: number;
  brand: string | null;
  weightBeforePacking: number | null;
  weightAfterPacking: number | null;
  vaultId: Types.ObjectId | null;
  drawerId: Types.ObjectId | null;
}

export interface GoldReceivingReceiptDoc extends BaseDocFields {
  receiptNumber: string;
  status: GoldDocumentStatus;
  printCount: number;
  lastPrintedAt: Date | null;
  receiptDate: Date;
  branchId: Types.ObjectId | null;
  releaseType: string | null;
  releaseOrderNumber: string | null;
  releaseLetterNumber: string | null;
  releaseLetterDate: Date | null;
  deliveredByUs: boolean;
  teamLeaderEmployeeId: Types.ObjectId | null;
  teamLeaderName: string | null;
  vehicleId: Types.ObjectId | null;
  vehicleNumber: string | null;
  companyId: Types.ObjectId | null;
  companyDelegateId: Types.ObjectId | null;
  companyDelegateNationalId: string | null;
  storageDelegateId: Types.ObjectId | null;
  storageDelegateNationalId: string | null;
  supervisor1EmployeeId: Types.ObjectId | null;
  supervisor1Name: string | null;
  supervisor2EmployeeId: Types.ObjectId | null;
  supervisor2Name: string | null;
  representativeId: Types.ObjectId | null;
  nationalId: string | null;
  keyHolder: string | null;
  keyHolderNationalId: string | null;
  totalWeight: number;
  barsCount: number;
  notes: string | null;
  storageLocation: string | null;
  lines: GoldReceivingLineSub[];
  barIds: Types.ObjectId[];
}

const lineSchema = new Schema<GoldReceivingLineSub>(
  {
    serialNumber: { type: String, trim: true, default: '' },
    metalType: { type: String, enum: GOLD_METAL_TYPES, required: true, default: 'gold' },
    purity: { type: String, trim: true, default: null },
    weight: { type: Number, required: true, default: 0 },
    brand: { type: String, trim: true, default: null },
    weightBeforePacking: { type: Number, default: null },
    weightAfterPacking: { type: Number, default: null },
    vaultId: { type: Schema.Types.ObjectId, default: null },
    drawerId: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

const receiptSchema = new Schema<GoldReceivingReceiptDoc>(
  {
    receiptNumber: { type: String, required: true },
    status: { type: String, enum: GOLD_DOCUMENT_STATUSES, required: true, default: 'draft' },
    printCount: { type: Number, required: true, default: 0 },
    lastPrintedAt: { type: Date, default: null },
    receiptDate: { type: Date, required: true, default: Date.now },
    branchId: { type: Schema.Types.ObjectId, default: null },
    releaseType: { type: String, trim: true, default: null },
    releaseOrderNumber: { type: String, trim: true, default: null },
    releaseLetterNumber: { type: String, trim: true, default: null },
    releaseLetterDate: { type: Date, default: null },
    deliveredByUs: { type: Boolean, required: true, default: true },
    teamLeaderEmployeeId: { type: Schema.Types.ObjectId, default: null },
    teamLeaderName: { type: String, default: null },
    vehicleId: { type: Schema.Types.ObjectId, default: null },
    vehicleNumber: { type: String, trim: true, default: null },
    companyId: { type: Schema.Types.ObjectId, default: null },
    companyDelegateId: { type: Schema.Types.ObjectId, default: null },
    companyDelegateNationalId: { type: String, trim: true, default: null },
    storageDelegateId: { type: Schema.Types.ObjectId, default: null },
    storageDelegateNationalId: { type: String, trim: true, default: null },
    supervisor1EmployeeId: { type: Schema.Types.ObjectId, default: null },
    supervisor1Name: { type: String, default: null },
    supervisor2EmployeeId: { type: Schema.Types.ObjectId, default: null },
    supervisor2Name: { type: String, default: null },
    representativeId: { type: Schema.Types.ObjectId, default: null },
    nationalId: { type: String, trim: true, default: null },
    keyHolder: { type: String, trim: true, default: null },
    keyHolderNationalId: { type: String, trim: true, default: null },
    totalWeight: { type: Number, required: true, default: 0 },
    barsCount: { type: Number, required: true, default: 0 },
    notes: { type: String, default: null },
    storageLocation: { type: String, trim: true, default: null },
    lines: { type: [lineSchema], required: true, default: [] },
    barIds: { type: [Schema.Types.ObjectId], required: true, default: [] },
    ...baseFields,
  },
  baseSchemaOptions,
);

receiptSchema.index(
  { receiptNumber: 1 },
  { unique: true, name: 'ux_number', partialFilterExpression: { isDeleted: false } },
);
receiptSchema.index({ branchId: 1, receiptDate: -1 }, { name: 'ix_branch_date' });
receiptSchema.index({ companyId: 1, status: 1 }, { name: 'ix_company_status' });

export const GoldReceivingReceiptModel = model<GoldReceivingReceiptDoc>(
  'GoldReceivingReceipt',
  receiptSchema,
  'gold_receiving_receipts',
);
