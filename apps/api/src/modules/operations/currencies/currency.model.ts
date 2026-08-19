// The currency — Q33 NORMALIZE: legacy currencies are bare strings inside ONE `data_lists`
// singleton document (contad_app.js:1985-2005). Each becomes an entity whose `legacyAliases`
// carry every legacy spelling, because the legacy reports classify money by literal synonym
// lists (EGP = ['مصري','جنيه','EGP','جنيه مصري'] — contad_app.js:1409) and parity matching
// needs that spelling set as data, not as code.
import { Schema, model } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface OperationsCurrencyDoc extends BaseDocFields {
  code: string;
  name: string;
  legacyAliases: string[];
  isActive: boolean;
}

const currencySchema = new Schema<OperationsCurrencyDoc>(
  {
    code: { type: String, required: true },
    name: { type: String, required: true },
    legacyAliases: { type: [String], required: true, default: [] },
    isActive: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

currencySchema.index(
  { code: 1 },
  { unique: true, name: 'ux_code', partialFilterExpression: { isDeleted: false } },
);
currencySchema.index(
  { name: 1 },
  { unique: true, name: 'ux_name', partialFilterExpression: { isDeleted: false } },
);

export const OperationsCurrencyModel = model<OperationsCurrencyDoc>(
  'OperationsCurrency',
  currencySchema,
  'operations_currencies',
);
