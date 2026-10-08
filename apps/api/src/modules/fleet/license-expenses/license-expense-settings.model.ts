// The licensing-expenses set-up — «تتظبط مرة في الإعداد وتتعدل في كل مذكرة»: the names a new memo
// starts with. One row for the whole screen.
import { Schema, model } from 'mongoose';
import {
  type FleetLicenseExpenseItemChoice,
  type FleetLicenseExpenseSignatures,
  type FleetLicenseExpenseTemplates,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';
import { signaturesSchema } from './license-expense.model';

export interface FleetLicenseExpenseSettingsDoc extends BaseDocFields {
  /** Always `'default'` — the one set-up's key. */
  key: string;
  signatures: FleetLicenseExpenseSignatures;
  /** The four templates — renewal/extension × card/cash. Lines are kept as given. */
  templates: FleetLicenseExpenseTemplates | null;
  /** The items each memo offers — `null` (or a `null` side) until somebody chooses. */
  items: FleetLicenseExpenseItemChoice | null;
}

const licenseExpenseSettingsSchema = new Schema<FleetLicenseExpenseSettingsDoc>(
  {
    key: { type: String, required: true, default: 'default' },
    signatures: { type: signaturesSchema, required: true },
    // A plain map, as a notice's answers are: the lines are the screen's, kept as written.
    templates: { type: Schema.Types.Mixed, default: null },
    items: { type: Schema.Types.Mixed, default: null },
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
