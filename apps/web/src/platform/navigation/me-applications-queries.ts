// TanStack Query hook backing the dynamic sidebar. The effective navigation changes rarely within a
// session, so it is cached; the sidebar re-fetches on retry after an error.
import { useQuery } from '@tanstack/react-query';
import { getMyApplications } from './me-applications-api';

export const useMyApplications = () =>
  useQuery({
    queryKey: ['me', 'applications'],
    queryFn: getMyApplications,
    staleTime: 5 * 60_000,
  });
