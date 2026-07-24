// Hiring Documents + document-type DTO mapping (Stage 6). `missingRequired` (the active
// required type keys not yet uploaded) is computed by the service against the live catalog
// and passed in, since it depends on more than the document alone.
import {
  type HiringDocumentsDto,
  type HiringDocumentTypeDto,
} from '@ecms/contracts';
import { type HiringDocumentsDoc } from './hiring-documents.model';
import { type HiringDocumentTypeDoc } from './hiring-document-type.model';

export const toHiringDocumentTypeDto = (doc: HiringDocumentTypeDoc): HiringDocumentTypeDto => ({
  id: String(doc._id),
  key: doc.key,
  name: doc.name,
  required: doc.required,
  active: doc.active,
  version: doc.__v,
});

/** Active required type keys that this set is still missing (empty ⇒ completable). */
export const computeMissingRequired = (doc: HiringDocumentsDoc, activeRequiredKeys: string[]): string[] => {
  const present = new Set(doc.documents.map((d) => d.typeKey));
  return activeRequiredKeys.filter((k) => !present.has(k));
};

export const toHiringDocumentsDto = (
  doc: HiringDocumentsDoc,
  missingRequired: string[],
): HiringDocumentsDto => ({
  id: String(doc._id),
  employeeId: String(doc.employeeId),
  employeeCode: doc.employeeCode,
  applicantId: doc.applicantId === null ? null : String(doc.applicantId),
  branchId: String(doc.branchId),
  status: doc.status,
  documents: doc.documents.map((d) => ({
    typeId: String(d.typeId),
    typeKey: d.typeKey,
    typeName: d.typeName,
    required: d.required,
    fileId: String(d.fileId),
    fileName: d.fileName,
    fileVersion: d.fileVersion,
    notes: d.notes,
    uploadedBy: d.uploadedBy === null ? null : String(d.uploadedBy),
    uploadedAt: d.uploadedAt.toISOString(),
  })),
  missingRequired,
  completedAt: doc.completedAt === null ? null : doc.completedAt.toISOString(),
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});
