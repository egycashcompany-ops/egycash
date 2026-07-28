// TanStack Query hooks for the Screening feature (ADR-013). Reads cached by the shared key
// factory; writes apply the workflow envelope to the cache (I6) instead of invalidating and
// refetching. The queue's applicant search reuses the Applicants list API (screening's own list has
// no free-text field — it filters by applicantId), so a name/code lookup resolves to that filter.
import { useQuery } from '@tanstack/react-query';
import {
  type AddScreeningNote,
  type BulkScreenings,
  type CreateScreening,
  type DecideScreening,
} from '@ecms/contracts';
import { detailKey, listKey } from '../../../../../shared/lib/query-keys';
import { listApplicants } from '../../applicants/api/applicant-api';
import { useBulkMutation } from '../../../../../shared/lib/useBulkMutation';
import { applyBulkWorkflowResult, useWorkflowMutation } from '../../shared/useWorkflowMutation';
import * as api from './screening-api';
import { type ScreeningListParams } from './screening-api';

const MODULE = 'hr';
const FEATURE = 'screenings';

export const useScreenings = (params: ScreeningListParams) =>
  useQuery({
    queryKey: listKey(MODULE, FEATURE, params),
    queryFn: () => api.listScreenings(params),
    placeholderData: (prev) => prev,
  });

export const useScreening = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, FEATURE, id),
    queryFn: () => api.getScreening(id),
    enabled: id !== '',
  });

/** Applicant lookup for the queue filter + create dialog (reuses the Applicants list API). */
export const useApplicantSearch = (term: string) =>
  useQuery({
    queryKey: [MODULE, 'applicants', 'search', term],
    queryFn: () => listApplicants({ search: term, pageSize: 8, status: 'new' }),
    enabled: term.trim().length >= 2,
    staleTime: 30_000,
    select: (page) => page.items,
  });

export const useCreateScreening = () =>
  useWorkflowMutation(FEATURE, (body: CreateScreening) => api.createScreening(body));

export const useAddScreeningNote = (id: string) =>
  useWorkflowMutation(FEATURE, (body: AddScreeningNote) => api.addScreeningNote(id, body));

export const useDecideScreening = (id: string) =>
  useWorkflowMutation(FEATURE, (body: DecideScreening) => api.decideScreening(id, body));

export const useRedecideScreening = (id: string) =>
  useWorkflowMutation(FEATURE, (body: DecideScreening) => api.redecideScreening(id, body));

/** Bulk approve/reject the selection (RW17). Reports the partial-success envelope exactly. */
export const useBulkScreenings = (onApplied?: () => void) =>
  useBulkMutation<BulkScreenings>((body) => api.bulkScreenings(body), {
    applyResult: (qc, result) => applyBulkWorkflowResult(qc, FEATURE, result),
    ...(onApplied === undefined ? {} : { onApplied }),
  });
