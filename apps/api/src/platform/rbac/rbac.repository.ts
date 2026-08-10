import { Types, type FilterQuery, type PipelineStage } from 'mongoose';
import { BaseRepository } from '../../shared/base/base.repository';
import { PermissionModel, type PermissionDoc } from './permission.model';
import { RoleModel, type RoleDoc } from './role.model';
import { RoleAssignmentModel, type RoleAssignmentDoc } from './role-assignment.model';

class RoleRepository extends BaseRepository<RoleDoc> {
  constructor() {
    super(RoleModel, {});
  }

  async findByKey(key: string): Promise<RoleDoc | null> {
    return this.model.findOne({ key, isDeleted: false }).lean<RoleDoc>().exec();
  }

  async findByIds(ids: Types.ObjectId[]): Promise<RoleDoc[]> {
    return this.model
      .find({ _id: { $in: ids }, isDeleted: false })
      .lean<RoleDoc[]>()
      .exec();
  }

  /**
   * Registry sync helper — keeps a system role's grants equal to the full catalog.
   * Returns true when the stored key set actually changed (callers must then invalidate
   * the role holders' cached permission snapshots).
   */
  async setPermissionKeysByKey(key: string, permissionKeys: string[]): Promise<boolean> {
    const current = await this.findByKey(key);
    if (current === null) return false;
    const next = new Set(permissionKeys);
    const same =
      current.permissionKeys.length === next.size &&
      current.permissionKeys.every((k) => next.has(k));
    if (same) return false;
    await this.model.updateOne({ key, isDeleted: false }, { $set: { permissionKeys } }).exec();
    return true;
  }

  /**
   * Roles matching a typed term. Names are bilingual and the permission key is what an
   * administrator actually remembers — "which role grants `user.edit`?" is the question the roles
   * screen is opened to answer, so the key set is searched too.
   */
  searchFilter(search: string): FilterQuery<RoleDoc> {
    const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    return {
      $or: [{ 'name.ar': pattern }, { 'name.en': pattern }, { permissionKeys: pattern }],
    };
  }

  async findGrantingPermission(permissionKey: string): Promise<RoleDoc[]> {
    return this.model
      .find({ permissionKeys: permissionKey, isDeleted: false })
      .lean<RoleDoc[]>()
      .exec();
  }
}

class RoleAssignmentRepository extends BaseRepository<RoleAssignmentDoc> {
  constructor() {
    super(RoleAssignmentModel, {});
  }

  /**
   * Assignments the caller may see, paginated — scoped through the HOLDER.
   *
   * `role_assignments` declares no scope fields of its own, and it should not: who may see a grant
   * is decided by where the person holding it sits, and that lives on the user. So this joins to
   * `users` and applies the same clause `UserRepository` would apply to a direct read
   * (`holderScopeMatch`), which keeps one definition of "in my scope" for both paths.
   *
   * `$facet` returns the page and its total from ONE round trip, so the count cannot disagree with
   * the rows — a second query would count a set the page never saw.
   */
  async listVisible(
    filter: FilterQuery<RoleAssignmentDoc>,
    page: number,
    pageSize: number,
    holderMatch: Record<string, unknown>,
  ): Promise<{ items: RoleAssignmentDoc[]; totalItems: number }> {
    const pipeline: PipelineStage[] = [
      { $match: { ...filter, isDeleted: false } },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'holder',
        },
      },
      { $unwind: '$holder' },
      // A deleted account's grants are nobody's business, and the direct read filters them too.
      { $match: { 'holder.isDeleted': false, ...holderMatch } },
      {
        $facet: {
          items: [{ $sort: { createdAt: -1 } }, { $skip: (page - 1) * pageSize }, { $limit: pageSize }, { $project: { holder: 0 } }],
          total: [{ $count: 'value' }],
        },
      },
    ];
    const [result] = await this.model
      .aggregate<{ items: RoleAssignmentDoc[]; total: { value: number }[] }>(pipeline)
      .exec();
    return {
      items: result?.items ?? [],
      totalItems: result?.total[0]?.value ?? 0,
    };
  }

  /** Live assignments of a role, oldest first — the input to "revoke every holder". */
  async findActiveForRole(roleId: string): Promise<RoleAssignmentDoc[]> {
    return this.model
      .find({ roleId: new Types.ObjectId(roleId), isDeleted: false })
      .lean<RoleAssignmentDoc[]>()
      .exec();
  }

  /** Role ids that currently have at least one live assignment — backs the `unassigned` filter. */
  async roleIdsWithAssignments(): Promise<string[]> {
    const ids = await this.model
      .distinct('roleId', { isDeleted: false } as FilterQuery<RoleAssignmentDoc>)
      .exec();
    return ids.map(String);
  }

  async findActiveForUser(userId: string): Promise<RoleAssignmentDoc[]> {
    return this.model
      .find({ userId: new Types.ObjectId(userId), isDeleted: false })
      .lean<RoleAssignmentDoc[]>()
      .exec();
  }

  async findExpiringWithin(days: number): Promise<RoleAssignmentDoc[]> {
    const now = new Date();
    return this.model
      .find({
        isDeleted: false,
        validTo: { $ne: null, $gt: now, $lte: new Date(now.getTime() + days * 86_400_000) },
      })
      .lean<RoleAssignmentDoc[]>()
      .exec();
  }

  async distinctUserIdsForRole(roleId: string): Promise<string[]> {
    const ids = await this.model
      .distinct('userId', {
        roleId: new Types.ObjectId(roleId),
        isDeleted: false,
      } as FilterQuery<RoleAssignmentDoc>)
      .exec();
    return ids.map(String);
  }

  /**
   * Users with a currently-active assignment to one of `roleIds`, at `scope` or wider
   * (an `organization`-scope assignment always qualifies; a `branch`-scope assignment
   * qualifies only for a matching `branchId` — Sprint 3.3 plan §8/§11).
   */
  async distinctUserIdsForRolesAtScope(
    roleIds: Types.ObjectId[],
    scope: 'organization' | 'branch',
    branchId?: string,
  ): Promise<string[]> {
    const now = new Date();
    const scopeMatch: FilterQuery<RoleAssignmentDoc> =
      scope === 'organization'
        ? { scope: 'organization' }
        : {
            $or: [
              { scope: 'organization' },
              { scope: 'branch', branchId: new Types.ObjectId(branchId) },
            ],
          };
    const ids = await this.model
      .distinct('userId', {
        roleId: { $in: roleIds },
        isDeleted: false,
        $and: [
          { $or: [{ validFrom: null }, { validFrom: { $lte: now } }] },
          { $or: [{ validTo: null }, { validTo: { $gt: now } }] },
        ],
        ...scopeMatch,
      } as FilterQuery<RoleAssignmentDoc>)
      .exec();
    return ids.map(String);
  }
}

export const roleRepository = new RoleRepository();
export const roleAssignmentRepository = new RoleAssignmentRepository();
export { PermissionModel, type PermissionDoc };
