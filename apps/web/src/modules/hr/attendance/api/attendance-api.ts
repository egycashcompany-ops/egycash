// Attendance api/ surface (ADR-013). Endpoints match the backend contract exactly (frozen design
// v1.1 §5): AT-1's two admin screens, plus AT-6's day reads, regularization queue and CSV.
import {
  type ApproveOvertime,
  type AttendanceDayDto,
  type AttendanceDecisionDto,
  type AttendanceDecisionSignalsDto,
  type AttendanceRegularizationDto,
  type AttendanceSheetRowDto,
  type AttendanceEmployeeSummaryDto,
  type AttendanceEmployeeDayDto,
  type AttendanceSheetSummaryDto,
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

/**
 * The daily sheet. A DIFFERENT ENDPOINT from the day list on purpose: this one starts from the
 * employees and left-joins their day rows, so somebody who has not scanned is on the answer. The
 * list above answers "which rows exist", which can never show a no-show.
 */
export const listAttendanceSheet = (
  params: QueryParams,
): Promise<Paginated<AttendanceSheetRowDto>> =>
  getPage<AttendanceSheetRowDto>(`/hr/attendance/days/sheet${buildQuery(params)}`);

/**
 * The sheet's counts over the WHOLE day. A sibling read rather than a field on the list, because
 * the page envelope's `meta` is a shape every list in the product returns.
 */
export const attendanceSheetSummary = (
  params: QueryParams,
): Promise<AttendanceSheetSummaryDto> =>
  get<AttendanceSheetSummaryDto>(`/hr/attendance/days/sheet/summary${buildQuery(params)}`);

/**
 * One employee's period, added up by the server — never by this client.
 *
 * The figures are over EVERY day of the period, not the page on screen, and they are computed
 * beside the rows they come from so the page and the payslip cannot drift apart.
 */
export const attendanceEmployeeSummary = (
  params: QueryParams,
): Promise<AttendanceEmployeeSummaryDto> =>
  get<AttendanceEmployeeSummaryDto>(`/hr/attendance/days/employee-summary${buildQuery(params)}`);

/** The same figures about me — own by construction on the server; no employee filter is accepted. */
export const myAttendanceSummary = (
  params: QueryParams,
): Promise<AttendanceEmployeeSummaryDto> =>
  get<AttendanceEmployeeSummaryDto>(`/hr/attendance/days/me/summary${buildQuery(params)}`);

/**
 * EVERY CALENDAR DATE of one employee's period, resolved by the server.
 *
 * It replaces reading `/hr/attendance/days` for this screen, and the difference is the whole point:
 * that endpoint filters day DOCUMENTS, so a date with no row was simply absent from the answer and
 * the month skipped it — punches imported for the 12th and the 15th and the page showing neither,
 * while dates whose legacy row said `dayOff` read «يوم راحة» on top of real scans. This answers one
 * entry per date, resolved by the same function the daily sheet resolves its lines with, so the two
 * screens cannot disagree about the same employee on the same day.
 */
export const attendanceEmployeePeriod = (
  params: QueryParams,
): Promise<AttendanceEmployeeDayDto[]> =>
  get<AttendanceEmployeeDayDto[]>(`/hr/attendance/days/employee-period${buildQuery(params)}`);

/** The same, about me — own by construction on the server; no employee filter is accepted. */
export const myAttendancePeriod = (params: QueryParams): Promise<AttendanceEmployeeDayDto[]> =>
  get<AttendanceEmployeeDayDto[]>(`/hr/attendance/days/me/period${buildQuery(params)}`);

/** My own days — own by construction on the server; no employee filter is accepted. */
export const listMyAttendanceDays = (params: QueryParams): Promise<Paginated<AttendanceDayDto>> =>
  getPage<AttendanceDayDto>(`/hr/attendance/days/me${buildQuery(params)}`);

/**
 * Manager day decisions (stage 3). A decision is an INPUT to the derivation rather than an edit of
 * it, so there is no "undo" verb here — undoing one is `revoke`, which records a second decision.
 */
export const listAttendanceDecisions = (
  params: QueryParams,
): Promise<Paginated<AttendanceDecisionDto>> =>
  getPage<AttendanceDecisionDto>(`/hr/attendance/decisions${buildQuery(params)}`);

export const createAttendanceDecision = (body: unknown): Promise<AttendanceDecisionDto> =>
  post<AttendanceDecisionDto>('/hr/attendance/decisions', body);

export const decideAttendanceDecision = (
  id: string,
  body: unknown,
): Promise<AttendanceDecisionDto> =>
  post<AttendanceDecisionDto>(`/hr/attendance/decisions/${id}/decide`, body);

export const revokeAttendanceDecision = (
  id: string,
  body: unknown,
): Promise<AttendanceDecisionDto> =>
  post<AttendanceDecisionDto>(`/hr/attendance/decisions/${id}/revoke`, body);

/** Who has been deciding days over a window, and how often against the devices (stage 4). */
export const attendanceDecisionSignals = (
  params: QueryParams,
): Promise<AttendanceDecisionSignalsDto> =>
  get<AttendanceDecisionSignalsDto>(`/hr/attendance/decisions/signals${buildQuery(params)}`);

export const downloadDecisionsExport = (params: QueryParams): Promise<void> =>
  downloadBlob(
    `/hr/attendance/decisions/export${buildQuery(params)}`,
    `attendance-decisions-${new Date().toISOString().slice(0, 10)}.csv`,
  );

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
