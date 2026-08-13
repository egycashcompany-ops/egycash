// Employees feature api/ surface (ADR-013). Endpoints match the backend contract exactly
// (`/hr/employees`). Employment terms are copied server-side from the accepted offer snapshot — the
// create call only supplies the offer reference + an optional hiring date. Reference/offer lookups
// reuse the Job Offer feature's endpoints (no new API is introduced).
import {
  type ActionOverlapDto,
  type BranchDto,
  type CancelEmployeeAction,
  type CompensationAction,
  type CreateEmployee,
  type CreateEmployeeLogin,
  type DirectRegisterEmployee,
  type EmployeeActionDto,
  type EmployeeActionType,
  type AdminResetPasswordResultDto,
  type EmployeeDto,
  type EmployeeLoginProvisionDto,
  type EmployeeLoginDto,
  type EmployeeTimelineItemDto,
  type EmploymentAction,
  type ExitAction,
  type Paginated,
  type RehireAction,
  type RehireCheckResultDto,
  type RoleAssignmentDto,
  type UpdateEmployeePersonal,
  type UpdateUser,
  type UserDto,
} from '@ecms/contracts';
import { buildQuery, get, getPage, patch, post,
  type QueryParams,
} from '../../../../../shared/lib/api-client';

export type EmployeeListParams = QueryParams;

export const listEmployees = (params: EmployeeListParams): Promise<Paginated<EmployeeDto>> =>
  getPage<EmployeeDto>(`/hr/employees${buildQuery(params)}`);

export const getEmployee = (id: string): Promise<EmployeeDto> => get<EmployeeDto>(`/hr/employees/${id}`);

export const createEmployee = (
  body: CreateEmployee,
): Promise<EmployeeDto & { provisionedLogin: EmployeeLoginProvisionDto | null }> =>
  post<EmployeeDto & { provisionedLogin: EmployeeLoginProvisionDto | null }>('/hr/employees', body);

/** Direct Registration (D4) — onboard without a recruitment pipeline. */
export const registerEmployeeDirect = (
  body: DirectRegisterEmployee,
): Promise<EmployeeDto & { provisionedLogin: EmployeeLoginProvisionDto | null }> =>
  post<EmployeeDto & { provisionedLogin: EmployeeLoginProvisionDto | null }>('/hr/employees/direct', body);

/** Post-hire personal-data edits — plain audited updates, not personnel actions. */
export const updateEmployeePersonal = (id: string, body: UpdateEmployeePersonal): Promise<EmployeeDto> =>
  patch<EmployeeDto>(`/hr/employees/${id}/personal`, body);

/** Exited-employee match for a national id (the Rehire prompt). */
export const rehireCheck = (nationalId: string): Promise<RehireCheckResultDto | null> =>
  get<RehireCheckResultDto | null>(`/hr/employees/rehire-check${buildQuery({ nationalId })}`);

export const listSubordinates = (id: string): Promise<EmployeeDto[]> =>
  get<EmployeeDto[]>(`/hr/employees/${id}/subordinates`);

export const getEmployeeTimeline = (id: string): Promise<EmployeeTimelineItemDto[]> =>
  get<EmployeeTimelineItemDto[]>(`/hr/employees/${id}/timeline`);

// ── Personnel Actions engine (permission-grouped routes) ────────────────────
export const listEmployeeActions = (
  id: string,
  params: Record<string, string | number | undefined>,
): Promise<Paginated<EmployeeActionDto>> =>
  getPage<EmployeeActionDto>(`/hr/employees/${id}/actions${buildQuery(params)}`);

/** The overlap warning (C1) — what an action of this type would meet, before it is created. */
export const listActionOverlaps = (id: string, type: EmployeeActionType): Promise<ActionOverlapDto[]> =>
  get<ActionOverlapDto[]>(`/hr/employees/${id}/actions/overlaps${buildQuery({ type })}`);

export const createEmploymentAction = (id: string, body: EmploymentAction): Promise<EmployeeActionDto> =>
  post<EmployeeActionDto>(`/hr/employees/${id}/actions/employment`, body);

export const createCompensationAction = (id: string, body: CompensationAction): Promise<EmployeeActionDto> =>
  post<EmployeeActionDto>(`/hr/employees/${id}/actions/compensation`, body);

export const createExitAction = (id: string, body: ExitAction): Promise<EmployeeActionDto> =>
  post<EmployeeActionDto>(`/hr/employees/${id}/actions/exit`, body);

export const createRehireAction = (id: string, body: RehireAction): Promise<EmployeeActionDto> =>
  post<EmployeeActionDto>(`/hr/employees/${id}/actions/rehire`, body);

export const cancelEmployeeAction = (
  id: string,
  actionId: string,
  body: CancelEmployeeAction,
): Promise<EmployeeActionDto> =>
  post<EmployeeActionDto>(`/hr/employees/${id}/actions/${actionId}/cancel`, body);

// ── Platform Identity (ADR-017): create a login for an employee, resolve the branch code, and
// read/update the linked account. All reuse existing platform endpoints — no new API surface. ──
export const createEmployeeLogin = (id: string, body: CreateEmployeeLogin): Promise<EmployeeLoginDto> =>
  post<EmployeeLoginDto>(`/hr/employees/${id}/login`, body);

export const getBranch = (id: string): Promise<BranchDto> => get<BranchDto>(`/platform/branches/${id}`);

export const getUser = (id: string): Promise<UserDto> => get<UserDto>(`/platform/users/${id}`);

export const updateUser = (id: string, body: UpdateUser): Promise<UserDto> =>
  patch<UserDto>(`/platform/users/${id}`, body);

// ── Account security administration (auth design 4.4/4.5) ──────────────────
export const resetUserPassword = (id: string): Promise<AdminResetPasswordResultDto> =>
  post<AdminResetPasswordResultDto>(`/platform/users/${id}/reset-password`, {});

/** Re-deliver credentials to a still-gated account (design §13 R13/R14) — no reset side effects. */
export const resendUserCredentials = (id: string): Promise<AdminResetPasswordResultDto> =>
  post<AdminResetPasswordResultDto>(`/platform/users/${id}/credentials/resend`, {});

export const resetUserTotp = (id: string): Promise<void> =>
  post<void>(`/platform/users/${id}/totp/reset`, {});

export const requireUserTotp = (id: string, required: boolean): Promise<void> =>
  post<void>(`/platform/users/${id}/totp/require`, { required });

export const listUserAssignments = (userId: string): Promise<Paginated<RoleAssignmentDto>> =>
  getPage<RoleAssignmentDto>(`/platform/role-assignments${buildQuery({ userId, pageSize: 50 })}`);
