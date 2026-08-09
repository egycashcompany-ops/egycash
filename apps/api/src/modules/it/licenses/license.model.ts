// `it_licenses` — an entitlement to run a product (design §2.8).
//
// Two nulls carry meaning and neither is a missing value: `seats: null` is UNLIMITED, and
// `expiresAt: null` is PERPETUAL. Both are stated once here and read everywhere else.
//
// There is no `status` and no `seatsUsed`. §6 says the state is derived from `expiresAt`, and
// FR-10 says the seat count is derived from the live installations — a stored copy of either would
// drift the first time anything changed it by a path that forgot.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface ItLicensePurchaseSub {
  vendorId: Types.ObjectId | null;
  date: Date | null;
  cost: number | null;
  invoiceRef: string | null;
}

export interface ItLicenseDoc extends BaseDocFields {
  productId: Types.ObjectId;
  licenseKey: string | null;
  seats: number | null;
  purchase: ItLicensePurchaseSub | null;
  expiresAt: Date | null;
  notes: string | null;
}

// Embedded, matching `ItAssetPurchaseSub` field for field — a purchase is the same shape whether
// it bought a laptop or a licence, and Procurement will inherit one concept, not two.
const purchaseSchema = new Schema<ItLicensePurchaseSub>(
  {
    vendorId: { type: Schema.Types.ObjectId, default: null },
    date: { type: Date, default: null },
    cost: { type: Number, default: null },
    invoiceRef: { type: String, default: null },
  },
  { _id: false },
);

const licenseSchema = new Schema<ItLicenseDoc>(
  {
    productId: { type: Schema.Types.ObjectId, required: true },
    licenseKey: { type: String, default: null },
    seats: { type: Number, default: null, min: 1 },
    purchase: { type: purchaseSchema, default: null },
    expiresAt: { type: Date, default: null },
    notes: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

licenseSchema.index({ productId: 1 }, { name: 'ix_product' });
// The expiry sweep's index, and the mirror of `ix_warranty_end` on the asset. Sparse: a perpetual
// license has no date and belongs in no expiry scan.
licenseSchema.index({ expiresAt: 1 }, { name: 'ix_expires', sparse: true });
licenseSchema.index({ 'purchase.vendorId': 1 }, { name: 'ix_vendor', sparse: true });

export const ItLicenseModel = model<ItLicenseDoc>('ItLicense', licenseSchema, 'it_licenses');
