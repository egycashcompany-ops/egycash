// Interviews feature api/ surface (ADR-013). Every backend call in one place, through the shared
// api-client (typed REST + silent refresh); the hooks in interview-queries.ts wrap these in
// TanStack Query with keys + invalidation. Endpoints match the backend contract exactly
// (/hr/interviews, /hr/interview-stages). Interviewer selection/resolution reuses the existing
// platform Users endpoint (/platform/users) — no new API is invented.
import {
  type CancelInterview,
  type DecideInterview,
  type InterviewDto,
  type InterviewStageDto,
  type Paginated,
  type ReassignInterviewPanel,
  type RescheduleInterview,
  type ScheduleInterview,
  type SkipInterviewer,
  type SubmitInterviewEvaluation,
  type UserDto,
} from '@ecms/contracts';
import { buildQuery, get, getPage, post } from '../../../../../shared/lib/api-client';

export type InterviewListParams = Record<string, string | number | boolean | undefined | null>;

export const listInterviews = (params: InterviewListParams): Promise<Paginated<InterviewDto>> =>
  getPage<InterviewDto>(`/hr/interviews${buildQuery(params)}`);

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

// Interview stages (admin-configurable catalog, OQ-31). The queue/schedule flow reads the active
// stages to label rounds and to pick a stage; management (create/update) is out of this scope.
export const listInterviewStages = (): Promise<Paginated<InterviewStageDto>> =>
  getPage<InterviewStageDto>(`/hr/interview-stages${buildQuery({ active: true, pageSize: 100 })}`);

// Platform Users (reused for panel selection + name resolution — an existing endpoint, gated by
// `user.view`; degrades to raw identifiers when the caller lacks directory access).
export const searchUsers = (term: string): Promise<Paginated<UserDto>> =>
  getPage<UserDto>(`/platform/users${buildQuery({ search: term, status: 'active', pageSize: 8 })}`);

export const getUser = (id: string): Promise<UserDto> => get<UserDto>(`/platform/users/${id}`);
