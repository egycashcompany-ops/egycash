// Employee cost-centre membership (`/hr/employees/:id/cost-centers`).
//
// The endpoint is HR's because it is about an employee; the PERMISSIONS are the platform cost
// centre's, because placing a person somewhere is that authority. The catalog picker below needs
// `costCenter.view`, which whoever may read this card already holds — the two live on one
// resource, so the screen never asks for a grant it cannot justify.
import { type CostCenterAssignmentDto, type CostCenterDto, type Paginated } from '@ecms/contracts';
import { get, getPage, post } from '../../../../../shared/lib/api-client';

export const listEmployeeCostCenters = (employeeId: string): Promise<CostCenterAssignmentDto[]> =>
  get<CostCenterAssignmentDto[]>(`/hr/employees/${employeeId}/cost-centers`);

export const assignEmployeeCostCenter = (
  employeeId: string,
  body: { costCenterId: string; effectiveFrom: string; note?: string },
): Promise<{ id: string }> =>
  post<{ id: string }>(`/hr/employees/${employeeId}/cost-centers`, body);

export const endEmployeeCostCenter = (
  employeeId: string,
  assignmentId: string,
  on: string,
): Promise<void> =>
  post<void>(`/hr/employees/${employeeId}/cost-centers/${assignmentId}/end`, { on });

/** The catalog, for the picker. Active only — an inactive centre cannot start a new assignment. */
export const listAssignableCostCenters = (): Promise<Paginated<CostCenterDto>> =>
  getPage<CostCenterDto>('/platform/cost-centers?status=active&pageSize=100');
