// TanStack Query hooks for the Evaluation Batches feature (ADR-013). Reads cached by the shared
// key factory.
//
// I6 — the two acts that name ONE candidate (decide an item, void an item) answer with the workflow
// envelope, so they refresh the cache from the response. The batch-LEVEL acts span every candidate
// in the batch and have no single workflow state to report, so they seed the batch they return and
// mark the affected lists stale without asking for anything.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AddBatchItems,
  type BulkBatchItems,
  type BulkEvaluationBatches,
  type CancelEvaluationBatch,
  type CloseEvaluationBatch,
  type CreateEvaluationBatch,
  type DecideBatchItem,
  type EvaluationBatchDto,
  type IssueEvaluationBatch,
  type UpdateEvaluationBatch,
  type VoidBatchItem,
} from '@ecms/contracts';
import { detailKey, listKey } from '../../../../../shared/lib/query-keys';
import { useBulkMutation } from '../../../../../shared/lib/useBulkMutation';
import { applyBulkWorkflowResult, applyWorkflowEnvelope } from '../../shared/useWorkflowMutation';
import { markAllRecruitmentListsStale } from '../../shared/workflow-cache';
import * as api from './evaluation-batch-api';
import { type BatchListParams } from './evaluation-batch-api';

const MODULE = 'hr';
const FEATURE = 'evaluationBatches';

/**
 * `enabled` is how a phase-scoped list avoids asking the wrong question while it waits.
 *
 * The phase-scoped screen knows a phase KEY and needs the id the API filters by, which only the
 * catalog can supply. Firing the query before that resolves would ask for EVERY phase's batches —
 * briefly showing exactly the mixed list the scoping exists to prevent.
 */
export const useEvaluationBatches = (params: BatchListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, FEATURE, params),
    queryFn: () => api.listEvaluationBatches(params),
    placeholderData: (prev) => prev,
    enabled,
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

/**
 * A batch-LEVEL act returns the batch itself: seed its detail cache, and mark the batch lists stale
 * so membership is re-read when they are next looked at. No request is issued here.
 */
const useSeedBatch = () => {
  const qc = useQueryClient();
  return (batch: EvaluationBatchDto) => {
    qc.setQueryData(detailKey(MODULE, FEATURE, batch.id), batch);
    void qc.invalidateQueries({ queryKey: listKey(MODULE, FEATURE), refetchType: 'none' });
    void qc.invalidateQueries({ queryKey: [MODULE, FEATURE, 'candidates'], refetchType: 'none' });
  };
};

export const useCreateEvaluationBatch = () => {
  const seed = useSeedBatch();
  return useMutation({
    mutationFn: (body: CreateEvaluationBatch) => api.createEvaluationBatch(body),
    onSuccess: seed,
  });
};

export const useUpdateEvaluationBatch = (id: string) => {
  const seed = useSeedBatch();
  return useMutation({ mutationFn: (body: UpdateEvaluationBatch) => api.updateEvaluationBatch(id, body), onSuccess: seed });
};

export const useAddBatchItems = (id: string) => {
  const seed = useSeedBatch();
  return useMutation({ mutationFn: (body: AddBatchItems) => api.addBatchItems(id, body), onSuccess: seed });
};

export const useRemoveBatchItem = (id: string) => {
  const seed = useSeedBatch();
  return useMutation({
    mutationFn: (vars: { applicantId: string; version: number }) =>
      api.removeBatchItem(id, vars.applicantId, vars.version),
    onSuccess: seed,
  });
};

export const useIssueEvaluationBatch = (id: string) => {
  const seed = useSeedBatch();
  return useMutation({ mutationFn: (body: IssueEvaluationBatch) => api.issueEvaluationBatch(id, body), onSuccess: seed });
};

export const useRetryBatchPackage = (id: string) => {
  const seed = useSeedBatch();
  return useMutation({ mutationFn: () => api.retryBatchPackage(id), onSuccess: seed });
};

export const useUploadBatchResult = (id: string) => {
  const seed = useSeedBatch();
  return useMutation({
    mutationFn: (vars: { file: File; version: number; note?: string; applicantId?: string }) =>
      api.uploadBatchResult(id, vars.file, vars.version, {
        ...(vars.note === undefined ? {} : { note: vars.note }),
        ...(vars.applicantId === undefined ? {} : { applicantId: vars.applicantId }),
      }),
    onSuccess: seed,
  });
};

/**
 * Deciding an item IS an evaluation decision (I1): it names one candidate, so it answers with the
 * full envelope — which refreshes the batch, the candidate's history and every stage badge. The
 * candidate's own evaluation ROW lives in another feature's lists, so those are marked stale
 * (no request) rather than left showing a decision that has already been made.
 */
export const useDecideBatchItem = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { applicantId: string; body: DecideBatchItem }) => {
      const envelope = await api.decideBatchItem(id, vars.applicantId, vars.body);
      applyWorkflowEnvelope(qc, FEATURE, envelope);
      markAllRecruitmentListsStale(qc);
      return envelope.data;
    },
  });
};

/** Voiding an item names one candidate too, so it carries the same envelope. */
export const useVoidBatchItem = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { applicantId: string; body: VoidBatchItem }) => {
      const envelope = await api.voidBatchItem(id, vars.applicantId, vars.body);
      applyWorkflowEnvelope(qc, FEATURE, envelope);
      markAllRecruitmentListsStale(qc);
      return envelope.data;
    },
  });
};

export const useCloseEvaluationBatch = (id: string) => {
  const seed = useSeedBatch();
  return useMutation({ mutationFn: (body: CloseEvaluationBatch) => api.closeEvaluationBatch(id, body), onSuccess: seed });
};

export const useCancelEvaluationBatch = (id: string) => {
  const seed = useSeedBatch();
  return useMutation({ mutationFn: (body: CancelEvaluationBatch) => api.cancelEvaluationBatch(id, body), onSuccess: seed });
};

/** Bulk decide/void items inside one batch (RW10/RW17) — partial-success envelope. */
export const useBulkBatchItems = (id: string, onApplied?: () => void) =>
  useBulkMutation<BulkBatchItems>((body) => api.bulkBatchItems(id, body), {
    applyResult: (qc, result) => {
      applyBulkWorkflowResult(qc, 'evaluations', result);
      void qc.invalidateQueries({ queryKey: detailKey(MODULE, FEATURE, id) });
    },
    ...(onApplied === undefined ? {} : { onApplied }),
  });

/** Bulk close/cancel over batches themselves (list-level actions). */
export const useBulkEvaluationBatches = (onApplied?: () => void) =>
  useBulkMutation<BulkEvaluationBatches>((body) => api.bulkEvaluationBatches(body), {
    applyResult: (qc, result) => applyBulkWorkflowResult(qc, FEATURE, result),
    ...(onApplied === undefined ? {} : { onApplied }),
  });
