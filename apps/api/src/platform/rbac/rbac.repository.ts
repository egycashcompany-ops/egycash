import { Types, type ClientSession, type FilterQuery, type PipelineStage } from 'mongoose';
import { type DataScope } from '@ecms/contracts';
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

  /** Live roles carrying any of `keys`, read inside the caller's transaction (`grantAlongside`). */
  async findHoldingAny(keys: readonly string[], session: ClientSession): Promise<RoleDoc[]> {
    if (keys.length === 0) return [];
    return this.model
      .find({ permissionKeys: { $in: [...keys] }, isDeleted: false })
      .session(session)
      .lean<RoleDoc[]>()
      .exec();
  }

  /**
   * Union `add` into one live role's keys — atomically, and only while it still carries every key
   * of `because` (the filter names them). Strictly additive (`$addToSet`), a SYSTEM write
   * (`updatedBy` null), and it moves the version (`__v`) the role editor sends back, so a form
   * opened before this write is refused with the usual conflict instead of saving over it. Null
   * when the role no longer matches.
   */
  async addPermissionKeys(
    id: Types.ObjectId,
    because: readonly string[],
    add: readonly string[],
    session: ClientSession,
  ): Promise<RoleDoc | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, isDeleted: false, permissionKeys: { $all: [...because] } },
        {
          $addToSet: { permissionKeys: { $each: [...add] } },
          $set: { updatedBy: null },
          $inc: { __v: 1 },
        },
        { new: true, session },
      )
      .lean<RoleDoc>()
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
   *
   * The order is fixed at newest-first rather than taken from the query: a grant has no field worth
   * sorting by that the screens expose, and accepting a `sortBy` here would mean honouring it on a
   * joined document where an unrecognised field silently sorts by nothing at all.
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

  /**
   * Every live assignment of a role. Read to COUNT holders — "is this the last Super Admin?" — so
   * no order is imposed; there is nothing here for one to mean.
   */
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

  /**
   * Every grant IN FORCE now for any of `userIds` — not revoked, its validity window open. What a
   * row of the System Users list names as the account's roles: a grant that has not started yet,
   * or has ended, gives no authority today and is not one of them.
   */
  async findInForceForUsers(userIds: readonly Types.ObjectId[]): Promise<RoleAssignmentDoc[]> {
    if (userIds.length === 0) return [];
    const now = new Date();
    return this.model
      .find({
        userId: { $in: userIds },
        isDeleted: false,
        $and: [
          { $or: [{ validFrom: null }, { validFrom: { $lte: now } }] },
          { $or: [{ validTo: null }, { validTo: { $gt: now } }] },
        ],
      } as FilterQuery<RoleAssignmentDoc>)
      .lean<RoleAssignmentDoc[]>()
      .exec();
  }

  /** Users holding any of `roleIds` in force now, at any scope — the System Users role filter. */
  async distinctUserIdsInForceForRoles(roleIds: readonly Types.ObjectId[]): Promise<string[]> {
    if (roleIds.length === 0) return [];
    const now = new Date();
    const ids = await this.model
      .distinct('userId', {
        roleId: { $in: roleIds },
        isDeleted: false,
        $and: [
          { $or: [{ validFrom: null }, { validFrom: { $lte: now } }] },
          { $or: [{ validTo: null }, { validTo: { $gt: now } }] },
        ],
      } as FilterQuery<RoleAssignmentDoc>)
      .exec();
    return ids.map(String);
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

  /** Users with a live assignment of `roleId` at exactly `scope` (validity window not consulted). */
  async distinctUserIdsForRoleAtExactScope(roleId: string, scope: DataScope): Promise<string[]> {
    const ids = await this.model
      .distinct('userId', {
        roleId: new Types.ObjectId(roleId),
        scope,
        isDeleted: false,
      } as FilterQuery<RoleAssignmentDoc>)
      .exec();
    return ids.map(String);
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
   * Every currently-active assignment of one of `roleIds`, whole.
   *
   * Whole documents rather than a `distinct` on `userId`, because the caller has to read each
   * grant's SHAPE — its scope, the department it names, how far it reaches — to decide which rung
   * of an approval chain its holder stands on. Encoding that as a Mongo filter would put the rule
   * in two places, and the one place it must not differ is «who may approve this».
   */
  async findActiveForRoles(roleIds: Types.ObjectId[]): Promise<RoleAssignmentDoc[]> {
    if (roleIds.length === 0) return [];
    const now = new Date();
    return this.model
      .find({
        roleId: { $in: roleIds },
        isDeleted: false,
        $and: [
          { $or: [{ validFrom: null }, { validFrom: { $lte: now } }] },
          { $or: [{ validTo: null }, { validTo: { $gt: now } }] },
        ],
      } as FilterQuery<RoleAssignmentDoc>)
      .lean<RoleAssignmentDoc[]>()
      .exec();
  }

  /**
   * Users with a currently-active assignment to one of `roleIds`, at `scope` or wider
   * (an `organization`-scope assignment always qualifies; a `branch`-scope assignment
   * qualifies when it is placed in `branchId` or REACHES it — a named branch, or every branch —
   * Sprint 3.3 plan §8/§11).
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
              { scope: 'branch', branchIds: new Types.ObjectId(branchId) },
              { scope: 'branch', allBranches: true },
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
