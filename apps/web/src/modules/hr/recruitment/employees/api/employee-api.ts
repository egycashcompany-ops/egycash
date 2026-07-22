// Employees feature api/ surface (ADR-013). Endpoints match the backend contract exactly
// (`/hr/employees`). Employment terms are copied server-side from the accepted offer snapshot — the
// create call only supplies the offer reference + an optional hiring date. Reference/offer lookups
// reuse the Job Offer feature's endpoints (no new API is introduced).
import {
  type BranchDto,
  type CreateEmployee,
  type CreateEmployeeLogin,
  type EmployeeDto,
  type EmployeeLoginDto,
  type Paginated,
  type RoleAssignmentDto,
  type UpdateUser,
  type UserDto,
} from '@ecms/contracts';
import { buildQuery, get, getPage, patch, post } from '../../../../../shared/lib/api-client';

export type EmployeeListParams = Record<string, string | number | boolean | undefined | null>;

export const listEmployees = (params: EmployeeListParams): Promise<Paginated<EmployeeDto>> =>
  getPage<EmployeeDto>(`/hr/employees${buildQuery(params)}`);

export const getEmployee = (id: string): Promise<EmployeeDto> => get<EmployeeDto>(`/hr/employees/${id}`);

export const createEmployee = (body: CreateEmployee): Promise<EmployeeDto> =>
  post<EmployeeDto>('/hr/employees', body);

// ── Platform Identity (ADR-017): create a login for an employee, resolve the branch code, and
// read/update the linked account. All reuse existing platform endpoints — no new API surface. ──
export const createEmployeeLogin = (id: string, body: CreateEmployeeLogin): Promise<EmployeeLoginDto> =>
  post<EmployeeLoginDto>(`/hr/employees/${id}/login`, body);

export const getBranch = (id: string): Promise<BranchDto> => get<BranchDto>(`/platform/branches/${id}`);

export const getUser = (id: string): Promise<UserDto> => get<UserDto>(`/platform/users/${id}`);

export const updateUser = (id: string, body: UpdateUser): Promise<UserDto> =>
  patch<UserDto>(`/platform/users/${id}`, body);

export const listUserAssignments = (userId: string): Promise<Paginated<RoleAssignmentDto>> =>
  getPage<RoleAssignmentDto>(`/platform/role-assignments${buildQuery({ userId, pageSize: 50 })}`);
