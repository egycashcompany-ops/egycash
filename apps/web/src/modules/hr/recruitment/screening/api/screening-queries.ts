// TanStack Query hooks for the Screening feature (ADR-013). Reads cached by the shared key
// factory; writes invalidate the feature subtree on success. The queue's applicant search reuses
// the Applicants list API (screening's own list has no free-text field — it filters by
// applicantId), so a name/code lookup resolves to that filter.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type AddScreeningNote, type CreateScreening, type DecideScreening } from '@ecms/contracts';
import { detailKey, featureKey, listKey } from '../../../../../shared/lib/query-keys';
import { listApplicants } from '../../applicants/api/applicant-api';
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

const useInvalidateScreenings = (): (() => void) => {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: featureKey(MODULE, FEATURE) });
  };
};

export const useCreateScreening = () => {
  const invalidate = useInvalidateScreenings();
  return useMutation({ mutationFn: (body: CreateScreening) => api.createScreening(body), onSuccess: invalidate });
};

export const useAddScreeningNote = (id: string) => {
  const invalidate = useInvalidateScreenings();
  return useMutation({ mutationFn: (body: AddScreeningNote) => api.addScreeningNote(id, body), onSuccess: invalidate });
};

export const useDecideScreening = (id: string) => {
  const invalidate = useInvalidateScreenings();
  return useMutation({ mutationFn: (body: DecideScreening) => api.decideScreening(id, body), onSuccess: invalidate });
};
