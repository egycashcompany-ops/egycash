// Evaluations feature api/ surface (ADR-013). Every backend call in one place, through the shared
// api-client (typed REST + silent refresh + multipart upload); the hooks in evaluation-queries.ts
// wrap these in TanStack Query with keys + invalidation. Endpoints match the backend contract
// exactly (/hr/evaluations, /hr/evaluation-phases). The applicant picker reuses the Applicants list.
import {
  type CreateEvaluationPhase,
  type DecideEvaluation,
  type EvaluationDto,
  type EvaluationPhaseDto,
  type OpenEvaluation,
  type SetEvaluationAppointment,
  type SetPlacementRecommendation,
  type Paginated,
  type UpdateEvaluationPhase,
  type WorkflowEnvelopeDto,
  type BulkEvaluations,
  type BulkWorkflowResultDto,
} from '@ecms/contracts';
import {
  buildQuery,
  delWorkflow,
  get,
  getPage,
  patch,
  patchWorkflow,
  post,
  postWorkflow,
  uploadWorkflow,
} from '../../../../../shared/lib/api-client';

export type EvaluationListParams = Record<string, string | number | boolean | undefined | null>;

type EvaluationEnvelope = Promise<WorkflowEnvelopeDto<EvaluationDto>>;

export const listEvaluations = (params: EvaluationListParams): Promise<Paginated<EvaluationDto>> =>
  getPage<EvaluationDto>(`/hr/evaluations${buildQuery(params)}`);

export const getEvaluation = (id: string): Promise<EvaluationDto> =>
  get<EvaluationDto>(`/hr/evaluations/${id}`);

export const openEvaluation = (body: OpenEvaluation): EvaluationEnvelope =>
  postWorkflow<EvaluationDto>('/hr/evaluations', body);

/** Decide (approve/reject) — re-settable: calling again edits the decision (audited). */
export const decideEvaluation = (id: string, body: DecideEvaluation): EvaluationEnvelope =>
  patchWorkflow<EvaluationDto>(`/hr/evaluations/${id}/decision`, body);

/** RW9 — book (or clear) the visit on an individual phase that schedules one. */
/** RW5 — the phase's advisory placement recommendation; never moves the candidate by itself. */
export const setEvaluationRecommendation = (
  id: string,
  body: SetPlacementRecommendation,
): EvaluationEnvelope => patchWorkflow<EvaluationDto>(`/hr/evaluations/${id}/recommendation`, body);

export const setEvaluationAppointment = (
  id: string,
  body: SetEvaluationAppointment,
): EvaluationEnvelope => patchWorkflow<EvaluationDto>(`/hr/evaluations/${id}/appointment`, body);

export const uploadEvaluationFile = (
  id: string,
  file: File,
  version: number,
  note?: string,
): EvaluationEnvelope => {
  const form = new FormData();
  form.append('file', file);
  form.append('version', String(version));
  if (note !== undefined && note.trim() !== '') form.append('note', note.trim());
  return uploadWorkflow<EvaluationDto>(`/hr/evaluations/${id}/files`, form);
};

export const removeEvaluationFile = (
  id: string,
  fileId: string,
  version: number,
): EvaluationEnvelope => delWorkflow<EvaluationDto>(`/hr/evaluations/${id}/files/${fileId}`, { version });

// Evaluation-phase catalog (labels + backs the phase picker; sequential order). The settings
// screen manages it (create / edit / reorder / enable-disable) — extensible without code changes.
export const listEvaluationPhases = (): Promise<Paginated<EvaluationPhaseDto>> =>
  getPage<EvaluationPhaseDto>(`/hr/evaluation-phases${buildQuery({ active: true, pageSize: 100 })}`);

export const listAllEvaluationPhases = (): Promise<Paginated<EvaluationPhaseDto>> =>
  getPage<EvaluationPhaseDto>(`/hr/evaluation-phases${buildQuery({ pageSize: 100 })}`);

export const createEvaluationPhase = (body: CreateEvaluationPhase): Promise<EvaluationPhaseDto> =>
  post<EvaluationPhaseDto>('/hr/evaluation-phases', body);

export const updateEvaluationPhase = (id: string, body: UpdateEvaluationPhase): Promise<EvaluationPhaseDto> =>
  patch<EvaluationPhaseDto>(`/hr/evaluation-phases/${id}`, body);

/** Bulk approve/reject one phase's queue (RW10/RW17) — answers a partial-success envelope. */
export const bulkEvaluations = (body: BulkEvaluations): Promise<BulkWorkflowResultDto> =>
  post<BulkWorkflowResultDto>('/hr/evaluations/bulk', body);
