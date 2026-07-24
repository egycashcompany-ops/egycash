// Doc → DTO. The pending step is DERIVED from the status (the chain stores decided steps
// only — R9b dynamic manager binding).
import { type LeaveRequestDto } from '@ecms/contracts';
import { dateOnlyIso } from '../../shared/business-date';
import { type LeaveRequestDoc } from './leave-request.model';

export const toLeaveRequestDto = (doc: LeaveRequestDoc): LeaveRequestDto => ({
  id: String(doc._id),
  employeeId: String(doc.employeeId),
  employeeCode: doc.employeeCode,
  employeeName: doc.employeeName,
  branchId: doc.branchId === null ? null : String(doc.branchId),
  departmentId: doc.departmentId === null ? null : String(doc.departmentId),
  sectionId: doc.sectionId === null ? null : String(doc.sectionId),
  typeId: String(doc.typeId),
  typeCode: doc.typeCode,
  status: doc.status,
  startDate: dateOnlyIso(doc.startDate),
  endDate: dateOnlyIso(doc.endDate),
  halfDayStart: doc.halfDayStart,
  halfDayEnd: doc.halfDayEnd,
  days: doc.days,
  reason: doc.reason,
  attachments: doc.attachments.map(String),
  approvals: doc.approvals.map((a) => ({
    step: a.step,
    deciderUserId: String(a.deciderUserId),
    decision: a.decision,
    comment: a.comment,
    at: a.at.toISOString(),
  })),
  pendingStep: doc.status === 'pendingManager' ? 'manager' : doc.status === 'pendingHr' ? 'hr' : null,
  actualReturnDate: doc.actualReturnDate === null ? null : dateOnlyIso(doc.actualReturnDate),
  statusDriveOutcome: doc.statusDriveOutcome,
  cancelReason: doc.cancelReason,
  createdBy: doc.createdBy === null ? '' : String(doc.createdBy),
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});
