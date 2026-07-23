// TanStack Query hooks for the Evaluations feature (ADR-013). Reads cached by the shared key
// factory; writes invalidate the feature subtree on success. The applicant picker reuses the
// Applicants list API; the phase catalog backs the sequential phase picker + labels.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type DecideEvaluation, type OpenEvaluation } from '@ecms/contracts';
import { detailKey, listKey } from '../../../../../shared/lib/query-keys';
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

const useInvalidate = () => {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: [MODULE, FEATURE] });
    if (id !== undefined) void qc.invalidateQueries({ queryKey: detailKey(MODULE, FEATURE, id) });
  };
};

export const useOpenEvaluation = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: OpenEvaluation) => api.openEvaluation(body),
    onSuccess: (doc) => invalidate(doc.id),
  });
};

export const useDecideEvaluation = (id: string) => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: DecideEvaluation) => api.decideEvaluation(id, body),
    onSuccess: () => invalidate(id),
  });
};

export const useUploadEvaluationFile = (id: string) => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (vars: { file: File; version: number; note?: string }) =>
      api.uploadEvaluationFile(id, vars.file, vars.version, vars.note),
    onSuccess: () => invalidate(id),
  });
};

export const useRemoveEvaluationFile = (id: string) => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (vars: { fileId: string; version: number }) =>
      api.removeEvaluationFile(id, vars.fileId, vars.version),
    onSuccess: () => invalidate(id),
  });
};
