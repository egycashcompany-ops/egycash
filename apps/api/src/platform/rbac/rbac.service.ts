// The authorization model (ADR-004, amended by ADR-015): permissions declared in
// code and synced at boot; roles are data; assignments carry a data scope and an
// optional validity window (Review R14). Effective permission sets are cached with
// a TTL capped at the next validity boundary — expiry needs no cleanup job.
import { Types } from 'mongoose';
import {
  DATA_SCOPE_RANK,
  ErrorCodes,
  PlatformEvents,
  breakGlassPermissionKeys,
  widerScope,
  type CreateRole,
  type CreateRoleAssignment,
  type DataScope,
  type EffectivePermissionRowDto,
  type EffectivePermissionsDto,
  type ListRoleAssignmentsQuery,
  type ListRolesQuery,
  type Paginated,
  type PermissionDef,
  type PermissionDto,
  type PermissionState,
  type RoleAssignmentDto,
  type RoleDto,
  type RoleManagement,
  type UpdateRole,
  type UpdateRoleAssignment,
  type PageDef,
  type PageDto,
  type PermissionCatalogDto,
  validatePageRegistry,
} from '@ecms/contracts';
import { BusinessRuleError, NotFoundError } from '../../shared/errors';
import { scopeSelector, type AuthContext, type ScopeSelector } from '../../shared/types';
import { HR_ONLY_ROLE_KEY_PREFIX, isDerivedHrRoleKey } from '../../hr-only-policy';
import { getCache } from '../../infrastructure/redis/cache';
import { logger } from '../../infrastructure/logging/logger';
import { diffChanges } from '../../shared/utils/diff';
import { auditService } from '../audit';
import { userService } from '../users';
import { userRepository } from '../users/user.repository';
import { emit } from '../kernel/event-bus';
import {
  PermissionModel,
  roleAssignmentRepository,
  roleRepository,
  type PermissionDoc,
} from './rbac.repository';
import { type RoleDoc } from './role.model';
import { type RoleAssignmentDoc } from './role-assignment.model';

const PERM_CACHE_MAX_TTL_SECONDS = 300;

export interface EffectivePermissions {
  permissions: Record<string, DataScope>;
  isPrivileged: boolean;
}

const roleEntityRef = (id: string) => ({ moduleId: 'platform', entityType: 'role', entityId: id });

/** The seeded role whose last holder must never be removed — the account that can fix everything. */
const SUPER_ADMIN_KEY = 'super-admin';

/** One grant an account holds, placed relative to the moment being evaluated. */
interface ResolvedGrant {
  assignment: RoleAssignmentDoc;
  role: RoleDoc;
  state: PermissionState;
}

/** Where a validity window sits relative to `now` — the R14 rule, in one place. */
const grantState = (assignment: RoleAssignmentDoc, now: Date): PermissionState => {
  if (assignment.validFrom !== null && assignment.validFrom > now) return 'pending';
  if (assignment.validTo !== null && now >= assignment.validTo) return 'expired';
  return 'active';
};

/**
 * **The one place an effective permission set is derived.** (ADR-004; SA-4 amendment to ADR-026.)
 *
 * Two callers need two different projections of the same answer: the authorization path enforces
 * with `{ permissions, isPrivileged }` and caches it, while the administration screen has to
 * explain it — which role, which assignment, which window, and whether it applies right now. A
 * second implementation of the merge would be a second definition of what a permission set IS, and
 * the two would drift the first time either changed. So this function computes everything once and
 * each caller takes the part it needs.
 *
 * The merge rules are unchanged from before the extraction, deliberately and exactly: only ACTIVE
 * grants contribute; a key held at two scopes resolves to the wider (`widerScope`); and
 * `isPrivileged` is decided per ASSIGNMENT (a system role makes its holder privileged even if it
 * happens to carry no keys), never per key.
 */
const computeEffective = (
  assignments: RoleAssignmentDoc[],
  rolesById: Map<string, RoleDoc>,
  now: Date,
): { grants: ResolvedGrant[]; permissions: Record<string, DataScope>; isPrivileged: boolean } => {
  const grants = assignments.flatMap((assignment): ResolvedGrant[] => {
    const role = rolesById.get(String(assignment.roleId));
    // A grant whose role was deleted contributes nothing and explains nothing.
    return role === undefined ? [] : [{ assignment, role, state: grantState(assignment, now) }];
  });

  const permissions: Record<string, DataScope> = {};
  let holdsProtectedRole = false;
  for (const grant of grants) {
    if (grant.state !== 'active') continue;
    if (grant.role.isSystem) holdsProtectedRole = true;
    for (const key of grant.role.permissionKeys) {
      const existing = permissions[key];
      permissions[key] =
        existing === undefined
          ? grant.assignment.scope
          : widerScope(existing, grant.assignment.scope);
    }
  }
  const isPrivileged =
    holdsProtectedRole || breakGlassPermissionKeys.some((key) => key in permissions);

  return { grants, permissions, isPrivileged };
};

/**
 * A row is `active` when something grants it now. Otherwise it reports the more useful of the two
 * remaining answers: a window that has not opened yet is a different fact from one that has closed,
 * and "pending" is the one an administrator can act on.
 */
