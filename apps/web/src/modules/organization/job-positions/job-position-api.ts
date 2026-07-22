// Job Position feature api surface — a reusable organization master entity (`/platform/job-positions`,
// gated by jobPosition.*). A Job Position is owned by a Department (required) and optionally placed at
// a Section within it. It is NOT tied to Recruitment and needs no Job Requisition (ADR-016).
import {
  type CreateJobPosition,
  type JobPositionDto,
  type Paginated,
  type UpdateJobPosition,
} from '@ecms/contracts';
import { buildQuery, del, get, getPage, patch, post } from '../../../shared/lib/api-client';

export type JobPositionListParams = Record<string, string | number | boolean | undefined | null>;

export const listJobPositions = (params: JobPositionListParams): Promise<Paginated<JobPositionDto>> =>
  getPage<JobPositionDto>(`/platform/job-positions${buildQuery(params)}`);

export const getJobPosition = (id: string): Promise<JobPositionDto> =>
  get<JobPositionDto>(`/platform/job-positions/${id}`);

export const createJobPosition = (body: CreateJobPosition): Promise<JobPositionDto> =>
  post<JobPositionDto>('/platform/job-positions', body);

export const updateJobPosition = (id: string, body: UpdateJobPosition): Promise<JobPositionDto> =>
  patch<JobPositionDto>(`/platform/job-positions/${id}`, body);

export const deleteJobPosition = (id: string): Promise<void> =>
  del<void>(`/platform/job-positions/${id}`);
