// Document → DTO. `filledCount` arrives as an argument rather than off the document, because it is
// not on the document: it is counted from the link records every time it is read (D-REQ-13).
import { type JobRequisitionDto } from '@ecms/contracts';
import { type JobRequisitionDoc } from './job-requisition.model';
import { type JobRequisitionFillDoc } from './job-requisition-fill.model';

const iso = (value: Date | null | undefined): string | null =>
  value === null || value === undefined ? null : value.toISOString();

const id = (value: { toString: () => string } | null | undefined): string | null =>
  value === null || value === undefined ? null : String(value);

export const toJobRequisitionDto = (
  doc: JobRequisitionDoc,
  filledCount: number,
): JobRequisitionDto => ({
  id: String(doc._id),
  code: doc.code,
  jobTitleId: String(doc.jobTitleId),
  departmentId: String(doc.departmentId),
  branchId: String(doc.branchId),
  sectionId: id(doc.sectionId),
  quantity: doc.quantity,
  filledCount,
  reason: doc.reason,
  priority: doc.priority,
  neededBy: iso(doc.neededBy),
  status: doc.status,
  requestedBy: String(doc.requestedBy),
  managerDecidedBy: id(doc.managerDecidedBy),
  managerDecidedAt: iso(doc.managerDecidedAt),
  managerComment: doc.managerComment,
  hrDecidedBy: id(doc.hrDecidedBy),
  hrDecidedAt: iso(doc.hrDecidedAt),
  hrComment: doc.hrComment,
  closedBy: id(doc.closedBy),
  closedAt: iso(doc.closedAt),
  closeReason: doc.closeReason,
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

export const toJobRequisitionFillDto = (doc: JobRequisitionFillDoc) => ({
  id: String(doc._id),
  requisitionId: String(doc.requisitionId),
  applicantId: String(doc.applicantId),
  employeeId: id(doc.employeeId),
  filledAt: doc.filledAt.toISOString(),
});
