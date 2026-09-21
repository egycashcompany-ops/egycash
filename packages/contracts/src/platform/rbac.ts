import { z } from 'zod';
import {
  booleanQuery,
  objectId,
  DataScopeSchema,
  LocalizedStringSchema,
  PaginationQuerySchema,
  type DataScope,
} from '../common/index.js';
import { PermissionKeySchema } from '../permissions/def.js';

/**
 * The list heading a role is filed under — a name the administrator writes, not an id.
 *
 * It replaces the department reference this field used to be, and the replacement is the point.
 * A department could only ever name a department, so «أدوار النظام» and «البوابات الخارجية» had
 * nowhere to go and every role in the company piled up under «عام» — which is exactly what the
 * owner was looking at when he asked for this: «عاوز اقدر اجمع الادوار فى مجموعات واسميها».
 *
 * Purely organizational. Nothing authorizes on it, exactly as `pageId` organizes permissions
 * without authorizing on them, and two roles in the same group have nothing in common beyond
 * sitting under one heading.
 *
 * A group exists only because some role names it: there is no separate record, so renaming one is
 * renaming it on every role that carries it, and it disappears when the last of them leaves.
 */
export const ROLE_GROUP_MAX = 60;
const RoleGroupSchema = z
  .string()
  .trim()
  .max(ROLE_GROUP_MAX)
  // An empty string and «no group» are the same fact, and storing both would split one heading in
  // two — «عام» once for null and once for ''.
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional();

export const CreateRoleSchema = z
  .object({
    name: LocalizedStringSchema,
    description: z.string().max(500).optional(),
    group: RoleGroupSchema,
    permissionKeys: z.array(z.string()).min(1),
  })
  .strict();
export type CreateRole = z.infer<typeof CreateRoleSchema>;

/**
 * Rename one heading across every role that carries it.
 *
 * Its own endpoint rather than a loop of role updates on the client, because a rename is one act
 * and a loop is not: a client that PATCHed eight roles and lost the network after five would leave
 * the company with two headings where it had one, and no way to tell which was meant.
 *
 * `to: null` ungroups them — the same act as clearing the field on each, which is how a heading is
 * deleted. There is nothing else to delete: a group is a name roles carry, not a record.
 */
export const RenameRoleGroupSchema = z
  .object({
    from: z.string().trim().max(ROLE_GROUP_MAX).nullable(),
    to: z.string().trim().max(ROLE_GROUP_MAX).nullable(),
  })
  .strict();
export type RenameRoleGroup = z.infer<typeof RenameRoleGroupSchema>;

export const UpdateRoleSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    description: z.string().max(500).nullable().optional(),
    group: RoleGroupSchema,
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
  /** The heading the list files this role under; null files it under «عام». */
  group: string | null;
  /**
   * How many live assignments carry this role.
   *
   * On the list because it answers the question the list cannot otherwise answer. Two roles named
   * «الموارد البشرية» and «الموارد البشرية Test» are indistinguishable by name and permission
   * count; that one of them is held by nobody is the fact that tells an administrator which is the
   * leftover of an experiment.
   */
  holderCount: number;
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
    // when present, must match that placement.
    branchId: objectId().optional(),
    departmentId: objectId().optional(),
    sectionId: objectId().optional(),
    /**
     * The REACH of a `branch` or `department` grant, beyond the holder's own placement.
     *
     * A department is one record per branch, but to the company it is one department — «الحركة»
     * in every site — with a general manager over all of it and a manager in each branch who may be
     * given a second branch to follow. Neither was expressible while a grant resolved to exactly the
     * holder's home unit. So:
     *
     *   • `branchIds` — the branches this grant reaches. The holder's own branch is always included
     *     whether or not it is listed; anything else here is a branch ADDED to their reach.
     *   • `departmentCatalogId` — for a `department` grant, the company-wide department (the
     *     catalog entry) rather than one branch's copy of it. With `branchIds` it means that
     *     department in those branches; with `allBranches` it means that department everywhere.
     *   • `allBranches` — the general-manager form: every branch, now and as branches are added.
     *
     * Omitted, a grant behaves exactly as before: the holder's home unit, and nothing else.
     */
    branchIds: z.array(objectId()).max(50).optional(),
    departmentCatalogId: objectId().optional(),
    allBranches: z.boolean().optional(),
    validFrom: z.coerce.date().optional(),
    validTo: z.coerce.date().optional(),
  })
  .strict()
  .refine((v) => !(v.allBranches === true && v.branchIds !== undefined && v.branchIds.length > 0), {
    message: 'allBranches and branchIds are two answers to one question — send one',
    path: ['branchIds'],
  })
  .refine((v) => v.departmentCatalogId === undefined || v.scope === 'department', {
    message: 'departmentCatalogId belongs to a department-scoped grant',
    path: ['departmentCatalogId'],
  })
  .refine(
    (v) => (v.branchIds === undefined && v.allBranches !== true) || v.scope === 'branch' || v.scope === 'department',
    { message: 'a reach beyond the home unit needs a branch or department scope', path: ['branchIds'] },
  )
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
  /**
   * The grant's reach beyond the home unit — see `CreateRoleAssignmentSchema`. Names are resolved
   * server-side for the page, like `role` above: a screen listing grants should not have to load the
   * branch and department catalogs to say «الحركة · المهندسين · أكتوبر».
   */
  branchIds: string[];
  branches: { id: string; name: { ar: string; en: string } }[];
  departmentCatalogId: string | null;
  departmentCatalog: { id: string; name: { ar: string; en: string } } | null;
  allBranches: boolean;
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

