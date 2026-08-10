// System Administration → Users: the api/ surface (ADR-013). Every call targets an endpoint the
// platform ALREADY serves — this slice adds no backend, so a path here that the API does not
// declare is a bug the contract spec beside this folder catches at build time.
//
// Why this client lives in the module rather than in `platform/`: `platform/settings/settings-api.ts`
// sits there because any module's settings screen reads it. Administering user accounts has exactly
// one consumer — this module — so it stays local, the way every other feature's api/ folder does.
//
// The HR employee profile calls four of these same endpoints from its own api/ file. That
// duplication is deliberate for now: the alternative is either a cross-module import (forbidden —
// modules never import each other) or moving HR's calls out, which is a refactor of HR that this
// slice is not allowed to make.
import {
  type AdminResetPasswordResultDto,
  type ChangeUserStatus,
  type CreateUser,
  type DepartmentDto,
  type EmployeeDto,
  type InvitedUserDto,
  type OrgUnitOptionDto,
  type Paginated,
  type SectionDto,
  type TimelineDto,
  type UpdateUser,
  type UserDto,
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

export type SystemUserListParams = QueryParams;

/** `GET /platform/users` — branch/department/section-scoped server-side by `user.view`. */
export const listUsers = (params: SystemUserListParams): Promise<Paginated<UserDto>> =>
  getPage<UserDto>(`/platform/users${buildQuery(params)}`);

export const getUser = (id: string): Promise<UserDto> => get<UserDto>(`/platform/users/${id}`);

/**
 * Create an account. The response carries `activationToken` — the setup link's secret, returned
 * once so the caller can hand it over out of band when delivery fails. The screen never displays
 * it: an administrator who can read a setup token can set someone else's password, which is the
 * one thing this whole flow exists to prevent.
 */
export const createUser = (body: CreateUser): Promise<InvitedUserDto> =>
  post<InvitedUserDto>('/platform/users', body);

export const updateUser = (id: string, body: UpdateUser): Promise<UserDto> =>
  patch<UserDto>(`/platform/users/${id}`, body);

/**
 * Retire an account (SA-5). A SOFT delete: the row is kept with `isDeleted` set, so it vanishes
 * from every read the API offers while the audit trail — which lives in its own collection —
 * survives intact. The server refuses your own account and the last Super Admin.
 */
export const deleteUser = (id: string): Promise<void> => del<void>(`/platform/users/${id}`);

/** Clear the automatic lockout the failed-login counter armed. Does not change the status. */
export const unlockUser = (id: string): Promise<UserDto> =>
  post<UserDto>(`/platform/users/${id}/unlock`, {});

/**
 * Lifecycle transition. `version` rides along, so a concurrent edit answers 409 rather than
 * silently overwriting a status somebody else just changed.
 */
export const changeUserStatus = (id: string, body: ChangeUserStatus): Promise<UserDto> =>
  post<UserDto>(`/platform/users/${id}/status`, body);

/**
 * Admin reset (§14.4): the password hash is cleared and a fresh one-time setup link is delivered.
 * No password is supplied by — or returned to — the administrator; the result carries delivery
 * OUTCOMES only.
 */
export const resetUserPassword = (id: string): Promise<AdminResetPasswordResultDto> =>
  post<AdminResetPasswordResultDto>(`/platform/users/${id}/reset-password`, {});

/** Re-deliver a PENDING setup link (§14.3). The API refuses when none is outstanding. */
export const resendUserCredentials = (id: string): Promise<AdminResetPasswordResultDto> =>
  post<AdminResetPasswordResultDto>(`/platform/users/${id}/credentials/resend`, {});

/** Wipe TOTP enrollment; the `required` flag is left exactly as it was. */
export const resetUserTotp = (id: string): Promise<void> =>
  post<void>(`/platform/users/${id}/totp/reset`, {});

/** D6 force on/off. Forcing ON clears any enrolled secret — the user re-enrolls at next login. */
export const setUserTotpRequired = (id: string, required: boolean): Promise<void> =>
  post<void>(`/platform/users/${id}/totp/require`, { required });

/** Break-glass: ends every session the account holds. */
export const revokeUserSessions = (id: string): Promise<void> =>
  del<void>(`/platform/users/${id}/sessions`);

/**
 * The account's history, merged from the audit and activity streams (BD-007). The endpoint carries
 * no `authorize()` on purpose: it degrades to whichever of `auditLog.view` / `activityLog.view` the
 * caller holds, and refuses only when they hold neither. `included` reports which streams answered,
 * so the screen can say what it is showing instead of implying it is everything.
 */
export const getUserTimeline = (id: string, pageSize: number, page = 1): Promise<TimelineDto> =>
  get<TimelineDto>(
    `/platform/timeline${buildQuery({ entityType: 'user', entityId: id, pageSize, page })}`,
  );

/**
 * Branch options for the placement field. A purpose-built reference endpoint that returns the
 * ACTIVE units only as `{id, code, name}` and is authenticated rather than `branch.view`-gated —
 * so the field is populated for an administrator who may edit accounts without also administering
 * the org tree. Not a catalog read: there is no page to raise (ADR-019).
 */
export const listBranchOptions = (): Promise<OrgUnitOptionDto[]> =>
  get<OrgUnitOptionDto[]>('/platform/branches/options');

/**
 * Departments of one branch, and sections of one department — the cascade below the branch field.
 *
 * NOT the `/options` reference endpoints the branch field uses: those return every active unit in
 * the company with no parent filter, so a cascade built on them would offer departments that do not
 * belong to the chosen branch and let an administrator save an inconsistent placement. These are
 * the ordinary list endpoints, searched server-side (ADR-019 rule 5) and gated by
 * `department.view` / `section.view` — which is why the field degrades to a note rather than an
 * empty dropdown for an administrator who does not hold them.
 */
export const searchDepartments = (
  branchId: string,
  search: string,
): Promise<Paginated<DepartmentDto>> =>
  getPage<DepartmentDto>(
    `/platform/departments${buildQuery({ branchId, search, status: 'active', pageSize: 8 })}`,
  );

export const searchSections = (
  departmentId: string,
  search: string,
): Promise<Paginated<SectionDto>> =>
  getPage<SectionDto>(
    `/platform/sections${buildQuery({ departmentId, search, status: 'active', pageSize: 8 })}`,
  );

export const getDepartment = (id: string): Promise<DepartmentDto> =>
  get<DepartmentDto>(`/platform/departments/${id}`);

export const getSection = (id: string): Promise<SectionDto> =>
  get<SectionDto>(`/platform/sections/${id}`);

// ── Employee linkage (decision E1 — HR owns the relationship) ────────────────
//
// These two calls are the ONLY reason this module talks to `/hr`. The link is HR's to write, so
// System Administration asks HR to write it rather than setting `user.employeeId` itself — which it
// could not do anyway: the field is not in the update schema, and nothing else exposes it.

/** Employees to offer when attaching an account. Searched, never loaded (ADR-019). */
export const searchEmployees = (search: string): Promise<Paginated<EmployeeDto>> =>
  getPage<EmployeeDto>(`/hr/employees${buildQuery({ search, employed: true, pageSize: 8 })}`);

export const getEmployee = (id: string): Promise<EmployeeDto> =>
  get<EmployeeDto>(`/hr/employees/${id}`);

export const linkUserToEmployee = (employeeId: string, userId: string): Promise<EmployeeDto> =>
  post<EmployeeDto>(`/hr/employees/${employeeId}/user-link`, { userId });

export const unlinkUserFromEmployee = (employeeId: string): Promise<EmployeeDto> =>
  del<EmployeeDto>(`/hr/employees/${employeeId}/user-link`);
