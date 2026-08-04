// TanStack Query hooks for the Interviews feature (ADR-013). Reads cached by the shared key
// factory; writes apply the workflow envelope to the cache (I6) rather than refetching. The queue's
// applicant search reuses the Applicants list API (interviews filter by applicantId, not free
// text); interviewer selection and name resolution reuse the platform Users endpoint.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type BulkScheduleInterviews,
  type BulkStartInterviews,
  type CancelInterview,
  type CreateInterviewStage,
  type DecideInterview,
  type ReassignInterviewPanel,
  type RescheduleInterview,
  type ScheduleInterview,
  type SkipInterviewer,
  type StartInterview,
  type StartScheduledInterview,
  type SubmitInterviewEvaluation,
  type UpdateInterviewStage,
  type BulkInterviews,
} from '@ecms/contracts';
import { detailKey, listKey } from '../../../../../shared/lib/query-keys';
import { listApplicants } from '../../applicants/api/applicant-api';
import { useBulkMutation } from '../../../../../shared/lib/useBulkMutation';
import { applyBulkWorkflowResult, useWorkflowMutation } from '../../shared/useWorkflowMutation';
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

export const useScheduleInterview = () =>
  useWorkflowMutation(FEATURE, (body: ScheduleInterview) => api.scheduleInterview(body));

export const useRescheduleInterview = (id: string) =>
  useWorkflowMutation(FEATURE, (body: RescheduleInterview) => api.rescheduleInterview(id, body));

export const useReassignPanel = (id: string) =>
  useWorkflowMutation(FEATURE, (body: ReassignInterviewPanel) => api.reassignInterviewPanel(id, body));

export const useSkipInterviewer = (id: string) =>
  useWorkflowMutation(FEATURE, (body: SkipInterviewer) => api.skipInterviewer(id, body));

export const useCancelInterview = (id: string) =>
  useWorkflowMutation(FEATURE, (body: CancelInterview) => api.cancelInterview(id, body));

export const useSubmitEvaluation = (id: string) =>
  useWorkflowMutation(FEATURE, (body: SubmitInterviewEvaluation) => api.submitInterviewEvaluation(id, body));

export const useDecideInterview = (id: string) =>
  useWorkflowMutation(FEATURE, (body: DecideInterview) => api.decideInterview(id, body));

export const useRedecideInterview = (id: string) =>
  useWorkflowMutation(FEATURE, (body: DecideInterview) => api.redecideInterview(id, body));

/**
 * RW12 — start ONE candidate's round now. The round may not have existed a moment ago, and the
 * envelope reports the one it opened, so this needs no more refreshing than any other act.
 */
export const useStartInterview = () =>
  useWorkflowMutation(FEATURE, (body: StartInterview) => api.startInterview(body));

/** Start an already-scheduled round (`scheduled → inProgress`). */
export const useStartScheduledInterview = (id: string) =>
  useWorkflowMutation(FEATURE, (body: StartScheduledInterview) => api.startScheduledInterview(id, body));

/**
 * The same act addressed by id at call time — a queue row starts a round it does not "own", so it
 * cannot bind a hook per row.
 */
export const useStartScheduledInterviewRow = () =>
  useWorkflowMutation(FEATURE, (vars: { id: string; version: number }) =>
    api.startScheduledInterview(vars.id, { version: vars.version }),
  );

/** RW12 — bulk "Start now" over a stage's waiting queue. */
export const useBulkStartInterviews = (onApplied?: () => void) =>
  useBulkMutation<BulkStartInterviews>((body) => api.bulkStartInterviews(body), {
    applyResult: (qc, result) => applyBulkWorkflowResult(qc, FEATURE, result),
    ...(onApplied === undefined ? {} : { onApplied }),
  });

/** Bulk cancel / pass / fail a selection of rounds (RW17). */
export const useBulkInterviews = (onApplied?: () => void) =>
  useBulkMutation<BulkInterviews>((body) => api.bulkInterviews(body), {
    applyResult: (qc, result) => applyBulkWorkflowResult(qc, FEATURE, result),
    ...(onApplied === undefined ? {} : { onApplied }),
  });

/** RW17 — one stage + one date/panel across a selection, through the shared bulk executor. */
export const useBulkScheduleInterviews = (onApplied?: () => void) =>
  useBulkMutation<BulkScheduleInterviews>((body) => api.bulkScheduleInterviews(body), {
    applyResult: (qc, result) => applyBulkWorkflowResult(qc, FEATURE, result),
    ...(onApplied === undefined ? {} : { onApplied }),
  });
