// TanStack Query hooks for the Job Offer feature (ADR-013). Reads cached by the shared key factory;
// each write applies the workflow envelope to the cache (I6), so nothing is refetched. The applicant
// lookup reuses the Applicants list API; org/manager references reuse the existing platform
// endpoints.
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  type AwaitingOfferCandidateDto,
  type Paginated,
  type AcceptJobOffer,
  type CreateJobOffer,
  type RejectJobOffer,
  type ReviseJobOffer,
  type SendJobOffer,
  type WithdrawJobOffer,
  type BulkJobOffers,
} from '@ecms/contracts';
import { detailKey, listKey } from '../../../../../shared/lib/query-keys';
import { listApplicants } from '../../applicants/api/applicant-api';
import { useBulkMutation } from '../../../../../shared/lib/useBulkMutation';
import { applyBulkWorkflowResult, useWorkflowMutation } from '../../shared/useWorkflowMutation';
import * as api from './job-offer-api';
import { type JobOfferListParams } from './job-offer-api';

const MODULE = 'hr';
const FEATURE = 'jobOffers';

/**
 * The queue. Its own key, so creating an offer or moving somebody invalidates it without touching
 * the offers LIST — the two answer different questions and go stale for different reasons.
 */
export const useAwaitingOffer = (params: {
  page: number;
  pageSize: number;
  search?: string;
}): UseQueryResult<Paginated<AwaitingOfferCandidateDto>> =>
  useQuery({
    queryKey: listKey(MODULE, 'jobOffersAwaiting', params),
    queryFn: () => api.fetchAwaitingOffer(params),
  });

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

/**
 * Applicant lookup for the create form — ONLY applicants HR explicitly moved to the Job Offer
 * stage (eligibility is never automatic; the server enforces the same rule on create).
 */
export const useApplicantSearch = (term: string) =>
  useQuery({
    queryKey: [MODULE, 'applicants', 'search', 'jobOffer', term],
    queryFn: () => listApplicants({ search: term, movedToOffer: true, status: 'new', pageSize: 8 }),
    enabled: term.trim().length >= 2,
    staleTime: 30_000,
    select: (page) => page.items,
  });

// ── Reference lookups ───────────────────────────────────────────────────────────────────────────
//
// Branches, Departments and Job Titles are no longer read here. They used to come from the
// organization-ADMINISTRATION lists, each gated on its own `<unit>.view`, which made every consumer
// pass `can('branch.view')` as the `enabled` flag — so a reader who legitimately saw the ROWS could
// not read the NAME of the unit on them, and a required picker fed from the same hook offered
// nothing at all. Naming a unit a screen already shows is not browsing HR's directory.
//
// They come from `modules/organization/shared/references.ts` now — `/platform/<unit>/options`,
// authenticated and ungated, {id, code, name, parentId, catalogId} for active units, paged to
// exhaustion server-side rather than capped at one page of 100.

/**
 * The seats that require a driving test — the drivers registry's own definition of who it is about.
 *
 * A separate query rather than a filter over the job-title OPTIONS, because the difference is the
 * QUESTION asked of the server and not the answer's shape: the options carry no
 * `requiresDrivingTest`, so filtering them in the browser is not possible at all.
 */
export const useDrivingJobTitles = (enabled: boolean) =>
  useQuery({
    queryKey: [MODULE, 'jobTitles', 'active', 'requiresDrivingTest'],
    queryFn: () => api.listJobTitles(true),
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

export const useCreateJobOffer = () =>
  useWorkflowMutation(FEATURE, (body: CreateJobOffer) => api.createJobOffer(body));

export const useReviseJobOffer = (id: string) =>
  useWorkflowMutation(FEATURE, (body: ReviseJobOffer) => api.reviseJobOffer(id, body));

export const useSendJobOffer = (id: string) =>
  useWorkflowMutation(FEATURE, (body: SendJobOffer) => api.sendJobOffer(id, body));

export const useAcceptJobOffer = (id: string) =>
  useWorkflowMutation(FEATURE, (body: AcceptJobOffer) => api.acceptJobOffer(id, body));

export const useRejectJobOffer = (id: string) =>
  useWorkflowMutation(FEATURE, (body: RejectJobOffer) => api.rejectJobOffer(id, body));

export const useWithdrawJobOffer = (id: string) =>
  useWorkflowMutation(FEATURE, (body: WithdrawJobOffer) => api.withdrawJobOffer(id, body));

/** Bulk send/withdraw the selection (RW17). */
export const useBulkJobOffers = (onApplied?: () => void) =>
  useBulkMutation<BulkJobOffers>((body) => api.bulkJobOffers(body), {
    applyResult: (qc, result) => applyBulkWorkflowResult(qc, FEATURE, result),
    ...(onApplied === undefined ? {} : { onApplied }),
  });
