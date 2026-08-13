// Payroll adjustment DTO mapping (P-HR-04).
//
// The catalog row is resolved by the caller and passed in — one query for a page of rows rather
// than one per row, the same shape the pay-item assignment mapper uses.
import { type PayrollAdjustmentDto } from '@ecms/contracts';
import { type PayrollAdjustmentDoc } from './payroll-adjustment.model';

export const toPayrollAdjustmentDto = (
  doc: PayrollAdjustmentDoc,
  payItems: Map<string, { code: string; name: { ar: string; en: string } }>,
): PayrollAdjustmentDto => ({
  id: String(doc._id),
  employeeId: String(doc.employeeId),
  period: doc.period,
  kind: doc.kind,
  amount: doc.amount,
  currency: doc.currency,
  reason: doc.reason,
  payItemId: doc.payItemId === null ? null : String(doc.payItemId),
  payItem: doc.payItemId === null ? null : (payItems.get(String(doc.payItemId)) ?? null),
  note: doc.note,
  attachmentFileId: doc.attachmentFileId === null ? null : String(doc.attachmentFileId),
  status: doc.status,
  submittedBy: doc.submittedBy === null ? null : String(doc.submittedBy),
  submittedAt: doc.submittedAt === null ? null : doc.submittedAt.toISOString(),
  decidedBy: doc.decidedBy === null ? null : String(doc.decidedBy),
  decidedAt: doc.decidedAt === null ? null : doc.decidedAt.toISOString(),
  decisionNote: doc.decisionNote,
  cancelledBy: doc.cancelledBy === null ? null : String(doc.cancelledBy),
  cancelledAt: doc.cancelledAt === null ? null : doc.cancelledAt.toISOString(),
  cancelReason: doc.cancelReason,
  createdBy: doc.createdBy === null ? null : String(doc.createdBy),
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
  version: doc.__v,
});
