// TanStack Query hooks for the Applicants feature (ADR-013). Reads are cached by the shared key
// factory; workflow writes apply the response envelope to the cache (I6) rather than invalidating
// and refetching. Failures surface via the global Query/Mutation error handler; components add
// success toasts.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ReassignPlacement,
  type ApplicantSourceDto,
  type BulkApplicants,
  type ConfirmApplicantIdentity,
  type FileCategoryDto,
  type FileDto,
  type OcrExtractNationalId,
  type RegisterApplicant,
  type MoveApplicantToOffer,
  type RestoreApplicant,
  type ReturnToStage,
  type StageRef,
  type UpdateApplicant,
  type WithdrawApplicant,
} from '@ecms/contracts';
import { detailKey, listKey } from '../../../../../shared/lib/query-keys';
import {
  applyBulkWorkflowResult,
  applyWorkflowEnvelope,
  useWorkflowMutation,
} from '../../shared/useWorkflowMutation';
import { markAllRecruitmentListsStale } from '../../shared/workflow-cache';
import { useBulkMutation } from '../../../../../shared/lib/useBulkMutation';
import * as api from './applicant-api';
import { type ApplicantListParams } from './applicant-api';

const MODULE = 'hr';
const FEATURE = 'applicants';

export const useApplicants = (params: ApplicantListParams) =>
  useQuery({
    queryKey: listKey(MODULE, FEATURE, params),
    queryFn: () => api.listApplicants(params),
    placeholderData: (prev) => prev,
  });

export const useApplicant = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, FEATURE, id),
    queryFn: () => api.getApplicant(id),
    enabled: id !== '',
  });

export const useApplicantSources = () =>
  useQuery({
    queryKey: [MODULE, 'applicantSources', 'list'],
    queryFn: () => api.listApplicantSources(),
    staleTime: 5 * 60_000,
    select: (page): ApplicantSourceDto[] => page.items,
  });

export const useFileCategories = () =>
  useQuery({
    queryKey: ['platform', 'fileCategories', 'list'],
    queryFn: () => api.listFileCategories(),
    staleTime: 5 * 60_000,
    select: (page): FileCategoryDto[] => page.items,
  });

export const useApplicantAttachments = (id: string) =>
  useQuery({
    queryKey: [...detailKey(MODULE, FEATURE, id), 'attachments'],
    queryFn: () => api.listApplicantAttachments(id),
    enabled: id !== '',
  });

// ── Workflow acts (I6 — the envelope refreshes the cache; nothing is refetched) ───────────────

export const useRegisterApplicant = () =>
  useWorkflowMutation(FEATURE, (body: RegisterApplicant) => api.registerApplicant(body));

export const useVerifyApplicantIdentity = (id: string) =>
  useWorkflowMutation(FEATURE, (body: ConfirmApplicantIdentity) => api.verifyApplicantIdentity(id, body));

export const useWithdrawApplicant = (id: string) =>
  useWorkflowMutation(FEATURE, (body: WithdrawApplicant) => api.withdrawApplicant(id, body));

export const useMoveApplicantToOffer = (id: string) =>
  useWorkflowMutation(FEATURE, (body: MoveApplicantToOffer) => api.moveApplicantToOffer(id, body));

export const useRestoreApplicant = (id: string) =>
  useWorkflowMutation(FEATURE, (body: RestoreApplicant) => api.restoreApplicant(id, body));

/** RW2 — reassignment moves the candidate; the envelope carries where they landed. */
export const useReassignApplicant = (id: string) =>
  useWorkflowMutation(FEATURE, (body: ReassignPlacement) => api.reassignApplicant(id, body));

/**
 * An ordinary audited edit, not a workflow act (I4): it answers with the applicant alone, so it
 * seeds the detail cache and marks the lists stale without asking for anything.
 */
export const useUpdateApplicant = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateApplicant) => api.updateApplicant(id, body),
    onSuccess: (updated) => {
      qc.setQueryData(detailKey(MODULE, FEATURE, updated.id), updated);
      void qc.invalidateQueries({ queryKey: listKey(MODULE, FEATURE), refetchType: 'none' });
    },
  });
};

/**
 * RW13 — what returning this candidate to `target` WOULD do. Enabled only while the dialog holds a
 * target, and never cached: the answer depends on live records the user is about to change.
 */
export const useReturnToStagePreview = (id: string, target: StageRef | null) =>
  useQuery({
    queryKey: [MODULE, FEATURE, id, 'returnPreview', target?.kind ?? null, target?.refId ?? null],
    queryFn: () => api.previewReturnToStage(id, target as StageRef),
    enabled: id !== '' && target !== null,
    staleTime: 0,
    gcTime: 0,
  });

/**
 * RW13 — the act itself. Its `data` is the plan rather than an aggregate, so the candidate inside
 * it is what seeds the applicant caches; the stages it superseded are marked stale (no request),
 * because a response about one candidate cannot carry every other feature's rows.
 */
export const useReturnToStage = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: ReturnToStage) => {
      const envelope = await api.returnApplicantToStage(id, body);
      applyWorkflowEnvelope(qc, FEATURE, { ...envelope, data: envelope.data.applicant });
      markAllRecruitmentListsStale(qc);
      return envelope.data;
    },
  });
};

/**
 * Bulk withdraw / reassign / move the selection (RW17). I7 — the SAME hook every other bulk
 * action uses, so the partial-success envelope is reported the same way here as everywhere else
 * instead of each page inventing its own wording for a mixed result.
 */
export const useBulkApplicants = (onApplied?: () => void) =>
  useBulkMutation<BulkApplicants>((body) => api.bulkApplicants(body), {
    applyResult: (qc, result) => applyBulkWorkflowResult(qc, FEATURE, result),
    ...(onApplied === undefined ? {} : { onApplied }),
  });

// ── Attachments (files on the record, not moves through the pipeline) ─────────────────────────

const useInvalidateAttachments = (id: string): (() => void) => {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: [...detailKey(MODULE, FEATURE, id), 'attachments'] });
    void qc.invalidateQueries({ queryKey: detailKey(MODULE, FEATURE, id) });
  };
};

export const useAddApplicantAttachment = (id: string) => {
  const invalidate = useInvalidateAttachments(id);
  return useMutation({
    mutationFn: (form: FormData) => api.addApplicantAttachment(id, form),
    onSuccess: invalidate,
  });
};

export const useRemoveApplicantAttachment = (id: string) => {
  const invalidate = useInvalidateAttachments(id);
  return useMutation({
    mutationFn: (fileId: string) => api.removeApplicantAttachment(id, fileId),
    onSuccess: invalidate,
  });
};

export const useOcrExtract = () =>
  useMutation({ mutationFn: (body: OcrExtractNationalId) => api.ocrExtractNationalId(body) });

export type { FileDto };
