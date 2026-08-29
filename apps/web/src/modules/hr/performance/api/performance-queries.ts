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
  type ClosePerformanceGoal,
  type CreatePerformanceCycle,
  type CreatePerformanceGoal,
  type ExcusePerformanceReview,
  type FinalizePerformanceReview,
  type OpenPerformanceCycle,
  type ProgressPerformanceGoal,
  type ReturnPerformanceReview,
  type SubmitPerformanceReview,
  type UpdatePerformanceCycle,
} from '@ecms/contracts';
import { detailKey, listKey } from '../../../../shared/lib/query-keys';
import * as api from './performance-api';

const MODULE = 'hr';
const CYCLES = 'performanceCycles';
const REVIEWS = 'performanceReviews';
const GOALS = 'performanceGoals';

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

/**
 * Every review transition refreshes the reviews AND the cycles.
 *
 * The cycle carries the count a round is closable by, and «can I close this yet» is the question
 * the cycles screen answers. A finalize that refreshed only the queue would leave somebody looking
 * at a round that still says it has open reviews when it does not.
 */
const useReviewTransition = <TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [MODULE, REVIEWS] });
      void client.invalidateQueries({ queryKey: [MODULE, CYCLES] });
    },
  });
};

export const useSubmitPerformanceReview = () =>
  useReviewTransition(({ id, body }: { id: string; body: SubmitPerformanceReview }) =>
    api.submitPerformanceReview(id, body),
  );

export const useReturnPerformanceReview = () =>
  useReviewTransition(({ id, body }: { id: string; body: ReturnPerformanceReview }) =>
    api.returnPerformanceReview(id, body),
  );

export const useFinalizePerformanceReview = () =>
  useReviewTransition(({ id, body }: { id: string; body: FinalizePerformanceReview }) =>
    api.finalizePerformanceReview(id, body),
  );

export const useExcusePerformanceReview = () =>
  useReviewTransition(({ id, body }: { id: string; body: ExcusePerformanceReview }) =>
    api.excusePerformanceReview(id, body),
  );

/** Its own key, not a filtered reuse of the queue: the two are different reads for different people. */
export const useMyPerformanceReviews = (params: Record<string, string | number | undefined>) =>
  useQuery({
    queryKey: listKey(MODULE, 'myPerformanceReviews', params),
    queryFn: () => api.listMyPerformanceReviews(params),
    placeholderData: (prev) => prev,
  });

// ── Goals ───────────────────────────────────────────────────────────────────

export const usePerformanceGoals = (params: Record<string, string | number | undefined>) =>
  useQuery({
    queryKey: listKey(MODULE, GOALS, params),
    queryFn: () => api.listPerformanceGoals(params),
    placeholderData: (prev) => prev,
  });

/**
 * Every goal write refreshes goals only. The REVIEW does not change when a goal moves — the row
 * expansion re-reads goals under its own key, and invalidating reviews too would refetch a whole
 * queue page on every progress note.
 */
const useGoalMutation = <TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [MODULE, GOALS] });
    },
  });
};

export const useCreatePerformanceGoal = () =>
  useGoalMutation((body: CreatePerformanceGoal) => api.createPerformanceGoal(body));

export const useProgressPerformanceGoal = () =>
  useGoalMutation(({ id, body }: { id: string; body: ProgressPerformanceGoal }) =>
    api.progressPerformanceGoal(id, body),
  );

export const useClosePerformanceGoal = () =>
  useGoalMutation(({ id, body }: { id: string; body: ClosePerformanceGoal }) =>
    api.closePerformanceGoal(id, body),
  );
