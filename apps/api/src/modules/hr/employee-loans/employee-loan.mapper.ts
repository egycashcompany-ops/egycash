// Employee loan DTO mapping (P-HR-05).
//
// `remainingMinor` is DERIVED here rather than read from a column, and the major-unit figure is
// derived from the minor one — the same one-way conversion PY-7 uses on a payslip's totals, for
// the same reason: two stored copies of one number are two chances for it to be wrong.
import {
  fromMinorUnits,
  toMinorUnits,
  type EmployeeLoanDetailDto,
  type EmployeeLoanDto,
  type LoanInstallmentDto,
  type LoanRepaymentDto,
} from '@ecms/contracts';
import { dateOnlyIso } from '../shared/business-date';
import { type EmployeeLoanDoc } from './employee-loan.model';
import { type LoanInstallmentDoc } from './loan-installment.model';
import { type LoanRepaymentDoc } from './loan-repayment.model';
import { remainingMinorOf } from './employee-loan.service';

export const toLoanInstallmentDto = (doc: LoanInstallmentDoc): LoanInstallmentDto => ({
  id: String(doc._id),
  loanId: String(doc.loanId),
  seq: doc.seq,
  period: doc.period,
  amountMinor: doc.amountMinor,
  amount: fromMinorUnits(doc.amountMinor),
  status: doc.status,
});

export const toLoanRepaymentDto = (doc: LoanRepaymentDoc): LoanRepaymentDto => ({
  id: String(doc._id),
  loanId: String(doc.loanId),
  installmentId: String(doc.installmentId),
  period: doc.period,
  runId: String(doc.runId),
  payslipId: String(doc.payslipId),
  amountMinor: doc.amountMinor,
  amount: fromMinorUnits(doc.amountMinor),
  recordedAt: doc.recordedAt.toISOString(),
});

/**
 * The repayments are passed IN rather than read here: a page of loans resolves them in one query,
 * the same shape the pay-item and adjustment mappers use for their catalog rows.
 */
export const toEmployeeLoanDto = (
  doc: EmployeeLoanDoc,
  repayments: readonly LoanRepaymentDoc[] = [],
): EmployeeLoanDto => {
  const repaidMinor = repayments.reduce((sum, row) => sum + row.amountMinor, 0);
  const remainingMinor = remainingMinorOf(doc, repaidMinor);
  return {
    id: String(doc._id),
    employeeId: String(doc.employeeId),
    type: doc.type,
    principal: doc.principal,
    principalMinor: toMinorUnits(doc.principal),
    currency: doc.currency,
    installmentCount: doc.installmentCount,
    firstPeriod: doc.firstPeriod,
    reason: doc.reason,
    note: doc.note,
    attachmentFileId: doc.attachmentFileId === null ? null : String(doc.attachmentFileId),
    status: doc.status,
    remainingMinor,
    remaining: fromMinorUnits(remainingMinor),
    repaidMinor,
    repaid: fromMinorUnits(repaidMinor),
    submittedBy: doc.submittedBy === null ? null : String(doc.submittedBy),
    submittedAt: doc.submittedAt === null ? null : doc.submittedAt.toISOString(),
    decidedBy: doc.decidedBy === null ? null : String(doc.decidedBy),
    decidedAt: doc.decidedAt === null ? null : doc.decidedAt.toISOString(),
    decisionNote: doc.decisionNote,
    // A business date, not a timestamp: the day money changed hands, as everywhere else in HR.
    disbursedAt: doc.disbursedAt === null ? null : dateOnlyIso(doc.disbursedAt),
    disbursedBy: doc.disbursedBy === null ? null : String(doc.disbursedBy),
    disbursementNote: doc.disbursementNote,
    externalSettlement:
      doc.externalSettlement === null
        ? null
        : {
            amountMinor: doc.externalSettlement.amountMinor,
            amount: fromMinorUnits(doc.externalSettlement.amountMinor),
            reason: doc.externalSettlement.reason,
            at: doc.externalSettlement.at.toISOString(),
            by: doc.externalSettlement.by === null ? null : String(doc.externalSettlement.by),
          },
    cancelledBy: doc.cancelledBy === null ? null : String(doc.cancelledBy),
    cancelledAt: doc.cancelledAt === null ? null : doc.cancelledAt.toISOString(),
    cancelReason: doc.cancelReason,
    createdBy: doc.createdBy === null ? null : String(doc.createdBy),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    version: doc.__v,
  };
};

export const toEmployeeLoanDetailDto = (
  doc: EmployeeLoanDoc,
  installments: readonly LoanInstallmentDoc[],
  repayments: readonly LoanRepaymentDoc[] = [],
): EmployeeLoanDetailDto => ({
  ...toEmployeeLoanDto(doc, repayments),
  installments: installments.map(toLoanInstallmentDto),
  repayments: repayments.map(toLoanRepaymentDto),
});
