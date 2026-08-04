import { type DirectoryProfileDto } from '@ecms/contracts';
import { get, post } from '../../shared/lib/api-client';

export const getDirectoryProfile = (userId: string): Promise<DirectoryProfileDto> =>
  get<DirectoryProfileDto>(`/platform/directory/${userId}`);

/** Everyone a page mentions, in one request. */
export const resolveDirectoryProfiles = (userIds: string[]): Promise<DirectoryProfileDto[]> =>
  post<DirectoryProfileDto[]>('/platform/directory/resolve', { userIds });
