// An employee loan or advance (P-HR-05) — the OBLIGATION.
//
// NOT PERIOD-KEYED, and that is the difference from `hr_payroll_adjustments`. An adjustment is a
// decision about one month, so the month is its key; a loan is a debt that outlives any month, so
// its key is the loan. The months it will occupy live in `hr_loan_installments`, one row each.
//
// THE PRINCIPAL IS WRITTEN ONCE. It is the obligation itself, and D10 froze that a loan is its
// principal and nothing else — no interest, no fee, no penalty. What changes over a loan's life is
// what remains, and that is DERIVED (`principal − everything repaid`) rather than stored: a second
// copy of a number is a second chance for it to be wrong.
//
// `branchId` is the ADR-015 scope field, denormalized from the employee at write time like every
// other HR collection; visibility itself is inherited from the employee, exactly as Personnel
// Actions and pay-item assignments do it.
import { Schema, model, type Types } from 'mongoose';
import {
  EMPLOYEE_LOAN_STATUSES,
  EMPLOYEE_LOAN_TYPES,
  type EmployeeLoanStatus,
  type EmployeeLoanType,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

/** D7-1 — money collected outside ECMS, recorded once and closing the balance. */
export interface LoanExternalSettlement {
  amountMinor: number;
  reason: string;
  at: Date;
  by: Types.ObjectId | null;
}

export interface EmployeeLoanDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  type: EmployeeLoanType;
  /** Major units, at the storage precision the payroll money module defines. Always positive. */
  principal: number;
  currency: string;
  installmentCount: number;
  /** `YYYY-MM`, Cairo — the first month the schedule occupies. */
  firstPeriod: string;
  reason: string;
  note: string | null;
  attachmentFileId: Types.ObjectId | null;
  status: EmployeeLoanStatus;
  submittedBy: Types.ObjectId | null;
  submittedAt: Date | null;
  decidedBy: Types.ObjectId | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  /** A RECORD that money changed hands elsewhere — ECMS has no treasury and pays nobody. */
  disbursedAt: Date | null;
  disbursedBy: Types.ObjectId | null;
  disbursementNote: string | null;
  externalSettlement: LoanExternalSettlement | null;
  cancelledBy: Types.ObjectId | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  branchId: Types.ObjectId | null;
}

const externalSettlementSchema = new Schema<LoanExternalSettlement>(
  {
    amountMinor: { type: Number, required: true },
    reason: { type: String, required: true },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

const employeeLoanSchema = new Schema<EmployeeLoanDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: EMPLOYEE_LOAN_TYPES, required: true },
    principal: { type: Number, required: true },
    currency: { type: String, required: true, default: 'EGP' },
    installmentCount: { type: Number, required: true },
    firstPeriod: { type: String, required: true },
    reason: { type: String, required: true },
    note: { type: String, default: null },
    attachmentFileId: { type: Schema.Types.ObjectId, default: null },
    status: { type: String, enum: EMPLOYEE_LOAN_STATUSES, required: true, default: 'draft' },
    submittedBy: { type: Schema.Types.ObjectId, default: null },
    submittedAt: { type: Date, default: null },
    decidedBy: { type: Schema.Types.ObjectId, default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: null },
    disbursedAt: { type: Date, default: null },
    disbursedBy: { type: Schema.Types.ObjectId, default: null },
    disbursementNote: { type: String, default: null },
    externalSettlement: { type: externalSettlementSchema, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: null },
    branchId: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// D3's read — "does this employee already have one on the way?" — and the employee's own list.
// NOT a unique index: "live" is a predicate over `status`, and a partial unique index would also
// have to survive a cancelled loan being replaced, which is the normal case rather than the
// exception. The service holds the rule; this makes its check cheap — the same division of labour
// `employee_pay_items` uses for its overlap rule.
employeeLoanSchema.index({ employeeId: 1, status: 1 }, { name: 'ix_employee_status' });
// The approval queue, and the organization-wide list.
employeeLoanSchema.index({ status: 1, createdAt: -1 }, { name: 'ix_status_createdAt' });

export const EmployeeLoanModel = model<EmployeeLoanDoc>(
  'HrEmployeeLoan',
  employeeLoanSchema,
  'hr_employee_loans',
);