const rowState = (sources: { state: PermissionState }[]): PermissionState => {
  if (sources.some((s) => s.state === 'active')) return 'active';
  if (sources.some((s) => s.state === 'pending')) return 'pending';
  return 'expired';
};

class RbacService {
  private registryKeys = new Set<string>();

  /**
   * The administration surfaces this deployment declares (P7-A).
   *
   * Held in memory rather than a collection because they are pure code, identical on every boot,
   * and read by exactly one endpoint — persisting them would add a model and a migration to store
   * a copy of something the process already has, and give it a way to disagree with the code.
   * Which pages exist depends on which modules registered, so it can only be known at runtime.
   */
  private pageRegistry: PageDef[] = [];

  // ── Management classification (SA-3) ───────────────────────────────────────

  /**
   * How a role is looked after. Derived, never stored: `isSystem` is the seeded-and-protected flag
   * that also makes holders privileged, and the `hr-only:` prefix marks the derivatives the
   * confinement reconciliation mints and re-asserts on every boot.
   */
  managementOf(doc: Pick<RoleDoc, 'isSystem' | 'key'>): RoleManagement {
    if (doc.isSystem) return 'system';
    return isDerivedHrRoleKey(doc.key) ? 'derived' : 'none';
  }

  /**
   * Both kinds of managed role refuse edits, for different reasons.
   *
   * A SYSTEM role is protected because the platform seeds and depends on it. A DERIVED role is
   * protected because it is not an administrator's to change: the HR-only reconciliation owns it
   * and re-asserts its grants on every boot and every seed, so an edit here is not merely unwise —
   * it is silently reverted, which is worse than being refused.
   */
  private assertEditable(doc: RoleDoc): void {
    const management = this.managementOf(doc);
    if (management === 'system') {
      throw new BusinessRuleError('System roles are protected', ErrorCodes.ROLE_PROTECTED);
    }
    if (management === 'derived') {
      throw new BusinessRuleError(
        'This role is maintained by the HR-only confinement and cannot be edited here — the next boot would restore it',
        ErrorCodes.ROLE_PROTECTED,
      );
    }
  }

  // ── Privilege-escalation guards (SA-3, decisions R2/R3) ────────────────────
  //
  // Applied to EVERY request: the controller passes the caller's context on all four mutating
  // paths. The parameter is optional only because the confinement reconciliation and the seeds act
  // as the SYSTEM — there is no request behind them and no human whose authority could be
  // exceeded — which is the same distinction `by: null` already draws across this codebase. It is
  // not an exemption keyed on a user id or a role: no principal can reach the unguarded path over
  // HTTP.

  /**
   * Nobody may hand out an authority they do not hold. Without this, `role.create` is effectively
   * `*`: an administrator could mint a role carrying every permission in the registry and assign
   * it — to themselves.
   */
  private assertKeysHeld(actor: AuthContext, keys: string[], what: string): void {
    const missing = keys.filter((key) => actor.permissions[key] === undefined);
    if (missing.length > 0) {
      throw new BusinessRuleError(
        `You cannot ${what} permissions you do not hold: ${missing.sort().join(', ')}`,
      );
    }
  }

  /**
   * …and nobody may hand out an authority WIDER than their own. A holder of `x @ branch` granting
   * `x @ organization` would be creating access they cannot exercise, which is the same escalation
   * one level down — the keys all check out and the reach does not.
   */
  private assertScopeNotWider(actor: AuthContext, keys: string[], scope: DataScope): void {
    const wanted = DATA_SCOPE_RANK[scope];
    const tooWide = keys.filter((key) => {
      const held = actor.permissions[key];
      return held !== undefined && DATA_SCOPE_RANK[held] < wanted;
    });
    if (tooWide.length > 0) {
      throw new BusinessRuleError(
        `You cannot grant ${scope} scope for permissions you hold more narrowly: ${tooWide.sort().join(', ')}`,
      );
    }
  }

  // ── Registry (code → DB, boot-time) ───────────────────────────────────────

  async syncPermissionRegistry(defs: PermissionDef[]): Promise<void> {
    const seen = new Set<string>();
    for (const def of defs) {
      if (seen.has(def.key)) throw new Error(`duplicate permission key in catalog: ${def.key}`);
      seen.add(def.key);
      await PermissionModel.updateOne(
        { key: def.key },
        {
          $set: {
            resource: def.resource,
            action: def.action,
            moduleId: def.moduleId,
            name: def.name,
            breakGlass: def.breakGlass === true,
            pageId: def.pageId,
          },
        },
        { upsert: true },
      ).exec();
    }
    await PermissionModel.deleteMany({ key: { $nin: [...seen] } }).exec();
    this.registryKeys = seen;

    // Protected system roles track the catalog: super-admin holds everything. When the
    // catalog changed (a new module registered permissions), the holders' cached permission
    // snapshots are stale — without invalidation the new module 403s until the cache expires.
    const changedRoleKeys: string[] = [];
    if (await roleRepository.setPermissionKeysByKey('super-admin', [...seen])) {
      changedRoleKeys.push('super-admin');
    }
    const platformKeys = defs.filter((d) => d.moduleId === 'platform').map((d) => d.key);
    if (await roleRepository.setPermissionKeysByKey('platform-admin', platformKeys)) {
      changedRoleKeys.push('platform-admin');
    }
    for (const key of changedRoleKeys) {
      const role = await roleRepository.findByKey(key);
      if (role !== null) await this.invalidateUsersOfRole(String(role._id));
    }
    logger.info(
      { count: seen.size, invalidatedRoles: changedRoleKeys },
      'permission registry synced',
    );
  }

