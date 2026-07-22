// Applications (Modules) feature api surface — a standalone platform catalog (`/platform/applications`,
// gated by application.*). Each application is a navigable module (icon + route) grouped by category
// and ordered by sortOrder; it is the future source of navigation and module access.
import {
  type ApplicationDto,
  type CreateApplication,
  type Paginated,
  type UpdateApplication,
} from '@ecms/contracts';
import { buildQuery, del, get, getPage, patch, post } from '../../../shared/lib/api-client';

export type ApplicationListParams = Record<string, string | number | boolean | undefined | null>;

export const listApplications = (params: ApplicationListParams): Promise<Paginated<ApplicationDto>> =>
  getPage<ApplicationDto>(`/platform/applications${buildQuery(params)}`);

export const getApplication = (id: string): Promise<ApplicationDto> =>
  get<ApplicationDto>(`/platform/applications/${id}`);

export const createApplication = (body: CreateApplication): Promise<ApplicationDto> =>
  post<ApplicationDto>('/platform/applications', body);

export const updateApplication = (id: string, body: UpdateApplication): Promise<ApplicationDto> =>
  patch<ApplicationDto>(`/platform/applications/${id}`, body);

export const deleteApplication = (id: string): Promise<void> =>
  del<void>(`/platform/applications/${id}`);
