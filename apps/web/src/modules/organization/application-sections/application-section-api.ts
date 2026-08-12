// Application Sections feature api surface (`/platform/application-sections`). A section groups
// applications inside one category; it is administered under the category's own grants, so this
// adds no permission of its own.
import {
  type ApplicationSectionDto,
  type CreateApplicationSection,
  type Paginated,
  type ReorderApplicationSections,
  type ReorderApplications,
  type UpdateApplicationSection,
  type ApplicationDto,
} from '@ecms/contracts';
import { buildQuery, del, getPage, patch, post, type QueryParams } from '../../../shared/lib/api-client';

export const listApplicationSections = (
  params: QueryParams,
): Promise<Paginated<ApplicationSectionDto>> =>
  getPage<ApplicationSectionDto>(`/platform/application-sections${buildQuery(params)}`);

export const createApplicationSection = (
  body: CreateApplicationSection,
): Promise<ApplicationSectionDto> =>
  post<ApplicationSectionDto>('/platform/application-sections', body);

export const updateApplicationSection = (
  id: string,
  body: UpdateApplicationSection,
): Promise<ApplicationSectionDto> =>
  patch<ApplicationSectionDto>(`/platform/application-sections/${id}`, body);

export const deleteApplicationSection = (id: string): Promise<void> =>
  del<void>(`/platform/application-sections/${id}`);

/** Order by POSITION: send the ids as they should read, the server renumbers. */
export const reorderApplicationSections = (
  body: ReorderApplicationSections,
): Promise<ApplicationSectionDto[]> =>
  patch<ApplicationSectionDto[]>('/platform/application-sections/reorder', body);

/** The single write behind every drag: which bucket a row lands in, and where inside it. */
export const reorderApplications = (body: ReorderApplications): Promise<ApplicationDto[]> =>
  patch<ApplicationDto[]>('/platform/applications/reorder', body);
