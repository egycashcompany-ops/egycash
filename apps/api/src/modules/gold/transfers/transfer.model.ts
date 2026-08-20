// عمليات التحويل — moving OWNERSHIP of bars from one company to another (gold `models/Transfer.js`).
// A transfer never moves metal: the bars stay in their drawers, and confirming only rewrites who
// owns them. That is why reverting a transfer needs the previous owner and nothing else.
import { Schema, model, type Types } from 'mongoose';
import {
  GOLD_DOCUMENT_STATUSES,
  GOLD_METAL_TYPES,
  type GoldDocumentStatus,
  type GoldMetalType,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface GoldTransferDoc extends BaseDocFields {
  transferNumber: string;
  status: GoldDocumentStatus;
  printCount: number;
  lastPrintedAt: Date | null;
  transferDate: Date;
  branchId: Types.ObjectId | null;
  metalType: GoldMetalType | null;
  supervisor1EmployeeId: Types.ObjectId | null;
  supervisor1Name: string | null;
  supervisor2EmployeeId: Types.ObjectId | null;
  supervisor2Name: string | null;
  currentOwnerId: Types.ObjectId | null;
  currentOwnerDelegateId: Types.ObjectId | null;
  currentOwnerNationalId: string | null;
  newOwnerId: Types.ObjectId | null;
  newOwnerDelegateId: Types.ObjectId | null;
  newOwnerNationalId: string | null;
  barsCount: number;
  totalWeight: number;
  barIds: Types.ObjectId[];
  approvedBy: string | null;
  notes: string | null;
}

const transferSchema = new Schema<GoldTransferDoc>(
  {
    transferNumber: { type: String, required: true },
    status: { type: String, enum: GOLD_DOCUMENT_STATUSES, required: true, default: 'draft' },
    printCount: { type: Number, required: true, default: 0 },
    lastPrintedAt: { type: Date, default: null },
    transferDate: { type: Date, required: true, default: Date.now },
    branchId: { type: Schema.Types.ObjectId, default: null },
    metalType: { type: String, enum: [...GOLD_METAL_TYPES, null], default: null },
    supervisor1EmployeeId: { type: Schema.Types.ObjectId, default: null },
    supervisor1Name: { type: String, default: null },
    supervisor2EmployeeId: { type: Schema.Types.ObjectId, default: null },
    supervisor2Name: { type: String, default: null },
    currentOwnerId: { type: Schema.Types.ObjectId, default: null },
    currentOwnerDelegateId: { type: Schema.Types.ObjectId, default: null },
    currentOwnerNationalId: { type: String, trim: true, default: null },
    newOwnerId: { type: Schema.Types.ObjectId, default: null },
    newOwnerDelegateId: { type: Schema.Types.ObjectId, default: null },
    newOwnerNationalId: { type: String, trim: true, default: null },
    barsCount: { type: Number, required: true, default: 0 },
    totalWeight: { type: Number, required: true, default: 0 },
    barIds: { type: [Schema.Types.ObjectId], required: true, default: [] },
    approvedBy: { type: String, trim: true, default: null },
    notes: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

transferSchema.index(
  { transferNumber: 1 },
  { unique: true, name: 'ux_number', partialFilterExpression: { isDeleted: false } },
);
transferSchema.index({ branchId: 1, transferDate: -1 }, { name: 'ix_branch_date' });

export const GoldTransferModel = model<GoldTransferDoc>(
  'GoldTransfer',
  transferSchema,
  'gold_transfers',
);
