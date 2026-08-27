// TanStack Query hooks for the review queue.
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { type ApplicantDocumentSetDto, type Paginated } from '@ecms/contracts';
import { detailKey, listKey } from '../../../../../shared/lib/query-keys';
import * as api from './applicant-document-api';

const MODULE = 'hr';
const FEATURE = 'applicantDocuments';

export const useApplicantDocumentSets = (
  params: api.ApplicantDocumentSetParams,
): UseQueryResult<Paginated<ApplicantDocumentSetDto>> =>
  useQuery({
    queryKey: listKey(MODULE, FEATURE, params),
    queryFn: () => api.fetchApplicantDocumentSets(params),
  });

export const useApplicantDocumentSet = (
  applicantId: string,
): UseQueryResult<ApplicantDocumentSetDto> =>
  useQuery({
    queryKey: detailKey(MODULE, FEATURE, applicantId),
    queryFn: () => api.fetchApplicantDocumentSet(applicantId),
    enabled: applicantId !== '',
  });

/**
 * Rule on one document.
 *
 * The response IS the whole set after the decision, so it is written straight into the detail cache
 * rather than triggering a refetch — the reviewer sees the slot settle without a round trip. The
 * LIST is invalidated instead of patched: a decision can empty a candidate out of the pending
 * queue, and which page they then belong on is the server's answer, not this file's.
 */
export const useReviewApplicantDocument = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.reviewApplicantDocument,
    onSuccess: (set) => {
      queryClient.setQueryData(detailKey(MODULE, FEATURE, set.applicantId), set);
      void queryClient.invalidateQueries({ queryKey: listKey(MODULE, FEATURE) });
    },
  });
};
