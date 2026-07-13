// TanStack Query hooks for the Interviews feature (ADR-013). Reads cached by the shared key
// factory; writes invalidate the feature subtree on success. The queue's applicant search reuses
// the Applicants list API (interviews filter by applicantId, not free text); interviewer selection
// and name resolution reuse the platform Users endpoint.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CancelInterview,
  type DecideInterview,
  type ReassignInterviewPanel,
  type RescheduleInterview,
  type ScheduleInterview,
  type SkipInterviewer,
  type SubmitInterviewEvaluation,
} from '@ecms/contracts';
import { detailKey, featureKey, listKey } from '../../../../../shared/lib/query-keys';
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

/** Active interview-stage catalog (labels rounds + backs the stage picker). */
export const useInterviewStages = () =>
  useQuery({
    queryKey: [MODULE, 'interviewStages', 'active'],
    queryFn: () => api.listInterviewStages(),
    staleTime: 5 * 60_000,
    select: (page) => page.items,
  });

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

const useInvalidateInterviews = (): (() => void) => {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: featureKey(MODULE, FEATURE) });
  };
};

export const useScheduleInterview = () => {
  const invalidate = useInvalidateInterviews();
  return useMutation({ mutationFn: (body: ScheduleInterview) => api.scheduleInterview(body), onSuccess: invalidate });
};

export const useRescheduleInterview = (id: string) => {
  const invalidate = useInvalidateInterviews();
  return useMutation({
    mutationFn: (body: RescheduleInterview) => api.rescheduleInterview(id, body),
    onSuccess: invalidate,
  });
};

export const useReassignPanel = (id: string) => {
  const invalidate = useInvalidateInterviews();
  return useMutation({
    mutationFn: (body: ReassignInterviewPanel) => api.reassignInterviewPanel(id, body),
    onSuccess: invalidate,
  });
};

export const useSkipInterviewer = (id: string) => {
  const invalidate = useInvalidateInterviews();
  return useMutation({ mutationFn: (body: SkipInterviewer) => api.skipInterviewer(id, body), onSuccess: invalidate });
};

export const useCancelInterview = (id: string) => {
  const invalidate = useInvalidateInterviews();
  return useMutation({ mutationFn: (body: CancelInterview) => api.cancelInterview(id, body), onSuccess: invalidate });
};

export const useSubmitEvaluation = (id: string) => {
  const invalidate = useInvalidateInterviews();
  return useMutation({
    mutationFn: (body: SubmitInterviewEvaluation) => api.submitInterviewEvaluation(id, body),
    onSuccess: invalidate,
  });
};

export const useDecideInterview = (id: string) => {
  const invalidate = useInvalidateInterviews();
  return useMutation({ mutationFn: (body: DecideInterview) => api.decideInterview(id, body), onSuccess: invalidate });
};
