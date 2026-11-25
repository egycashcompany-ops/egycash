// The warehouses' calls (ADR-013), one typed function per endpoint
// `apps/api/src/modules/administration/warehouses/warehouses/warehouse.routes.ts` serves. No delete:
// `isActive: false` on the PATCH retires a warehouse (§5.3).
//
// Which branches the register's filter and the create dialog offer is the module's own read,
// `/administration/warehouses/branch-options` — the web cannot work out a key's reach per branch
// (§19.3). The department a warehouse names is a platform option (`/platform/departments/options`,
// readable by any signed-in user), read here rather than through the Organization module: no module
// imports another (`.github/pull_request_template.md`, IT's `it-api.ts` precedent).
import {
  type AdministrationWarehouseBranchOptionDto,
  type AdministrationWarehouseDto,
  type CreateAdministrationWarehouse,
  type OrgUnitOptionDto,
  type Paginated,
  type UpdateAdministrationWarehouse,
} from '@ecms/contracts';
import { buildQuery, get, getPage, patch, post } from '../../../shared/lib/api-client';
import { type AdministrationListParams } from './catalog-api';

export const listWarehouses = (
  params: AdministrationListParams,
): Promise<Paginated<AdministrationWarehouseDto>> =>
  getPage<AdministrationWarehouseDto>(`/administration/warehouses${buildQuery(params)}`);

export const createWarehouse = (
  body: CreateAdministrationWarehouse,
): Promise<AdministrationWarehouseDto> =>
  post<AdministrationWarehouseDto>('/administration/warehouses', body);

export const updateWarehouse = (
  id: string,
  body: UpdateAdministrationWarehouse,
): Promise<AdministrationWarehouseDto> =>
  patch<AdministrationWarehouseDto>(`/administration/warehouses/${id}`, body);

/** Every active branch, as the top bar names and orders them, with `canView` and `canCreate`. */
export const listWarehouseBranchOptions = (): Promise<AdministrationWarehouseBranchOptionDto[]> =>
  get<AdministrationWarehouseBranchOptionDto[]>('/administration/warehouses/branch-options');

/** The departments — each branch's copies, `parentId` its branch — for the warehouse's owner. */
export const listDepartmentOptions = (): Promise<OrgUnitOptionDto[]> =>
  get<OrgUnitOptionDto[]>('/platform/departments/options');
