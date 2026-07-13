// TanStack Query hooks for the Job Offer feature (ADR-013). Reads cached by the shared key factory;
// each write returns the fresh offer, so it seeds the detail cache from the response and invalidates
// only the list subtree (minimal invalidation). The applicant lookup reuses the Applicants list API;
// org/manager references reuse the existing platform endpoints.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AcceptJobOffer,
  type CreateJobOffer,
  type JobOfferDto,
  type RejectJobOffer,
  type ReviseJobOffer,
  type SendJobOffer,
  type WithdrawJobOffer,
} from '@ecms/contracts';
import { detailKey, listKey } from '../../../../../shared/lib/query-keys';
import { listApplicants } from '../../applicants/api/applicant-api';
import * as api from './job-offer-api';
import { type JobOfferListParams } from './job-offer-api';

const MODULE = 'hr';
const FEATURE = 'jobOffers';

export const useJobOffers = (params: JobOfferListParams) =>
  useQuery({
    queryKey: listKey(MODULE, FEATURE, params),
    queryFn: () => api.listJobOffers(params),
    placeholderData: (prev) => prev,
  });

export const useJobOffer = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, FEATURE, id),
    queryFn: () => api.getJobOffer(id),
    enabled: id !== '',
  });

/** Applicant lookup for the create form (reuses the Applicants list API). */
export const useApplicantSearch = (term: string) =>
  useQuery({
    queryKey: [MODULE, 'applicants', 'search', 'jobOffer', term],
    queryFn: () => listApplicants({ search: term, pageSize: 8 }),
    enabled: term.trim().length >= 2,
    staleTime: 30_000,
    select: (page) => page.items,
  });

// ── Reference lookups (long-cached; gated by their own *.view — degrade to empty on denial) ──────
export const useBranches = (enabled: boolean) =>
  useQuery({
    queryKey: [MODULE, 'branches', 'active'],
    queryFn: () => api.listBranches(),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    select: (page) => page.items,
  });

export const useDepartments = (enabled: boolean) =>
  useQuery({
    queryKey: [MODULE, 'departments', 'active'],
    queryFn: () => api.listDepartments(),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    select: (page) => page.items,
  });

export const useJobTitles = (enabled: boolean) =>
  useQuery({
    queryKey: [MODULE, 'jobTitles', 'active'],
    queryFn: () => api.listJobTitles(),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    select: (page) => page.items,
  });

export const useUserSearch = (term: string, enabled: boolean) =>
  useQuery({
    queryKey: [MODULE, 'users', 'search', term],
    queryFn: () => api.searchUsers(term),
    enabled: enabled && term.trim().length >= 2,
    staleTime: 30_000,
    select: (page) => page.items,
  });

export const useUser = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: [MODULE, 'users', 'detail', id],
    queryFn: () => api.getUser(id),
    enabled: enabled && id !== '',
    staleTime: 5 * 60_000,
    retry: false,
  });

const useOfferWriters = (
  id: string | null,
): { seedAndInvalidate: (updated: JobOfferDto) => void } => {
  const qc = useQueryClient();
  return {
    seedAndInvalidate: (updated) => {
      qc.setQueryData(detailKey(MODULE, FEATURE, id ?? updated.id), updated);
      void qc.invalidateQueries({ queryKey: listKey(MODULE, FEATURE) });
    },
  };
};

export const useCreateJobOffer = () => {
  const { seedAndInvalidate } = useOfferWriters(null);
  return useMutation({ mutationFn: (body: CreateJobOffer) => api.createJobOffer(body), onSuccess: seedAndInvalidate });
};

export const useReviseJobOffer = (id: string) => {
  const { seedAndInvalidate } = useOfferWriters(id);
  return useMutation({ mutationFn: (body: ReviseJobOffer) => api.reviseJobOffer(id, body), onSuccess: seedAndInvalidate });
};

export const useSendJobOffer = (id: string) => {
  const { seedAndInvalidate } = useOfferWriters(id);
  return useMutation({ mutationFn: (body: SendJobOffer) => api.sendJobOffer(id, body), onSuccess: seedAndInvalidate });
};

export const useAcceptJobOffer = (id: string) => {
  const { seedAndInvalidate } = useOfferWriters(id);
  return useMutation({ mutationFn: (body: AcceptJobOffer) => api.acceptJobOffer(id, body), onSuccess: seedAndInvalidate });
};

export const useRejectJobOffer = (id: string) => {
  const { seedAndInvalidate } = useOfferWriters(id);
  return useMutation({ mutationFn: (body: RejectJobOffer) => api.rejectJobOffer(id, body), onSuccess: seedAndInvalidate });
};

export const useWithdrawJobOffer = (id: string) => {
  const { seedAndInvalidate } = useOfferWriters(id);
  return useMutation({ mutationFn: (body: WithdrawJobOffer) => api.withdrawJobOffer(id, body), onSuccess: seedAndInvalidate });
};
