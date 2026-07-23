// Evaluations feature api/ surface (ADR-013). Every backend call in one place, through the shared
// api-client (typed REST + silent refresh + multipart upload); the hooks in evaluation-queries.ts
// wrap these in TanStack Query with keys + invalidation. Endpoints match the backend contract
// exactly (/hr/evaluations, /hr/evaluation-phases). The applicant picker reuses the Applicants list.
import {
  type DecideEvaluation,
  type EvaluationDto,
  type EvaluationPhaseDto,
  type OpenEvaluation,
  type Paginated,
} from '@ecms/contracts';
import { api, buildQuery, get, getPage, patch, post, upload } from '../../../../../shared/lib/api-client';

export type EvaluationListParams = Record<string, string | number | boolean | undefined | null>;

export const listEvaluations = (params: EvaluationListParams): Promise<Paginated<EvaluationDto>> =>
  getPage<EvaluationDto>(`/hr/evaluations${buildQuery(params)}`);

export const getEvaluation = (id: string): Promise<EvaluationDto> =>
  get<EvaluationDto>(`/hr/evaluations/${id}`);

export const openEvaluation = (body: OpenEvaluation): Promise<EvaluationDto> =>
  post<EvaluationDto>('/hr/evaluations', body);

/** Decide (approve/reject) — re-settable: calling again edits the decision (audited). */
export const decideEvaluation = (id: string, body: DecideEvaluation): Promise<EvaluationDto> =>
  patch<EvaluationDto>(`/hr/evaluations/${id}/decision`, body);

export const uploadEvaluationFile = (
  id: string,
  file: File,
  version: number,
  note?: string,
): Promise<EvaluationDto> => {
  const form = new FormData();
  form.append('file', file);
  form.append('version', String(version));
  if (note !== undefined && note.trim() !== '') form.append('note', note.trim());
  return upload<EvaluationDto>(`/hr/evaluations/${id}/files`, form);
};

export const removeEvaluationFile = (id: string, fileId: string, version: number): Promise<EvaluationDto> =>
  api<EvaluationDto>(`/hr/evaluations/${id}/files/${fileId}`, {
    method: 'DELETE',
    body: JSON.stringify({ version }),
  });

// Active evaluation-phase catalog (labels + backs the phase picker; sequential order).
export const listEvaluationPhases = (): Promise<Paginated<EvaluationPhaseDto>> =>
  getPage<EvaluationPhaseDto>(`/hr/evaluation-phases${buildQuery({ active: true, pageSize: 100 })}`);
