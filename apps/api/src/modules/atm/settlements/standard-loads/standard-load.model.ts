// A standard load («الحمولة القياسية») — a named count profile per branch × bank (S-3, DS-8;
// docs/12-planning/atm-settlements-phase1.md §4.3).
//
// A count per EGP denomination; a layout may point at one, otherwise the bank's ONE default
// applies (`ux_default`, the race guard of a default switch). A line copies the counts its profile
// gave it (`standardNotes`), so editing a profile later changes no line.
import { Schema, model, type Types } from 'mongoose';
import {
  ATM_BANK_CODES,
  ATM_CASSETTE_NOTES_MAX,
  ATM_EGP_DENOMINATIONS,
  type AtmBankCode,
  type AtmDenominationNotes,
} from '@ecms/contracts';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';
import { NO_CONTROL } from '../shared/slot.schema';

export interface AtmStandardLoadDoc extends BaseDocFields {
  branchId: Types.ObjectId;
  bankCode: AtmBankCode;
  /** ≤ 40; null = unnamed (an imported row). */
  label: string | null;
  isDefault: boolean;
  order: number;
  /** 1..6 entries, unique EGP denominations. */
  notes: AtmDenominationNotes[];
}

const notesSchema = new Schema<AtmDenominationNotes>(
  {
    denomination: { type: Number, required: true, enum: ATM_EGP_DENOMINATIONS },
    notes: { type: Number, required: true, min: 0, max: ATM_CASSETTE_NOTES_MAX },
  },
  { _id: false },
);

const standardLoadSchema = new Schema<AtmStandardLoadDoc>(
  {
    branchId: { type: Schema.Types.ObjectId, required: true },
    bankCode: { type: String, required: true, enum: ATM_BANK_CODES },
    label: { type: String, default: null, maxlength: 40, match: NO_CONTROL },
    isDefault: { type: Boolean, required: true, default: false },
    order: { type: Number, required: true, min: 0 },
    notes: {
      type: [notesSchema],
      required: true,
      // Re-checked here as well as by the save schema (§4.3): 1..6 entries, no denomination twice.
      validate: {
        validator: (v: AtmDenominationNotes[]) =>
          v.length >= 1 &&
          v.length <= ATM_EGP_DENOMINATIONS.length &&
          new Set(v.map((n) => n.denomination)).size === v.length,
        message: 'a standard load holds 1..6 distinct EGP denominations',
      },
    },
    ...baseFields,
  },
  baseSchemaOptions,
);

standardLoadSchema.index({ branchId: 1, bankCode: 1, order: 1 }, { name: 'ix_branch_bank' });
standardLoadSchema.index(
  { branchId: 1, bankCode: 1 },
  {
    unique: true,
    name: 'ux_default',
    partialFilterExpression: { isDefault: true, isDeleted: false },
  },
);

export const AtmStandardLoadModel = model<AtmStandardLoadDoc>(
  'AtmStandardLoad',
  standardLoadSchema,
  'atm_standard_loads',
);
