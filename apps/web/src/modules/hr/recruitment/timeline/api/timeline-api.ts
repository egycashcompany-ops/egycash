// Recruitment-timeline api/ surface (ADR-013): every backend call in one place. Uses the shared
// api-client; the hooks in timeline-queries.ts wrap these in TanStack Query.
import {
  type AddTimelineNote,
  type RecruitmentTimelineEntryDto,
} from '@ecms/contracts';
import { buildQuery, get, post,
  type QueryParams,
} from '../../../../../shared/lib/api-client';

export type TimelineParams = QueryParams;

export const listRecruitmentTimeline = (
  applicantId: string,
  params: TimelineParams = {},
): Promise<RecruitmentTimelineEntryDto[]> =>
  get<RecruitmentTimelineEntryDto[]>(`/hr/applicants/${applicantId}/timeline${buildQuery(params)}`);

export const addRecruitmentTimelineNote = (
  applicantId: string,
  body: AddTimelineNote,
): Promise<RecruitmentTimelineEntryDto> =>
  post<RecruitmentTimelineEntryDto>(`/hr/applicants/${applicantId}/timeline/notes`, body);
