// Evaluation-batches feature api/ surface (ADR-013). Every backend call in one place, through the
// shared api-client; the hooks in evaluation-batch-queries.ts wrap these in TanStack Query.
// Endpoints match the backend contract exactly (/hr/evaluation-batches).
import {
  type AddBatchItems,
  type BatchCandidateDto,
  type BulkActionResultDto,
  type BulkBatchItems,
  type BulkEvaluationBatches,
  type CancelEvaluationBatch,
  type CloseEvaluationBatch,
  type CreateEvaluationBatch,
  type DecideBatchItem,
  type EvaluationBatchDto,
  type EvaluationBatchSummaryDto,
  type IssueEvaluationBatch,
  type Paginated,
  type UpdateEvaluationBatch,
  type VoidBatchItem,
} from '@ecms/contracts';
import { api, buildQuery, get, getPage, patch, post, upload } from '../../../../../shared/lib/api-client';

export type BatchListParams = Record<string, string | number | boolean | undefined | null>;

export const listEvaluationBatches = (
  params: BatchListParams,
): Promise<Paginated<EvaluationBatchSummaryDto>> =>
  getPage<EvaluationBatchSummaryDto>(`/hr/evaluation-batches${buildQuery(params)}`);

export const getEvaluationBatch = (id: string): Promise<EvaluationBatchDto> =>
  get<EvaluationBatchDto>(`/hr/evaluation-batches/${id}`);

/** The selection pool for "Generate batch" — applicants waiting at the phase, not already batched. */
export const listBatchCandidates = (
  phaseId: string,
  branchId?: string,
): Promise<BatchCandidateDto[]> =>
  get<BatchCandidateDto[]>(
    `/hr/evaluation-batches/candidates${buildQuery({ phaseId, branchId, limit: 500 })}`,
  );

export const createEvaluationBatch = (body: CreateEvaluationBatch): Promise<EvaluationBatchDto> =>
  post<EvaluationBatchDto>('/hr/evaluation-batches', body);

export const updateEvaluationBatch = (
  id: string,
  body: UpdateEvaluationBatch,
): Promise<EvaluationBatchDto> => patch<EvaluationBatchDto>(`/hr/evaluation-batches/${id}`, body);

export const addBatchItems = (id: string, body: AddBatchItems): Promise<EvaluationBatchDto> =>
  post<EvaluationBatchDto>(`/hr/evaluation-batches/${id}/items`, body);

export const removeBatchItem = (
  id: string,
  applicantId: string,
  version: number,
): Promise<EvaluationBatchDto> =>
  api<EvaluationBatchDto>(`/hr/evaluation-batches/${id}/items/${applicantId}`, {
    method: 'DELETE',
    body: JSON.stringify({ version }),
  });

export const issueEvaluationBatch = (
  id: string,
  body: IssueEvaluationBatch,
): Promise<EvaluationBatchDto> => post<EvaluationBatchDto>(`/hr/evaluation-batches/${id}/issue`, body);

/** Re-request the package build after a failure (RW8b — retryable from the UI). */
export const retryBatchPackage = (id: string): Promise<EvaluationBatchDto> =>
  post<EvaluationBatchDto>(`/hr/evaluation-batches/${id}/package/retry`, {});

export const uploadBatchResult = (
  id: string,
  file: File,
  version: number,
  opts: { note?: string; applicantId?: string } = {},
): Promise<EvaluationBatchDto> => {
  const form = new FormData();
  form.append('file', file);
  form.append('version', String(version));
  if (opts.note !== undefined && opts.note.trim() !== '') form.append('note', opts.note.trim());
  if (opts.applicantId !== undefined) form.append('applicantId', opts.applicantId);
  return upload<EvaluationBatchDto>(`/hr/evaluation-batches/${id}/results`, form);
};

export const decideBatchItem = (
  id: string,
  applicantId: string,
  body: DecideBatchItem,
): Promise<EvaluationBatchDto> =>
  patch<EvaluationBatchDto>(`/hr/evaluation-batches/${id}/items/${applicantId}/decision`, body);

export const voidBatchItem = (
  id: string,
  applicantId: string,
  body: VoidBatchItem,
): Promise<EvaluationBatchDto> =>
  post<EvaluationBatchDto>(`/hr/evaluation-batches/${id}/items/${applicantId}/void`, body);

export const bulkBatchItems = (id: string, body: BulkBatchItems): Promise<BulkActionResultDto> =>
  post<BulkActionResultDto>(`/hr/evaluation-batches/${id}/items/bulk`, body);

export const closeEvaluationBatch = (
  id: string,
  body: CloseEvaluationBatch,
): Promise<EvaluationBatchDto> => post<EvaluationBatchDto>(`/hr/evaluation-batches/${id}/close`, body);

export const cancelEvaluationBatch = (
  id: string,
  body: CancelEvaluationBatch,
): Promise<EvaluationBatchDto> => post<EvaluationBatchDto>(`/hr/evaluation-batches/${id}/cancel`, body);

export const bulkEvaluationBatches = (body: BulkEvaluationBatches): Promise<BulkActionResultDto> =>
  post<BulkActionResultDto>('/hr/evaluation-batches/bulk', body);
