// HR's side of the candidate documents. The staff surface, not the portal's.
//
// Every call here names an applicant, which is exactly the difference from
// `applicant-portal-api.ts`: a reviewer works through other people's files by definition, and it
// is a permission that lets them, not a session that happens to be theirs.
import {
  type ApplicantFolderDetailDto,
  type ApplicantFolderDto,
  type BulkDeleteApplicantFolders,
  type DeleteApplicantFolder,
  type DeleteApplicantFoldersResultDto,
  type DeletedApplicantFolderDto,
  type DownloadTicketDto,
  type ApplicantDocumentSetDto,
  type Paginated,
  type ReviewApplicantDocument,
} from '@ecms/contracts';
import { buildQuery, del, get, getPage, post } from '../../../../../shared/lib/api-client';

const BASE = '/hr/applicant-documents';

export interface ApplicantDocumentSetParams {
  page: number;
  pageSize: number;
  pendingOnly?: boolean;
  search?: string;
  [key: string]: string | number | boolean | undefined;
}

export const fetchApplicantDocumentSets = (
  params: ApplicantDocumentSetParams,
): Promise<Paginated<ApplicantDocumentSetDto>> => getPage(`${BASE}${buildQuery(params)}`);

export const fetchApplicantDocumentSet = (applicantId: string): Promise<ApplicantDocumentSetDto> =>
  get(`${BASE}/${applicantId}`);

export const reviewApplicantDocument = (input: {
  applicantId: string;
  typeId: string;
  body: ReviewApplicantDocument;
}): Promise<ApplicantDocumentSetDto> =>
  post(`${BASE}/${input.applicantId}/documents/${input.typeId}/review`, input.body);

// ── Folders: everything kept for each applicant ─────────────────────────────

export interface ApplicantFolderParams {
  page: number;
  pageSize: number;
  search?: string;
  [key: string]: string | number | boolean | undefined;
}

export const fetchApplicantFolders = (
  params: ApplicantFolderParams,
): Promise<Paginated<ApplicantFolderDto>> => getPage(`${BASE}/folders${buildQuery(params)}`);

export const fetchApplicantFolder = (applicantId: string): Promise<ApplicantFolderDetailDto> =>
  get(`${BASE}/folders/${applicantId}`);

/**
 * Empty one applicant's folder. `applicantDocument.delete`, and refused outright for a candidate
 * who was hired or is being hired — the API decides, so a disabled button is a courtesy.
 */
export const deleteApplicantFolder = (
  applicantId: string,
  body: DeleteApplicantFolder,
): Promise<DeletedApplicantFolderDto> => del(`${BASE}/folders/${applicantId}`, body);

/** Empty several. Partial by contract: the answer says what went and what was kept. */
export const bulkDeleteApplicantFolders = (
  body: BulkDeleteApplicantFolders,
): Promise<DeleteApplicantFoldersResultDto> => post(`${BASE}/folders/bulk-delete`, body);

/** A short-lived signed URL for one file's bytes (the URL itself needs no session). */
export const fileTicket = (fileId: string): Promise<DownloadTicketDto> =>
  get<DownloadTicketDto>(`/platform/files/${fileId}/download?mode=ticket`);
