// TanStack Query hooks for the warehouses (ADR-013). A warehouse write re-reads the register; the
// branch options and the department options are their own subtrees, since no warehouse write
// changes what a key reaches or which departments exist.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AdministrationWarehouseDto,
  type CreateAdministrationWarehouse,
  type UpdateAdministrationWarehouse,
} from '@ecms/contracts';
import {
  administrationKeys,
  departmentNamesKey,
  departmentOptionsKey,
  warehouseBranchOptionsKey,
  warehouseKey,
  warehouseListKey,
} from './administration-keys';
import { type AdministrationListParams } from './catalog-api';
import { useAdministrationWrite } from './catalog-queries';
import * as api from './warehouses-api';

export const useAdministrationWarehouses = (params: AdministrationListParams, enabled = true) =>
  useQuery({
    queryKey: warehouseListKey(params),
    queryFn: () => api.listWarehouses(params),
    placeholderData: (prev) => prev,
    enabled,
  });

/**
 * What the reader may do per branch. It follows the top bar's choice (`canView`, `canCreate`), so
 * it is read again when the screen mounts rather than kept for the session.
 */
export const useWarehouseBranchOptions = (enabled = true) =>
  useQuery({
    queryKey: warehouseBranchOptionsKey(),
    queryFn: api.listWarehouseBranchOptions,
    enabled,
  });

/** The platform's active departments — rarely change, so cached for a while. */
export const useDepartmentOptions = (enabled = true) =>
  useQuery({
    queryKey: departmentOptionsKey(),
    queryFn: () => api.listDepartmentOptions(),
    staleTime: 5 * 60_000,
    enabled,
  });

/**
 * Every department, the retired ones too — read only to NAME a department a warehouse already
 * points at that the active list no longer holds, never to offer one.
 */
export const useDepartmentNames = (enabled = true) =>
  useQuery({
    queryKey: departmentNamesKey(),
    queryFn: () => api.listDepartmentOptions(true),
    staleTime: 5 * 60_000,
    enabled,
  });

/** One warehouse as it now is — what a form rebases on after a stale save. */
export const useRereadWarehouse = (): ((id: string) => Promise<AdministrationWarehouseDto>) => {
  const qc = useQueryClient();
  return (id) =>
    qc.fetchQuery({
      queryKey: warehouseKey(id),
      queryFn: () => api.getWarehouse(id),
      staleTime: 0,
    });
};

/** A warehouse is shown on its register and the home's count, both under `warehouses`. */
export const WAREHOUSE_SUBTREES = [administrationKeys.warehouses] as const;

export const useCreateWarehouse = () =>
  useAdministrationWrite(
    (body: CreateAdministrationWarehouse) => api.createWarehouse(body),
    WAREHOUSE_SUBTREES,
  );

export const useUpdateWarehouse = () =>
  useAdministrationWrite(
    ({ id, body }: { id: string; body: UpdateAdministrationWarehouse }) =>
      api.updateWarehouse(id, body),
    WAREHOUSE_SUBTREES,
  );
