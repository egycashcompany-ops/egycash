// Leave Management api/ surface (ADR-013). Endpoints match the backend contract exactly
// (frozen design §7). Attachments upload as multipart through the shared client.
import {
  type AdjustLeaveBalance,
  type CancelLeaveRequest,
  type CreateHoliday,
  type CreateLeaveRequest,
  type CreateLeaveType,
  type DecideLeaveRequest,
  type HolidayDto,
  type LeaveBalanceDto,
  type LeaveEligibilityDto,
  type LeaveLedgerEntryDto,
  type LeaveRequestDto,
  type LeaveTypeDto,
  type Paginated,
  type ReturnLeaveRequest,
  type UpdateLeaveType,
  type WorkCalendarDto,
} from '@ecms/contracts';
import { buildQuery, del, get, getPage, patch, post, upload } from '../../../../shared/lib/api-client';

export type LeaveListParams = Record<string, string | number | boolean | undefined | null>;

// ── Types catalog ───────────────────────────────────────────────────────────
export const listLeaveTypes = (): Promise<LeaveTypeDto[]> => get<LeaveTypeDto[]>('/hr/leave-types');
export const createLeaveType = (body: CreateLeaveType): Promise<LeaveTypeDto> =>
  post<LeaveTypeDto>('/hr/leave-types', body);
export const updateLeaveType = (id: string, body: UpdateLeaveType): Promise<LeaveTypeDto> =>
  patch<LeaveTypeDto>(`/hr/leave-types/${id}`, body);

// ── Work calendar ───────────────────────────────────────────────────────────
export const getWorkCalendar = (from: string, to: string): Promise<WorkCalendarDto> =>
  get<WorkCalendarDto>(`/hr/work-calendar${buildQuery({ from, to })}`);
export const listHolidays = (from: string, to: string): Promise<HolidayDto[]> =>
  get<HolidayDto[]>(`/hr/holidays${buildQuery({ from, to })}`);
export const createHoliday = (body: CreateHoliday): Promise<HolidayDto> =>
  post<HolidayDto>('/hr/holidays', body);
export const deleteHoliday = (id: string): Promise<{ deleted: boolean }> =>
  del<{ deleted: boolean }>(`/hr/holidays/${id}`);

// ── Requests ────────────────────────────────────────────────────────────────
export const listLeaveRequests = (params: LeaveListParams): Promise<Paginated<LeaveRequestDto>> =>
  getPage<LeaveRequestDto>(`/hr/leave-requests${buildQuery(params)}`);
export const getLeaveRequest = (id: string): Promise<LeaveRequestDto> =>
  get<LeaveRequestDto>(`/hr/leave-requests/${id}`);
export const submitLeaveRequest = (body: CreateLeaveRequest): Promise<LeaveRequestDto> =>
  post<LeaveRequestDto>('/hr/leave-requests', body);
export const pendingLeaveApprovals = (): Promise<LeaveRequestDto[]> =>
  get<LeaveRequestDto[]>('/hr/leave-requests/pending-approvals');
export const approveLeaveRequest = (id: string, body: DecideLeaveRequest): Promise<LeaveRequestDto> =>
  post<LeaveRequestDto>(`/hr/leave-requests/${id}/approve`, body);
export const rejectLeaveRequest = (id: string, body: DecideLeaveRequest): Promise<LeaveRequestDto> =>
  post<LeaveRequestDto>(`/hr/leave-requests/${id}/reject`, body);
export const cancelLeaveRequest = (id: string, body: CancelLeaveRequest): Promise<LeaveRequestDto> =>
  post<LeaveRequestDto>(`/hr/leave-requests/${id}/cancel`, body);
export const returnLeaveRequest = (id: string, body: ReturnLeaveRequest): Promise<LeaveRequestDto> =>
  post<LeaveRequestDto>(`/hr/leave-requests/${id}/return`, body);
export const attachToLeaveRequest = (id: string, file: File): Promise<LeaveRequestDto> => {
  const form = new FormData();
  form.append('file', file);
  return upload<LeaveRequestDto>(`/hr/leave-requests/${id}/attachments`, form);
};
export const leaveCalendar = (from: string, to: string): Promise<LeaveRequestDto[]> =>
  get<LeaveRequestDto[]>(`/hr/leave-calendar${buildQuery({ from, to })}`);

// ── Balances, ledger, eligibility (employee-keyed) ──────────────────────────
export const employeeLeaveBalances = (employeeId: string, year?: number): Promise<LeaveBalanceDto[]> =>
  get<LeaveBalanceDto[]>(`/hr/employees/${employeeId}/leave-balances${buildQuery({ year })}`);
export const employeeLeaveLedger = (
  employeeId: string,
  params: LeaveListParams,
): Promise<Paginated<LeaveLedgerEntryDto>> =>
  getPage<LeaveLedgerEntryDto>(`/hr/employees/${employeeId}/leave-ledger${buildQuery(params)}`);
export const adjustLeaveBalance = (
  employeeId: string,
  body: AdjustLeaveBalance,
): Promise<LeaveBalanceDto[]> =>
  post<LeaveBalanceDto[]>(`/hr/employees/${employeeId}/leave-balances/adjust`, body);
export const leaveEligibility = (
  employeeId: string,
  params: LeaveListParams,
): Promise<LeaveEligibilityDto> =>
  get<LeaveEligibilityDto>(`/hr/employees/${employeeId}/leave-eligibility${buildQuery(params)}`);
