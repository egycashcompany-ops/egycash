// TanStack Query hooks for the Evaluation Batches feature (ADR-013). Reads cached by the shared
// key factory; writes invalidate the batch subtree AND the wider recruitment tree, since deciding
// a batch item also moves the applicant's evaluation record and every stage counter with it.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AddBatchItems,
  type BulkBatchItems,
  type BulkEvaluationBatches,
  type CancelEvaluationBatch,
  type CloseEvaluationBatch,
  type CreateEvaluationBatch,
  type DecideBatchItem,
  type IssueEvaluationBatch,
  type UpdateEvaluationBatch,
  type VoidBatchItem,
} from '@ecms/contracts';
import { detailKey, listKey } from '../../../../../shared/lib/query-keys';
import { useBulkMutation } from '../../../../../shared/lib/useBulkMutation';
import { invalidateRecruitment } from '../../shared/invalidate-recruitment';
import * as api from './evaluation-batch-api';
import { type BatchListParams } from './evaluation-batch-api';

const MODULE = 'hr';
const FEATURE = 'evaluationBatches';

export const useEvaluationBatches = (params: BatchListParams) =>
  useQuery({
    queryKey: listKey(MODULE, FEATURE, params),
    queryFn: () => api.listEvaluationBatches(params),
    placeholderData: (prev) => prev,
  });

export const useEvaluationBatch = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, FEATURE, id),
    queryFn: () => api.getEvaluationBatch(id),
    enabled: id !== '',
  });

/** The selection pool for a new batch — only fetched while the picker is open. */
export const useBatchCandidates = (phaseId: string, enabled: boolean) =>
  useQuery({
    queryKey: [MODULE, FEATURE, 'candidates', phaseId],
    queryFn: () => api.listBatchCandidates(phaseId),
    enabled: enabled && phaseId !== '',
  });

const useInvalidate = () => {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: [MODULE, FEATURE] });
    if (id !== undefined) void qc.invalidateQueries({ queryKey: detailKey(MODULE, FEATURE, id) });
    // A batch decision IS an evaluation decision (I1), so the stage queues and badges move too.
    invalidateRecruitment(qc);
  };
};

export const useCreateEvaluationBatch = () => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CreateEvaluationBatch) => api.createEvaluationBatch(body),
    onSuccess: (doc) => invalidate(doc.id),
  });
};

export const useUpdateEvaluationBatch = (id: string) => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: UpdateEvaluationBatch) => api.updateEvaluationBatch(id, body),
    onSuccess: () => invalidate(id),
  });
};

export const useAddBatchItems = (id: string) => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: AddBatchItems) => api.addBatchItems(id, body),
    onSuccess: () => invalidate(id),
  });
};

export const useRemoveBatchItem = (id: string) => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (vars: { applicantId: string; version: number }) =>
      api.removeBatchItem(id, vars.applicantId, vars.version),
    onSuccess: () => invalidate(id),
  });
};

export const useIssueEvaluationBatch = (id: string) => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: IssueEvaluationBatch) => api.issueEvaluationBatch(id, body),
    onSuccess: () => invalidate(id),
  });
};

export const useRetryBatchPackage = (id: string) => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => api.retryBatchPackage(id),
    onSuccess: () => invalidate(id),
  });
};

export const useUploadBatchResult = (id: string) => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (vars: { file: File; version: number; note?: string; applicantId?: string }) =>
      api.uploadBatchResult(id, vars.file, vars.version, {
        ...(vars.note === undefined ? {} : { note: vars.note }),
        ...(vars.applicantId === undefined ? {} : { applicantId: vars.applicantId }),
      }),
    onSuccess: () => invalidate(id),
  });
};

export const useDecideBatchItem = (id: string) => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (vars: { applicantId: string; body: DecideBatchItem }) =>
      api.decideBatchItem(id, vars.applicantId, vars.body),
    onSuccess: () => invalidate(id),
  });
};

export const useVoidBatchItem = (id: string) => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (vars: { applicantId: string; body: VoidBatchItem }) =>
      api.voidBatchItem(id, vars.applicantId, vars.body),
    onSuccess: () => invalidate(id),
  });
};

export const useCloseEvaluationBatch = (id: string) => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CloseEvaluationBatch) => api.closeEvaluationBatch(id, body),
    onSuccess: () => invalidate(id),
  });
};

export const useCancelEvaluationBatch = (id: string) => {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CancelEvaluationBatch) => api.cancelEvaluationBatch(id, body),
    onSuccess: () => invalidate(id),
  });
};

/** Bulk decide/void items inside one batch (RW10/RW17) — partial-success envelope. */
export const useBulkBatchItems = (id: string, onApplied?: () => void) =>
  useBulkMutation<BulkBatchItems>((body) => api.bulkBatchItems(id, body), {
    invalidate: invalidateRecruitment,
    ...(onApplied === undefined ? {} : { onApplied }),
  });

/** Bulk close/cancel over batches themselves (list-level actions). */
export const useBulkEvaluationBatches = (onApplied?: () => void) =>
  useBulkMutation<BulkEvaluationBatches>((body) => api.bulkEvaluationBatches(body), {
    invalidate: invalidateRecruitment,
    ...(onApplied === undefined ? {} : { onApplied }),
  });
