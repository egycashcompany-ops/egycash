// A company's authorised delegate — the person who signs for metal on the owner's behalf
// (gold `models/Representative.js`). These are the CUSTOMER's people, not EGYCASH staff, which is
// why they stay a gold-owned collection while the vault custodians moved to the ECMS directory.
import { Schema, model, type Types } from 'mongoose';
import { GOLD_ACTIVE_STATUSES, type GoldActiveStatus } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface GoldRepresentativeDoc extends BaseDocFields {
  companyId: Types.ObjectId;
  fullName: string;
  nationalId: string | null;
  phone: string | null;
  jobTitle: string | null;
  joinDate: Date | null;
  status: GoldActiveStatus;
  notes: string | null;
}

const representativeSchema = new Schema<GoldRepresentativeDoc>(
  {
    companyId: { type: Schema.Types.ObjectId, required: true },
    fullName: { type: String, required: true, trim: true },
    nationalId: { type: String, trim: true, default: null },
    phone: { type: String, trim: true, default: null },
    jobTitle: { type: String, trim: true, default: null },
    joinDate: { type: Date, default: null },
    status: { type: String, enum: GOLD_ACTIVE_STATUSES, required: true, default: 'active' },
    notes: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

representativeSchema.index({ companyId: 1 }, { name: 'ix_company' });
representativeSchema.index({ fullName: 1 }, { name: 'ix_name' });
representativeSchema.index({ nationalId: 1 }, { name: 'ix_national_id' });

export const GoldRepresentativeModel = model<GoldRepresentativeDoc>(
  'GoldRepresentative',
  representativeSchema,
  'gold_representatives',
);
