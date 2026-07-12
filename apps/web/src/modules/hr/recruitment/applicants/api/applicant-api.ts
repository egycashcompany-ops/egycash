// Applicants feature api/ surface (ADR-013): every backend call in one place. Uses the shared
// api-client (typed REST + multipart + silent refresh); the hooks in applicant-queries.ts wrap
// these in TanStack Query with keys + invalidation.
import {
  type ApplicantDto,
  type ApplicantSourceDto,
  type BulkApplicants,
  type BulkApplicantsResultDto,
  type ConfirmApplicantIdentity,
  type DownloadTicketDto,
  type FileCategoryDto,
  type FileDto,
  type OcrExtractNationalId,
  type OcrExtractionDto,
  type Paginated,
  type RegisterApplicant,
  type UpdateApplicant,
  type WithdrawApplicant,
} from '@ecms/contracts';
import { buildQuery, del, downloadBlob, get, getPage, patch, post, upload } from '../../../../../shared/lib/api-client';

export type ApplicantListParams = Record<string, string | number | boolean | undefined | null>;

export const listApplicants = (params: ApplicantListParams): Promise<Paginated<ApplicantDto>> =>
  getPage<ApplicantDto>(`/hr/applicants${buildQuery(params)}`);

export const getApplicant = (id: string): Promise<ApplicantDto> => get<ApplicantDto>(`/hr/applicants/${id}`);

export const registerApplicant = (body: RegisterApplicant): Promise<ApplicantDto> =>
  post<ApplicantDto>('/hr/applicants', body);

export const updateApplicant = (id: string, body: UpdateApplicant): Promise<ApplicantDto> =>
  patch<ApplicantDto>(`/hr/applicants/${id}`, body);

export const verifyApplicantIdentity = (id: string, body: ConfirmApplicantIdentity): Promise<ApplicantDto> =>
  post<ApplicantDto>(`/hr/applicants/${id}/verify-identity`, body);

export const withdrawApplicant = (id: string, body: WithdrawApplicant): Promise<ApplicantDto> =>
  post<ApplicantDto>(`/hr/applicants/${id}/withdraw`, body);

export const bulkApplicants = (body: BulkApplicants): Promise<BulkApplicantsResultDto> =>
  post<BulkApplicantsResultDto>('/hr/applicants/bulk', body);

export const ocrExtractNationalId = (body: OcrExtractNationalId): Promise<OcrExtractionDto> =>
  post<OcrExtractionDto>('/hr/applicants/ocr/national-id', body);

// Attachments (bytes via the applicant endpoints, which wire the Files service server-side).
export const listApplicantAttachments = (id: string): Promise<FileDto[]> =>
  get<FileDto[]>(`/hr/applicants/${id}/attachments`);

export const addApplicantAttachment = (id: string, form: FormData): Promise<FileDto> =>
  upload<FileDto>(`/hr/applicants/${id}/attachments`, form);

export const removeApplicantAttachment = (id: string, fileId: string): Promise<void> =>
  del<void>(`/hr/applicants/${id}/attachments/${fileId}`);

/** Short-lived signed download URL for an attachment (the URL itself is public). */
export const fileDownloadTicket = (fileId: string): Promise<DownloadTicketDto> =>
  get<DownloadTicketDto>(`/platform/files/${fileId}/download?mode=ticket`);

// Reference data.
export const listApplicantSources = (): Promise<Paginated<ApplicantSourceDto>> =>
  getPage<ApplicantSourceDto>(`/hr/applicant-sources${buildQuery({ active: true, pageSize: 100 })}`);

export const listFileCategories = (): Promise<Paginated<FileCategoryDto>> =>
  getPage<FileCategoryDto>(`/platform/file-categories${buildQuery({ pageSize: 100 })}`);

/** Upload a raw file to the platform Files service (used by the OCR flow to obtain a fileId). */
export const uploadPlatformFile = (form: FormData): Promise<FileDto> => upload<FileDto>('/platform/files', form);

/** Export the current filtered set as CSV (paging/search are ignored server-side). */
export const exportApplicantsCsv = (params: ApplicantListParams): Promise<void> =>
  downloadBlob(
    `/hr/applicants/export${buildQuery(params)}`,
    `applicants-${new Date().toISOString().slice(0, 10)}.csv`,
  );