  isRegisteredPermission(key: string): boolean {
    return this.registryKeys.has(key);
  }

  /**
   * Every permission key the boot sync put in the registry — the platform catalog plus each
   * registered module's. Empty before `syncPermissionRegistry` has run.
   *
   * This is what "everything" means for a role that is supposed to hold everything, and it can only
   * be known at runtime: the module catalog depends on which manifests this deployment registered.
   */
  registeredPermissionKeys(): string[] {
    return [...this.registryKeys];
  }

  /**
   * Record the page registry for this deployment, and refuse to boot on a broken one.
   *
   * The validation is here rather than only in CI because the registry is ASSEMBLED per deployment:
   * a page belonging to a module nobody enabled is not a problem, and a permission pointing at a
   * page from a module somebody turned off is. Only the process that knows which modules are on can
   * tell those apart, so the check runs where the assembly happens (D6).
   */
  syncPageRegistry(pages: PageDef[], permissions: PermissionDef[]): void {
    const problems = validatePageRegistry(pages, permissions);
    if (problems.length > 0) {
      throw new Error(
        `page registry is invalid:\n${problems.map((p) => `  [${p.kind}] ${p.detail}`).join('\n')}`,
      );
    }
    this.pageRegistry = pages;
  }

  /** The catalog and the surfaces it groups into — one answer, because they are one fact. */
  async listPermissionCatalog(): Promise<PermissionCatalogDto> {
    const permissions = await this.listPermissions();
    const pages: PageDto[] = [...this.pageRegistry]
      .sort(
        (a, b) =>
          a.moduleId.localeCompare(b.moduleId) ||
          (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
          a.id.localeCompare(b.id),
      )
      .map((page) => ({
        id: page.id,
        moduleId: page.moduleId,
        name: page.name,
        route: page.route ?? null,
        sortOrder: page.sortOrder ?? null,
      }));
    return { permissions, pages };
  }

  async listPermissions(): Promise<PermissionDto[]> {
    const docs = await PermissionModel.find()
      .sort({ moduleId: 1, key: 1 })
      .lean<PermissionDoc[]>()
      .exec();
    return docs.map((doc) => ({
      key: doc.key,
      resource: doc.resource,
      action: doc.action,
      moduleId: doc.moduleId,
      name: doc.name,
      breakGlass: doc.breakGlass,
      // `?? null` covers a registry row written before this field existed; the next boot's sync
      // fills it in, and until then the key groups under Other / Unassigned rather than vanishing.
      pageId: doc.pageId ?? null,
    }));
  }

  // ── Roles ─────────────────────────────────────────────────────────────────

  private assertKnownPermissionKeys(keys: string[]): void {
    const unknown = keys.filter((key) => !this.registryKeys.has(key));
    if (unknown.length > 0) {
      throw new BusinessRuleError(
        `Unknown permission keys: ${unknown.join(', ')}`,
        ErrorCodes.PERMISSION_UNKNOWN,
      );
    }
  }

  async createRole(input: CreateRole, by: string, actor?: AuthContext): Promise<RoleDoc> {
    this.assertKnownPermissionKeys(input.permissionKeys);
    if (actor !== undefined) this.assertKeysHeld(actor, input.permissionKeys, 'put into a role');
    const doc = await roleRepository.create(
      {
        key: null,
        name: input.name,
        description: input.description ?? null,
        isSystem: false,
        permissionKeys: [...new Set(input.permissionKeys)],
      },
      { by },
    );
    await auditService.record({
      entityRef: roleEntityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, { name: doc.name, permissionKeys: doc.permissionKeys }),
    });
    await emit(PlatformEvents.RoleChanged, { roleId: String(doc._id), change: 'created' });
    return doc;
  }

