// System Administration → Roles & Permissions: the api/ surface (ADR-013).
//
// Every call targets an endpoint the platform already serves. The three additions these slices make
// to the platform — the roles list's filters, the assignment validity-window PATCH (SA-3) and the
// effective-permissions read (SA-4) — are extensions of existing routers, not a new surface.
import {
  MAX_PAGE_SIZE,
  type DepartmentCatalogDto,
  type CreateRole,
  type CreateRoleAssignment,
  type EffectivePermissionsDto,
  type Paginated,
  type PermissionCatalogDto,
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
export const listPermissionCatalog = (): Promise<PermissionCatalogDto> =>
  get<PermissionCatalogDto>('/platform/permissions');

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

// ── Effective permissions (SA-4) ────────────────────────────────────────────

/**
 * What an account may actually do, and where each permission came from.
 *
 * A sub-resource of the ACCOUNT, not of the roles collection, because that is what it describes —
 * and because the endpoint is scoped by `user.view`, which is what decides whether this caller may
 * look at this person at all. Unpaginated on purpose: the row count is bounded by the permission
 * registry that ships with the deployment, not by anything a user can grow.
 */
export const getEffectivePermissions = (userId: string): Promise<EffectivePermissionsDto> =>
  get<EffectivePermissionsDto>(`/platform/users/${userId}/effective-permissions`);

/**
 * The company-wide departments, for the grant form's picker — «الحركة», not «الحركة / طنطا».
 *
 * Read from the catalogue LIST, which is gated on `department.view`: the catalogue router has no
 * `/options` route by design (its audience is the create form, whose caller already holds that
 * key), and an administrator granting roles holds it too. Paged to exhaustion for the reason every
 * catalogue read in this repository is now — `BaseRepository.list` clamps a page to 100.
 */
export const listDepartmentCatalog = async (): Promise<DepartmentCatalogDto[]> => {
  const out: DepartmentCatalogDto[] = [];
  for (let page = 1; ; page += 1) {
    const res = await getPage<DepartmentCatalogDto>(
      `/platform/department-catalog${buildQuery({ status: 'active', page, pageSize: MAX_PAGE_SIZE, sortDir: 'asc' })}`,
    );
    out.push(...res.items);
    if (page >= res.meta.totalPages) return out;
  }
};
