// Payroll api/ surface (ADR-013). PY-1 is the pay-item catalog; PY-2 adds what an item is worth
// to one employee over one dated interval. No run, no payslip, no calculation.
import {
  type CreateEmployeePayItem,
  type CreatePayItem,
  type EmployeePayItemDto,
  type Paginated,
  type PayItemDto,
  type RemoveEmployeePayItemResultDto,
  type UpdatePayItem,
} from '@ecms/contracts';
import { buildQuery, del, patch, post, getPage, type QueryParams } from '../../../../shared/lib/api-client';

export const listPayItems = (params: QueryParams): Promise<Paginated<PayItemDto>> =>
  getPage<PayItemDto>(`/hr/payroll/pay-items${buildQuery(params)}`);

export const createPayItem = (body: CreatePayItem): Promise<PayItemDto> =>
  post<PayItemDto>('/hr/payroll/pay-items', body);

export const updatePayItem = (id: string, body: UpdatePayItem): Promise<PayItemDto> =>
  patch<PayItemDto>(`/hr/payroll/pay-items/${id}`, body);

export const deletePayItem = (id: string): Promise<void> =>
  del<void>(`/hr/payroll/pay-items/${id}`);

// ── Employee pay items (PY-2) ───────────────────────────────────────────────
// Nested under the employee, and gated by the compensation keys rather than any key of their
// own — these rows ARE the employee's compensation.

export const listEmployeePayItems = (
  employeeId: string,
  params: QueryParams,
): Promise<Paginated<EmployeePayItemDto>> =>
  getPage<EmployeePayItemDto>(`/hr/employees/${employeeId}/pay-items${buildQuery(params)}`);

export const createEmployeePayItem = (
  employeeId: string,
  body: CreateEmployeePayItem,
): Promise<EmployeePayItemDto> =>
  post<EmployeePayItemDto>(`/hr/employees/${employeeId}/pay-items`, body);

/** Returns the OUTCOME — a future assignment is removed, a started one is ended (never deleted). */
export const removeEmployeePayItem = (
  employeeId: string,
  id: string,
): Promise<RemoveEmployeePayItemResultDto> =>
  del<RemoveEmployeePayItemResultDto>(`/hr/employees/${employeeId}/pay-items/${id}`);
