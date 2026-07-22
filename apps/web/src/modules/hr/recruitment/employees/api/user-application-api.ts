// User ↔ Applications assignment api surface (nested under a user:
// `/platform/users/:userId/applications`, gated by user.view/edit). `listActiveApplications` feeds
// the assign picker with active applications to choose from.
import { type ApplicationDto, type Paginated } from '@ecms/contracts';
import { buildQuery, del, get, getPage, post } from '../../../../../shared/lib/api-client';

export const listUserApplications = (userId: string): Promise<ApplicationDto[]> =>
  get<ApplicationDto[]>(`/platform/users/${userId}/applications`);

export const assignUserApplication = (userId: string, applicationId: string): Promise<ApplicationDto> =>
  post<ApplicationDto>(`/platform/users/${userId}/applications`, { applicationId });

export const removeUserApplication = (userId: string, applicationId: string): Promise<void> =>
  del<void>(`/platform/users/${userId}/applications/${applicationId}`);

export const listActiveApplications = (): Promise<Paginated<ApplicationDto>> =>
  getPage<ApplicationDto>(`/platform/applications${buildQuery({ status: 'active', pageSize: 200 })}`);
