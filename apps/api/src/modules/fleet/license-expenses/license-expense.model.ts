// «مصروفات التراخيص» — one record of the department's licensing-expenses memo: a renewal
// («تجديد تراخيص»), an extension («مد مدة»), or both written on the same day, each its own sheet on
// paper. Nothing in a half is required — «ومش عاوز اى داتا اجبارى» — so an empty half is a valid one.
import { Schema, model, type Types } from 'mongoose';
import {
  FLEET_LICENSE_EXPENSE_PAYMENTS,
  type FleetLicenseExpensePaidBy,
  type FleetLicenseExpenseSignatures,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface FleetLicenseExpenseVehicle {
  /** The registry's car — `null` for a plate typed by hand. */
  vehicleId: Types.ObjectId | null;
  plate: string;
}

export interface FleetLicenseExpenseItem {
  /** The `licenseExpenseItem` it was picked from — `null` for one written by hand. */
  itemId: Types.ObjectId | null;
  label: string;
  amount: number | null;
  count: number;
  paidBy: FleetLicenseExpensePaidBy;
  receipt: boolean;
}

export interface FleetLicenseExpensePartDoc {
  vehicles: FleetLicenseExpenseVehicle[];
  items: FleetLicenseExpenseItem[];
}

export interface FleetLicenseExpenseDoc extends BaseDocFields {
  date: Date;
  renewal: FleetLicenseExpensePartDoc | null;
  extension: FleetLicenseExpensePartDoc | null;
  /** Who signs this memo — the set-up's names, as this memo was written. */
  signatures: FleetLicenseExpenseSignatures;
}

const vehicleSchema = new Schema<FleetLicenseExpenseVehicle>(
  {
    vehicleId: { type: Schema.Types.ObjectId, default: null },
    plate: { type: String, default: '' },
  },
  { _id: false },
);

const itemSchema = new Schema<FleetLicenseExpenseItem>(
  {
    itemId: { type: Schema.Types.ObjectId, default: null },
    label: { type: String, default: '' },
    amount: { type: Number, default: null },
    count: { type: Number, required: true, default: 1 },
    paidBy: { type: String, enum: FLEET_LICENSE_EXPENSE_PAYMENTS, required: true },
    receipt: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

const partSchema = new Schema<FleetLicenseExpensePartDoc>(
  {
    vehicles: { type: [vehicleSchema], default: [] },
    items: { type: [itemSchema], default: [] },
  },
  { _id: false },
);

export const signaturesSchema = new Schema<FleetLicenseExpenseSignatures>(
  {
    agent: { type: String, default: '' },
    director: { type: String, default: '' },
    generalManager: { type: String, default: '' },
  },
  { _id: false },
);

const licenseExpenseSchema = new Schema<FleetLicenseExpenseDoc>(
  {
    date: { type: Date, required: true },
    renewal: { type: partSchema, default: null },
    extension: { type: partSchema, default: null },
    signatures: { type: signaturesSchema, required: true },
    ...baseFields,
  },
  { ...baseSchemaOptions, minimize: false },
);

// The table, newest memo first.
licenseExpenseSchema.index({ date: -1, createdAt: -1 }, { name: 'ix_license_expense_date' });
// «كود السيارة» filters on the cars of either memo.
licenseExpenseSchema.index(
  { 'renewal.vehicles.vehicleId': 1 },
  { name: 'ix_license_expense_renewal_vehicle' },
);
licenseExpenseSchema.index(
  { 'extension.vehicles.vehicleId': 1 },
  { name: 'ix_license_expense_extension_vehicle' },
);

export const FleetLicenseExpenseModel = model<FleetLicenseExpenseDoc>(
  'FleetLicenseExpense',
  licenseExpenseSchema,
  'fleet_license_expenses',
);
