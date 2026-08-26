// Evaluation-batch DTO mapping. Dates are ISO strings; ids are stringified. National ids are
// masked on egress — the unmasked value stays on the document for the generated PDF list only.
import {
  maskNationalId,
  type BatchCandidateDto,
  type BatchDocumentDto,
  type BatchItemDto,
  type BatchPackageDto,
  type EvaluationBatchDto,
  type EvaluationBatchSummaryDto,
} from '@ecms/contracts';
import { placementDto, placementLabelDto } from '../workflow/stage-mapper';
import { type ApplicantDoc } from '../applicants';
import {
  type BatchDocument,
  type BatchItem,
  type BatchPackage,
  type EvaluationBatchDoc,
} from './evaluation-batch.model';

const packageDto = (p: BatchPackage): BatchPackageDto => ({
  status: p.status,
  listPdfFileId: p.listPdfFileId === null ? null : String(p.listPdfFileId),
  archiveFileId: p.archiveFileId === null ? null : String(p.archiveFileId),
  attachmentCount: p.attachmentCount,
  builtAt: p.builtAt === null ? null : p.builtAt.toISOString(),
  error: p.error,
});

export const batchItemDto = (item: BatchItem): BatchItemDto => ({
  applicantId: String(item.applicantId),
  applicantCode: item.applicantCode,
  applicantName: item.applicantName ?? '',
  evaluationId: String(item.evaluationId),
  placement: placementDto(item.placementSnapshot),
  placementLabel: placementLabelDto(item.placementSnapshotLabel),
  nationalIdMasked: item.nationalId == null ? null : maskNationalId(item.nationalId),
  motherName: item.motherName ?? null,
  address: item.address ?? null,
  phone: item.phone ?? null,
  result: item.result,
  grade: item.grade ?? null,
  reason: item.reason,
  resultFileId: item.resultFileId === null ? null : String(item.resultFileId),
  decidedBy: item.decidedBy === null ? null : String(item.decidedBy),
  decidedAt: item.decidedAt === null ? null : item.decidedAt.toISOString(),
});

const documentDto = (d: BatchDocument): BatchDocumentDto => ({
  fileId: String(d.fileId),
  fileName: d.fileName,
  note: d.note,
  applicantId: d.applicantId === null ? null : String(d.applicantId),
  uploadedBy: d.uploadedBy === null ? null : String(d.uploadedBy),
  uploadedAt: d.uploadedAt.toISOString(),
});

const summaryFields = (doc: EvaluationBatchDoc): EvaluationBatchSummaryDto => ({
  id: String(doc._id),
  code: doc.code,
  phaseId: String(doc.phaseId),
  phaseKey: doc.phaseKey,
  phaseName: doc.phaseName,
  branchId: doc.branchId === null ? null : String(doc.branchId),
  status: doc.status,
  title: doc.title,
  scheduledFor: doc.scheduledFor === null ? null : doc.scheduledFor.toISOString(),
  sentAt: doc.sentAt === null ? null : doc.sentAt.toISOString(),
  expectedReturnAt: doc.expectedReturnAt === null ? null : doc.expectedReturnAt.toISOString(),
  returnedAt: doc.returnedAt === null ? null : doc.returnedAt.toISOString(),
  counts: doc.counts,
  package: packageDto(doc.package),
  issuedAt: doc.issuedAt === null ? null : doc.issuedAt.toISOString(),
  issuedBy: doc.issuedBy === null ? null : String(doc.issuedBy),
  closedAt: doc.closedAt === null ? null : doc.closedAt.toISOString(),
  closedBy: doc.closedBy === null ? null : String(doc.closedBy),
  cancelledAt: doc.cancelledAt === null ? null : doc.cancelledAt.toISOString(),
  cancelledBy: doc.cancelledBy === null ? null : String(doc.cancelledBy),
  cancelledReason: doc.cancelledReason,
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

/** List rows never carry `items` — a batch may hold hundreds; counts drive the table. */
export const toEvaluationBatchSummaryDto = (doc: EvaluationBatchDoc): EvaluationBatchSummaryDto =>
  summaryFields(doc);

export const toEvaluationBatchDto = (doc: EvaluationBatchDoc): EvaluationBatchDto => ({
  ...summaryFields(doc),
  items: (doc.items ?? []).map(batchItemDto),
  returnedDocuments: (doc.returnedDocuments ?? []).map(documentDto),
});

export const toBatchCandidateDto = (
  applicant: ApplicantDoc,
  eligibleSince: Date | null,
): BatchCandidateDto => ({
  applicantId: String(applicant._id),
  applicantCode: applicant.code,
  applicantName: applicant.fullNameAr,
  branchId: applicant.branchId === null ? null : String(applicant.branchId),
  placement: placementDto(applicant.placement),
  placementLabel: placementLabelDto(applicant.placementLabel),
  eligibleSince: eligibleSince === null ? null : eligibleSince.toISOString(),
});
