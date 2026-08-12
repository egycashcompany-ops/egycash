// TanStack Query hooks for the pay-item catalog and the employee assignments (ADR-013).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CreateEmployeePayItem,
  type CreatePayItem,
  type UpdatePayItem,
} from '@ecms/contracts';
import { featureKey, listKey } from '../../../../shared/lib/query-keys';
import * as api from './payroll-api';

const MODULE = 'hr';
const FEATURE = 'payItems';

export const usePayItems = (params: Record<string, string | number>) =>
  useQuery({
    queryKey: listKey(MODULE, FEATURE, params),
    queryFn: () => api.listPayItems(params),
    placeholderData: (prev) => prev,
  });

const useCatalogMutation = <TVars>(fn: (vars: TVars) => Promise<unknown>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void client.invalidateQueries({ queryKey: featureKey(MODULE, FEATURE) }),
  });
};

export const useCreatePayItem = () =>
  useCatalogMutation((body: CreatePayItem) => api.createPayItem(body));

export const useUpdatePayItem = () =>
  useCatalogMutation(({ id, body }: { id: string; body: UpdatePayItem }) =>
    api.updatePayItem(id, body),
  );

export const useDeletePayItem = () => useCatalogMutation((id: string) => api.deletePayItem(id));

// ── Employee pay items (PY-2) ───────────────────────────────────────────────

const EMPLOYEE_FEATURE = 'employeePayItems';

export const useEmployeePayItems = (
  employeeId: string,
  params: Record<string, string | number>,
) =>
  useQuery({
    queryKey: listKey(MODULE, EMPLOYEE_FEATURE, { employeeId, ...params }),
    queryFn: () => api.listEmployeePayItems(employeeId, params),
    placeholderData: (prev) => prev,
  });

/**
 * Both writes invalidate the employee feature AND the catalog: archiving the last assignment of
 * an item changes whether that item may be deleted, and the catalog screen shows that.
 */
const useEmployeePayItemMutation = <TVars, TData>(fn: (vars: TVars) => Promise<TData>) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: featureKey(MODULE, EMPLOYEE_FEATURE) });
      void client.invalidateQueries({ queryKey: featureKey(MODULE, FEATURE) });
    },
  });
};

export const useCreateEmployeePayItem = (employeeId: string) =>
  useEmployeePayItemMutation((body: CreateEmployeePayItem) =>
    api.createEmployeePayItem(employeeId, body),
  );

export const useRemoveEmployeePayItem = (employeeId: string) =>
  useEmployeePayItemMutation((id: string) => api.removeEmployeePayItem(employeeId, id));
