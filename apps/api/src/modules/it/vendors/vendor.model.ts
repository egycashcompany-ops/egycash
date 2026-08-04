// IT vendors (design §2.9): the supplier/service-provider card. IT-owned until a Procurement
// module owns the concept (§13-Q6, debt roadmap §16-P4). Contacts are EMBEDDED — bounded by
// business reality (a vendor has a handful of contacts), not a growth collection.
import { Schema, model } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface ItVendorContactSub {
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
}

export interface ItVendorDoc extends BaseDocFields {
  name: string;
  code: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  services: string | null;
  contacts: ItVendorContactSub[];
  isActive: boolean;
}

const contactSchema = new Schema<ItVendorContactSub>(
  {
    name: { type: String, required: true },
    role: { type: String, default: null },
    phone: { type: String, default: null },
    email: { type: String, default: null },
  },
  { _id: false },
);

const vendorSchema = new Schema<ItVendorDoc>(
  {
    name: { type: String, required: true },
    code: { type: String, default: null },
    phone: { type: String, default: null },
    email: { type: String, default: null },
    address: { type: String, default: null },
    services: { type: String, default: null },
    contacts: { type: [contactSchema], required: true, default: [] },
    isActive: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

vendorSchema.index(
  { name: 1 },
  { unique: true, name: 'ux_name', partialFilterExpression: { isDeleted: false } },
);
vendorSchema.index({ isActive: 1 }, { name: 'ix_active' });

export const ItVendorModel = model<ItVendorDoc>('ItVendor', vendorSchema, 'it_vendors');
