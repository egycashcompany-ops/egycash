// What payroll ACTUALLY took (P-HR-05-B) — the third of the three concepts, and the only one that
// is a fact rather than an intention.
//
// APPEND-ONLY, in the shape `hr_leave_ledger` established: written once, never updated, never
// deleted, and the balance is rebuilt FROM it rather than stored beside it. A second copy of a
// number is a second chance for it to be wrong, and this is the number an employee will argue
// about.
//
// IT CITES DOCUMENTS THAT ALREADY EXIST. `runId` and `payslipId` are the identity of the thing
// that took the money — the payslip is the receipt — so "which document proves this deduction?"
// has an answer nobody had to mint.
//
// THE UNIQUE KEY IS THE IDEMPOTENCY. `(loanId, period)`: one loan owes at most one instalment in
// one month, so a re-issued payslip, a second run over the same period, or a retried batch all
// collide on a row that already exists and write nothing. The service checks first for the
// readable path; this index is what holds under a race.
import { Schema, model, type Types } from 'mongoose';

export interface LoanRepaymentDoc {
  _id: Types.ObjectId;
  loanId: Types.ObjectId;
  installmentId: Types.ObjectId;
  employeeId: Types.ObjectId;
  /** `YYYY-MM`, the month the payslip covered. */
  period: string;
  runId: Types.ObjectId;
  payslipId: Types.ObjectId;
  amountMinor: number;
  branchId: Types.ObjectId | null;
  recordedAt: Date;
  createdAt: Date;
}

const loanRepaymentSchema = new Schema<LoanRepaymentDoc>(
  {
    loanId: { type: Schema.Types.ObjectId, required: true },
    installmentId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    period: { type: String, required: true },
    runId: { type: Schema.Types.ObjectId, required: true },
    payslipId: { type: Schema.Types.ObjectId, required: true },
    amountMinor: { type: Number, required: true },
    branchId: { type: Schema.Types.ObjectId, default: null },
    recordedAt: { type: Date, required: true },
  },
  // No `updatedAt`, no `isDeleted`, no `updatedBy`: there is nothing here to update or to retract.
  // A deduction that turns out to be wrong is corrected forward, the way the rest of payroll
  // corrects a frozen month.
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

loanRepaymentSchema.index({ loanId: 1, period: 1 }, { unique: true, name: 'ux_loan_period' });
// The balance read: every repayment of one loan, in the order they happened.
loanRepaymentSchema.index({ loanId: 1, recordedAt: 1 }, { name: 'ix_loan_recordedAt' });
loanRepaymentSchema.index({ employeeId: 1, period: 1 }, { name: 'ix_employee_period' });

export const LoanRepaymentModel = model<LoanRepaymentDoc>(
  'HrLoanRepayment',
  loanRepaymentSchema,
  'hr_loan_repayments',
);
