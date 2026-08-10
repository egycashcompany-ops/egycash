// TanStack Query hooks for roles, the permission registry and assignments (ADR-013).
//
// Every assignment write invalidates BOTH subtrees: an assignment belongs to a user and to a role,
// and the two screens that show it are reached from opposite directions.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CreateRole,
  type CreateRoleAssignment,
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
    queryFn: api.listPermissions,
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
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
