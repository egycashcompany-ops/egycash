// Cost Centre catalog api surface (`/platform/cost-centers`, gated by costCenter.*).
//
// The catalog is identity only. Who belongs to a centre is an employee-side assignment and lives
// under `/hr/employees/:id/cost-centers` — a different screen, a different authority.
import {
  type CostCenterDto,
  type CreateCostCenter,
  type Paginated,
  type UpdateCostCenter,
} from '@ecms/contracts';
import {
  buildQuery,
  del,
  get,
  getPage,
  patch,
  post,
  type QueryParams,
} from '../../../shared/lib/api-client';

export type CostCenterListParams = QueryParams;

export const listCostCenters = (params: CostCenterListParams): Promise<Paginated<CostCenterDto>> =>
  getPage<CostCenterDto>(`/platform/cost-centers${buildQuery(params)}`);

export const getCostCenter = (id: string): Promise<CostCenterDto> =>
  get<CostCenterDto>(`/platform/cost-centers/${id}`);

export const createCostCenter = (body: CreateCostCenter): Promise<CostCenterDto> =>
  post<CostCenterDto>('/platform/cost-centers', body);

export const updateCostCenter = (id: string, body: UpdateCostCenter): Promise<CostCenterDto> =>
  patch<CostCenterDto>(`/platform/cost-centers/${id}`, body);

export const deleteCostCenter = (id: string): Promise<void> =>
  del<void>(`/platform/cost-centers/${id}`);
