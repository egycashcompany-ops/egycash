// One scheduled installment (P-HR-05) — an INTENTION, not a fact.
//
// "This month is meant to take Y." It is not a deduction: nothing here says money moved, and in
// phase A nothing can, because there is no payroll integration yet. That distinction is the reason
// this collection exists separately from the loan and separately from the repayment record phase B
// will add — an intention may be rewritten while its month is open; a deduction on an issued
// payslip never may.
//
// THE AMOUNT IS IN MINOR UNITS, unlike the loan's principal. It is stored the way it is compared:
// `sum(installments) === principalMinor` is the design's invariant (D5/D10), and stating it over
// integers is what makes it exact rather than nearly exact.
import { Schema, model, type Types } from 'mongoose';
import { LOAN_INSTALLMENT_STATUSES, type LoanInstallmentStatus } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface LoanInstallmentDoc extends BaseDocFields {
  loanId: Types.ObjectId;
  /** Denormalized so the per-employee read never needs the loan first. */
  employeeId: Types.ObjectId;
  seq: number;
  /** `YYYY-MM`, Cairo. */
  period: string;
  amountMinor: number;
  status: LoanInstallmentStatus;
  branchId: Types.ObjectId | null;
}

const loanInstallmentSchema = new Schema<LoanInstallmentDoc>(
  {
    loanId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    seq: { type: Number, required: true },
    period: { type: String, required: true },
    amountMinor: { type: Number, required: true },
    status: { type: String, enum: LOAN_INSTALLMENT_STATUSES, required: true, default: 'planned' },
    branchId: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// Both UNIQUE, and both for the same reason: two installments in one month for one loan, or two
// rows claiming the same position in its order, are not business rules to police later — they are
// shapes that must not exist. A reschedule CANCELS rows and writes new ones with fresh sequence
// numbers rather than editing them in place, so the keys stay honest about what happened.
loanInstallmentSchema.index({ loanId: 1, seq: 1 }, { unique: true, name: 'ux_loan_seq' });
loanInstallmentSchema.index(
  { loanId: 1, period: 1 },
  {
    unique: true,
    name: 'ux_loan_period',
    // A cancelled row is history: it must not block the corrected row that replaces it.
    partialFilterExpression: { status: 'planned' },
  },
);
// The read phase B's payroll port will take — one month, every employee — and the tab's read.
loanInstallmentSchema.index({ period: 1, status: 1 }, { name: 'ix_period_status' });
loanInstallmentSchema.index({ employeeId: 1, period: 1 }, { name: 'ix_employee_period' });

export const LoanInstallmentModel = model<LoanInstallmentDoc>(
  'HrLoanInstallment',
  loanInstallmentSchema,
  'hr_loan_installments',
);
