// TanStack Query hooks for the Applicants feature (ADR-013). Reads are cached by the shared
// key factory; writes invalidate the feature subtree (and the specific detail) on success.
// Failures surface via the global Query/Mutation error handler; components add success toasts.
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
import { detailKey, featureKey, listKey } from '../../../../../shared/lib/query-keys';
import { invalidateRecruitment } from '../../shared/invalidate-recruitment';
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

const useInvalidateApplicants = (): (() => void) => {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: featureKey(MODULE, FEATURE) });
  };
};

/** Withdraw/restore change pipeline visibility, so invalidate the whole recruitment subtree: the
 *  candidate's stage records and every queue counter move with them (I11/RW15). */
const useInvalidateLifecycle = (): (() => void) => {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: featureKey(MODULE, FEATURE) });
  };
};

export const useRegisterApplicant = () => {
  const invalidate = useInvalidateApplicants();
  return useMutation({
    mutationFn: (body: RegisterApplicant) => api.registerApplicant(body),
    onSuccess: invalidate,
  });
};

export const useUpdateApplicant = (id: string) => {
  const invalidate = useInvalidateApplicants();
  return useMutation({
    mutationFn: (body: UpdateApplicant) => api.updateApplicant(id, body),
    onSuccess: invalidate,
  });
};

export const useVerifyApplicantIdentity = (id: string) => {
  const invalidate = useInvalidateApplicants();
  return useMutation({
    mutationFn: (body: ConfirmApplicantIdentity) => api.verifyApplicantIdentity(id, body),
    onSuccess: invalidate,
  });
};

export const useWithdrawApplicant = (id: string) => {
  const invalidate = useInvalidateLifecycle();
  return useMutation({
    mutationFn: (body: WithdrawApplicant) => api.withdrawApplicant(id, body),
    onSuccess: invalidate,
  });
};

export const useMoveApplicantToOffer = (id: string) => {
  const invalidate = useInvalidateApplicants();
  return useMutation({
    mutationFn: (body: MoveApplicantToOffer) => api.moveApplicantToOffer(id, body),
    onSuccess: invalidate,
  });
};

export const useRestoreApplicant = (id: string) => {
  const invalidate = useInvalidateLifecycle();
  return useMutation({
    mutationFn: (body: RestoreApplicant) => api.restoreApplicant(id, body),
    onSuccess: invalidate,
  });
};

/** RW2 — reassignment moves the candidate, so every recruitment surface refreshes with it. */
export const useReassignApplicant = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReassignPlacement) => api.reassignApplicant(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: detailKey(MODULE, FEATURE, id) });
      invalidateRecruitment(qc);
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

/** RW13 — the act itself. Supersedes forward records and re-opens the target on a new attempt. */
export const useReturnToStage = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReturnToStage) => api.returnApplicantToStage(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: detailKey(MODULE, FEATURE, id) });
      invalidateRecruitment(qc);
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
    invalidate: invalidateRecruitment,
    ...(onApplied === undefined ? {} : { onApplied }),
  });

export const useAddApplicantAttachment = (id: string) => {
  const invalidate = useInvalidateApplicants();
  return useMutation({
    mutationFn: (form: FormData) => api.addApplicantAttachment(id, form),
    onSuccess: invalidate,
  });
};

export const useRemoveApplicantAttachment = (id: string) => {
  const invalidate = useInvalidateApplicants();
  return useMutation({
    mutationFn: (fileId: string) => api.removeApplicantAttachment(id, fileId),
    onSuccess: invalidate,
  });
};

export const useOcrExtract = () =>
  useMutation({ mutationFn: (body: OcrExtractNationalId) => api.ocrExtractNationalId(body) });

export type { FileDto };
