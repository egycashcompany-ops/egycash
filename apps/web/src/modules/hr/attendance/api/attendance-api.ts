// Attendance api/ surface (ADR-013). Endpoints match the backend contract exactly (frozen design
// v1.1 §5): AT-1's two admin screens, plus AT-6's day reads, regularization queue and CSV.
import {
  type ApproveOvertime,
  type AttendanceDayDto,
  type AttendanceRegularizationDto,
  type CreateAttendanceRegularization,
  type CreateShift,
  type CreateShiftAssignment,
  type DecideAttendanceRegularization,
  type EmployeeDto,
  type Paginated,
  type ShiftAssignmentDto,
  type ShiftDto,
  type UpdateShift,
} from '@ecms/contracts';
import {
  buildQuery,
  del,
  downloadBlob,
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

// ── AT-6: day reads, the regularization chain, overtime, and the CSV ─────────

/** The scoped read behind the daily sheet and the employee month. */
export const listAttendanceDays = (params: QueryParams): Promise<Paginated<AttendanceDayDto>> =>
  getPage<AttendanceDayDto>(`/hr/attendance/days${buildQuery(params)}`);

/** My own days — own by construction on the server; no employee filter is accepted. */
export const listMyAttendanceDays = (params: QueryParams): Promise<Paginated<AttendanceDayDto>> =>
  getPage<AttendanceDayDto>(`/hr/attendance/days/me${buildQuery(params)}`);

export const listRegularizations = (
  params: QueryParams,
): Promise<Paginated<AttendanceRegularizationDto>> =>
  getPage<AttendanceRegularizationDto>(`/hr/attendance/regularizations${buildQuery(params)}`);

export const listMyRegularizations = (
  params: QueryParams,
): Promise<Paginated<AttendanceRegularizationDto>> =>
  getPage<AttendanceRegularizationDto>(`/hr/attendance/regularizations/me${buildQuery(params)}`);

/** The decision worklist: my direct reports' manager step + the HR step within my scope. */
export const listPendingRegularizations = (): Promise<AttendanceRegularizationDto[]> =>
  get<AttendanceRegularizationDto[]>('/hr/attendance/regularizations/pending-decisions');

export const createRegularization = (
  body: CreateAttendanceRegularization,
): Promise<AttendanceRegularizationDto> =>
  post<AttendanceRegularizationDto>('/hr/attendance/regularizations', body);

export const decideRegularization = (
  id: string,
  body: DecideAttendanceRegularization,
): Promise<AttendanceRegularizationDto> =>
  post<AttendanceRegularizationDto>(`/hr/attendance/regularizations/${id}/decide`, body);

export const cancelRegularization = (
  id: string,
  version: number,
): Promise<AttendanceRegularizationDto> =>
  post<AttendanceRegularizationDto>(`/hr/attendance/regularizations/${id}/cancel`, { version });

/** Quantity release only — the server holds the ceiling and refuses a frozen day. */
export const approveOvertime = (id: string, body: ApproveOvertime): Promise<AttendanceDayDto> =>
  post<AttendanceDayDto>(`/hr/attendance/overtime/${id}/approve`, body);

/** The CSV, through the shared download seam — a separate grant from reading. */
export const downloadAttendanceExport = (params: QueryParams): Promise<void> =>
  downloadBlob(
    `/hr/attendance/export${buildQuery(params)}`,
    `attendance-${new Date().toISOString().slice(0, 10)}.csv`,
  );
