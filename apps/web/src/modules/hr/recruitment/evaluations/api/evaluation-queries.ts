// TanStack Query hooks for the Evaluations feature (ADR-013). Reads cached by the shared key
// factory; writes apply the workflow envelope to the cache (I6) rather than refetching. The
// applicant picker reuses the Applicants list API; the phase catalog backs the phase picker.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CreateEvaluationPhase,
  type DecideEvaluation,
  type OpenEvaluation,
  type SetEvaluationAppointment,
  type SetPlacementRecommendation,
  type UpdateEvaluationPhase,
  type BulkEvaluations,
} from '@ecms/contracts';
import { detailKey, listKey } from '../../../../../shared/lib/query-keys';
import { useBulkMutation } from '../../../../../shared/lib/useBulkMutation';
import { applyBulkWorkflowResult, useWorkflowMutation } from '../../shared/useWorkflowMutation';
import * as api from './evaluation-api';
import { type EvaluationListParams } from './evaluation-api';

const MODULE = 'hr';
const FEATURE = 'evaluations';

export const useEvaluations = (params: EvaluationListParams) =>
  useQuery({
    queryKey: listKey(MODULE, FEATURE, params),
    queryFn: () => api.listEvaluations(params),
    placeholderData: (prev) => prev,
  });

export const useEvaluation = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, FEATURE, id),
    queryFn: () => api.getEvaluation(id),
    enabled: id !== '',
  });

/** Active evaluation-phase catalog (labels + sequential phase picker). */
export const useEvaluationPhases = () =>
  useQuery({
    queryKey: [MODULE, FEATURE, 'phases'],
    queryFn: () => api.listEvaluationPhases(),
    staleTime: 5 * 60_000,
    select: (page) => page.items,
  });

/** Full catalog (incl. disabled phases) — the settings screen. */
export const useAllEvaluationPhases = () =>
  useQuery({
    queryKey: [MODULE, FEATURE, 'phases', 'all'],
    queryFn: () => api.listAllEvaluationPhases(),
    select: (page) => page.items,
  });

const useInvalidatePhases = () => {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: [MODULE, FEATURE, 'phases'] });
};

export const useCreateEvaluationPhase = () => {
  const invalidate = useInvalidatePhases();
  return useMutation({
    mutationFn: (body: CreateEvaluationPhase) => api.createEvaluationPhase(body),
    onSuccess: invalidate,
  });
};

export const useUpdateEvaluationPhase = () => {
  const invalidate = useInvalidatePhases();
  return useMutation({
    mutationFn: (vars: { id: string; body: UpdateEvaluationPhase }) =>
      api.updateEvaluationPhase(vars.id, vars.body),
    onSuccess: invalidate,
  });
};

export const useOpenEvaluation = () =>
  useWorkflowMutation(FEATURE, (body: OpenEvaluation) => api.openEvaluation(body));

export const useDecideEvaluation = (id: string) =>
  useWorkflowMutation(FEATURE, (body: DecideEvaluation) => api.decideEvaluation(id, body));

/** RW9 — book (or clear) the visit on a phase that schedules one. */
export const useSetEvaluationAppointment = (id: string) =>
  useWorkflowMutation(FEATURE, (body: SetEvaluationAppointment) => api.setEvaluationAppointment(id, body));

/** RW5 — record (or clear) this phase's advisory placement recommendation. */
export const useSetEvaluationRecommendation = (id: string) =>
  useWorkflowMutation(FEATURE, (body: SetPlacementRecommendation) => api.setEvaluationRecommendation(id, body));

export const useUploadEvaluationFile = (id: string) =>
  useWorkflowMutation(FEATURE, (vars: { file: File; version: number; note?: string }) =>
    api.uploadEvaluationFile(id, vars.file, vars.version, vars.note),
  );

export const useRemoveEvaluationFile = (id: string) =>
  useWorkflowMutation(FEATURE, (vars: { fileId: string; version: number }) =>
    api.removeEvaluationFile(id, vars.fileId, vars.version),
  );

/** Bulk approve/reject one phase's queue (RW10/RW17). */
export const useBulkEvaluations = (onApplied?: () => void) =>
  useBulkMutation<BulkEvaluations>((body) => api.bulkEvaluations(body), {
    applyResult: (qc, result) => applyBulkWorkflowResult(qc, FEATURE, result),
    ...(onApplied === undefined ? {} : { onApplied }),
  });
