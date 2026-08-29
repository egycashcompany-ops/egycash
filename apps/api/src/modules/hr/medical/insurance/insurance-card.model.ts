// The medical insurance card (P-HR-MED D2, D4, D10, D13).
//
// THIS COLLECTION DECLARES BOTH SCOPE AXES, AND THE CLINICAL ONES DO NOT. The asymmetry IS D4
// stated in the schema: a card number is an administrative fact somebody's HR officer legitimately
// administers by branch, and a blood type is not. Reading who is insured under which policy is a
// question about benefits administration; reading somebody's conditions is a question about their
// body, and the two must not share a visibility model.
//
// A BENEFIT RECORD, NOT A CLAIM SYSTEM (D10). No claims, no reimbursements, no balances — the same
// accounting boundary PY-12, P-HR-12 and P-HR-14 are each stopped at.
//
// `endsOn` IS STORED AND NEVER SWEPT (D13). A card whose window has passed keeps saying `active`
// until a person ends it, because «expired» is a conclusion drawn from a date and this module draws
// none. The status is what somebody set.
import { Schema, model, type Types } from 'mongoose';
import { INSURANCE_CARD_STATUSES, type Dependant, type InsuranceCardStatus } from '@ecms/contracts';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';

export interface InsuranceCardDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  employeeCode: string;
  employeeName: string;
  provider: string;
  /**
   * The number on the card — NOT a social-insurance number (D2).
   *
   * The name matters: `insuranceNumber` is what a payroll deduction is calculated from, and this
   * module holds no such thing. `medical-absences.spec.ts` bans that name outright.
   */
  cardNumber: string;
  tier: string | null;
  status: InsuranceCardStatus;
  startsOn: Date;
  endsOn: Date | null;
  endedOn: Date | null;
  endReason: string | null;
  /** Names and relationships. Not people the system administers — see the contract (D10). */
  dependants: Dependant[];
  note: string | null;
  /** BOTH AXES — the one medical collection that carries them, and D4's whole point. */
  branchId: Types.ObjectId | null;
  departmentId: Types.ObjectId | null;
}

const dependantSchema = new Schema<Dependant>(
  { name: { type: String, required: true }, relationship: { type: String, required: true } },
  { _id: false },
);

const insuranceCardSchema = new Schema<InsuranceCardDoc>(
  {
    ...baseFields,
    employeeId: { type: Schema.Types.ObjectId, required: true },
    employeeCode: { type: String, required: true },
    employeeName: { type: String, required: true },
    provider: { type: String, required: true },
    cardNumber: { type: String, required: true },
    tier: { type: String, default: null },
    status: {
      type: String,
      enum: INSURANCE_CARD_STATUSES,
      required: true,
      default: 'active',
    },
    startsOn: { type: Date, required: true },
    endsOn: { type: Date, default: null },
    endedOn: { type: Date, default: null },
    endReason: { type: String, default: null },
    dependants: { type: [dependantSchema], default: [] },
    note: { type: String, default: null },
    branchId: { type: Schema.Types.ObjectId, default: null },
    departmentId: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);

// ONE ACTIVE CARD PER PERSON. Two would each claim to be what somebody presents at a clinic, and
// the second would be found by whichever query ran first. A renewal ENDS one and issues another,
// which is also what the provider does.
insuranceCardSchema.index(
  { employeeId: 1 },
  {
    unique: true,
    name: 'ux_active_employee',
    partialFilterExpression: { status: 'active', isDeleted: false },
  },
);
insuranceCardSchema.index({ status: 1, startsOn: -1 }, { name: 'ix_status_startsOn' });
insuranceCardSchema.index({ departmentId: 1, status: 1 }, { name: 'ix_departmentId_status' });

// NO INDEX ON `endsOn`, deliberately. An index is what a sweep is built on, and «whose cover lapses
// this month» is the report D13 refuses until somebody says what follows from a lapse.

export const InsuranceCardModel = model<InsuranceCardDoc>(
  'HrInsuranceCard',
  insuranceCardSchema,
  'hr_medical_insurance',
);
