// Documents as the API answers them (design §3). Pure, so the shapes are tested without a database.
import {
  type ComplianceDocumentDto,
  type ComplianceFolderDto,
  type CompliancePersonDto,
  type ComplianceSeenSummaryDto,
} from '@ecms/contracts';
import { type ComplianceDocumentDoc } from './documents/document.model';
import { type ComplianceFolderDoc } from './folders/folder.model';

/**
 * A folder for one caller. The list of who sees it goes to the responsible person only — a reader
 * is told the folder is theirs, never who else has it — and a person whose account is gone is left
 * out rather than shown as an id.
 */
export const toComplianceFolderDto = (
  doc: ComplianceFolderDoc,
  documentCount: number,
  people: ReadonlyMap<string, CompliancePersonDto> | null,
): ComplianceFolderDto => ({
  id: String(doc._id),
  name: doc.name,
  hasCover: doc.cover !== null,
  coverVersion: doc.cover === null ? null : String(doc.cover.fileId),
  documentCount,
  viewers:
    people === null
      ? []
      : doc.viewerUserIds
          .map((id) => people.get(String(id)))
          .filter((person): person is CompliancePersonDto => person !== undefined),
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
  version: doc.__v,
});

export const toComplianceDocumentDto = (
  doc: ComplianceDocumentDoc,
  seen: ComplianceSeenSummaryDto | null,
): ComplianceDocumentDto => ({
  id: String(doc._id),
  folderId: String(doc.folderId),
  name: doc.name,
  fileName: doc.fileName,
  kind: doc.kind,
  mime: doc.mime,
  size: doc.size,
  uploadedAt: doc.uploadedAt.toISOString(),
  seen,
  version: doc.__v,
});
