import { Types, type FilterQuery } from 'mongoose';
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

  /** Registry sync helper — keeps a system role's grants equal to the full catalog. */
  async setPermissionKeysByKey(key: string, permissionKeys: string[]): Promise<void> {
    await this.model.updateOne({ key, isDeleted: false }, { $set: { permissionKeys } }).exec();
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
