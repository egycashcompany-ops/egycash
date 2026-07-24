// The authorization model (ADR-004, amended by ADR-015): permissions declared in
// code and synced at boot; roles are data; assignments carry a data scope and an
// optional validity window (Review R14). Effective permission sets are cached with
// a TTL capped at the next validity boundary — expiry needs no cleanup job.
import { Types } from 'mongoose';
import {
  ErrorCodes,
  PlatformEvents,
  breakGlassPermissionKeys,
  widerScope,
  type CreateRole,
  type CreateRoleAssignment,
  type DataScope,
  type ListRoleAssignmentsQuery,
  type Paginated,
  type PermissionDef,
  type PermissionDto,
  type RoleAssignmentDto,
  type RoleDto,
  type UpdateRole,
} from '@ecms/contracts';
import { BusinessRuleError, NotFoundError } from '../../shared/errors';
import { getCache } from '../../infrastructure/redis/cache';
import { logger } from '../../infrastructure/logging/logger';
import { diffChanges } from '../../shared/utils/diff';
import { auditService } from '../audit';
import { userService } from '../users';
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

class RbacService {
  private registryKeys = new Set<string>();

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
          },
        },
        { upsert: true },
      ).exec();
    }
    await PermissionModel.deleteMany({ key: { $nin: [...seen] } }).exec();
    this.registryKeys = seen;

    // Protected system roles track the catalog: super-admin holds everything.
    await roleRepository.setPermissionKeysByKey('super-admin', [...seen]);
    await roleRepository.setPermissionKeysByKey(
      'platform-admin',
      defs.filter((d) => d.moduleId === 'platform').map((d) => d.key),
    );
    logger.info({ count: seen.size }, 'permission registry synced');
  }

  isRegisteredPermission(key: string): boolean {
    return this.registryKeys.has(key);
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

  async createRole(input: CreateRole, by: string): Promise<RoleDoc> {
    this.assertKnownPermissionKeys(input.permissionKeys);
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

  async updateRole(id: string, input: UpdateRole, by: string): Promise<RoleDoc> {
    const before = await roleRepository.getById(id);
    if (before.isSystem) {
      throw new BusinessRuleError('System roles are protected', ErrorCodes.ROLE_PROTECTED);
    }
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.description !== undefined) set.description = input.description;
    if (input.permissionKeys !== undefined) {
      this.assertKnownPermissionKeys(input.permissionKeys);
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
    if (role.isSystem) {
      throw new BusinessRuleError('System roles are protected', ErrorCodes.ROLE_PROTECTED);
    }
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

  async listRoles(page: number, pageSize: number): Promise<Paginated<RoleDoc>> {
    return roleRepository.list({ page, pageSize, sortableFields: ['createdAt'] });
  }

  // ── Assignments ───────────────────────────────────────────────────────────

  async assignRole(input: CreateRoleAssignment, by: string): Promise<RoleAssignmentDoc> {
    const user = await userService.getById(input.userId);
    const role = await roleRepository.getById(input.roleId);

    // A hierarchical scope always resolves to the user's HOME placement at that level (ADR-015/017);
    // multi-placement grants arrive with a real consumer. The optional *Id inputs, when present,
    // must match that home placement.
    const resolvePlacement = (
      level: 'branch' | 'department' | 'section',
      home: Types.ObjectId | null,
      supplied: string | undefined,
    ): Types.ObjectId | null => {
      if (home === null) {
        throw new BusinessRuleError(`A ${level}-scoped assignment requires the user to have a ${level}`);
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

  async revokeAssignment(id: string, by: string): Promise<void> {
    const doc = await roleAssignmentRepository.getById(id);
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

  async listAssignments(query: ListRoleAssignmentsQuery): Promise<Paginated<RoleAssignmentDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.userId !== undefined) filter.userId = new Types.ObjectId(query.userId);
    if (query.roleId !== undefined) filter.roleId = new Types.ObjectId(query.roleId);
    return roleAssignmentRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortableFields: ['createdAt'],
    });
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

  async getEffectivePermissions(
    userId: string,
    permissionVersion: number,
  ): Promise<EffectivePermissions> {
    const cache = getCache();
    const cacheKey = this.permCacheKey(userId, permissionVersion);
    const cached = await cache.get(cacheKey);
    if (cached !== null) return JSON.parse(cached) as EffectivePermissions;

    const now = new Date();
    const assignments = await roleAssignmentRepository.findActiveForUser(userId);
    const active = assignments.filter(
      (a) =>
        (a.validFrom === null || a.validFrom <= now) && (a.validTo === null || now < a.validTo),
    );
    const roles = await roleRepository.findByIds(active.map((a) => a.roleId));
    const rolesById = new Map(roles.map((role) => [String(role._id), role]));

    const permissions: Record<string, DataScope> = {};
    let holdsProtectedRole = false;
    for (const assignment of active) {
      const role = rolesById.get(String(assignment.roleId));
      if (role === undefined) continue;
      if (role.isSystem) holdsProtectedRole = true;
      for (const key of role.permissionKeys) {
        const existing = permissions[key];
        permissions[key] =
          existing === undefined ? assignment.scope : widerScope(existing, assignment.scope);
      }
    }
    const isPrivileged =
      holdsProtectedRole || breakGlassPermissionKeys.some((key) => key in permissions);

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
      name: doc.name,
      description: doc.description,
      isSystem: doc.isSystem,
      permissionKeys: doc.permissionKeys,
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }

  toAssignmentDto(doc: RoleAssignmentDoc): RoleAssignmentDto {
    return {
      id: String(doc._id),
      userId: String(doc.userId),
      roleId: String(doc.roleId),
      scope: doc.scope,
      branchId: doc.branchId === null ? null : String(doc.branchId),
      departmentId: doc.departmentId === null ? null : String(doc.departmentId),
      sectionId: doc.sectionId === null ? null : String(doc.sectionId),
      validFrom: doc.validFrom === null ? null : doc.validFrom.toISOString(),
      validTo: doc.validTo === null ? null : doc.validTo.toISOString(),
      createdAt: doc.createdAt.toISOString(),
    };
  }

  // ── Seed helpers ──────────────────────────────────────────────────────────

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
