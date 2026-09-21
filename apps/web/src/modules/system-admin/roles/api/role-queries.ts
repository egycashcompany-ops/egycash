// TanStack Query hooks for roles, the permission registry and assignments (ADR-013).
//
// Every assignment write invalidates BOTH subtrees: an assignment belongs to a user and to a role,
// and the two screens that show it are reached from opposite directions.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CreateRole,
  type CreateRoleAssignment,
  type RenameRoleGroup,
  type UpdateRole,
  type UpdateRoleAssignment,
} from '@ecms/contracts';
import { detailKey, featureKey, listKey } from '../../../../shared/lib/query-keys';
import * as api from './role-api';
import { type AssignmentListParams, type RoleListParams } from './role-api';

const MODULE = 'system-admin';
const ROLES = 'roles';
const ASSIGNMENTS = 'assignments';

const rolesKey = featureKey(MODULE, ROLES);
const assignmentsKey = featureKey(MODULE, ASSIGNMENTS);

export const useRoles = (params: RoleListParams) =>
  useQuery({ queryKey: listKey(MODULE, ROLES, params), queryFn: () => api.listRoles(params) });

export const useRole = (id: string) =>
  useQuery({ queryKey: detailKey(MODULE, ROLES, id), queryFn: () => api.getRole(id) });

/**
 * The permission registry. Long-lived on purpose: it only changes when a deployment registers new
 * permissions, so re-fetching it per screen would be a request that never returns anything new.
 */
export const usePermissionCatalog = (enabled = true) =>
  useQuery({
    queryKey: [MODULE, 'permission-catalog'],
    queryFn: api.listPermissionCatalog,
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
    // P7-A carries the page registry over the wire; every current caller still wants the flat
    // permission list, so the shape they see is unchanged. P7-B reads the pages.
    select: (catalog) => catalog.permissions,
  });

/** The administration surfaces, from the same request the catalog came in — never a second fetch. */
export const usePermissionPages = (enabled = true) =>
  useQuery({
    queryKey: [MODULE, 'permission-catalog'],
    queryFn: api.listPermissionCatalog,
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
    select: (catalog) => catalog.pages,
  });

const useRoleWrite = <TArgs, TResult>(mutationFn: (args: TArgs) => Promise<TResult>) => {
  const qc = useQueryClient();
  return useMutation<TResult, unknown, TArgs>({
    mutationFn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: rolesKey });
    },
  });
};

export const useCreateRole = () => useRoleWrite((body: CreateRole) => api.createRole(body));

export const useUpdateRole = (id: string) =>
  useRoleWrite((body: UpdateRole) => api.updateRole(id, body));

export const useDeleteRole = (id: string) => useRoleWrite(() => api.deleteRole(id));

/**
 * Move one role to a heading — the list's own write, keyed by role rather than bound to one.
 *
 * `useUpdateRole` is built for a screen editing ONE role and closes over its id; the list moves
 * whichever row the administrator touched, so the id travels with the call.
 */
export const useMoveRoleToGroup = () =>
  useRoleWrite((args: { id: string; group: string | null; version: number }) =>
    api.updateRole(args.id, { group: args.group, version: args.version }),
  );

/**
 * The headings in use. Long-lived: they change only when a role is filed or renamed, and both of
 * those invalidate the roles subtree this key lives under.
 */
export const useRoleGroups = () =>
  useQuery({ queryKey: [MODULE, ROLES, 'groups'], queryFn: api.listRoleGroups, staleTime: 60_000 });

export const useRenameRoleGroup = () =>
  useRoleWrite((body: RenameRoleGroup) => api.renameRoleGroup(body));

// ── Assignments ─────────────────────────────────────────────────────────────

export const useAssignments = (params: AssignmentListParams, enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, ASSIGNMENTS, params),
    queryFn: () => api.listAssignments(params),
    enabled,
  });

const useAssignmentWrite = <TArgs, TResult>(mutationFn: (args: TArgs) => Promise<TResult>) => {
  const qc = useQueryClient();
  return useMutation<TResult, unknown, TArgs>({
    mutationFn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: assignmentsKey });
      // The roles list shows which roles nobody holds, and a grant just changed that.
      void qc.invalidateQueries({ queryKey: rolesKey });
    },
  });
};

export const useCreateAssignment = () =>
  useAssignmentWrite((body: CreateRoleAssignment) => api.createAssignment(body));

export const useUpdateAssignment = () =>
  useAssignmentWrite((args: { id: string; body: UpdateRoleAssignment }) =>
    api.updateAssignment(args.id, args.body),
  );

export const useRevokeAssignment = () =>
  useAssignmentWrite((id: string) => api.revokeAssignment(id));

// ── Effective permissions (SA-4) ────────────────────────────────────────────

/**
 * Computed fresh by the server on every read — there is no cache behind it, by design — so this
 * query does not hold it either: `staleTime: 0` means reopening the tab asks again. The point of
 * the screen is to answer "what does this account hold RIGHT NOW", and a cached answer to that is
 * the wrong kind of answer.
 *
 * It lives under the assignments key so that granting or revoking a role invalidates it too: those
 * writes are exactly what changes it.
 */
export const useEffectivePermissions = (userId: string, enabled = true) =>
  useQuery({
    queryKey: [MODULE, ASSIGNMENTS, 'effective', userId],
    queryFn: () => api.getEffectivePermissions(userId),
    enabled: enabled && userId !== '',
    staleTime: 0,
  });

/** Every active company-wide department, for the grant form. Rarely changes; cached like the roles. */
export const useDepartmentCatalog = (enabled = true) =>
  useQuery({
    queryKey: ['platform', 'department-catalog', 'grant-form'],
    queryFn: api.listDepartmentCatalog,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
