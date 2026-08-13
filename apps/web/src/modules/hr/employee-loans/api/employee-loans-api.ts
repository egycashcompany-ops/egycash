// Employee loans api/ surface (ADR-013 — P-HR-05, phase A).
//
// Every path is per-employee, because a loan belongs to a person rather than to a month. There is
// no payroll call here and no payslip call: phase A touches no payroll at all.
import {
  type AccelerateEmployeeLoan,
  type CancelEmployeeLoan,
  type CreateEmployeeLoan,
  type DecideEmployeeLoan,
  type DisburseEmployeeLoan,
  type EmployeeLoanDetailDto,
  type EmployeeLoanDto,
  type Paginated,
  type RescheduleEmployeeLoan,
  type SettleEmployeeLoanExternally,
} from '@ecms/contracts';
import { buildQuery, get, patch, post, getPage, type QueryParams } from '../../../../shared/lib/api-client';

export const listEmployeeLoans = (
  employeeId: string,
  params: QueryParams,
): Promise<Paginated<EmployeeLoanDetailDto>> =>
  getPage<EmployeeLoanDetailDto>(`/hr/employees/${employeeId}/loans${buildQuery(params)}`);

/**
 * The organization-wide read (P-HR-06-B) — every loan, across everybody.
 *
 * It came with phase A and had no caller until the administration screen; nothing was added on the
 * server to make that screen possible. Note the SHAPE: `EmployeeLoanDto`, not the detail one. No
 * instalments and no repayments, because a list crossing hundreds of people must not drag hundreds
 * of schedules with it — and because the schedule is not editable from a list anyway. It lives one
 * click away, on the employee's own file, which is the only place it can be changed.
 *
 * P-HR-06-A put `employeeName` / `employeeCode` on these rows, which is what makes the list legible
 * to somebody who does not already know whose loan they are looking at.
 */
export const listAllLoans = (params: QueryParams): Promise<Paginated<EmployeeLoanDto>> =>
  getPage<EmployeeLoanDto>(`/hr/employee-loans${buildQuery(params)}`);

export const getEmployeeLoan = (employeeId: string, id: string): Promise<EmployeeLoanDetailDto> =>
  get<EmployeeLoanDetailDto>(`/hr/employees/${employeeId}/loans/${id}`);

export const createLoan = (employeeId: string, body: CreateEmployeeLoan): Promise<EmployeeLoanDto> =>
  post<EmployeeLoanDto>(`/hr/employees/${employeeId}/loans`, body);

export const submitLoan = (
  employeeId: string,
  id: string,
  version: number,
): Promise<EmployeeLoanDto> =>
  post<EmployeeLoanDto>(`/hr/employees/${employeeId}/loans/${id}/submit`, { version });

/** The second person's decision (D2) — behind its own permission server-side. */
export const decideLoan = (
  employeeId: string,
  id: string,
  body: DecideEmployeeLoan,
): Promise<EmployeeLoanDto> =>
  post<EmployeeLoanDto>(`/hr/employees/${employeeId}/loans/${id}/decide`, body);

/** Recording that the money changed hands ELSEWHERE — and generating the schedule (D5). */
export const disburseLoan = (
  employeeId: string,
  id: string,
  body: DisburseEmployeeLoan,
): Promise<EmployeeLoanDto> =>
  post<EmployeeLoanDto>(`/hr/employees/${employeeId}/loans/${id}/disburse`, body);

export const rescheduleLoan = (
  employeeId: string,
  id: string,
  body: RescheduleEmployeeLoan,
): Promise<EmployeeLoanDetailDto> =>
  post<EmployeeLoanDetailDto>(`/hr/employees/${employeeId}/loans/${id}/reschedule`, body);

/** D7-2 — an extra amount taken through payroll in a named month, so the loan ends earlier. */
export const accelerateLoan = (
  employeeId: string,
  id: string,
  body: AccelerateEmployeeLoan,
): Promise<EmployeeLoanDetailDto> =>
  post<EmployeeLoanDetailDto>(`/hr/employees/${employeeId}/loans/${id}/accelerate`, body);

/** D7-1 — money collected outside ECMS. It closes the loan and deducts nothing. */
export const settleLoanExternally = (
  employeeId: string,
  id: string,
  body: SettleEmployeeLoanExternally,
): Promise<EmployeeLoanDto> =>
  post<EmployeeLoanDto>(`/hr/employees/${employeeId}/loans/${id}/settle-external`, body);

export const cancelLoan = (
  employeeId: string,
  id: string,
  body: CancelEmployeeLoan,
): Promise<EmployeeLoanDto> =>
  post<EmployeeLoanDto>(`/hr/employees/${employeeId}/loans/${id}/cancel`, body);

export const updateLoanDraft = (
  employeeId: string,
  id: string,
  body: Record<string, unknown>,
): Promise<EmployeeLoanDto> =>
  patch<EmployeeLoanDto>(`/hr/employees/${employeeId}/loans/${id}`, body);