/** One grant's contribution of one permission key — a role assignment, or a direct delegation. */
export interface EffectivePermissionSourceDto {
  /** The assignment's id — or the delegated grant's, when `kind` is `delegation`. */
  assignmentId: string;
  /**
   * `role` is a role assignment, exactly as before. `delegation` is a direct, per-site grant made
   * by a manager to somebody they reach (ADR-032): it carries no role, so `roleId` is null and
   * `roleName` is the fixed label for such grants; `branch` says which site it is for.
   */
  kind: 'role' | 'delegation';
  roleId: string | null;
  roleName: { ar: string; en: string };
  roleKey: string | null;
  roleManaged: RoleManagement;
  branch: { id: string; name: { ar: string; en: string } } | null;
  /** For a delegation confined to one department of that branch; null for the whole branch. */
  department: { id: string; name: { ar: string; en: string } } | null;
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

// ── «صلاحياتي» — the account's own answer (self-service) ────────────────────
//
// The administration projection above is about SOMEBODY ELSE: it is gated on `user.view` and
// `role.view`, it keeps every grant that ever applied — pending and expired alike — and it names
// the assignment ids an administrator would act on. None of that belongs to a clerk asking the one
// question this view exists for: «أنا مسموح لي بإيه؟».
//
// So this is the same computation reduced to what the holder himself may read:
//   • only what is in force RIGHT NOW — a grant that opens next month is not an authority he has,
//     and a grant that closed is not one he lost the right to be told about on a different screen,
//   • grouped by the SCREEN it opens, because a person thinks in screens and not in module ids,
//   • the source named, never identified — «دور: مدير الحركة» or «تفويض · أكتوبر · الحركة», with
//     no assignment id to act on, because there is no action here to take.
//
// It carries no permission gate for the same reason the effective-applications resolver carries
// none: the answer is scoped to the caller by construction. It is served for the CALLER only —
// there is no `:id` on the route — so it can never become a way to read another account.

/** Where one of the caller's permissions comes from, named rather than identified. */
export interface MyPermissionSourceDto {
  kind: 'role' | 'delegation';
  /** The role's name, or the fixed label a delegated grant carries. */
  name: { ar: string; en: string };
  /** The site a delegation is for — «أكتوبر · الحركة». Null for a role. */
  where: { ar: string; en: string } | null;
}

export interface MyPermissionDto {
  key: string;
  /** From the registry; null for a key no module declares any more. */
  name: { ar: string; en: string } | null;
  moduleId: string | null;
  /** The administration surface it belongs to — what this view groups on. */
  pageId: string | null;
  breakGlass: boolean;
  /** Always a real scope: a row with none in force is not in this list at all. */
  scope: DataScope;
  sources: MyPermissionSourceDto[];
}

/**
 * `pages` rides along so the client can print a screen's NAME without reading the full catalog,
 * which `permission.view` guards and an ordinary account does not hold. Only the surfaces the rows
 * actually reference are sent.
 */
export interface MyPermissionsDto {
  evaluatedAt: string;
  rows: MyPermissionDto[];
  pages: PageDto[];
}

// ── Delegated grants (ADR-032) ──────────────────────────────────────────────
//
// A manager hands out, per UNIT, permissions they hold there — to people they reach. No role in
// between: the grant IS the list of keys, for one account, over one department in one branch (or,
// from a whole-branch holder, over the branch as a whole). Each unit's table is its own record, so
// what somebody may do in «الحركة · المهندسين» says nothing about «الأمن · المهندسين» or about
// «الحركة · أكتوبر».

/**
 * The full list for one (account, unit): the server replaces, never merges. Empty = remove.
 * `departmentId: null` names the whole branch, which only a whole-branch holder may grant.
 */
export const SetDelegationSchema = z
  .object({
    branchId: objectId(),
    departmentId: objectId().nullable(),
    permissionKeys: z.array(PermissionKeySchema).max(500),
  })
  .strict();
export type SetDelegation = z.infer<typeof SetDelegationSchema>;

export interface DelegationDto {
  id: string;
  userId: string;
  branch: { id: string; name: { ar: string; en: string } };
  /** The department copy the grant is confined to, or null for the whole branch. */
  department: { id: string; name: { ar: string; en: string } } | null;
  permissionKeys: string[];
  /** The account that last wrote this grant, or null for a system write. */
  grantedBy: string | null;
  updatedAt: string;
}

export interface UserDelegationsDto {
  userId: string;
  grants: DelegationDto[];
}

/**
 * What the caller may delegate, and where — their own ceiling, resolved once for the screen.
 *
 * Per branch: the keys the caller holds over the WHOLE branch (`permissionKeys`; empty for a
 * department-level manager), and its departments with the keys held over each of them BEYOND the
 * whole-branch ones (so an organization-wide administrator's answer stays small: every key once
 * per branch, and the departments list carries names only). A unit's ceiling is the union of the
 * two. `pages` and `permissions` are the registry entries for the union of every key named, so the
 * screen can draw «screen × actions» without a wider catalog read the caller may not be allowed
 * to make.
 */
export interface DelegationCatalogDto {
  branches: {
    id: string;
    name: { ar: string; en: string };
    permissionKeys: string[];
    departments: { id: string; name: { ar: string; en: string }; permissionKeys: string[] }[];
  }[];
  pages: PageDto[];
  permissions: PermissionDto[];
}
