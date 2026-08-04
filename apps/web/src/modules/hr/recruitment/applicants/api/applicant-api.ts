// Applicants feature api/ surface (ADR-013): every backend call in one place. Uses the shared
// api-client (typed REST + multipart + silent refresh); the hooks in applicant-queries.ts wrap
// these in TanStack Query.
//
// I6 — the WORKFLOW acts (register, verify, withdraw, restore, move, reassign, return-to-stage)
// answer with the whole envelope. The ordinary audited edit (`PATCH /:id`), the attachments, the
// OCR call and the export are not workflow acts and are unchanged.
import {
  type ReassignPlacement,
  type ApplicantDto,
  type ApplicantSourceDto,
  type BulkApplicants,
  type BulkWorkflowResultDto,
  type ConfirmApplicantIdentity,
  type DownloadTicketDto,
  type FileCategoryDto,
  type FileDto,
  type OcrExtractNationalId,
  type OcrExtractionDto,
  type Paginated,
  type RegisterApplicant,
  type MoveApplicantToOffer,
  type RestoreApplicant,
  type ReturnToStage,
  type ReturnToStagePreviewDto,
  type ReturnToStageResultDto,
  type StageRef,
  type UpdateApplicant,
  type WithdrawApplicant,
  type WorkflowEnvelopeDto,
} from '@ecms/contracts';
import {
  buildQuery,
  del,
  downloadBlob,
  get,
  getPage,
  patch,
  post,
  postWorkflow,
  upload,
  type QueryParams,
} from '../../../../../shared/lib/api-client';

export type ApplicantListParams = QueryParams;

type ApplicantEnvelope = Promise<WorkflowEnvelopeDto<ApplicantDto>>;

export const listApplicants = (params: ApplicantListParams): Promise<Paginated<ApplicantDto>> =>
  getPage<ApplicantDto>(`/hr/applicants${buildQuery(params)}`);

export const getApplicant = (id: string): Promise<ApplicantDto> => get<ApplicantDto>(`/hr/applicants/${id}`);

export const registerApplicant = (body: RegisterApplicant): ApplicantEnvelope =>
  postWorkflow<ApplicantDto>('/hr/applicants', body);

export const updateApplicant = (id: string, body: UpdateApplicant): Promise<ApplicantDto> =>
  patch<ApplicantDto>(`/hr/applicants/${id}`, body);

export const verifyApplicantIdentity = (id: string, body: ConfirmApplicantIdentity): ApplicantEnvelope =>
  postWorkflow<ApplicantDto>(`/hr/applicants/${id}/verify-identity`, body);

export const withdrawApplicant = (id: string, body: WithdrawApplicant): ApplicantEnvelope =>
  postWorkflow<ApplicantDto>(`/hr/applicants/${id}/withdraw`, body);

/** Explicit HR move to the Job Offer stage (offer eligibility is never automatic). */
export const moveApplicantToOffer = (id: string, body: MoveApplicantToOffer): ApplicantEnvelope =>
  postWorkflow<ApplicantDto>(`/hr/applicants/${id}/move-to-offer`, body);

export const restoreApplicant = (id: string, body: RestoreApplicant): ApplicantEnvelope =>
  postWorkflow<ApplicantDto>(`/hr/applicants/${id}/restore`, body);

/** RW2 — reassign Position and/or Branch (audited, reason mandatory). */
export const reassignApplicant = (id: string, body: ReassignPlacement): ApplicantEnvelope =>
  postWorkflow<ApplicantDto>(`/hr/applicants/${id}/reassign`, body);

export const bulkApplicants = (body: BulkApplicants): Promise<BulkWorkflowResultDto> =>
  post<BulkWorkflowResultDto>('/hr/applicants/bulk', body);

// ── Return to an earlier stage (RW13) ────────────────────────────────────────
// Two calls, deliberately: the preview answers "what would this do?" with the SAME resolution the
// act uses, so the confirmation dialog can never promise something different from what happens.

export const previewReturnToStage = (
  id: string,
  target: StageRef,
): Promise<ReturnToStagePreviewDto> =>
  get<ReturnToStagePreviewDto>(
    `/hr/applicants/${id}/return-to-stage/preview${buildQuery({
      kind: target.kind,
      refId: target.refId,
    })}`,
  );

/**
 * RW13 — the act itself. Its `data` is the PLAN (what it superseded, which attempt re-opened) with
 * the moved candidate inside it, so it is typed for what the server actually answers rather than
 * pretending to be an ordinary applicant response.
 */
export const returnApplicantToStage = (
  id: string,
  body: ReturnToStage,
): Promise<WorkflowEnvelopeDto<ReturnToStageResultDto>> =>
  postWorkflow<ReturnToStageResultDto>(`/hr/applicants/${id}/return-to-stage`, body);

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
