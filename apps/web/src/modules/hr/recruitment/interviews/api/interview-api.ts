// Interviews feature api/ surface (ADR-013). Every backend call in one place, through the shared
// api-client (typed REST + silent refresh); the hooks in interview-queries.ts wrap these in
// TanStack Query with keys + invalidation. Endpoints match the backend contract exactly
// (/hr/interviews, /hr/interview-stages). Interviewer selection/resolution reuses the existing
// platform Users endpoint (/platform/users) — no new API is invented.
import {
  type BulkScheduleInterviews,
  type BulkStartInterviews,
  type CancelInterview,
  type CreateInterviewStage,
  type DecideInterview,
  type InterviewDto,
  type InterviewStageDto,
  type Paginated,
  type ReassignInterviewPanel,
  type RescheduleInterview,
  type ScheduleInterview,
  type SetPlacementRecommendation,
  type SkipInterviewer,
  type StartInterview,
  type StartScheduledInterview,
  type SubmitInterviewEvaluation,
  type UpdateInterviewStage,
  type UserDto,
  type BulkActionResultDto,
  type BulkInterviews,
} from '@ecms/contracts';
import {
  buildQuery,
  get,
  getPage,
  patch,
  patchWorkflow,
  post,
  postWorkflow,
} from '../../../../../shared/lib/api-client';

export type InterviewListParams = Record<string, string | number | boolean | undefined | null>;

export const listInterviews = (params: InterviewListParams): Promise<Paginated<InterviewDto>> =>
  getPage<InterviewDto>(`/hr/interviews${buildQuery(params)}`);

export const getInterview = (id: string): Promise<InterviewDto> => get<InterviewDto>(`/hr/interviews/${id}`);

export const scheduleInterview = (body: ScheduleInterview): Promise<InterviewDto> =>
  postWorkflow<InterviewDto>('/hr/interviews', body);

/**
 * RW12 — start a round for ONE candidate right now. The round need not exist yet, so this
 * addresses the CANDIDATE and the stage; the server opens the waiting record if it has to and
 * stamps the actor and the start time itself.
 */
export const startInterview = (body: StartInterview): Promise<InterviewDto> =>
  postWorkflow<InterviewDto>('/hr/interviews/start', body);

/** Start a round that was already scheduled: `scheduled → inProgress`, server-stamped. */
export const startScheduledInterview = (
  id: string,
  body: StartScheduledInterview,
): Promise<InterviewDto> => postWorkflow<InterviewDto>(`/hr/interviews/${id}/start`, body);

/** RW5 — the panel's advisory placement recommendation; never moves the candidate by itself. */
export const setInterviewRecommendation = (
  id: string,
  body: SetPlacementRecommendation,
): Promise<InterviewDto> => patchWorkflow<InterviewDto>(`/hr/interviews/${id}/recommendation`, body);

export const rescheduleInterview = (id: string, body: RescheduleInterview): Promise<InterviewDto> =>
  postWorkflow<InterviewDto>(`/hr/interviews/${id}/reschedule`, body);

export const reassignInterviewPanel = (id: string, body: ReassignInterviewPanel): Promise<InterviewDto> =>
  postWorkflow<InterviewDto>(`/hr/interviews/${id}/panel`, body);

export const skipInterviewer = (id: string, body: SkipInterviewer): Promise<InterviewDto> =>
  postWorkflow<InterviewDto>(`/hr/interviews/${id}/panel/skip`, body);

export const cancelInterview = (id: string, body: CancelInterview): Promise<InterviewDto> =>
  postWorkflow<InterviewDto>(`/hr/interviews/${id}/cancel`, body);

export const submitInterviewEvaluation = (id: string, body: SubmitInterviewEvaluation): Promise<InterviewDto> =>
  postWorkflow<InterviewDto>(`/hr/interviews/${id}/evaluations`, body);

export const decideInterview = (id: string, body: DecideInterview): Promise<InterviewDto> =>
  postWorkflow<InterviewDto>(`/hr/interviews/${id}/decide`, body);

/** Edit the outcome of a completed interview (D7: a decision is not final; fully audited). */
export const redecideInterview = (id: string, body: DecideInterview): Promise<InterviewDto> =>
  patchWorkflow<InterviewDto>(`/hr/interviews/${id}/decision`, body);

// Interview stages (admin-configurable catalog, OQ-31). The queue/schedule flow reads the active
// stages to label rounds and to pick a stage; the settings screen manages the catalog (create /
// edit / reorder / enable-disable) so a 3rd or 4th round is configured from the UI, not the API.
export const listInterviewStages = (): Promise<Paginated<InterviewStageDto>> =>
  getPage<InterviewStageDto>(`/hr/interview-stages${buildQuery({ active: true, pageSize: 100 })}`);

export const listAllInterviewStages = (): Promise<Paginated<InterviewStageDto>> =>
  getPage<InterviewStageDto>(`/hr/interview-stages${buildQuery({ pageSize: 100 })}`);

export const createInterviewStage = (body: CreateInterviewStage): Promise<InterviewStageDto> =>
  post<InterviewStageDto>('/hr/interview-stages', body);

export const updateInterviewStage = (id: string, body: UpdateInterviewStage): Promise<InterviewStageDto> =>
  patch<InterviewStageDto>(`/hr/interview-stages/${id}`, body);

// Platform Users (reused for panel selection + name resolution — an existing endpoint, gated by
// `user.view`; degrades to raw identifiers when the caller lacks directory access).
export const searchUsers = (term: string): Promise<Paginated<UserDto>> =>
  getPage<UserDto>(`/platform/users${buildQuery({ search: term, status: 'active', pageSize: 8 })}`);

export const getUser = (id: string): Promise<UserDto> => get<UserDto>(`/platform/users/${id}`);

/** RW12 — start the selected candidates' rounds NOW (no prior scheduling required). */
export const bulkStartInterviews = (body: BulkStartInterviews): Promise<BulkActionResultDto> =>
  post<BulkActionResultDto>('/hr/interviews/bulk/start', body);

/** RW17 — one stage + one date/panel applied across a selection of candidates. */
export const bulkScheduleInterviews = (
  body: BulkScheduleInterviews,
): Promise<BulkActionResultDto> => post<BulkActionResultDto>('/hr/interviews/bulk/schedule', body);

/** Bulk cancel / pass / fail / reassign a selection of rounds (RW17). */
export const bulkInterviews = (body: BulkInterviews): Promise<BulkActionResultDto> =>
  post<BulkActionResultDto>('/hr/interviews/bulk', body);
