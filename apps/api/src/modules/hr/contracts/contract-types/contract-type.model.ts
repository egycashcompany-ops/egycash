// Contract-type catalog (frozen contracts design D4a): admin-defined kinds (permanent,
// fixed-term, …) with the per-type business flags. Archived — never deleted (history).
import { Schema, model } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface ContractTypeDoc extends BaseDocFields {
  name: LocalizedString;
  /** Fixed-term contracts carry an end date; open-ended ones may omit it. */
  allowsEndDate: boolean;
  /** Q3 override flag: default is ONE active contract per employee per type. */
  multipleActiveAllowed: boolean;
  status: 'active' | 'archived';
}

const localized = { ar: { type: String, required: true }, en: { type: String, required: true } };

const contractTypeSchema = new Schema<ContractTypeDoc>(
  {
    name: localized,
    allowsEndDate: { type: Boolean, default: true },
    multipleActiveAllowed: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    ...baseFields,
  },
  baseSchemaOptions,
);

export const ContractTypeModel = model<ContractTypeDoc>(
  'HrContractType',
  contractTypeSchema,
  'hr_contract_types',
);
