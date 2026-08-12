// The pay-item catalog (PY-1): what an organization calls its earnings and deductions.
//
// It carries no amount — an amount belongs to an employee or to a calculation, never to the
// definition — and no tax or insurance field, because those rules are out of Payroll v1.
//
// `quantitySource` (PY-4) is the item's other half of its meaning: `calcBasis` says it is priced
// per day, and this says per day of WHAT. Set once with the rest, and never editable.
//
// ARCHIVED, NEVER DELETED once used: a payslip line names the item that produced it, so removing
// the row would leave history pointing at nothing. The delete route refuses a used item and the
// screen archives instead.
import { Schema, model } from 'mongoose';
import {
  PAY_ITEM_QUANTITY_SOURCES,
  type LocalizedString,
  type PayItemCalcBasis,
  type PayItemKind,
  type PayItemQuantitySource,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface PayItemDoc extends BaseDocFields {
  code: string;
  name: LocalizedString;
  kind: PayItemKind;
  calcBasis: PayItemCalcBasis;
  /** PY-4: which frozen-attendance quantity a `perDay`/`perMinute` item multiplies. */
  quantitySource: PayItemQuantitySource | null;
  sortOrder: number;
  status: 'active' | 'archived';
}

const localized = { ar: { type: String, required: true }, en: { type: String, required: true } };

const payItemSchema = new Schema<PayItemDoc>(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: localized,
    kind: { type: String, enum: ['earning', 'deduction'], required: true },
    calcBasis: {
      type: String,
      enum: ['fixed', 'perDay', 'perMinute', 'percentOfBase'],
      required: true,
    },
    quantitySource: { type: String, enum: [...PAY_ITEM_QUANTITY_SOURCES], default: null },
    sortOrder: { type: Number, required: true, default: 0 },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The code IS the handle later phases cite, so a live duplicate would make "which item is
// HOUSING?" ambiguous — the database refuses it even under concurrent writers.
payItemSchema.index(
  { code: 1 },
  { unique: true, name: 'ux_code', partialFilterExpression: { isDeleted: false } },
);
payItemSchema.index({ status: 1, sortOrder: 1 }, { name: 'ix_status_sortOrder' });

export const PayItemModel = model<PayItemDoc>('HrPayItem', payItemSchema, 'hr_pay_items');
