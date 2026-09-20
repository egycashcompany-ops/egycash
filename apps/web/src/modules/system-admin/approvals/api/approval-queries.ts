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

export const useSetApprovalWorkflow = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetApprovalWorkflow) => api.setWorkflow(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: workflowsKey }),
  });
};

export const useDeleteApprovalWorkflow = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteWorkflow(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: workflowsKey }),
  });
};
