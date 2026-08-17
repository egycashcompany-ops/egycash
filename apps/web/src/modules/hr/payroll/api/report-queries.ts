// TanStack Query hooks for the report builder (ADR-013).
//
// A definition is cached; a RESULT is not keyed for reuse the way a list is — running a report is a
// question about a run's money at the moment you ask it, and the mutation shape says so rather than
// letting a stale total sit behind a cache key.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CreatePayrollReportDefinition,
  type UpdatePayrollReportDefinition,
} from '@ecms/contracts';
import { featureKey, listKey } from '../../../../shared/lib/query-keys';
import * as api from './report-api';

const MODULE = 'hr';
const FEATURE = 'payrollReportDefinitions';

export const useReportDefinitions = (params: Record<string, string | number>) =>
  useQuery({
    queryKey: listKey(MODULE, FEATURE, params),
    queryFn: () => api.listReportDefinitions(params),
    placeholderData: (prev) => prev,
  });

export const useCreateReportDefinition = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePayrollReportDefinition) => api.createReportDefinition(body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: featureKey(MODULE, FEATURE) });
    },
  });
};

export const useUpdateReportDefinition = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdatePayrollReportDefinition }) =>
      api.updateReportDefinition(id, body),
    onSuccess: () => {
      // The list carries each definition's version, and an edit has just changed one — refetching
      // is what stops the next edit from sending a version that is already stale.
      void client.invalidateQueries({ queryKey: featureKey(MODULE, FEATURE) });
    },
  });
};

export const useDeleteReportDefinition = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteReportDefinition(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: featureKey(MODULE, FEATURE) });
    },
  });
};

/** Preview an unsaved definition (D-B1-6). A mutation because it is an action, not a cached read. */
export const usePreviewReport = () =>
  useMutation({
    mutationFn: ({ runId, definition }: { runId: string; definition: CreatePayrollReportDefinition }) =>
      api.previewReport(runId, definition),
  });

/** Run a stored definition. */
export const useRunReportDefinition = () =>
  useMutation({
    mutationFn: ({ id, runId }: { id: string; runId: string }) => api.runReportDefinition(id, runId),
  });
