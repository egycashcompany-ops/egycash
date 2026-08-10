import { z } from 'zod';
import {
  booleanQuery,
  objectId,
  DataScopeSchema,
  LocalizedStringSchema,
  PaginationQuerySchema,
  type DataScope,
} from '../common/index.js';

export const CreateRoleSchema = z
  .object({
    name: LocalizedStringSchema,
    description: z.string().max(500).optional(),
    permissionKeys: z.array(z.string()).min(1),
  })
  .strict();
export type CreateRole = z.infer<typeof CreateRoleSchema>;

export const UpdateRoleSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    description: z.string().max(500).nullable().optional(),
    permissionKeys: z.array(z.string()).min(1).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateRole = z.infer<typeof UpdateRoleSchema>;

/**
 * How a role is looked after, and therefore what an administrator may do to it.
 *
 * DERIVED from the stored role — no field is added to the model:
 *   • `system`  — `isSystem`: seeded and protected (`super-admin`, `platform-admin`,
 *                 `employee-self-service`). Holding one also makes an account PRIVILEGED, which is
 *                 why the flag is not handed out casually.
 *   • `derived` — keyed `hr-only:*`: minted and re-asserted by the HR-only reconciliation on every
 *                 boot and seed. Deliberately NOT `isSystem` (that would make its holders
 *                 privileged), so `isSystem` alone cannot tell an administrator that editing it is
 *                 pointless — the next boot would put it back.
 *   • `none`    — an ordinary administrator-managed role.
 */
export const ROLE_MANAGEMENT = ['system', 'derived', 'none'] as const;
export const RoleManagementSchema = z.enum(ROLE_MANAGEMENT);
export type RoleManagement = z.infer<typeof RoleManagementSchema>;

