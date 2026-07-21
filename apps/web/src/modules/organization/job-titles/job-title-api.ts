// Job Title feature api surface — the enriched organization-wide catalog (`/platform/job-titles`,
// gated by jobTitle.*). A Job Title carries the role *definition* (grade, salary band, hiring
// requirements); it is deliberately NOT linked to a Branch/Department/Section here.
import {
  type CreateJobTitle,
  type JobTitleDto,
  type Paginated,
  type UpdateJobTitle,
} from '@ecms/contracts';
import { buildQuery, del, get, getPage, patch, post } from '../../../shared/lib/api-client';

export type JobTitleListParams = Record<string, string | number | boolean | undefined | null>;

export const listJobTitles = (params: JobTitleListParams): Promise<Paginated<JobTitleDto>> =>
  getPage<JobTitleDto>(`/platform/job-titles${buildQuery(params)}`);

export const getJobTitle = (id: string): Promise<JobTitleDto> =>
  get<JobTitleDto>(`/platform/job-titles/${id}`);

export const createJobTitle = (body: CreateJobTitle): Promise<JobTitleDto> =>
  post<JobTitleDto>('/platform/job-titles', body);

export const updateJobTitle = (id: string, body: UpdateJobTitle): Promise<JobTitleDto> =>
  patch<JobTitleDto>(`/platform/job-titles/${id}`, body);

export const deleteJobTitle = (id: string): Promise<void> =>
  del<void>(`/platform/job-titles/${id}`);
