// Delegated grants (ADR-032): a manager hands out, per site, what they hold there.
//
// The rule is ADR-026's, applied one level down: nobody hands out an authority they do not hold.
// Here "hold" is read per site — the manager must hold `delegation.manage` in the site, and every
// key they ADD must be one they hold at branch level or wider IN THAT SITE (`keyReachesBranch`).
// Keys already on the record that the manager could not grant themselves stay: removing is a
// narrowing and always allowed; keeping what somebody else granted is not a grant.
//
// Who may be delegated to is the manager's reach for `delegation.manage`: the target account is
// read through that selector, so an account outside it answers 404 before a single key is looked
// at — the same shape `assignRole` has with `role.assign`.
import { Types } from 'mongoose';
import {
  DATA_SCOPE_RANK,
  type DelegationCatalogDto,
  type DelegationDto,
  type UserDelegationsDto,
} from '@ecms/contracts';
import { BusinessRuleError } from '../../shared/errors';
import { keyReachesBranch, reachOfKey, scopeSelector, type AuthContext } from '../../shared/types';
import { auditService } from '../audit';
import { userService } from '../users';
import { branchRepository } from '../organization/branches/branch.repository';
import { delegatedGrantRepository } from './delegation.repository';
import { type DelegatedGrantDoc } from './delegation.model';
import { rbacService } from './rbac.service';

export const DELEGATION_KEY = 'delegation.manage';

type BranchName = { ar: string; en: string };

class DelegationService {
  /** The sites the caller may delegate in, with the keys they may hand out in each. */
  async catalogFor(actor: AuthContext): Promise<DelegationCatalogDto> {
    const held = actor.permissions[DELEGATION_KEY];
    if (held === undefined) return { branches: [], pages: [], permissions: [] };

    const branches =
      held === 'organization'
        ? await branchRepository.listAll()
        : await branchRepository.findByIdsSystem(this.delegableBranchIds(actor));
    const live = branches.filter((b) => b.status === 'active' && b.isDeleted !== true);

    const registered = new Set(rbacService.registeredPermissionKeys());
    const perBranch = live.map((b) => ({
      id: String(b._id),
      name: b.name,
      permissionKeys: Object.keys(actor.permissions)
        .filter((key) => registered.has(key) && keyReachesBranch(actor, key, String(b._id)))
        .sort(),
    }));
    const union = new Set(perBranch.flatMap((b) => b.permissionKeys));
    const catalog = await rbacService.listPermissionCatalog();
    const permissions = catalog.permissions.filter((p) => union.has(p.key));
    const pageIds = new Set(permissions.map((p) => p.pageId));
    return {
      branches: perBranch,
      pages: catalog.pages.filter((p) => pageIds.has(p.id)),
      permissions,
    };
  }

  /** Every per-site grant one account holds, read through the caller's delegation reach. */
  async forUser(actor: AuthContext, userId: string): Promise<UserDelegationsDto> {
    await userService.getById(userId, scopeSelector(actor, DELEGATION_KEY));
    return this.toUserDto(userId, await delegatedGrantRepository.findForUser(userId));
  }

  /**
   * Replace the site's table for one account. An empty list removes it.
   *
   * Every rule is enforced here, on every HTTP path — the screen greys out what the manager cannot
   * grant, but that is an explanation of a refusal made here.
   */
  async set(
    actor: AuthContext,
    userId: string,
    branchId: string,
    permissionKeys: readonly string[],
  ): Promise<UserDelegationsDto> {
    if (!keyReachesBranch(actor, DELEGATION_KEY, branchId)) {
      throw new BusinessRuleError('You do not delegate in this site');
    }
    const target = await userService.getById(userId, scopeSelector(actor, DELEGATION_KEY));
    const [branch] = await branchRepository.findByIdsSystem([branchId]);
    if (branch === undefined || branch.status !== 'active' || branch.isDeleted === true) {
      throw new BusinessRuleError(`Unknown or inactive branch: ${branchId}`);
    }

    const wanted = [...new Set(permissionKeys)].sort();
    const unknown = wanted.filter((key) => !rbacService.isRegisteredPermission(key));
    if (unknown.length > 0) {
      throw new BusinessRuleError(`Unknown permission keys: ${unknown.join(', ')}`);
    }

    const current = await delegatedGrantRepository.findForUserInBranch(userId, branchId);
    const before = current === null ? [] : [...current.permissionKeys].sort();
    const added = wanted.filter((key) => !before.includes(key));
    this.assertMayGrant(actor, added, branchId);

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
        ],
      });
    }
    return this.toUserDto(targetId, await delegatedGrantRepository.findForUser(targetId));
  }

  /** The sites `delegation.manage` reaches for a branch- or department-level holder. */
  private delegableBranchIds(actor: AuthContext): string[] {
    const held = actor.permissions[DELEGATION_KEY];
    if (held === undefined || DATA_SCOPE_RANK[held] < DATA_SCOPE_RANK.branch) return [];
    const reach = reachOfKey(actor, DELEGATION_KEY).branchIds;
    if (reach.length > 0) return reach;
    return actor.branchId === null ? [] : [actor.branchId];
  }

  /** ADR-026 §1, per site: every key ADDED must be held at branch level or wider in that site. */
  private assertMayGrant(actor: AuthContext, added: readonly string[], branchId: string): void {
    const missing = added.filter((key) => actor.permissions[key] === undefined);
    if (missing.length > 0) {
      throw new BusinessRuleError(
        `You cannot delegate permissions you do not hold: ${missing.join(', ')}`,
      );
    }
    const beyond = added.filter((key) => !keyReachesBranch(actor, key, branchId));
    if (beyond.length > 0) {
      throw new BusinessRuleError(
        `You cannot delegate permissions you do not hold in this site: ${beyond.join(', ')}`,
      );
    }
  }

  private async toUserDto(userId: string, docs: DelegatedGrantDoc[]): Promise<UserDelegationsDto> {
    const branches = await branchRepository.findByIdsSystem(docs.map((d) => String(d.branchId)));
    const names = new Map<string, BranchName>(branches.map((b) => [String(b._id), b.name]));
    return {
      userId,
      grants: docs.map(
        (d): DelegationDto => ({
          id: String(d._id),
          userId: String(d.userId),
          branch: {
            id: String(d.branchId),
            name: names.get(String(d.branchId)) ?? { ar: String(d.branchId), en: String(d.branchId) },
          },
          permissionKeys: [...d.permissionKeys].sort(),
          grantedBy: d.grantedBy === null ? null : String(d.grantedBy),
          updatedAt: d.updatedAt.toISOString(),
        }),
      ),
    };
  }
}

export const delegationService = new DelegationService();
