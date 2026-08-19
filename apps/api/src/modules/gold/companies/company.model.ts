// Owners of the metal in the vault — companies, investment funds and financial institutions
// (gold `models/Company.js`). Organization-level reference data: a fund is a customer of EGYCASH,
// not of one branch, so this collection is deliberately NOT branch-scoped — exactly as it was.
import { Schema, model, type Types } from 'mongoose';
import {
  GOLD_ACTIVE_STATUSES,
  GOLD_COMPANY_TYPES,
  type GoldActiveStatus,
  type GoldCompanyType,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface GoldCompanyDoc extends BaseDocFields {
  name: string;
  /** Platform Files id — the port's replacement for the gold system's Cloudinary URL. */
  logoFileId: Types.ObjectId | null;
  type: GoldCompanyType;
  phone: string | null;
  email: string | null;
  status: GoldActiveStatus;
  notes: string | null;
}

const companySchema = new Schema<GoldCompanyDoc>(
  {
    name: { type: String, required: true, trim: true },
    logoFileId: { type: Schema.Types.ObjectId, default: null },
    type: { type: String, enum: GOLD_COMPANY_TYPES, required: true, default: 'company' },
    phone: { type: String, trim: true, default: null },
    email: { type: String, trim: true, lowercase: true, default: null },
    status: { type: String, enum: GOLD_ACTIVE_STATUSES, required: true, default: 'active' },
    notes: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

companySchema.index({ name: 1 }, { name: 'ix_name' });
companySchema.index({ type: 1, status: 1 }, { name: 'ix_type_status' });

export const GoldCompanyModel = model<GoldCompanyDoc>(
  'GoldCompany',
  companySchema,
  'gold_companies',
);
