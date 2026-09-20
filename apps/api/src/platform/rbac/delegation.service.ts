// Delegated grants (ADR-032, Gap 1): a manager hands out, per UNIT, what they hold there.
//
// The rule is ADR-026's, applied one level down and read per unit: nobody hands out an authority
// they do not hold. A unit is one department in one branch, or a whole branch. The manager must
// hold `delegation.manage` over the unit, and every key they ADD must be one they hold over that
// unit (`keyCoversUnit`): a whole-branch holder covers any department in the branch; a
// department-level holder covers that department there and nothing else — so «مدير عام الحركة»
// (الحركة in every branch) may grant «الحركة · المهندسين» and never «المهندسين» as a whole, and
// «مدير الحركة في المهندسين» may grant nothing in «الأمن».
//
// Keys already on the record that the manager could not grant themselves stay: removing is a
// narrowing and always allowed; keeping what somebody else granted is not a grant.
//
// Who may be delegated to is the manager's reach for `delegation.manage`: the target account is
// read through that selector, so an account outside it answers 404 before a single key is looked
// at — the same shape `assignRole` has with `role.assign`.
import { Types } from 'mongoose';
import {
  type DelegationCatalogDto,
  type DelegationDto,
  type SetDelegation,
  type UserDelegationsDto,
} from '@ecms/contracts';
import { BusinessRuleError } from '../../shared/errors';
import { keyCoversUnit, reachOfKey, scopeSelector, type AuthContext } from '../../shared/types';
import { auditService } from '../audit';
import { userService } from '../users';
import { branchRepository } from '../organization/branches/branch.repository';
import { departmentRepository } from '../organization/departments/department.repository';
import { type DepartmentDoc } from '../organization/departments/department.model';
import { delegatedGrantRepository } from './delegation.repository';
import { type DelegatedGrantDoc } from './delegation.model';
import { rbacService } from './rbac.service';

export const DELEGATION_KEY = 'delegation.manage';

type Name = { ar: string; en: string };

/** The units one key covers for the caller: whole branches, and department copies (id → branch). */
const coverageOf = (
  actor: AuthContext,
  key: string,
): { everywhere: boolean; branches: Set<string>; departments: Map<string, string | null> } => {
  const held = actor.permissions[key];
  if (held === undefined || held === 'own' || held === 'section') {
    return { everywhere: false, branches: new Set(), departments: new Map() };
  }
  if (held === 'organization') return { everywhere: true, branches: new Set(), departments: new Map() };
  const reach = reachOfKey(actor, key);
  if (reach.branchIds.length > 0 || reach.departments.length > 0) {
    return {
      everywhere: false,
      branches: new Set(reach.branchIds),
      departments: new Map(reach.departments.map((d) => [d.id, d.branchId])),
    };
  }
  // Home only: the branch for a branch grant, the department (branch resolved later) for a
  // department grant.
  return {
    everywhere: false,
    branches: new Set(held === 'branch' && actor.branchId !== null ? [actor.branchId] : []),
    departments: new Map(held === 'department' && actor.departmentId !== null ? [[actor.departmentId, null]] : []),
  };
};

