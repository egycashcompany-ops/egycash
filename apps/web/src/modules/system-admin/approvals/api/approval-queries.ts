// TanStack Query hooks for approval chains (ADR-013).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type SetApprovalWorkflow } from '@ecms/contracts';
import { featureKey, listKey } from '../../../../shared/lib/query-keys';
import * as api from './approval-api';

const MODULE = 'system-admin';
const WORKFLOWS = 'approval-workflows';

const workflowsKey = featureKey(MODULE, WORKFLOWS);

export const useApprovalWorkflows = () =>
  useQuery({ queryKey: listKey(MODULE, WORKFLOWS, {}), queryFn: api.listWorkflows });

/**
 * The registered request types. Long-lived: they change only when a deployment registers a new
 * module, so re-fetching per screen would be a request that never returns anything new.
 */
export const useApprovalRequestTypes = () =>
  useQuery({
    queryKey: [MODULE, 'approval-request-types'],
    queryFn: api.listRequestTypes,
    staleTime: 10 * 60_000,
    retry: false,
  });

/**
 * A chain save. Its answer re-reads the chains whether it was taken or refused: a save refused as
 * stale (409 `STALE_DOCUMENT`) names a row or version the list no longer has, so the list behind
 * the dialog is re-read to show the chain as it now is, and the next Edit names that row and
 * version. Settled rather than on error, because a mutation's own `onError` opts it out of the
 * global toast that words the refusal (`shared/lib/query-client.ts`).
 */
export const useSetApprovalWorkflow = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetApprovalWorkflow) => api.setWorkflow(body),
    onSettled: () => void qc.invalidateQueries({ queryKey: workflowsKey }),
  });
};

export const useDeleteApprovalWorkflow = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteWorkflow(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: workflowsKey }),
  });
};
