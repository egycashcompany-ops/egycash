// The active users page's one read. Its own file, as every system-admin surface has its own
// client: «who is on now» is not part of the users API, and is gated by its own permission.
import { useQuery } from '@tanstack/react-query';
import { type ActiveUsersDto, type ListActiveUsersQuery } from '@ecms/contracts';
import { api } from '../../../../shared/lib/api-client';

/** How often the page asks again while it is open — «who is on now» goes stale in minutes. */
export const ACTIVE_USERS_REFRESH_MS = 30_000;

export const listActiveUsers = (query: ListActiveUsersQuery): Promise<ActiveUsersDto> => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string' && value !== '') params.set(key, value);
  }
  const qs = params.toString();
  return api<ActiveUsersDto>(`/platform/presence/active-users${qs === '' ? '' : `?${qs}`}`);
};

export const useActiveUsers = (query: ListActiveUsersQuery) =>
  useQuery({
    queryKey: ['platform', 'presence', 'active-users', query],
    queryFn: () => listActiveUsers(query),
    refetchInterval: ACTIVE_USERS_REFRESH_MS,
    // The page keeps showing the last answer while the next one is on its way.
    placeholderData: (previous) => previous,
  });
