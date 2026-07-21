// Employees feature api/ surface (ADR-013). Endpoints match the backend contract exactly
// (`/hr/employees`). Employment terms are copied server-side from the accepted offer snapshot — the
// create call only supplies the offer reference + an optional hiring date. Reference/offer lookups
// reuse the Job Offer feature's endpoints (no new API is introduced).
import { type CreateEmployee, type EmployeeDto, type Paginated } from '@ecms/contracts';
import { buildQuery, get, getPage, post } from '../../../../../shared/lib/api-client';

export type EmployeeListParams = Record<string, string | number | boolean | undefined | null>;

export const listEmployees = (params: EmployeeListParams): Promise<Paginated<EmployeeDto>> =>
  getPage<EmployeeDto>(`/hr/employees${buildQuery(params)}`);

export const getEmployee = (id: string): Promise<EmployeeDto> => get<EmployeeDto>(`/hr/employees/${id}`);

export const createEmployee = (body: CreateEmployee): Promise<EmployeeDto> =>
  post<EmployeeDto>('/hr/employees', body);
