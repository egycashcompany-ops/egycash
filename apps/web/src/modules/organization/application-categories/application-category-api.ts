// Application Categories feature api surface — the standalone catalog that groups Applications in the
// sidebar (`/platform/application-categories`, gated by applicationCategory.*).
import {
  type ApplicationCategoryDto,
  type CreateApplicationCategory,
  type Paginated,
  type UpdateApplicationCategory,
} from '@ecms/contracts';
import { buildQuery, del, get, getPage, patch, post } from '../../../shared/lib/api-client';

export type ApplicationCategoryListParams = Record<
  string,
  string | number | boolean | undefined | null
>;

export const listApplicationCategories = (
  params: ApplicationCategoryListParams,
): Promise<Paginated<ApplicationCategoryDto>> =>
  getPage<ApplicationCategoryDto>(`/platform/application-categories${buildQuery(params)}`);

export const getApplicationCategory = (id: string): Promise<ApplicationCategoryDto> =>
  get<ApplicationCategoryDto>(`/platform/application-categories/${id}`);

export const createApplicationCategory = (
  body: CreateApplicationCategory,
): Promise<ApplicationCategoryDto> =>
  post<ApplicationCategoryDto>('/platform/application-categories', body);

export const updateApplicationCategory = (
  id: string,
  body: UpdateApplicationCategory,
): Promise<ApplicationCategoryDto> =>
  patch<ApplicationCategoryDto>(`/platform/application-categories/${id}`, body);

export const deleteApplicationCategory = (id: string): Promise<void> =>
  del<void>(`/platform/application-categories/${id}`);
