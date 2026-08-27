// TanStack Query hooks for the round and its rows (ADR-013 — P-HR-PRF, P2).
//
// TWO KEYS, AND OPENING INVALIDATES BOTH. A cycle write normally touches only cycles — but OPENING
// writes several hundred reviews, so it is the one mutation that has to refresh the other
// collection as well. Leaving it on the cycles key alone would show somebody a round marked open
// beside a reviews queue that is still empty, which reads exactly like the materializer failing.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AssignPerformanceEvaluator,
  type ClosePerformanceCycle,
  type CreatePerformanceCycle,
  type OpenPerformanceCycle,
  type UpdatePerformanceCycle,
} from '@ecms/contracts';
import { detailKey, listKey } from '../../../../shared/lib/query-keys';
import * as api from './performance-api';

const MODULE = 'hr';
const CYCLES = 'performanceCycles';
const REVIEWS = 'performanceReviews';

// ── Cycles ──────────────────────────────────────────────────────────────────

export const usePerformanceCycles = (params: Record<string, string | number | undefined>) =>
  useQuery({
    queryKey: listKey(MODULE, CYCLES, params),
    queryFn: () => api.listPerformanceCycles(params),
    placeholderData: (prev) => prev,
  });

export const usePerformanceCycle = (id: string | undefined) =>
  useQuery({
    queryKey: detailKey(MODULE, CYCLES, id ?? ''),
    queryFn: () => api.getPerformanceCycle(id ?? ''),
    enabled: id !== undefined && id !== '',
  });

const useCycleMutation = <TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [MODULE, CYCLES] });
    },
  });
};

export const useCreatePerformanceCycle = () =>
  useCycleMutation((body: CreatePerformanceCycle) => api.createPerformanceCycle(body));

export const useUpdatePerformanceCycle = () =>
  useCycleMutation(({ id, body }: { id: string; body: UpdatePerformanceCycle }) =>
    api.updatePerformanceCycle(id, body),
  );

/** The one cycle mutation that also refreshes the reviews — see the note at the top. */
const useOpeningMutation = <TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [MODULE, CYCLES] });
      void client.invalidateQueries({ queryKey: [MODULE, REVIEWS] });
    },
  });
};

export const useOpenPerformanceCycle = () =>
  useOpeningMutation(({ id, body }: { id: string; body: OpenPerformanceCycle }) =>
    api.openPerformanceCycle(id, body),
  );

export const useClosePerformanceCycle = () =>
  useOpeningMutation(({ id, body }: { id: string; body: ClosePerformanceCycle }) =>
    api.closePerformanceCycle(id, body),
  );

// ── Reviews ─────────────────────────────────────────────────────────────────

export const usePerformanceReviews = (params: Record<string, string | number | undefined>) =>
  useQuery({
    queryKey: listKey(MODULE, REVIEWS, params),
    queryFn: () => api.listPerformanceReviews(params),
    placeholderData: (prev) => prev,
  });

export const usePerformanceReview = (id: string | undefined) =>
  useQuery({
    queryKey: detailKey(MODULE, REVIEWS, id ?? ''),
    queryFn: () => api.getPerformanceReview(id ?? ''),
    enabled: id !== undefined && id !== '',
  });

export const useAssignPerformanceEvaluator = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AssignPerformanceEvaluator }) =>
      api.assignPerformanceEvaluator(id, body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [MODULE, REVIEWS] });
    },
  });
};
