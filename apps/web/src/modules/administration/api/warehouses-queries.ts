// TanStack Query hooks for the warehouses (ADR-013). A warehouse write re-reads the register; the
// branch options and the department options are their own subtrees, since no warehouse write
// changes what a key reaches or which departments exist.
import { useQuery } from '@tanstack/react-query';
import {
  type CreateAdministrationWarehouse,
  type UpdateAdministrationWarehouse,
} from '@ecms/contracts';
import {
  administrationKeys,
  departmentOptionsKey,
  warehouseBranchOptionsKey,
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

/** The platform's departments — rarely change, so cached for a while. */
export const useDepartmentOptions = (enabled = true) =>
  useQuery({
    queryKey: departmentOptionsKey(),
    queryFn: api.listDepartmentOptions,
    staleTime: 5 * 60_000,
    enabled,
  });

export const useCreateWarehouse = () =>
  useAdministrationWrite(
    (body: CreateAdministrationWarehouse) => api.createWarehouse(body),
    [administrationKeys.warehouses],
  );

export const useUpdateWarehouse = () =>
  useAdministrationWrite(
    ({ id, body }: { id: string; body: UpdateAdministrationWarehouse }) =>
      api.updateWarehouse(id, body),
    [administrationKeys.warehouses],
  );
