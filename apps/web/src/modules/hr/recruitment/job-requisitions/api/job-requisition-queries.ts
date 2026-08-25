// TanStack Query hooks for job requisitions (ADR-013).
//
// Every mutation invalidates the whole feature rather than one key: each of them can move the
// STATUS, and the status is what the list, the detail and the counters all read. A narrower
// invalidation would leave a screen showing `open` next to a requisition that just filled.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CloseJobRequisition,
  type CreateJobRequisition,
  type DecideJobRequisition,
  type ListJobRequisitionsQuery,
  type UpdateJobRequisition,
} from '@ecms/contracts';
import { detailKey, featureKey, listKey } from '../../../../../shared/lib/query-keys';
import * as api from './job-requisition-api';

const MODULE = 'hr';
const FEATURE = 'jobRequisitions';

export const useJobRequisitions = (query: Partial<ListJobRequisitionsQuery>) =>
  useQuery({
    queryKey: listKey(MODULE, FEATURE, query as Record<string, unknown>),
    queryFn: () => api.listJobRequisitions(query),
    placeholderData: (prev) => prev,
  });

export const useJobRequisition = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, FEATURE, id),
    queryFn: () => api.getJobRequisition(id),
  });

export const useJobRequisitionFills = (id: string) =>
  useQuery({
    queryKey: [...detailKey(MODULE, FEATURE, id), 'fills'],
    queryFn: () => api.listJobRequisitionFills(id),
  });

const useFeatureMutation = <TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: featureKey(MODULE, FEATURE) });
    },
  });
};

export const useCreateJobRequisition = () =>
  useFeatureMutation((body: CreateJobRequisition) => api.createJobRequisition(body));

export const useUpdateJobRequisition = () =>
  useFeatureMutation(({ id, body }: { id: string; body: UpdateJobRequisition }) =>
    api.updateJobRequisition(id, body),
  );

export const useSubmitJobRequisition = () =>
  useFeatureMutation(({ id, version }: { id: string; version: number }) =>
    api.submitJobRequisition(id, version),
  );

export const useDecideJobRequisition = () =>
  useFeatureMutation(({ id, body }: { id: string; body: DecideJobRequisition }) =>
    api.decideJobRequisition(id, body),
  );

export const useCloseJobRequisition = () =>
  useFeatureMutation(({ id, body }: { id: string; body: CloseJobRequisition }) =>
    api.closeJobRequisition(id, body),
  );

export const useCancelJobRequisition = () =>
  useFeatureMutation(({ id, body }: { id: string; body: CloseJobRequisition }) =>
    api.cancelJobRequisition(id, body),
  );

export const useDeleteJobRequisition = () =>
  useFeatureMutation((id: string) => api.deleteJobRequisition(id));
