// Payroll api/ surface (ADR-013). PY-1 is the pay-item catalog; PY-2 adds what an item is worth
// to one employee over one dated interval; PY-3 reads what those come to over a period. Still no
// run and no payslip.
import {
  type CancelPayrollAdjustment,
  type CompensationEffectsDto,
  type CreatePayrollAdjustment,
  type DecidePayrollAdjustment,
  type PayrollAdjustmentDto,
  type CreateEmployeePayItem,
  type CreatePayrollRun,
  type GeneratePayslipsResultDto,
  type PayrollRunDto,
  type PayslipDto,
  type CreatePayItem,
  type EmployeePayItemDto,
  type Paginated,
  type PayItemDto,
  type RemoveEmployeePayItemResultDto,
  type UpdatePayItem,
} from '@ecms/contracts';
import {
  buildQuery,
  del,
  get,
  patch,
  post,
  getPage,
  type QueryParams,
} from '../../../../shared/lib/api-client';

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

// ── Compensation effects (PY-3) ─────────────────────────────────────────────
// Read-only, and behind the same compensation key as the assignments themselves.

export const getEmployeeCompensation = (
  employeeId: string,
  period: string,
): Promise<CompensationEffectsDto> =>
  get<CompensationEffectsDto>(
    `/hr/employees/${employeeId}/compensation${buildQuery({ period })}`,
  );

// ── Payroll runs (PY-6) ─────────────────────────────────────────────────────
// The period, and the moment its facts stopped moving. Freezing is irreversible.

export const listPayrollRuns = (params: QueryParams): Promise<Paginated<PayrollRunDto>> =>
  getPage<PayrollRunDto>(`/hr/payroll/runs${buildQuery(params)}`);

export const createPayrollRun = (body: CreatePayrollRun): Promise<PayrollRunDto> =>
  post<PayrollRunDto>('/hr/payroll/runs', body);

export const freezePayrollRun = (id: string, version: number): Promise<PayrollRunDto> =>
  post<PayrollRunDto>(`/hr/payroll/runs/${id}/freeze`, { version });

export const cancelPayrollRun = (
  id: string,
  body: { reason: string; version: number },
): Promise<PayrollRunDto> => post<PayrollRunDto>(`/hr/payroll/runs/${id}/cancel`, body);

// ── Payslips (PY-7) ─────────────────────────────────────────────────────────
// Issued from a frozen run, and issuing is idempotent: a second pass reports what was already
// there rather than restating it with today's figures.

export const listRunPayslips = (
  runId: string,
  params: QueryParams,
): Promise<Paginated<PayslipDto>> =>
  getPage<PayslipDto>(`/hr/payroll/runs/${runId}/payslips${buildQuery(params)}`);

export const generatePayslips = (runId: string): Promise<GeneratePayslipsResultDto> =>
  post<GeneratePayslipsResultDto>(`/hr/payroll/runs/${runId}/payslips`, {});

/** The caller's OWN payslips (PY-11) — own-scope by construction, so no employee id is sent. */
export const listMyPayslips = (params: QueryParams): Promise<Paginated<PayslipDto>> =>
  getPage<PayslipDto>(`/hr/payroll/payslips/me${buildQuery(params)}`);

// ── Payroll adjustments — bonuses and penalties (P-HR-04) ────────────────────
export const listEmployeeAdjustments = (
  employeeId: string,
  params: QueryParams,
): Promise<Paginated<PayrollAdjustmentDto>> =>
  getPage<PayrollAdjustmentDto>(`/hr/employees/${employeeId}/adjustments${buildQuery(params)}`);

/**
 * The organization-wide read (P-HR-06) — the queue's source, and it already existed.
 *
 * P-HR-04 mounted `GET /hr/payroll/adjustments` and then shipped only the profile tab, so this
 * endpoint has had no caller at all until now. The queue is that endpoint asked with
 * `status=pendingApproval`; nothing new was added on the server to make the screen possible.
 */
export const listAdjustments = (params: QueryParams): Promise<Paginated<PayrollAdjustmentDto>> =>
  getPage<PayrollAdjustmentDto>(`/hr/payroll/adjustments${buildQuery(params)}`);

export const createAdjustment = (
  employeeId: string,
  body: CreatePayrollAdjustment,
): Promise<PayrollAdjustmentDto> =>
  post<PayrollAdjustmentDto>(`/hr/employees/${employeeId}/adjustments`, body);

export const submitAdjustment = (
  employeeId: string,
  id: string,
  version: number,
): Promise<PayrollAdjustmentDto> =>
  post<PayrollAdjustmentDto>(`/hr/employees/${employeeId}/adjustments/${id}/submit`, { version });

/** The second person's decision (D1) — behind its own permission server-side. */
export const decideAdjustment = (
  employeeId: string,
  id: string,
  body: DecidePayrollAdjustment,
): Promise<PayrollAdjustmentDto> =>
  post<PayrollAdjustmentDto>(`/hr/employees/${employeeId}/adjustments/${id}/decide`, body);

export const cancelAdjustment = (
  employeeId: string,
  id: string,
  body: CancelPayrollAdjustment,
): Promise<PayrollAdjustmentDto> =>
  post<PayrollAdjustmentDto>(`/hr/employees/${employeeId}/adjustments/${id}/cancel`, body);
