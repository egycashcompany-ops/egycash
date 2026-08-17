// The bank — the legacy "customer" (discovery §11: the customer IS the bank). Fields mirror the
// legacy `banks` collection; `opsName` is the verbatim `bank_name_ops` every legacy screen joins
// on, kept unique so migration and parity reports can match legacy rows one-to-one.
import { Schema, model } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface OperationsBankDoc extends BaseDocFields {
  code: number;
  name: LocalizedString;
  opsName: string;
  slogan: LocalizedString | null;
  /** Q31 NORMALIZE — replaces /vault1's hardcoded 22-name `$switch` sort (contad_app.js:1449). */
  sortOrder: number | null;
  isActive: boolean;
}

const bankSchema = new Schema<OperationsBankDoc>(
  {
    code: { type: Number, required: true },
    name: { ar: { type: String, required: true }, en: { type: String, required: true } },
    opsName: { type: String, required: true },
    slogan: {
      type: { ar: { type: String, required: true }, en: { type: String, required: true } },
      default: null,
    },
    sortOrder: { type: Number, default: null },
    isActive: { type: Boolean, required: true, default: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

bankSchema.index(
  { opsName: 1 },
  { unique: true, name: 'ux_ops_name', partialFilterExpression: { isDeleted: false } },
);
bankSchema.index(
  { code: 1 },
  { unique: true, name: 'ux_code', partialFilterExpression: { isDeleted: false } },
);

export const OperationsBankModel = model<OperationsBankDoc>(
  'OperationsBank',
  bankSchema,
  'operations_banks',
);