  async updateRole(
    id: string,
    input: UpdateRole,
    by: string,
    actor?: AuthContext,
  ): Promise<RoleDoc> {
    const before = await roleRepository.getById(id);
    this.assertEditable(before);
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.description !== undefined) set.description = input.description;
    if (input.permissionKeys !== undefined) {
      this.assertKnownPermissionKeys(input.permissionKeys);
      // Only what the edit ADDS is checked. Removing a grant is a narrowing and always allowed, and
      // re-sending an untouched list must not refuse an administrator who is renaming a role that
      // happens to carry a permission they do not hold — they gain nothing by leaving it there, and
      // assigning that role to anyone still runs the full check.
      const added = input.permissionKeys.filter((key) => !before.permissionKeys.includes(key));
      if (actor !== undefined) this.assertKeysHeld(actor, added, 'add');
      set.permissionKeys = [...new Set(input.permissionKeys)];
    }
    const after = await roleRepository.updateById(id, set, { by, version: input.version });
    await auditService.record({
      entityRef: roleEntityRef(id),
      action: 'update',
      changes: diffChanges(
        {
          name: before.name,
          description: before.description,
          permissionKeys: before.permissionKeys,
        },
        { name: after.name, description: after.description, permissionKeys: after.permissionKeys },
      ),
    });
    await this.invalidateUsersOfRole(id);
    await emit(PlatformEvents.RoleChanged, { roleId: id, change: 'updated' });
    return after;
  }

  async deleteRole(id: string, by: string): Promise<void> {
    const role = await roleRepository.getById(id);
    this.assertEditable(role);
    const assignedUserIds = await roleAssignmentRepository.distinctUserIdsForRole(id);
    if (assignedUserIds.length > 0) {
      throw new BusinessRuleError('Role still has assignments — revoke them first');
    }
    await roleRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: roleEntityRef(id), action: 'delete' });
    await emit(PlatformEvents.RoleChanged, { roleId: id, change: 'deleted' });
  }

  async getRole(id: string): Promise<RoleDoc> {
    return roleRepository.getById(id);
  }

  /**
   * The roles list, with the three filters the administration screen needs.
   *
   * `unassigned` is the one that carries meaning: "disabling" a role IS revoking its assignments —
   * there is no status field and adding one would put a second switch inside the authorization path
   * — so this is how an administrator finds the roles that are currently off. It is computed from
   * the assignments rather than stored, which is why it cannot go stale.
   */
  async listRoles(query: ListRolesQuery): Promise<Paginated<RoleDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.search !== undefined)
      Object.assign(filter, roleRepository.searchFilter(query.search));
    if (query.managed === 'system') filter.isSystem = true;
    if (query.managed === 'derived') {
      filter.isSystem = false;
      filter.key = { $regex: `^${HR_ONLY_ROLE_KEY_PREFIX}` };
    }
    if (query.managed === 'none') {
      filter.isSystem = false;
      filter.$nor = [{ key: { $regex: `^${HR_ONLY_ROLE_KEY_PREFIX}` } }];
    }
    if (query.unassigned === true) {
      const held = await roleAssignmentRepository.roleIdsWithAssignments();
      filter._id = { $nin: held.map((id) => new Types.ObjectId(id)) };
    }
    return roleRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['createdAt', 'name.en'],
    });
  }

  // ── Assignments ───────────────────────────────────────────────────────────

  async assignRole(
    input: CreateRoleAssignment,
    by: string,
    actor?: AuthContext,
  ): Promise<RoleAssignmentDoc> {
    // The target account is read through the CALLER'S scope, so an administrator who cannot see a
    // user cannot grant to them either — 404, not a hint that the account exists.
    const user = await userService.getById(
      input.userId,
      actor === undefined ? undefined : scopeSelector(actor, 'role.assign'),
    );
    const role = await roleRepository.getById(input.roleId);
    if (actor !== undefined) {
      this.assertKeysHeld(actor, role.permissionKeys, 'grant');
      this.assertScopeNotWider(actor, role.permissionKeys, input.scope);
    }

    // A hierarchical scope always resolves to the user's HOME placement at that level (ADR-015/017);
    // multi-placement grants arrive with a real consumer. The optional *Id inputs, when present,
    // must match that home placement.
    const resolvePlacement = (
      level: 'branch' | 'department' | 'section',
      home: Types.ObjectId | null,
      supplied: string | undefined,
    ): Types.ObjectId | null => {
      if (home === null) {
        throw new BusinessRuleError(
          `A ${level}-scoped assignment requires the user to have a ${level}`,
        );
      }
      if (supplied !== undefined && supplied !== String(home)) {
        throw new BusinessRuleError(
          `${level}-scoped assignments must target the user's home ${level} (multi-${level} grants are not supported yet)`,
        );
      }
      return home;
    };

    const org = user.organization;
    let branchId: Types.ObjectId | null = null;
    let departmentId: Types.ObjectId | null = null;
    let sectionId: Types.ObjectId | null = null;
    if (input.scope === 'branch') {
      branchId = resolvePlacement('branch', org.branchId, input.branchId);
    } else if (input.scope === 'department') {
      departmentId = resolvePlacement('department', org.departmentId, input.departmentId);
    } else if (input.scope === 'section') {
      sectionId = resolvePlacement('section', org.sectionId, input.sectionId);
    }

    const doc = await roleAssignmentRepository.create(
      {
        userId: user._id,
        roleId: role._id,
        scope: input.scope,
        branchId,
        departmentId,
        sectionId,
        validFrom: input.validFrom ?? null,
        validTo: input.validTo ?? null,
      },
      { by },
    );
    await this.invalidateUser(input.userId);
    await auditService.record({
      entityRef: { moduleId: 'platform', entityType: 'user', entityId: input.userId },
      action: 'roleAssigned',
      changes: [
        { field: 'role', old: null, new: `${role.name.en} @ ${input.scope}` },
        ...(doc.validTo === null
          ? []
          : [{ field: 'validTo', old: null, new: doc.validTo.toISOString() }]),
      ],
    });
    await emit(PlatformEvents.RoleAssignmentChanged, {
      userId: input.userId,
      roleId: input.roleId,
      scope: input.scope,
      change: 'granted',
    });
    return doc;
  }

  /**
   * Would revoking this grant leave nobody able to administer the system? The last Super Admin is
   * the account that can repair any other mistake, so removing it is refused — a system nobody can
   * administer is not a state an administrative screen should be able to reach.
   *
   * The question is asked about the grants that SURVIVE the revoke, and about the accounts behind
   * them rather than the assignment rows: archiving does not revoke (SA-5 decision 1), so a
   * retired account keeps its super-admin grant, and counting rows would accept that dead grant as
   * cover — letting the rule be defeated by archiving a spare Super Admin first. Only an account
   * that can still sign in counts. Two grants held by the SAME account (one per scope) are cover
   * for each other, which is why the surviving rows are resolved to accounts before counting.
   */
  private async isLastSuperAdminAssignment(doc: RoleAssignmentDoc): Promise<boolean> {
    const superAdmin = await roleRepository.findByKey(SUPER_ADMIN_KEY);
    if (superAdmin === null || String(superAdmin._id) !== String(doc.roleId)) return false;
    const holders = await roleAssignmentRepository.findActiveForRole(String(doc.roleId));
    const survivors = holders
      .filter((held) => String(held._id) !== String(doc._id))
      .map((held) => String(held.userId));
    return (await userRepository.activeIdsAmong(survivors)).length === 0;
  }

  /**
   * The two guards every change to an existing assignment shares.
   *
   * Self-protection is not paternalism: revoking your own grant is how an administrator locks
   * themselves out of the screen they would need to undo it, and the account menu offers no way
   * back. Another administrator can always do it.
   */
  private async assertMayChangeAssignment(
    actor: AuthContext,
    doc: RoleAssignmentDoc,
  ): Promise<void> {
    if (String(doc.userId) === actor.userId) {
      throw new BusinessRuleError('You cannot change your own role assignment');
    }
    // Reading the holder through the caller's scope is what makes an out-of-scope assignment a 404.
    await userService.getById(String(doc.userId), scopeSelector(actor, 'role.assign'));
  }

  async revokeAssignment(id: string, by: string, actor?: AuthContext): Promise<void> {
    const doc = await roleAssignmentRepository.getById(id);
    if (actor !== undefined) {
      await this.assertMayChangeAssignment(actor, doc);
      if (await this.isLastSuperAdminAssignment(doc)) {
        throw new BusinessRuleError(
          'This is the last Super Admin assignment — grant the role to another account first',
        );
      }
    }
    await roleAssignmentRepository.softDeleteById(id, { by });
    await this.invalidateUser(String(doc.userId));
    await auditService.record({
      entityRef: { moduleId: 'platform', entityType: 'user', entityId: String(doc.userId) },
      action: 'roleRevoked',
      changes: [{ field: 'roleId', old: String(doc.roleId), new: null }],
    });
    await emit(PlatformEvents.RoleAssignmentChanged, {
      userId: String(doc.userId),
      roleId: String(doc.roleId),
      change: 'revoked',
    });
  }

  /**
   * Assignments the caller may see. `role_assignments` carries no placement of its own, so the
   * filtering happens through the HOLDER — the same clause a direct read of `users` would apply.
   */
  async listAssignments(
    query: ListRoleAssignmentsQuery,
    scope?: ScopeSelector,
  ): Promise<Paginated<RoleAssignmentDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.userId !== undefined) filter.userId = new Types.ObjectId(query.userId);
    if (query.roleId !== undefined) filter.roleId = new Types.ObjectId(query.roleId);
    const { items, totalItems } = await roleAssignmentRepository.listVisible(
      filter,
      query.page,
      query.pageSize,
      userRepository.holderScopeMatch(scope, 'holder.'),
    );
    return {
      items,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / query.pageSize)),
      },
    };
  }

  /**
   * Move an existing grant's validity window. The role, the user and the scope are untouched — a
   * change to any of those is a different grant, which is a revocation and a new assignment.
   *
   * The holders' cached permission snapshots are invalidated because a window that just opened or
   * closed changes what the account may do right now, and the cache TTL is capped at the NEXT
   * boundary — which this call may have just moved.
   */
  async updateAssignment(
    id: string,
    input: UpdateRoleAssignment,
    by: string,
    actor: AuthContext,
  ): Promise<RoleAssignmentDoc> {
    const before = await roleAssignmentRepository.getById(id);
    await this.assertMayChangeAssignment(actor, before);

    const set: Record<string, unknown> = {};
    if (input.validFrom !== undefined) set.validFrom = input.validFrom;
    if (input.validTo !== undefined) set.validTo = input.validTo;
    const from = (set.validFrom ?? before.validFrom) as Date | null;
    const to = (set.validTo ?? before.validTo) as Date | null;
    if (from !== null && to !== null && from >= to) {
      throw new BusinessRuleError('validFrom must be before validTo');
    }

    // The caller's version, not the stored one: a stale edit answers 409 rather than silently
    // undoing the administrator who got there first.
    const after = await roleAssignmentRepository.updateById(id, set, {
      by,
      version: input.version,
    });
    await this.invalidateUser(String(before.userId));
    await auditService.record({
      entityRef: { moduleId: 'platform', entityType: 'user', entityId: String(before.userId) },
      action: 'roleAssignmentUpdated',
      changes: diffChanges(
        {
          validFrom: before.validFrom?.toISOString() ?? null,
          validTo: before.validTo?.toISOString() ?? null,
        },
        {
          validFrom: after.validFrom?.toISOString() ?? null,
          validTo: after.validTo?.toISOString() ?? null,
        },
      ),
    });
    return after;
  }

  // ── Evaluation & cache (ADR-004) ──────────────────────────────────────────

  private permCacheKey(userId: string, version: number): string {
    return `perms:${userId}:v${version}`;
  }

  async invalidateUser(userId: string): Promise<void> {
    await userService.bumpPermissionVersion(userId);
    await getCache().del(`auth:user:${userId}`);
  }

  private async invalidateUsersOfRole(roleId: string): Promise<void> {
    const userIds = await roleAssignmentRepository.distinctUserIdsForRole(roleId);
    for (const userId of userIds) await this.invalidateUser(userId);
  }

  /**
   * Read every grant an account holds, valid or not, with its role resolved.
   *
   * Deliberately unfiltered by time: the enforcement path throws the invalid ones away immediately,
   * but SA-4's explanation is mostly about them — "why can't they do X" is usually answered by a
   * window that closed. One read serves both, so the two can never disagree about what exists.
   */
  private async loadGrants(userId: string): Promise<{
    assignments: RoleAssignmentDoc[];
    rolesById: Map<string, RoleDoc>;
  }> {
    const assignments = await roleAssignmentRepository.findActiveForUser(userId);
    const roles = await roleRepository.findByIds(assignments.map((a) => a.roleId));
    return { assignments, rolesById: new Map(roles.map((role) => [String(role._id), role])) };
  }

  async getEffectivePermissions(
    userId: string,
    permissionVersion: number,
  ): Promise<EffectivePermissions> {
    const cache = getCache();
    const cacheKey = this.permCacheKey(userId, permissionVersion);
    const cached = await cache.get(cacheKey);
    if (cached !== null) return JSON.parse(cached) as EffectivePermissions;

    const now = new Date();
    const { assignments, rolesById } = await this.loadGrants(userId);
    const { permissions, isPrivileged } = computeEffective(assignments, rolesById, now);

    // Cache TTL never crosses a validity boundary (Review R14).
    const boundaries = assignments
      .flatMap((a) => [a.validFrom, a.validTo])
      .filter((d): d is Date => d !== null && d > now)
      .map((d) => Math.ceil((d.getTime() - now.getTime()) / 1000));
    const ttl = Math.max(1, Math.min(PERM_CACHE_MAX_TTL_SECONDS, ...boundaries));

    const result: EffectivePermissions = { permissions, isPrivileged };
    await cache.set(cacheKey, JSON.stringify(result), ttl);
    return result;
  }

  /**
   * The same computation as `getEffectivePermissions`, with nothing thrown away (SA-4).
   *
   * Read-only, uncached, and computed fresh: this is an administration screen, and a second cache
   * would be a second thing to invalidate everywhere the first one is. The enforcement path keeps
   * its cache; `evaluatedAt` rides along so the screen can say which moment it is describing rather
   * than implying it speaks for the authorizer.
   *
   * It reduces to exactly what the authorizer enforces — the shared `computeEffective` is the only
   * place either answer is derived — and a test asserts that agreement rather than trusting it.
   */
  async explainEffectivePermissions(
    userId: string,
    scope?: ScopeSelector,
  ): Promise<EffectivePermissionsDto> {
    const now = new Date();
    // Scoped read FIRST, and it is the same read that supplies `permissionVersion` — so an account
    // the caller may not see answers 404 before a single grant has been looked at, and there is no
    // second, unscoped path to the same record.
    const user = await userService.getById(userId, scope);
    const { assignments, rolesById } = await this.loadGrants(userId);
    const { grants, permissions, isPrivileged } = computeEffective(assignments, rolesById, now);

    // The registry, for the module and the human name. A key it does not know still gets a row:
    // a role outlives the module that declared its keys, and hiding it would hide the reason.
    const keys = [...new Set(grants.flatMap((g) => g.role.permissionKeys))];
    const definitions = new Map(
      (
        await PermissionModel.find({ key: { $in: keys } })
          .lean<PermissionDoc[]>()
          .exec()
      ).map((doc) => [doc.key, doc]),
    );

    const rows = keys
      .map((key): EffectivePermissionRowDto => {
        const sources = grants
          .filter((g) => g.role.permissionKeys.includes(key))
          .map((g) => ({
            assignmentId: String(g.assignment._id),
            roleId: String(g.role._id),
            roleName: g.role.name,
            roleKey: g.role.key,
            roleManaged: this.managementOf(g.role),
            scope: g.assignment.scope,
            validFrom: g.assignment.validFrom?.toISOString() ?? null,
            validTo: g.assignment.validTo?.toISOString() ?? null,
            state: g.state,
            // Active, and as wide as the winning scope. Ties are marked on both, because both are.
            decisive: g.state === 'active' && g.assignment.scope === permissions[key],
          }));
        const definition = definitions.get(key);
        return {
          key,
          moduleId: definition?.moduleId ?? null,
          name: definition?.name ?? null,
          breakGlass: definition?.breakGlass ?? false,
          scope: permissions[key] ?? null,
          state: rowState(sources),
          sources,
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key));

    return {
      userId,
      evaluatedAt: now.toISOString(),
      permissionVersion: user.security.permissionVersion,
      isPrivileged,
      privilegedBecause: {
        systemRoles: [
          ...new Set(
            grants
              .filter((g) => g.state === 'active' && g.role.isSystem)
              .map((g) => g.role.name.en),
          ),
        ].sort(),
        breakGlassKeys: breakGlassPermissionKeys.filter((key) => key in permissions).sort(),
      },
      rows,
    };
  }

  /**
   * Every user currently holding `permissionKey` at `scope` or wider (Sprint 3.3 plan
   * §8/§11 — permission-based notification fan-out; `branchId` is required for
   * `scope: 'branch'`). A read-only query over the existing registry/assignment
   * collections — no new schema.
   */
  async listUserIdsWithPermission(
    permissionKey: string,
    scope: 'organization' | 'branch',
    branchId?: string,
  ): Promise<string[]> {
    const roles = await roleRepository.findGrantingPermission(permissionKey);
    if (roles.length === 0) return [];
    return roleAssignmentRepository.distinctUserIdsForRolesAtScope(
      roles.map((role) => role._id),
      scope,
      branchId,
    );
  }

  /** Expiring-soon inventory for the scheduler report (Review R14). */
  async listExpiringAssignments(
    days: number,
  ): Promise<{ userId: string; roleId: string; validTo: Date }[]> {
    const rows = await roleAssignmentRepository.findExpiringWithin(days);
    return rows
      .filter((row): row is typeof row & { validTo: Date } => row.validTo !== null)
      .map((row) => ({
        userId: String(row.userId),
        roleId: String(row.roleId),
        validTo: row.validTo,
      }));
  }

  // ── DTOs ──────────────────────────────────────────────────────────────────

  toRoleDto(doc: RoleDoc): RoleDto {
    return {
      id: String(doc._id),
      key: doc.key,
      name: doc.name,
      description: doc.description,
      isSystem: doc.isSystem,
      managed: this.managementOf(doc),
      permissionKeys: doc.permissionKeys,
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }

  /**
   * The roles referenced by a page of assignments, in ONE read. Without it every screen listing
   * assignments would have to load the whole catalog to render a name — the pattern ADR-019 exists
   * to prevent.
   */
  async rolesForAssignments(docs: RoleAssignmentDoc[]): Promise<Map<string, RoleDoc>> {
    if (docs.length === 0) return new Map();
    const roles = await roleRepository.findByIds([...new Set(docs.map((d) => d.roleId))]);
    return new Map(roles.map((role) => [String(role._id), role]));
  }

  toAssignmentDto(doc: RoleAssignmentDoc, role?: RoleDoc | undefined): RoleAssignmentDto {
    return {
      id: String(doc._id),
      userId: String(doc.userId),
      roleId: String(doc.roleId),
      // Null when the role is gone (soft-deleted after the grant): the screen says so rather than
      // rendering a blank, and the grant itself is still visible so it can be cleaned up.
      role:
        role === undefined
          ? null
          : {
              id: String(role._id),
              name: role.name,
              key: role.key,
              managed: this.managementOf(role),
            },
      scope: doc.scope,
      branchId: doc.branchId === null ? null : String(doc.branchId),
      departmentId: doc.departmentId === null ? null : String(doc.departmentId),
      sectionId: doc.sectionId === null ? null : String(doc.sectionId),
      validFrom: doc.validFrom === null ? null : doc.validFrom.toISOString(),
      validTo: doc.validTo === null ? null : doc.validTo.toISOString(),
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  // ── Seed helpers ──────────────────────────────────────────────────────────

  /** Users currently assigned a seeded system role (e.g. nav-catalog sync grants to admins). */
  async userIdsWithSystemRole(
    key: 'super-admin' | 'platform-admin' | 'employee-self-service',
  ): Promise<string[]> {
    const role = await roleRepository.findByKey(key);
    if (role === null) return [];
    return roleAssignmentRepository.distinctUserIdsForRole(String(role._id));
  }

  /**
   * WIDEN a seeded system role with grants a later module owns.
   *
   * `ensureSystemRole` deliberately never touches a role that already exists — a re-seed must not
   * silently revert an administrator's edit. But a role the PLATFORM owns still has to grow when a
   * module ships the surface it is meant to open (Attendance's self-service keys, AT-6), and on
   * every database that already ran the earlier seed there is no other moment to add them. So this
   * is strictly additive — it only ever unions keys in, never removes — and idempotent: the second
   * run finds nothing to add and writes nothing.
   */
  async addSystemRoleGrants(
    key: 'super-admin' | 'platform-admin' | 'employee-self-service',
    permissionKeys: string[],
  ): Promise<number> {
    const existing = await roleRepository.findByKey(key);
    if (existing === null) return 0;
    const missing = permissionKeys.filter((k) => !existing.permissionKeys.includes(k));
    if (missing.length === 0) return 0;
    await roleRepository.setPermissionKeysByKey(key, [...existing.permissionKeys, ...missing]);
    await this.invalidateUsersOfRole(String(existing._id));
    return missing.length;
  }

  async ensureSystemRole(
    key: 'super-admin' | 'platform-admin' | 'employee-self-service',
    name: { ar: string; en: string },
    permissionKeys: string[],
  ): Promise<RoleDoc> {
    const existing = await roleRepository.findByKey(key);
    if (existing !== null) return existing;
    return roleRepository.create(
      { key, name, description: null, isSystem: true, permissionKeys },
      { by: null },
    );
  }

  /**
   * A keyed role that is NOT a system role — seeded and kept in step with the code, but ordinary
   * as far as authorization is concerned.
   *
   * The distinction is load-bearing rather than cosmetic: `isSystem` is one of the two things that
   * make a holder PRIVILEGED (see `getEffectivePermissions`), and a privileged account is the one
   * TOTP enrollment is forced on at login. A seeded bundle of ordinary module permissions has no
   * business making its holders privileged, so it is created with `isSystem: false` and stays
   * protected by its `key` alone (the admin UI's protection is `isSystem`, so such a role remains
   * editable by administrators by design — the seed re-asserts its grants on every run).
   *
   * Idempotent: creates the role when the key is free, and otherwise brings its grants back to the
   * declared set, invalidating the holders' cached permission snapshots when they actually changed.
   */
  async ensureManagedRole(
    key: string,
    name: { ar: string; en: string },
    permissionKeys: string[],
  ): Promise<RoleDoc> {
    const keys = [...new Set(permissionKeys)];
    const existing = await roleRepository.findByKey(key);
    if (existing === null) {
      return roleRepository.create(
        { key, name, description: null, isSystem: false, permissionKeys: keys },
        { by: null },
      );
    }
    if (await roleRepository.setPermissionKeysByKey(key, keys)) {
      await this.invalidateUsersOfRole(String(existing._id));
    }
    const refreshed = await roleRepository.findByKey(key);
    return refreshed ?? existing;
  }

  /**
   * `permissionKey -> moduleId` for the keys asked about, read from the DB registry the boot sync
   * writes. Keys absent from the registry (a permission a retired module used to declare, still
   * sitting in a role) are simply missing from the map — callers decide what an unknown grant
   * means rather than having a default guessed for them here.
   */
  async moduleIdsForPermissions(permissionKeys: string[]): Promise<Map<string, string>> {
    if (permissionKeys.length === 0) return new Map();
    const docs = await PermissionModel.find(
      { key: { $in: [...new Set(permissionKeys)] } },
      { key: 1, moduleId: 1 },
    )
      .lean<{ key: string; moduleId: string }[]>()
      .exec();
    return new Map(docs.map((doc) => [doc.key, doc.moduleId]));
  }

  /**
   * Re-grant an existing assignment's user a DIFFERENT role on exactly the same terms — same data
   * scope, same branch/department/section placement, same validity window.
   *
   * `assignRole` cannot express this: it re-derives the placement from the user's home org and
   * refuses anything the input does not match, which is right for an administrator granting a role
   * and wrong for a rewrite that must preserve what was already granted. Silently widening a
   * department-scoped grant to organization scope, or dropping a `validTo`, would turn a
   * restriction into an escalation.
   *
   * Idempotent: an equivalent live assignment is left as it is.
   */
  async mirrorAssignment(
    source: RoleAssignmentDoc,
    roleId: string,
    by: string,
  ): Promise<RoleAssignmentDoc | null> {
    const userId = String(source.userId);
    const existing = await roleAssignmentRepository.findActiveForUser(userId);
    if (existing.some((a) => String(a.roleId) === roleId && a.scope === source.scope)) return null;
    const doc = await roleAssignmentRepository.create(
      {
        userId: source.userId,
        roleId: new Types.ObjectId(roleId),
        scope: source.scope,
        branchId: source.branchId,
        departmentId: source.departmentId,
        sectionId: source.sectionId,
        validFrom: source.validFrom,
        validTo: source.validTo,
      },
      { by },
    );
    await this.invalidateUser(userId);
    await auditService.record({
      entityRef: { moduleId: 'platform', entityType: 'user', entityId: userId },
      action: 'roleAssigned',
      changes: [{ field: 'role', old: null, new: `${roleId} @ ${source.scope}` }],
    });
    await emit(PlatformEvents.RoleAssignmentChanged, {
      userId,
      roleId,
      scope: source.scope,
      change: 'granted',
    });
    return doc;
  }

  async ensureAssignment(userId: string, roleId: string, scope: DataScope): Promise<void> {
    const existing = await roleAssignmentRepository.findActiveForUser(userId);
    if (existing.some((a) => String(a.roleId) === roleId && a.scope === scope)) return;
    await roleAssignmentRepository.create(
      {
        userId: new Types.ObjectId(userId),
        roleId: new Types.ObjectId(roleId),
        scope,
        branchId: null,
        departmentId: null,
        sectionId: null,
        validFrom: null,
        validTo: null,
      },
      { by: null },
    );
    await this.invalidateUser(userId).catch(() => {
      throw new NotFoundError('user for assignment not found');
    });
  }
}

export const rbacService = new RbacService();
