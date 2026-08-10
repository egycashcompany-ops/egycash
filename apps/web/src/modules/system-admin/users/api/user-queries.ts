// TanStack Query hooks for the users administration screens (ADR-013). Keys follow the platform
// factory — ['system-admin', 'users', kind, …] — so a write invalidates exactly its own subtree.
//
// Every mutation here reseeds the detail cache from the server's answer rather than patching the
// cached DTO, because half of what the screen shows is DERIVED server-side: `accountStatus` is a
// pure function of status, lock state and the pending setup link (`user.service.ts` §15.4), and a
// client that recomputed it would drift from the server the first time one of those inputs moved.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeUserStatus, type CreateUser, type UpdateUser } from '@ecms/contracts';
import { detailKey, featureKey, listKey } from '../../../../shared/lib/query-keys';
import * as api from './user-api';
import { type SystemUserListParams } from './user-api';

const MODULE = 'system-admin';
const FEATURE = 'users';

/** How many history rows the Activity tab shows. Bounded on purpose — see UserActivityTab. */
export const TIMELINE_PAGE_SIZE = 25;

const usersKey = featureKey(MODULE, FEATURE);

export const useSystemUsers = (params: SystemUserListParams) =>
  useQuery({
    queryKey: listKey(MODULE, FEATURE, params),
    queryFn: () => api.listUsers(params),
  });

export const useSystemUser = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, FEATURE, id),
    queryFn: () => api.getUser(id),
  });

export const useUserTimeline = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: [MODULE, FEATURE, 'timeline', id],
    queryFn: () => api.getUserTimeline(id, TIMELINE_PAGE_SIZE),
    enabled,
  });

/**
 * Everything an administrator can do to one account invalidates the same two things: the account
 * itself and the list it appears in. The Activity tab is invalidated too — each of these actions
 * writes an audit row, so the history on screen is stale the moment the action succeeds.
 */
const useUserAction = <TArgs, TResult>(
  mutationFn: (args: TArgs) => Promise<TResult>,
  userId: string,
) => {
  const qc = useQueryClient();
  return useMutation<TResult, unknown, TArgs>({
    mutationFn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: usersKey });
      void qc.invalidateQueries({ queryKey: [MODULE, FEATURE, 'timeline', userId] });
    },
  });
};

export const useChangeUserStatus = (id: string) =>
  useUserAction((body: ChangeUserStatus) => api.changeUserStatus(id, body), id);

export const useResetUserPassword = (id: string) =>
  useUserAction(() => api.resetUserPassword(id), id);

export const useResendUserCredentials = (id: string) =>
  useUserAction(() => api.resendUserCredentials(id), id);

export const useResetUserTotp = (id: string) => useUserAction(() => api.resetUserTotp(id), id);

export const useSetUserTotpRequired = (id: string) =>
  useUserAction((required: boolean) => api.setUserTotpRequired(id, required), id);

export const useRevokeUserSessions = (id: string) =>
  useUserAction(() => api.revokeUserSessions(id), id);

export const useUnlockUser = (id: string) => useUserAction(() => api.unlockUser(id), id);

export const useUpdateUser = (id: string) =>
  useUserAction((body: UpdateUser) => api.updateUser(id, body), id);

/** Creation has no account to invalidate the history of — only the list it will appear in. */
export const useCreateUser = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUser) => api.createUser(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: usersKey });
    },
  });
};

export const useBranchOptions = (enabled = true) =>
  useQuery({
    queryKey: [MODULE, 'branch-options'],
    queryFn: api.listBranchOptions,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

// ── Employee linkage (E1) ───────────────────────────────────────────────────
// The link lives on the EMPLOYEE, so writing it invalidates the account (whose `employeeId` moved)
// and the employee lookup that renders its name.

export const useEmployeeSearch = (term: string, enabled: boolean) =>
  useQuery({
    queryKey: [MODULE, 'employee-search', term],
    queryFn: () => api.searchEmployees(term),
    enabled: enabled && term.trim().length > 1,
    select: (page) => page.items,
  });

export const useLinkedEmployee = (employeeId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: [MODULE, 'employee', employeeId ?? '-'],
    queryFn: () => api.getEmployee(employeeId ?? ''),
    enabled: enabled && employeeId !== null,
    retry: false,
  });

export const useLinkUserToEmployee = (userId: string) =>
  useUserAction((employeeId: string) => api.linkUserToEmployee(employeeId, userId), userId);

export const useUnlinkUserFromEmployee = (userId: string) =>
  useUserAction((employeeId: string) => api.unlinkUserFromEmployee(employeeId), userId);