export interface RoleDto {
  id: string;
  /** Stable key for seeded and managed roles; null for administrator-created ones. */
  key: string | null;
  name: { ar: string; en: string };
  description: string | null;
  isSystem: boolean;
  /** Derived from `isSystem` + `key` — the single answer to "may I edit this?". */
  managed: RoleManagement;
  permissionKeys: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const ListRolesQuerySchema = PaginationQuerySchema.extend({
  search: z.string().max(200).optional(),
  /** Filter by how the role is looked after — the list's system / managed / ordinary tabs. */
  managed: RoleManagementSchema.optional(),
  /**
   * Roles nobody currently holds. "Disabling" a role IS revoking its assignments (there is no
   * status field and adding one would put a second switch inside the authorization path), so this
   * filter is how an administrator finds the roles that are effectively off.
   *
   * `booleanQuery()`, not `z.boolean()`: this arrives as the STRING `'true'` in a query string, and
   * a plain boolean would reject every request the filter makes.
   */
  unassigned: booleanQuery().optional(),
}).strict();
export type ListRolesQuery = z.infer<typeof ListRolesQuerySchema>;

// Role assignments are time-boundable (Review R14): expiry is enforced at
// permission-set computation, not by a cleanup job.
export const CreateRoleAssignmentSchema = z
  .object({
    userId: objectId(),
    roleId: objectId(),
    scope: DataScopeSchema,
    // The hierarchical scopes resolve to the target user's own placement; these are optional and,
    // when present, must match that placement (multi-scope grants are not supported yet).
    branchId: objectId().optional(),
    departmentId: objectId().optional(),
    sectionId: objectId().optional(),
    validFrom: z.coerce.date().optional(),
    validTo: z.coerce.date().optional(),
  })
  .strict()
  .refine((v) => v.validFrom === undefined || v.validTo === undefined || v.validFrom < v.validTo, {
    message: 'validFrom must be before validTo',
    path: ['validTo'],
  });
export type CreateRoleAssignment = z.infer<typeof CreateRoleAssignmentSchema>;

/**
 * Move an existing grant's validity window — and nothing else.
 *
 * Extending a grant that is about to lapse is a real operation, and expressing it as revoke +
 * re-grant would throw away when the grant was first made and split one decision into two rows in
 * the trail. The role, the user and the scope are deliberately absent: changing any of those is a
 * different grant, which is a revoke and a new assignment.
 */
export const UpdateRoleAssignmentSchema = z
  .object({
    validFrom: z.coerce.date().nullable().optional(),
    validTo: z.coerce.date().nullable().optional(),
    /**
     * Optimistic concurrency, like every other update in the system. A window is exactly the kind
     * of field two administrators reach for at the same moment — one extending a grant, the other
     * ending it — and last-write-wins would let the second silently undo the first.
     */
    version: z.number().int().min(0),
  })
  .strict()
  .refine((v) => v.validFrom !== undefined || v.validTo !== undefined, {
    message: 'nothing to change — supply validFrom or validTo',
    path: ['validTo'],
  });
export type UpdateRoleAssignment = z.infer<typeof UpdateRoleAssignmentSchema>;

export interface RoleAssignmentDto {
  id: string;
  userId: string;
  roleId: string;
  /**
   * The granted role, resolved for the page in one batched read. Without it every screen listing
   * assignments would have to load the whole roles catalog to render a name — the pattern ADR-019
   * exists to prevent.
   */
  role: {
    id: string;
    name: { ar: string; en: string };
    key: string | null;
    managed: RoleManagement;
  } | null;
  scope: DataScope;
  /**
   * The placement this grant was resolved against WHEN IT WAS MADE. Recorded for the trail and read
   * by permission-based notification fan-out; authorization reads the holder's CURRENT placement
   * from the request context and never this row (`base.repository.ts` scopeFilter).
   */
  branchId: string | null;
  departmentId: string | null;
  sectionId: string | null;
  validFrom: string | null;
  validTo: string | null;
  /** Optimistic-concurrency version — sent back on a window change. */
  version: number;
  createdAt: string;
}

export const ListRoleAssignmentsQuerySchema = PaginationQuerySchema.extend({
  userId: objectId().optional(),
  roleId: objectId().optional(),
}).strict();
export type ListRoleAssignmentsQuery = z.infer<typeof ListRoleAssignmentsQuerySchema>;

export interface PermissionDto {
  key: string;
  resource: string;
  action: string;
  moduleId: string;
  name: { ar: string; en: string };
  breakGlass: boolean;
  /**
   * The administration surface this permission belongs to (P7-A), or `null` when none administers
   * it. Purely organizational — the role matrix groups on it; nothing authorizes on it.
   */
  pageId: string | null;
}

/** One administration surface, as the registry serves it alongside the permissions. */
export interface PageDto {
  id: string;
  moduleId: string;
  name: { ar: string; en: string };
  route: string | null;
  sortOrder: number | null;
}

/**
 * What `GET /platform/permissions` answers: the catalog, and the surfaces it groups into.
 *
 * The two travel together because they are one fact — a `pageId` with no page to resolve it is not
 * useful to a client, and fetching them separately would let a screen render a tree from two
 * responses that disagree. Page NAMES live here rather than being repeated on every permission,
 * which would put 202 copies of the same localized string on the wire.
 */
export interface PermissionCatalogDto {
  permissions: PermissionDto[];
  pages: PageDto[];
}

// ── Effective permissions, explained (SA-4) ─────────────────────────────────
//
// The authorization path computes an account's permissions as `Record<key, DataScope>` and caches
// it. That answer is the right one to ENFORCE with and the wrong one to SHOW: the merge is lossy
// three times over — it discards which role carried the key, which assignment set the scope, and it
// drops every grant that is not valid right now before the merge even begins.
//
// So an administrator asking "why can this person do X?" — or, far more often, "why CAN'T they?" —
// has nothing to read. These types are the same computation with nothing thrown away.

/** Where a grant sits relative to the moment it was evaluated at. */
export const PERMISSION_STATES = ['active', 'pending', 'expired'] as const;
export const PermissionStateSchema = z.enum(PERMISSION_STATES);
export type PermissionState = z.infer<typeof PermissionStateSchema>;

/** One assignment's contribution of one permission key. */
export interface EffectivePermissionSourceDto {
  assignmentId: string;
  roleId: string;
  roleName: { ar: string; en: string };
  roleKey: string | null;
  roleManaged: RoleManagement;
  /** The grant's own scope, exactly as stored — never re-interpreted. */
  scope: DataScope;
  validFrom: string | null;
  validTo: string | null;
  state: PermissionState;
  /**
   * This contribution is what gives the key its effective scope: it is active AND its scope is the
   * widest among the active ones. Without the flag, two sources granting the same key at different
   * scopes read as a duplicate rather than as one answer and one also-ran. Ties are real — two
   * roles can both grant at the widest scope — and both are marked, because both are true.
   */
  decisive: boolean;
}

export interface EffectivePermissionRowDto {
  key: string;
  /** From the registry. `null` for a key no module declares any more — a role can outlive one. */
  moduleId: string | null;
  name: { ar: string; en: string } | null;
  breakGlass: boolean;
  /** The widest scope among the ACTIVE sources; `null` when nothing grants it right now. */
  scope: DataScope | null;
  /**
   * `active` when something grants it now; otherwise `pending` if a source is still to open, and
   * `expired` when every source has closed. A row is never dropped for being one of the latter two:
   * "this grant ended last Tuesday" is the answer to the question, and a missing row is not.
   */
  state: PermissionState;
  sources: EffectivePermissionSourceDto[];
}

export interface EffectivePermissionsDto {
  userId: string;
  /**
   * When this projection was computed. The enforcement path reads a cached snapshot whose TTL is
   * capped at the next validity boundary, so the two can differ for a bounded moment — this field
   * is what lets the screen say so rather than imply an authority it does not have.
   */
  evaluatedAt: string;
  /** The account's permission version — what the enforcement cache is keyed on. */
  permissionVersion: number;
  isPrivileged: boolean;
  /** Why. A privileged account is one holding a system role or a break-glass key (Review R13). */
  privilegedBecause: { systemRoles: string[]; breakGlassKeys: string[] };
  rows: EffectivePermissionRowDto[];
}
