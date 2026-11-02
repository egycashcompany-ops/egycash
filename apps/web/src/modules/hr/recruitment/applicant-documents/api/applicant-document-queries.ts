// TanStack Query hooks for the review queue.
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  type ApplicantDocumentSetDto,
  type ApplicantFolderDetailDto,
  type ApplicantFolderDto,
  type DeleteApplicantFoldersResultDto,
  type DeletedApplicantFolderDto,
  type DownloadTicketDto,
  type Paginated,
} from '@ecms/contracts';
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

export const useApplicantFolders = (
  params: api.ApplicantFolderParams,
): UseQueryResult<Paginated<ApplicantFolderDto>> =>
  useQuery({
    queryKey: listKey(MODULE, 'applicantFolders', params),
    queryFn: () => api.fetchApplicantFolders(params),
  });

export const useApplicantFolder = (applicantId: string): UseQueryResult<ApplicantFolderDetailDto> =>
  useQuery({
    queryKey: detailKey(MODULE, 'applicantFolders', applicantId),
    queryFn: () => api.fetchApplicantFolder(applicantId),
    enabled: applicantId !== '',
  });

/**
 * Empty one folder, or several.
 *
 * Both invalidate the whole `applicantFolders` feature rather than patching a row out of the list:
 * an emptied folder LEAVES the grid, which page the remaining folders fall on changes with it, and
 * both of those are the server's answer rather than something the client can work out. The DETAIL
 * cache for each emptied applicant is dropped as well, so reopening that folder asks again instead
 * of showing the files it held a moment ago.
 *
 * The APPLICANTS feature goes too, because the same request may have withdrawn the application:
 * that person's status, their row in every applicant list and the stage queues they were in have
 * all just changed, and none of it is under an `applicantFolders` key.
 */
const useFolderInvalidation = (): ((applicantIds: readonly string[]) => void) => {
  const queryClient = useQueryClient();
  return (applicantIds) => {
    for (const id of applicantIds) {
      queryClient.removeQueries({ queryKey: detailKey(MODULE, 'applicantFolders', id) });
      queryClient.removeQueries({ queryKey: detailKey(MODULE, 'applicants', id) });
    }
    void queryClient.invalidateQueries({ queryKey: listKey(MODULE, 'applicantFolders') });
    // The review queue counts the same documents, and emptying a folder empties that person's set.
    void queryClient.invalidateQueries({ queryKey: listKey(MODULE, FEATURE) });
    void queryClient.invalidateQueries({ queryKey: listKey(MODULE, 'applicants') });
  };
};

/** The withdrawal half of the request, shaped as the contract wants it. */
export type FolderWithdrawal = { withdraw: false } | { withdraw: true; withdrawReason: string };

export const useDeleteApplicantFolder = () => {
  const invalidate = useFolderInvalidation();
  return useMutation<
    DeletedApplicantFolderDto,
    Error,
    { applicantId: string; withdrawal: FolderWithdrawal }
  >({
    mutationFn: ({ applicantId, withdrawal }) =>
      api.deleteApplicantFolder(applicantId, withdrawal),
    onSuccess: (result) => invalidate([result.applicantId]),
  });
};

export const useBulkDeleteApplicantFolders = () => {
  const invalidate = useFolderInvalidation();
  return useMutation<
    DeleteApplicantFoldersResultDto,
    Error,
    { applicantIds: readonly string[]; withdrawal: FolderWithdrawal }
  >({
    mutationFn: ({ applicantIds, withdrawal }) =>
      api.bulkDeleteApplicantFolders({ applicantIds: [...applicantIds], ...withdrawal }),
    // Every id that was ASKED about, not only the ones that went: a refused folder was read to
    // find out it was refused, and its row now carries a reason the list did not have before.
    onSuccess: (_result, { applicantIds }) => invalidate(applicantIds),
  });
};

/**
 * A signed link to show one image. Links are short-lived, so one is asked for when the image is
 * shown and refreshed well before it runs out.
 */
export const useFileTicket = (fileId: string | null): UseQueryResult<DownloadTicketDto> =>
  useQuery({
    queryKey: ['platform', 'files', 'ticket', fileId],
    queryFn: () => api.fileTicket(fileId ?? ''),
    enabled: fileId !== null,
    staleTime: 60_000,
  });
