// TanStack Query hooks for the Interviews feature (ADR-013). Reads cached by the shared key
// factory; writes invalidate the feature subtree on success. The queue's applicant search reuses
// the Applicants list API (interviews filter by applicantId, not free text); interviewer selection
// and name resolution reuse the platform Users endpoint.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CancelInterview,
  type CreateInterviewStage,
  type DecideInterview,
  type InterviewDto,
  type ReassignInterviewPanel,
  type RescheduleInterview,
  type ScheduleInterview,
  type SkipInterviewer,
  type SubmitInterviewEvaluation,
  type UpdateInterviewStage,
} from '@ecms/contracts';
import { detailKey, listKey } from '../../../../../shared/lib/query-keys';
import { listApplicants } from '../../applicants/api/applicant-api';
import * as api from './interview-api';
import { type InterviewListParams } from './interview-api';

const MODULE = 'hr';
const FEATURE = 'interviews';

export const useInterviews = (params: InterviewListParams) =>
  useQuery({
    queryKey: listKey(MODULE, FEATURE, params),
    queryFn: () => api.listInterviews(params),
    placeholderData: (prev) => prev,
  });

export const useInterview = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, FEATURE, id),
    queryFn: () => api.getInterview(id),
    enabled: id !== '',
  });

/** "Awaiting scheduling" — applicants who passed Screening and have no interview yet (pipeline
 *  entry). Distinct subtree from the interviews list so scheduling invalidates it explicitly. */
export const useAwaitingInterviews = (params: InterviewListParams = {}) =>
  useQuery({
    queryKey: [MODULE, FEATURE, 'awaiting', params],
    queryFn: () => api.listAwaitingInterviews(params),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

/** Active interview-stage catalog (labels rounds + backs the stage picker). */
export const useInterviewStages = () =>
  useQuery({
    queryKey: [MODULE, 'interviewStages', 'active'],
    queryFn: () => api.listInterviewStages(),
    staleTime: 5 * 60_000,
    select: (page) => page.items,
  });

/** Full catalog (incl. disabled stages) — the settings screen. */
export const useAllInterviewStages = () =>
  useQuery({
    queryKey: [MODULE, 'interviewStages', 'all'],
    queryFn: () => api.listAllInterviewStages(),
    select: (page) => page.items,
  });

const useInvalidateStages = () => {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: [MODULE, 'interviewStages'] });
};

export const useCreateInterviewStage = () => {
  const invalidate = useInvalidateStages();
  return useMutation({
    mutationFn: (body: CreateInterviewStage) => api.createInterviewStage(body),
    onSuccess: invalidate,
  });
};

export const useUpdateInterviewStage = () => {
  const invalidate = useInvalidateStages();
  return useMutation({
    mutationFn: (vars: { id: string; body: UpdateInterviewStage }) =>
      api.updateInterviewStage(vars.id, vars.body),
    onSuccess: invalidate,
  });
};

/** Applicant lookup for the queue filter + schedule dialog (reuses the Applicants list API; the
 *  server enforces interview eligibility on schedule). Distinct cache key from other features'
 *  applicant searches so their differing queryFns never collide. */
export const useApplicantSearch = (term: string) =>
  useQuery({
    queryKey: [MODULE, 'applicants', 'search', 'interview', term],
    queryFn: () => listApplicants({ search: term, pageSize: 8 }),
    enabled: term.trim().length >= 2,
    staleTime: 30_000,
    select: (page) => page.items,
  });

/** Interviewer lookup for the panel pickers (reuses the platform Users endpoint, `user.view`). */
export const useUserSearch = (term: string, enabled: boolean) =>
  useQuery({
    queryKey: [MODULE, 'users', 'search', term],
    queryFn: () => api.searchUsers(term),
    enabled: enabled && term.trim().length >= 2,
    staleTime: 30_000,
    select: (page) => page.items,
  });

/** Resolve a single interviewer id → user (name display). Fails soft when directory is denied. */
export const useUser = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: [MODULE, 'users', 'detail', id],
    queryFn: () => api.getUser(id),
    enabled: enabled && id !== '',
    staleTime: 5 * 60_000,
    retry: false,
  });

// Minimal invalidation: a write returns the fresh interview, so we seed its detail cache directly
// and invalidate only the list subtree (['hr','interviews','list',…]) — never the whole feature.
const useInterviewWriters = (
  id: string | null,
): { seedAndInvalidate: (updated: InterviewDto) => void } => {
  const qc = useQueryClient();
  return {
    seedAndInvalidate: (updated) => {
      qc.setQueryData(detailKey(MODULE, FEATURE, id ?? updated.id), updated);
      void qc.invalidateQueries({ queryKey: listKey(MODULE, FEATURE) });
    },
  };
};

export const useScheduleInterview = () => {
  const qc = useQueryClient();
  const { seedAndInvalidate } = useInterviewWriters(null);
  return useMutation({
    mutationFn: (body: ScheduleInterview) => api.scheduleInterview(body),
    onSuccess: (updated) => {
      seedAndInvalidate(updated);
      // Scheduling removes the applicant from the "awaiting scheduling" queue.
      void qc.invalidateQueries({ queryKey: [MODULE, FEATURE, 'awaiting'] });
    },
  });
};

export const useRescheduleInterview = (id: string) => {
  const { seedAndInvalidate } = useInterviewWriters(id);
  return useMutation({
    mutationFn: (body: RescheduleInterview) => api.rescheduleInterview(id, body),
    onSuccess: seedAndInvalidate,
  });
};

export const useReassignPanel = (id: string) => {
  const { seedAndInvalidate } = useInterviewWriters(id);
  return useMutation({
    mutationFn: (body: ReassignInterviewPanel) => api.reassignInterviewPanel(id, body),
    onSuccess: seedAndInvalidate,
  });
};

export const useSkipInterviewer = (id: string) => {
  const { seedAndInvalidate } = useInterviewWriters(id);
  return useMutation({
    mutationFn: (body: SkipInterviewer) => api.skipInterviewer(id, body),
    onSuccess: seedAndInvalidate,
  });
};

export const useCancelInterview = (id: string) => {
  const { seedAndInvalidate } = useInterviewWriters(id);
  return useMutation({
    mutationFn: (body: CancelInterview) => api.cancelInterview(id, body),
    onSuccess: seedAndInvalidate,
  });
};

export const useSubmitEvaluation = (id: string) => {
  const { seedAndInvalidate } = useInterviewWriters(id);
  return useMutation({
    mutationFn: (body: SubmitInterviewEvaluation) => api.submitInterviewEvaluation(id, body),
    onSuccess: seedAndInvalidate,
  });
};

export const useDecideInterview = (id: string) => {
  const { seedAndInvalidate } = useInterviewWriters(id);
  return useMutation({
    mutationFn: (body: DecideInterview) => api.decideInterview(id, body),
    onSuccess: seedAndInvalidate,
  });
};

export const useRedecideInterview = (id: string) => {
  const { seedAndInvalidate } = useInterviewWriters(id);
  return useMutation({
    mutationFn: (body: DecideInterview) => api.redecideInterview(id, body),
    onSuccess: seedAndInvalidate,
  });
};
