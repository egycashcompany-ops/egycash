// Department ↔ Applications assignment api surface (nested under a department:
// `/platform/departments/:departmentId/applications`, gated by department.view/edit). The list
// returns the assigned applications themselves (ApplicationDto[]).
import { type ApplicationDto } from '@ecms/contracts';
import { del, get, post } from '../../../shared/lib/api-client';

export const listDepartmentApplications = (departmentId: string): Promise<ApplicationDto[]> =>
  get<ApplicationDto[]>(`/platform/departments/${departmentId}/applications`);

export const assignDepartmentApplication = (
  departmentId: string,
  applicationId: string,
): Promise<ApplicationDto> =>
  post<ApplicationDto>(`/platform/departments/${departmentId}/applications`, { applicationId });

export const removeDepartmentApplication = (
  departmentId: string,
  applicationId: string,
): Promise<void> => del<void>(`/platform/departments/${departmentId}/applications/${applicationId}`);
