// Interviews feature api/ surface (ADR-013). Every backend call in one place, through the shared
// api-client (typed REST + silent refresh); the hooks in interview-queries.ts wrap these in
// TanStack Query with keys + invalidation. Endpoints match the backend contract exactly
// (/hr/interviews, /hr/interview-stages). Interviewer selection/resolution reuses the existing
// platform Users endpoint (/platform/users) — no new API is invented.
import {
  type AwaitingInterviewDto,
  type CancelInterview,
  type CreateInterviewStage,
  type DecideInterview,
  type InterviewDto,
  type InterviewStageDto,
  type Paginated,
  type ReassignInterviewPanel,
  type RescheduleInterview,
  type ScheduleInterview,
  type SkipInterviewer,
  type SubmitInterviewEvaluation,
  type UpdateInterviewStage,
  type UserDto,
} from '@ecms/contracts';
import { buildQuery, get, getPage, patch, post } from '../../../../../shared/lib/api-client';

export type InterviewListParams = Record<string, string | number | boolean | undefined | null>;

export const listInterviews = (params: InterviewListParams): Promise<Paginated<InterviewDto>> =>
  getPage<InterviewDto>(`/hr/interviews${buildQuery(params)}`);

/** Applicants who passed Screening and await their first interview (pipeline entry). */
export const listAwaitingInterviews = (
  params: InterviewListParams,
): Promise<AwaitingInterviewDto[]> =>
  get<AwaitingInterviewDto[]>(`/hr/interviews/awaiting${buildQuery(params)}`);

export const getInterview = (id: string): Promise<InterviewDto> => get<InterviewDto>(`/hr/interviews/${id}`);

export const scheduleInterview = (body: ScheduleInterview): Promise<InterviewDto> =>
  post<InterviewDto>('/hr/interviews', body);

export const rescheduleInterview = (id: string, body: RescheduleInterview): Promise<InterviewDto> =>
  post<InterviewDto>(`/hr/interviews/${id}/reschedule`, body);

export const reassignInterviewPanel = (id: string, body: ReassignInterviewPanel): Promise<InterviewDto> =>
  post<InterviewDto>(`/hr/interviews/${id}/panel`, body);

export const skipInterviewer = (id: string, body: SkipInterviewer): Promise<InterviewDto> =>
  post<InterviewDto>(`/hr/interviews/${id}/panel/skip`, body);

export const cancelInterview = (id: string, body: CancelInterview): Promise<InterviewDto> =>
  post<InterviewDto>(`/hr/interviews/${id}/cancel`, body);

export const submitInterviewEvaluation = (id: string, body: SubmitInterviewEvaluation): Promise<InterviewDto> =>
  post<InterviewDto>(`/hr/interviews/${id}/evaluations`, body);

export const decideInterview = (id: string, body: DecideInterview): Promise<InterviewDto> =>
  post<InterviewDto>(`/hr/interviews/${id}/decide`, body);

/** Edit the outcome of a completed interview (D7: a decision is not final; fully audited). */
export const redecideInterview = (id: string, body: DecideInterview): Promise<InterviewDto> =>
  patch<InterviewDto>(`/hr/interviews/${id}/decision`, body);

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