class DelegationService {
  /** The units the caller may delegate in, with the keys they may hand out in each. */
  async catalogFor(actor: AuthContext): Promise<DelegationCatalogDto> {
    if (actor.permissions[DELEGATION_KEY] === undefined) return { branches: [], pages: [], permissions: [] };

    const registered = new Set(rbacService.registeredPermissionKeys());
    const keys = Object.keys(actor.permissions).filter((k) => registered.has(k));
    const manage = coverageOf(actor, DELEGATION_KEY);

    // Which units the caller delegates in at all: the whole branches, and the department copies,
    // that `delegation.manage` covers. Everything else is invisible to the screen.
    const liveBranches = (await branchRepository.listAll()).filter(
      (b) => b.status === 'active' && b.isDeleted !== true,
    );
    const wholeBranchIds = manage.everywhere
      ? liveBranches.map((b) => String(b._id))
      : liveBranches.map((b) => String(b._id)).filter((id) => manage.branches.has(id));
    const manageDepartmentIds = [...manage.departments.keys()];
    const departments: DepartmentDoc[] = [
      ...(await departmentRepository.findLiveInBranchesSystem(wholeBranchIds)),
      ...(manageDepartmentIds.length > 0 ? await departmentRepository.findByIdsSystem(manageDepartmentIds) : []),
    ].filter((d, i, all) => d.isDeleted !== true && all.findIndex((x) => String(x._id) === String(d._id)) === i);
    const branchIdsShown = new Set([...wholeBranchIds, ...departments.map((d) => String(d.branchId))]);

    // Per key, its own coverage — what the caller may hand out where.
    const perKey = new Map(keys.map((key) => [key, coverageOf(actor, key)]));
    const wholeKeys = (branchId: string): string[] =>
      keys.filter((key) => {
        const c = perKey.get(key);
        return c !== undefined && (c.everywhere || c.branches.has(branchId));
      });
    const departmentKeys = (d: DepartmentDoc, beyond: ReadonlySet<string>): string[] =>
      keys.filter((key) => {
        if (beyond.has(key)) return false;
        const c = perKey.get(key);
        return c !== undefined && c.departments.has(String(d._id));
      });

    const branches = liveBranches
      .filter((b) => branchIdsShown.has(String(b._id)))
      .map((b) => {
        const id = String(b._id);
        const whole = wholeBranchIds.includes(id) ? wholeKeys(id).sort() : [];
        const wholeSet = new Set(whole);
        return {
          id,
          name: b.name,
          permissionKeys: whole,
          departments: departments
            .filter((d) => String(d.branchId) === id)
            .map((d) => ({ id: String(d._id), name: d.name, permissionKeys: departmentKeys(d, wholeSet).sort() }))
            // A department a department-level manager reaches with nothing to hand out there is
            // not a unit to offer; under a whole-branch holder every department is one.
            .filter((d) => wholeBranchIds.includes(id) || d.permissionKeys.length > 0),
        };
      })
      .filter((b) => b.permissionKeys.length > 0 || b.departments.length > 0);

    const union = new Set(branches.flatMap((b) => [...b.permissionKeys, ...b.departments.flatMap((d) => d.permissionKeys)]));
    const catalog = await rbacService.listPermissionCatalog();
    const permissions = catalog.permissions.filter((p) => union.has(p.key));
    const pageIds = new Set(permissions.map((p) => p.pageId));
    return { branches, pages: catalog.pages.filter((p) => pageIds.has(p.id)), permissions };
  }

  /** Every per-unit grant one account holds, read through the caller's delegation reach. */
  async forUser(actor: AuthContext, userId: string): Promise<UserDelegationsDto> {
    await userService.getById(userId, scopeSelector(actor, DELEGATION_KEY));
    return this.toUserDto(userId, await delegatedGrantRepository.findForUser(userId));
  }

