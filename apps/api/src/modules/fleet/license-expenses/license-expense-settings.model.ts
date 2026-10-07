// The licensing-expenses set-up — «تتظبط مرة في الإعداد وتتعدل في كل مذكرة»: the names a new memo
// starts with. One row for the whole screen.
import { Schema, model } from 'mongoose';
import { type FleetLicenseExpenseSignatures } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';
import { signaturesSchema } from './license-expense.model';

export interface FleetLicenseExpenseSettingsDoc extends BaseDocFields {
  /** Always `'default'` — the one set-up's key. */
  key: string;
  signatures: FleetLicenseExpenseSignatures;
}

const licenseExpenseSettingsSchema = new Schema<FleetLicenseExpenseSettingsDoc>(
  {
    key: { type: String, required: true, default: 'default' },
    signatures: { type: signaturesSchema, required: true },
    ...baseFields,
  },
  { ...baseSchemaOptions, minimize: false },
);

licenseExpenseSettingsSchema.index(
  { key: 1 },
  {
    name: 'ux_license_expense_settings_key',
    unique: true,
    partialFilterExpression: { isDeleted: false },
  },
);

export const FleetLicenseExpenseSettingsModel = model<FleetLicenseExpenseSettingsDoc>(
  'FleetLicenseExpenseSettings',
  licenseExpenseSettingsSchema,
  'fleet_license_expense_settings',
);
