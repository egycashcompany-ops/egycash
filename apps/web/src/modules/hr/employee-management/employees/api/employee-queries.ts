// TanStack Query hooks for the Employees feature (ADR-013). Reads cached by the shared key factory;
// the create write seeds the new detail cache and invalidates only the list subtree. The accepted-
// offer lookup reuses the Job Offer list API (search + status:'accepted'); the org/manager reference
// resolution reuses the Job Offer feature's hooks/component — no new backend API is introduced.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CancelEmployeeAction,
  type CompensationAction,
  type CreateEmployee,
  type CreateEmployeeLogin,
  type DirectRegisterEmployee,
  type EmployeeDto,
  type EmploymentAction,
  type ExitAction,
  type RehireAction,
  type UpdateEmployeePersonal,
  type UpdateUser,
} from '@ecms/contracts';
import { detailKey, listKey } from '../../../../../shared/lib/query-keys';
import { listJobOffers } from '../../../recruitment/job-offers/api/job-offer-api';
import * as api from './employee-api';
import { type EmployeeListParams } from './employee-api';

const MODULE = 'hr';
const FEATURE = 'employees';

export const useEmployees = (params: EmployeeListParams) =>
  useQuery({
    queryKey: listKey(MODULE, FEATURE, params),
    queryFn: () => api.listEmployees(params),
    placeholderData: (prev) => prev,
  });

export const useEmployee = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, FEATURE, id),
    queryFn: () => api.getEmployee(id),
    enabled: id !== '',
  });

/** Accepted-offer lookup for the create flow (reuses the Job Offer list API). */
export const useAcceptedOfferSearch = (term: string) =>
  useQuery({
    queryKey: [MODULE, 'jobOffers', 'search', 'accepted', term],
    queryFn: () => listJobOffers({ search: term, status: 'accepted', pageSize: 8 }),
    enabled: term.trim().length >= 2,
    staleTime: 30_000,
    select: (page) => page.items,
  });

export const useCreateEmployee = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateEmployee) => api.createEmployee(body),
    onSuccess: (created: EmployeeDto) => {
      qc.setQueryData(detailKey(MODULE, FEATURE, created.id), created);
      void qc.invalidateQueries({ queryKey: listKey(MODULE, FEATURE) });
    },
  });
};

// ── Platform Identity (ADR-017) ──────────────────────────────────────────────
/** Resolve the hiring branch's Branch Code; degrades to empty without `branch.view`. */
export const useBranch = (branchId: string) =>
  useQuery({
    queryKey: [MODULE, 'branches', 'detail', branchId],
    queryFn: () => api.getBranch(branchId),
    enabled: branchId !== '',
    staleTime: 5 * 60_000,
    retry: false,
  });

/** The employee's linked login account, if any. */
export const useLinkedUser = (userId: string | null) =>
  useQuery({
    queryKey: [MODULE, 'users', 'detail', userId ?? ''],
    queryFn: () => api.getUser(userId ?? ''),
    enabled: userId !== null,
    retry: false,
  });

/** The linked account's data scopes (from its role assignments); degrades to empty on denial. */
export const useUserAssignments = (userId: string | null) =>
  useQuery({
    queryKey: [MODULE, 'roleAssignments', 'list', userId ?? ''],
    queryFn: () => api.listUserAssignments(userId ?? ''),
    enabled: userId !== null,
    retry: false,
    select: (page) => page.items,
  });

export const useCreateEmployeeLogin = (employeeId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateEmployeeLogin) => api.createEmployeeLogin(employeeId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: detailKey(MODULE, FEATURE, employeeId) });
    },
  });
};

export const useUpdateUser = (userId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateUser) => api.updateUser(userId, body),
    onSuccess: (updated) => {
      qc.setQueryData([MODULE, 'users', 'detail', userId], updated);
    },
  });
};

// ── Employee registry additions (frozen design) ─────────────────────────────

export const useRegisterEmployeeDirect = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DirectRegisterEmployee) => api.registerEmployeeDirect(body),
    onSuccess: (created: EmployeeDto) => {
      qc.setQueryData(detailKey(MODULE, FEATURE, created.id), created);
      void qc.invalidateQueries({ queryKey: listKey(MODULE, FEATURE) });
    },
  });
};

export const useUpdateEmployeePersonal = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateEmployeePersonal) => api.updateEmployeePersonal(id, body),
    onSuccess: (updated: EmployeeDto) => {
      qc.setQueryData(detailKey(MODULE, FEATURE, id), updated);
      void qc.invalidateQueries({ queryKey: [MODULE, FEATURE, 'timeline', id] });
    },
  });
};

export const useRehireCheck = (nationalId: string) =>
  useQuery({
    queryKey: [MODULE, FEATURE, 'rehireCheck', nationalId],
    queryFn: () => api.rehireCheck(nationalId),
    enabled: nationalId.trim().length >= 5,
    staleTime: 30_000,
  });

export const useSubordinates = (id: string) =>
  useQuery({
    queryKey: [MODULE, FEATURE, 'subordinates', id],
    queryFn: () => api.listSubordinates(id),
    enabled: id !== '',
  });

export const useEmployeeTimeline = (id: string) =>
  useQuery({
    queryKey: [MODULE, FEATURE, 'timeline', id],
    queryFn: () => api.getEmployeeTimeline(id),
    enabled: id !== '',
  });

export const useEmployeeActions = (id: string, params: Record<string, string | number | undefined>) =>
  useQuery({
    queryKey: [MODULE, FEATURE, 'actions', id, params],
    queryFn: () => api.listEmployeeActions(id, params),
    enabled: id !== '',
    placeholderData: (prev) => prev,
  });

/** Invalidate everything the actions engine may have touched (profile, actions, timeline, list). */
const useInvalidateAfterAction = (id: string) => {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: detailKey(MODULE, FEATURE, id) });
    void qc.invalidateQueries({ queryKey: listKey(MODULE, FEATURE) });
    void qc.invalidateQueries({ queryKey: [MODULE, FEATURE, 'actions', id] });
    void qc.invalidateQueries({ queryKey: [MODULE, FEATURE, 'timeline', id] });
    void qc.invalidateQueries({ queryKey: [MODULE, FEATURE, 'subordinates', id] });
  };
};

export const useEmploymentAction = (id: string) => {
  const invalidate = useInvalidateAfterAction(id);
  return useMutation({
    mutationFn: (body: EmploymentAction) => api.createEmploymentAction(id, body),
    onSuccess: invalidate,
  });
};

export const useCompensationAction = (id: string) => {
  const invalidate = useInvalidateAfterAction(id);
  return useMutation({
    mutationFn: (body: CompensationAction) => api.createCompensationAction(id, body),
    onSuccess: invalidate,
  });
};

export const useExitAction = (id: string) => {
  const invalidate = useInvalidateAfterAction(id);
  return useMutation({
    mutationFn: (body: ExitAction) => api.createExitAction(id, body),
    onSuccess: invalidate,
  });
};

export const useRehireAction = (id: string) => {
  const invalidate = useInvalidateAfterAction(id);
  return useMutation({
    mutationFn: (body: RehireAction) => api.createRehireAction(id, body),
    onSuccess: invalidate,
  });
};

export const useCancelEmployeeAction = (id: string) => {
  const invalidate = useInvalidateAfterAction(id);
  return useMutation({
    mutationFn: ({ actionId, body }: { actionId: string; body: CancelEmployeeAction }) =>
      api.cancelEmployeeAction(id, actionId, body),
    onSuccess: invalidate,
  });
};