  /**
   * Replace the unit's table for one account. An empty list removes it.
   *
   * Every rule is enforced here, on every HTTP path — the screen greys out what the manager cannot
   * grant, but that is an explanation of a refusal made here.
   */
  async set(actor: AuthContext, userId: string, input: SetDelegation): Promise<UserDelegationsDto> {
    const { branchId, departmentId } = input;
    if (!keyCoversUnit(actor, DELEGATION_KEY, branchId, departmentId)) {
      throw new BusinessRuleError(
        departmentId === null
          ? 'You do not delegate over this whole branch'
          : 'You do not delegate in this department of this branch',
      );
    }
    const target = await userService.getById(userId, scopeSelector(actor, DELEGATION_KEY));
    const [branch] = await branchRepository.findByIdsSystem([branchId]);
    if (branch === undefined || branch.status !== 'active' || branch.isDeleted === true) {
      throw new BusinessRuleError(`Unknown or inactive branch: ${branchId}`);
    }
    if (departmentId !== null) {
      const [department] = await departmentRepository.findByIdsSystem([departmentId]);
      if (department === undefined || department.isDeleted === true) {
        throw new BusinessRuleError(`Unknown department: ${departmentId}`);
      }
      if (String(department.branchId) !== branchId) {
        throw new BusinessRuleError('The department is not in this branch');
      }
    }

    const wanted = [...new Set(input.permissionKeys)].sort();
    const unknown = wanted.filter((key) => !rbacService.isRegisteredPermission(key));
    if (unknown.length > 0) {
      throw new BusinessRuleError(`Unknown permission keys: ${unknown.join(', ')}`);
    }

    const current = await delegatedGrantRepository.findForUserInUnit(userId, branchId, departmentId);
    const before = current === null ? [] : [...current.permissionKeys].sort();
    const added = wanted.filter((key) => !before.includes(key));
    this.assertMayGrant(actor, added, branchId, departmentId);

    const targetId = String(target._id);
    if (wanted.length === 0) {
      if (current !== null) {
        await delegatedGrantRepository.softDeleteById(String(current._id), { by: actor.userId });
      }
    } else if (current === null) {
      await delegatedGrantRepository.create(
        {
          userId: target._id,
          branchId: new Types.ObjectId(branchId),
          departmentId: departmentId === null ? null : new Types.ObjectId(departmentId),
          permissionKeys: wanted,
          grantedBy: new Types.ObjectId(actor.userId),
        },
        { by: actor.userId },
      );
    } else {
      await delegatedGrantRepository.updateById(
        String(current._id),
        { permissionKeys: wanted, grantedBy: new Types.ObjectId(actor.userId) },
        { by: actor.userId, version: current.__v },
      );
    }

    if (before.join(',') !== wanted.join(',')) {
      await rbacService.invalidateUser(targetId);
      await auditService.record({
        entityRef: { moduleId: 'platform', entityType: 'user', entityId: targetId },
        action: wanted.length === 0 ? 'roleRevoked' : 'roleAssigned',
        changes: [
          { field: 'delegation', old: before.join(', ') || null, new: wanted.join(', ') || null },
          { field: 'branch', old: null, new: String(branch._id) },
          { field: 'department', old: null, new: departmentId ?? 'whole-branch' },
        ],
      });
    }
    return this.toUserDto(targetId, await delegatedGrantRepository.findForUser(targetId));
  }

  /** ADR-026 §1, per unit: every key ADDED must be held over that unit. */
  private assertMayGrant(
    actor: AuthContext,
    added: readonly string[],
    branchId: string,
    departmentId: string | null,
  ): void {
    const missing = added.filter((key) => actor.permissions[key] === undefined);
    if (missing.length > 0) {
      throw new BusinessRuleError(
        `You cannot delegate permissions you do not hold: ${missing.join(', ')}`,
      );
    }
    const beyond = added.filter((key) => !keyCoversUnit(actor, key, branchId, departmentId));
    if (beyond.length > 0) {
      throw new BusinessRuleError(
        departmentId === null
          ? `You cannot delegate over the whole branch permissions you hold for one department: ${beyond.join(', ')}`
          : `You cannot delegate permissions you do not hold in this unit: ${beyond.join(', ')}`,
      );
    }
  }

  private async toUserDto(userId: string, docs: DelegatedGrantDoc[]): Promise<UserDelegationsDto> {
    const [branches, departments] = await Promise.all([
      branchRepository.findByIdsSystem(docs.map((d) => String(d.branchId))),
      departmentRepository.findByIdsSystem(
        docs.flatMap((d) => (d.departmentId === null ? [] : [String(d.departmentId)])),
      ),
    ]);
    const branchNames = new Map<string, Name>(branches.map((b) => [String(b._id), b.name]));
    const departmentNames = new Map<string, Name>(departments.map((d) => [String(d._id), d.name]));
    const named = (id: string, names: Map<string, Name>): { id: string; name: Name } => ({
      id,
      name: names.get(id) ?? { ar: id, en: id },
    });
    return {
      userId,
      grants: docs.map(
        (d): DelegationDto => ({
          id: String(d._id),
          userId: String(d.userId),
          branch: named(String(d.branchId), branchNames),
          department: d.departmentId === null ? null : named(String(d.departmentId), departmentNames),
          permissionKeys: [...d.permissionKeys].sort(),
          grantedBy: d.grantedBy === null ? null : String(d.grantedBy),
          updatedAt: d.updatedAt.toISOString(),
        }),
      ),
    };
  }
}

export const delegationService = new DelegationService();
