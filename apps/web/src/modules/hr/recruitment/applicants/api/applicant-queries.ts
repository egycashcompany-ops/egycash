// TanStack Query hooks for the Applicants feature (ADR-013). Reads are cached by the shared
// key factory; writes invalidate the feature subtree (and the specific detail) on success.
// Failures surface via the global Query/Mutation error handler; components add success toasts.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ApplicantSourceDto,
  type BulkApplicants,
  type ConfirmApplicantIdentity,
  type FileCategoryDto,
  type FileDto,
  type OcrExtractNationalId,
  type RegisterApplicant,
  type UpdateApplicant,
  type WithdrawApplicant,
} from '@ecms/contracts';
import { detailKey, featureKey, listKey } from '../../../../../shared/lib/query-keys';
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
  const invalidate = useInvalidateApplicants();
  return useMutation({
    mutationFn: (body: WithdrawApplicant) => api.withdrawApplicant(id, body),
    onSuccess: invalidate,
  });
};

export const useBulkApplicants = () => {
  const invalidate = useInvalidateApplicants();
  return useMutation({
    mutationFn: (body: BulkApplicants) => api.bulkApplicants(body),
    onSuccess: invalidate,
  });
};

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
