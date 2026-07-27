// A24 — the company branding profile: a module-owned SINGLETON configured
// independently of template bodies. Branding is applied at render time and frozen
// into each generated snapshot, so later branding changes never alter issued documents.
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface ContractBrandingDoc extends BaseDocFields {
  headerText: { ar: string; en: string };
  footerText: { ar: string; en: string };
  watermark: { ar: string; en: string };
  primaryColor: string;
  logoFileId: Types.ObjectId | null;
}

const localized = { _id: false, ar: { type: String, default: '' }, en: { type: String, default: '' } };

const brandingSchema = new Schema<ContractBrandingDoc>(
  {
    headerText: { type: localized, default: () => ({ ar: '', en: '' }) },
    footerText: { type: localized, default: () => ({ ar: '', en: '' }) },
    watermark: { type: localized, default: () => ({ ar: '', en: '' }) },
    primaryColor: { type: String, default: '#111111' },
    logoFileId: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

export const ContractBrandingModel = model<ContractBrandingDoc>(
  'HrContractBranding',
  brandingSchema,
  'hr_contract_branding',
);
