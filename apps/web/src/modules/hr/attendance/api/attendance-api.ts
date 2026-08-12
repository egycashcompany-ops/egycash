// Attendance api/ surface (ADR-013) — AT-1's two admin screens. Endpoints match the backend
// contract exactly (frozen design v1.1 §5); the day/punch surfaces gain screens in AT-6.
import {
  type CreateShift,
  type CreateShiftAssignment,
  type EmployeeDto,
  type Paginated,
  type ShiftAssignmentDto,
  type ShiftDto,
  type UpdateShift,
} from '@ecms/contracts';
import {
  buildQuery,
  del,
  get,
  getPage,
  patch,
  post,
  type QueryParams,
} from '../../../../shared/lib/api-client';

export const listShifts = (): Promise<ShiftDto[]> => get<ShiftDto[]>('/hr/attendance/shifts');
export const createShift = (body: CreateShift): Promise<ShiftDto> =>
  post<ShiftDto>('/hr/attendance/shifts', body);
export const updateShift = (id: string, body: UpdateShift): Promise<ShiftDto> =>
  patch<ShiftDto>(`/hr/attendance/shifts/${id}`, body);

export const listShiftAssignments = (
  params: QueryParams,
): Promise<Paginated<ShiftAssignmentDto>> =>
  getPage<ShiftAssignmentDto>(`/hr/attendance/assignments${buildQuery(params)}`);
export const createShiftAssignment = (
  body: CreateShiftAssignment,
): Promise<ShiftAssignmentDto> => post<ShiftAssignmentDto>('/hr/attendance/assignments', body);
export const removeShiftAssignment = (id: string): Promise<unknown> =>
  del<unknown>(`/hr/attendance/assignments/${id}`);

/** Server-side employee search for the assignment dialog (ADR-019 rule 5 — never load-all). */
export const searchEmployees = (search: string, pageSize = 8): Promise<Paginated<EmployeeDto>> =>
  getPage<EmployeeDto>(`/hr/employees${buildQuery({ search, employed: true, pageSize })}`);
