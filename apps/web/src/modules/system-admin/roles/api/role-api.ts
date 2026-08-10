// System Administration → Roles & Permissions: the api/ surface (ADR-013).
//
// Every call targets an endpoint the platform already serves. The two additions this slice makes to
// the platform — the roles list's filters and the assignment validity-window PATCH — are extensions
// of existing routers, not a new surface.
import {
  type CreateRole,
  type CreateRoleAssignment,
  type Paginated,
  type PermissionDto,
  type RoleAssignmentDto,
  type RoleDto,
  type UpdateRole,
  type UpdateRoleAssignment,
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

export type RoleListParams = QueryParams;

export const listRoles = (params: RoleListParams): Promise<Paginated<RoleDto>> =>
  getPage<RoleDto>(`/platform/roles${buildQuery(params)}`);

export const getRole = (id: string): Promise<RoleDto> => get<RoleDto>(`/platform/roles/${id}`);

export const createRole = (body: CreateRole): Promise<RoleDto> =>
  post<RoleDto>('/platform/roles', body);

export const updateRole = (id: string, body: UpdateRole): Promise<RoleDto> =>
  patch<RoleDto>(`/platform/roles/${id}`, body);

export const deleteRole = (id: string): Promise<void> => del<void>(`/platform/roles/${id}`);

/**
 * The whole registry. Not a catalog read of the kind ADR-019 forbids: this endpoint exists to
 * enumerate the permission definitions, it is gated by `permission.view`, and the matrix is only
 * meaningful when it shows every grant a role could carry.
 */
export const listPermissions = (): Promise<PermissionDto[]> =>
  get<PermissionDto[]>('/platform/permissions');

// ── Assignments ─────────────────────────────────────────────────────────────

export type AssignmentListParams = QueryParams;

export const listAssignments = (
  params: AssignmentListParams,
): Promise<Paginated<RoleAssignmentDto>> =>
  getPage<RoleAssignmentDto>(`/platform/role-assignments${buildQuery(params)}`);

export const createAssignment = (body: CreateRoleAssignment): Promise<RoleAssignmentDto> =>
  post<RoleAssignmentDto>('/platform/role-assignments', body);

/** Moves the validity window only — the role, the user and the scope are immutable on a grant. */
export const updateAssignment = (
  id: string,
  body: UpdateRoleAssignment,
): Promise<RoleAssignmentDto> =>
  patch<RoleAssignmentDto>(`/platform/role-assignments/${id}`, body);

export const revokeAssignment = (id: string): Promise<void> =>
  del<void>(`/platform/role-assignments/${id}`);
