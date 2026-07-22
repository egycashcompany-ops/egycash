// TanStack Query hooks for a user's direct application grants (ADR-013). Keyed per user; assign/remove
// invalidate that user's assignment list.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './user-application-api';

const KEY = 'userApplications';

export const useUserApplications = (userId: string) =>
  useQuery({
    queryKey: [KEY, userId],
    queryFn: () => api.listUserApplications(userId),
    enabled: userId !== '',
  });

export const useActiveApplications = (enabled: boolean) =>
  useQuery({
    queryKey: [KEY, 'active-options'],
    queryFn: () => api.listActiveApplications(),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    select: (page) => page.items,
  });

export const useAssignUserApplication = (userId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (applicationId: string) => api.assignUserApplication(userId, applicationId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [KEY, userId] });
    },
  });
};

export const useRemoveUserApplication = (userId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (applicationId: string) => api.removeUserApplication(userId, applicationId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [KEY, userId] });
    },
  });
};
