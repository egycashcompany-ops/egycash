import { Types, type FilterQuery, type PipelineStage } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
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

  /**
   * Every heading in use, once each, sorted.
   *
   * A `distinct` rather than a page of roles: the editor needs the NAMES, and asking for a hundred
   * roles to read a handful of strings off them is the «raise the page size to avoid paging»
   * pattern ADR-019 rule 5 forbids — and it would quietly miss a heading the moment the company
   * has more roles than the page.
   */
  async distinctGroups(): Promise<string[]> {
    const rows = await this.model.distinct('group', { isDeleted: false }).exec();
    return (rows as (string | null)[])
      .filter((g): g is string => typeof g === 'string' && g !== '')
      .sort((a, b) => a.localeCompare(b));
  }

  /**
   * Set a seeded role's display name — a system write, with no version to check.
   *
   * Optimistic concurrency is for two administrators editing one row. Nobody edits a system role's
   * name: the seed declares it and the screen refuses it, so there is no second writer to conflict
   * with, and demanding a version here would only make the boot step re-read a row it just read.
   */
  async renameSystemRole(id: string, name: LocalizedString): Promise<RoleDoc | null> {
    return this.model
      .findByIdAndUpdate(new Types.ObjectId(id), { $set: { name } }, { new: true })
      .lean<RoleDoc>()
      .exec();
  }

  /**
   * Rewrite one group name across every role that carries it, in one write.
   *
   * `null` on either side is «no group»: renaming FROM null files the ungrouped roles under a
   * heading, and renaming TO null empties the heading, which is how a group is deleted. There is
   * no group record to delete — see `RenameRoleGroupSchema`.
   */
  async renameGroup(from: string | null, to: string | null): Promise<number> {
    const result = await this.model
      .updateMany({ group: from, isDeleted: false }, { $set: { group: to } })
      .exec();
    return result.modifiedCount;
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
   * How many live assignments each of `roleIds` carries, as a map — roles with none are absent.
   *
   * One aggregate for the whole page rather than a count per row: the list shows tens of roles and
   * a count each would be tens of round trips for a badge. Absent-means-zero rather than a filled
   * map, because the caller defaults anyway and materializing the zeros buys nothing.
   */
  async countActiveByRole(roleIds: Types.ObjectId[]): Promise<Map<string, number>> {
    if (roleIds.length === 0) return new Map();
    const now = new Date();
    const rows = await this.model
      .aggregate<{ _id: Types.ObjectId; n: number }>([
        {
          $match: {
            roleId: { $in: roleIds },
            isDeleted: false,
            $and: [
              { $or: [{ validFrom: null }, { validFrom: { $lte: now } }] },
              { $or: [{ validTo: null }, { validTo: { $gt: now } }] },
            ],
          },
        },
        // By USER, not by row: two grants of one role to one person — «الحركة» in two branches —
        // are one holder, and counting rows would report two people where there is one.
        { $group: { _id: { roleId: '$roleId', userId: '$userId' } } },
        { $group: { _id: '$_id.roleId', n: { $sum: 1 } } },
      ])
      .exec();
    return new Map(rows.map((row) => [String(row._id), row.n]));
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
