// The Organization singleton (ADR-015): identity, legal data, fiscal settings.
// Exactly one document exists; `ensure()` creates it at first boot/seed.
import { Schema, model, type Types } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';

export interface OrganizationDoc {
  _id: Types.ObjectId;
  schemaVersion: number;
  name: LocalizedString;
  legalName: LocalizedString | null;
  taxNumber: string | null;
  commercialRegistry: string | null;
  fiscalYearStartMonth: number;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
  __v: number;
}

const localized = { ar: { type: String, required: true }, en: { type: String, required: true } };
const localizedSchema = new Schema(localized, { _id: false });

const organizationSchema = new Schema<OrganizationDoc>(
  {
    schemaVersion: { type: Number, default: 1 },
    name: localized,
    legalName: { type: localizedSchema, default: null },
    taxNumber: { type: String, default: null },
    commercialRegistry: { type: String, default: null },
    fiscalYearStartMonth: { type: Number, default: 1, min: 1, max: 12 },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { strict: true, timestamps: true },
);

export const OrganizationModel = model<OrganizationDoc>(
  'Organization',
  organizationSchema,
  'organization',
);
