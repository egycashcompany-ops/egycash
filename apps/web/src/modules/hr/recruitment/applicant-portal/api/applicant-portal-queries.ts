// TanStack Query hooks for the candidate's own screen.
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  type ApplicantDocumentSetDto,
  type ApplicantPortalStatusDto,
} from '@ecms/contracts';
import { detailKey } from '../../../../../shared/lib/query-keys';
import * as api from './applicant-portal-api';

const MODULE = 'hr';
const FEATURE = 'applicantPortal';

export const useMyPortalStatus = (): UseQueryResult<ApplicantPortalStatusDto> =>
  useQuery({ queryKey: detailKey(MODULE, FEATURE, 'status'), queryFn: api.fetchMyStatus });

export const useMyPortalDocuments = (): UseQueryResult<ApplicantDocumentSetDto> =>
  useQuery({ queryKey: detailKey(MODULE, FEATURE, 'documents'), queryFn: api.fetchMyDocuments });

/**
 * Upload, then refresh BOTH reads.
 *
 * The status is refetched alongside the documents because handing in the last missing document is
 * one of the things that can change what the candidate is waiting for, and a screen that showed a
 * completed document list beside a stale "we are waiting for your papers" would be telling them
 * two different things at once.
 */
export const useSubmitMyDocument = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.submitMyDocument,
    onSuccess: (set) => {
      queryClient.setQueryData(detailKey(MODULE, FEATURE, 'documents'), set);
      void queryClient.invalidateQueries({ queryKey: detailKey(MODULE, FEATURE, 'status') });
    },
  });
};
