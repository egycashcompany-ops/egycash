// Job Offer feature api/ surface (ADR-013). Every backend call in one place, through the shared
// api-client. Endpoints match the backend contract exactly (`/hr/job-offers`). Organizational and
// manager references are resolved via existing platform endpoints (branches / departments /
// job-titles / users) — no new API is introduced.
import {
  type AcceptJobOffer,
  type BranchDto,
  type CreateJobOffer,
  type DepartmentDto,
  type JobOfferDto,
  type JobTitleDto,
  type Paginated,
  type RejectJobOffer,
  type ReviseJobOffer,
  type SendJobOffer,
  type UserDto,
  type WithdrawJobOffer,
} from '@ecms/contracts';
import { buildQuery, get, getPage, patch, post } from '../../../../../shared/lib/api-client';

export type JobOfferListParams = Record<string, string | number | boolean | undefined | null>;

export const listJobOffers = (params: JobOfferListParams): Promise<Paginated<JobOfferDto>> =>
  getPage<JobOfferDto>(`/hr/job-offers${buildQuery(params)}`);

export const getJobOffer = (id: string): Promise<JobOfferDto> => get<JobOfferDto>(`/hr/job-offers/${id}`);

export const createJobOffer = (body: CreateJobOffer): Promise<JobOfferDto> =>
  post<JobOfferDto>('/hr/job-offers', body);

export const reviseJobOffer = (id: string, body: ReviseJobOffer): Promise<JobOfferDto> =>
  patch<JobOfferDto>(`/hr/job-offers/${id}`, body);

export const sendJobOffer = (id: string, body: SendJobOffer): Promise<JobOfferDto> =>
  post<JobOfferDto>(`/hr/job-offers/${id}/send`, body);

export const acceptJobOffer = (id: string, body: AcceptJobOffer): Promise<JobOfferDto> =>
  post<JobOfferDto>(`/hr/job-offers/${id}/accept`, body);

export const rejectJobOffer = (id: string, body: RejectJobOffer): Promise<JobOfferDto> =>
  post<JobOfferDto>(`/hr/job-offers/${id}/reject`, body);

export const withdrawJobOffer = (id: string, body: WithdrawJobOffer): Promise<JobOfferDto> =>
  post<JobOfferDto>(`/hr/job-offers/${id}/withdraw`, body);

// ── Reference data (existing platform endpoints, reused; each gated by its own *.view) ──────────
export const listBranches = (): Promise<Paginated<BranchDto>> =>
  getPage<BranchDto>(`/platform/branches${buildQuery({ status: 'active', pageSize: 100 })}`);

export const listDepartments = (): Promise<Paginated<DepartmentDto>> =>
  getPage<DepartmentDto>(`/platform/departments${buildQuery({ status: 'active', pageSize: 100 })}`);

export const listJobTitles = (): Promise<Paginated<JobTitleDto>> =>
  getPage<JobTitleDto>(`/platform/job-titles${buildQuery({ status: 'active', pageSize: 100 })}`);

export const searchUsers = (term: string): Promise<Paginated<UserDto>> =>
  getPage<UserDto>(`/platform/users${buildQuery({ search: term, status: 'active', pageSize: 8 })}`);

export const getUser = (id: string): Promise<UserDto> => get<UserDto>(`/platform/users/${id}`);
