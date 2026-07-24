// Electronic Employee File DTO mapping (Stage 7). Dates are ISO strings; the linked
// recruitment history and the Employee Timeline are surfaced as-is (the timeline is already
// ordered oldest-first by the service).
import {
  type EmployeeFileDocumentDto,
  type EmployeeFileDto,
  type EmployeeFileLinksDto,
  type EmployeeTimelineEntryDto,
} from '@ecms/contracts';
import {
  type EmployeeFileDoc,
  type EmployeeFileDocument,
  type EmployeeFileLinks,
  type EmployeeTimelineEntry,
} from './employee-file.model';

const documentDto = (d: EmployeeFileDocument): EmployeeFileDocumentDto => ({
  id: String(d._id),
  source: d.source,
  name: d.name,
  fileId: String(d.fileId),
  fileName: d.fileName,
  copiedFromFileId: d.copiedFromFileId === null ? null : String(d.copiedFromFileId),
  uploadedBy: d.uploadedBy === null ? null : String(d.uploadedBy),
  uploadedAt: d.uploadedAt.toISOString(),
});

const linksDto = (l: EmployeeFileLinks): EmployeeFileLinksDto => ({
  applicantId: String(l.applicantId),
  jobRequisitionId: l.jobRequisitionId === null ? null : String(l.jobRequisitionId),
  screeningId: l.screeningId === null ? null : String(l.screeningId),
  interviewIds: l.interviewIds.map((id) => String(id)),
  jobOfferId: l.jobOfferId === null ? null : String(l.jobOfferId),
  hiringDocumentsId: String(l.hiringDocumentsId),
});

const timelineEntryDto = (e: EmployeeTimelineEntry): EmployeeTimelineEntryDto => ({
  at: e.at.toISOString(),
  type: e.type,
  refType: e.refType,
  refId: e.refId === null ? null : String(e.refId),
  detail: e.detail,
  by: e.by === null ? null : String(e.by),
});

export const toEmployeeFileDto = (doc: EmployeeFileDoc): EmployeeFileDto => ({
  id: String(doc._id),
  employeeId: String(doc.employeeId),
  employeeCode: doc.employeeCode,
  applicantId: String(doc.applicantId),
  branchId: String(doc.branchId),
  status: doc.status,
  links: linksDto(doc.links),
  documents: doc.documents.map(documentDto),
  timeline: doc.timeline.map(timelineEntryDto),
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});
