// The asset register row (design §2.2). `status` is DERIVED from operations and never hand-set
// (FR-2): in IT-1 the only operation is registration, so every asset is `inStock`; IT-2's custody
// actions move it. `branchId` is the data-scope anchor and changes only via transfer (IT-2).
import { Schema, model, type Types } from 'mongoose';
import {
  IT_ASSET_STATUSES,
  IT_DISPOSAL_METHODS,
  type ItAssetStatus,
  type ItDisposalMethod,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface ItAssetPurchaseSub {
  date: Date | null;
  cost: number | null;
  vendorId: Types.ObjectId | null;
  invoiceRef: string | null;
}

export interface ItAssetWarrantySub {
  vendorId: Types.ObjectId | null;
  start: Date;
  end: Date;
  terms: string | null;
}

export interface ItAssetDisposalSub {
  at: Date;
  method: ItDisposalMethod;
  reason: string;
  notes: string | null;
}

export interface ItAssetDoc extends BaseDocFields {
  assetCode: string;
  name: string;
  description: string | null;
  categoryId: Types.ObjectId;
  status: ItAssetStatus;
  serialNumber: string | null;
  model: string | null;
  manufacturer: string | null;
  externalTag: string | null;
  branchId: Types.ObjectId;
  location: string | null;
  purchase: ItAssetPurchaseSub | null;
  warranty: ItAssetWarrantySub | null;
  /**
   * Head of the OPEN custody interval, `null` when the asset is not out (design §2.2). A read
   * convenience — `it_asset_assignments` is the truth, and the "one open per asset" invariant is
   * that collection's partial unique index, not this field (ADR-021).
   */
  currentAssignmentId: Types.ObjectId | null;
  /** Set once; `status: 'disposed'` is terminal and admits no further custody operation (FR-4). */
  disposal: ItAssetDisposalSub | null;
  notes: string | null;
}

const purchaseSchema = new Schema<ItAssetPurchaseSub>(
  {
    date: { type: Date, default: null },
    cost: { type: Number, default: null },
    vendorId: { type: Schema.Types.ObjectId, default: null },
    invoiceRef: { type: String, default: null },
  },
  { _id: false },
);

const warrantySchema = new Schema<ItAssetWarrantySub>(
  {
    vendorId: { type: Schema.Types.ObjectId, default: null },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    terms: { type: String, default: null },
  },
  { _id: false },
);

const disposalSchema = new Schema<ItAssetDisposalSub>(
  {
    at: { type: Date, required: true },
    method: { type: String, enum: IT_DISPOSAL_METHODS, required: true },
    reason: { type: String, required: true },
    notes: { type: String, default: null },
  },
  { _id: false },
);

const assetSchema = new Schema<ItAssetDoc>(
  {
    assetCode: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: null },
    categoryId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, required: true, enum: IT_ASSET_STATUSES, default: 'inStock' },
    serialNumber: { type: String, default: null },
    model: { type: String, default: null },
    manufacturer: { type: String, default: null },
    externalTag: { type: String, default: null },
    branchId: { type: Schema.Types.ObjectId, required: true },
    location: { type: String, default: null },
    purchase: { type: purchaseSchema, default: null },
    warranty: { type: warrantySchema, default: null },
    currentAssignmentId: { type: Schema.Types.ObjectId, default: null },
    disposal: { type: disposalSchema, default: null },
    notes: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The code is permanent and never reused — unique across deleted rows too, on purpose (FR-1).
assetSchema.index({ assetCode: 1 }, { unique: true, name: 'ux_asset_code' });
assetSchema.index(
  { serialNumber: 1 },
  {
    unique: true,
    name: 'ux_serial',
    partialFilterExpression: { isDeleted: false, serialNumber: { $type: 'string' } },
  },
);
assetSchema.index({ categoryId: 1, status: 1 }, { name: 'ix_category_status' });
assetSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branch_status' });
assetSchema.index({ externalTag: 1 }, { name: 'ix_external_tag', sparse: true });
assetSchema.index({ 'warranty.end': 1 }, { name: 'ix_warranty_end', sparse: true });

export const ItAssetModel = model<ItAssetDoc>('ItAsset', assetSchema, 'it_assets');
