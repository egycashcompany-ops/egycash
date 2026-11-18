// Data access only (ADR-003) — the sole place Mongoose is queried for delegated grants.
import { Types, type ClientSession } from 'mongoose';
import { BaseRepository } from '../../shared/base/base.repository';
import { DelegatedGrantModel, type DelegatedGrantDoc } from './delegation.model';

class DelegatedGrantRepository extends BaseRepository<DelegatedGrantDoc> {
  constructor() {
    super(DelegatedGrantModel, { branchField: 'branchId', departmentField: 'departmentId' });
  }

  /** Every live grant an account holds, one per unit. */
  async findForUser(userId: string): Promise<DelegatedGrantDoc[]> {
    return this.model
      .find({ userId: new Types.ObjectId(userId), isDeleted: false })
      .sort({ createdAt: 1 })
      .lean<DelegatedGrantDoc[]>()
      .exec();
  }

  /**
   * Every live grant carrying one key in one branch — the whole-branch rows and the department
   * rows together, because which of the two a row is decides which approval rung its holder
   * stands on, and that is the caller's rule to apply.
   */
  async findByKeyInBranch(permissionKey: string, branchId: string): Promise<DelegatedGrantDoc[]> {
    return this.model
      .find({
        branchId: new Types.ObjectId(branchId),
        permissionKeys: permissionKey,
        isDeleted: false,
      })
      .lean<DelegatedGrantDoc[]>()
      .exec();
  }

  /**
   * Every live grant carrying one key over one company-wide department, in every branch.
   *
   * Its own read rather than a widening of the one above, because this shape has no branch to look
   * under: a deputy handed «الحركة في كل الفروع» is stored once, not once per branch, so a query
   * scoped to a branch cannot see him however it is written. Missing him is not a slow answer but
   * a wrong one — the rung reads empty, the chain steps over it, and the request goes to HR past
   * the man it was meant to stop at.
   */
  async findByKeyForDepartmentEverywhere(
    permissionKey: string,
    departmentCatalogId: string,
  ): Promise<DelegatedGrantDoc[]> {
    return this.model
      .find({
        departmentCatalogId: new Types.ObjectId(departmentCatalogId),
        allBranches: true,
        permissionKeys: permissionKey,
        isDeleted: false,
      })
      .lean<DelegatedGrantDoc[]>()
      .exec();
  }

  /** The one live grant for an account over a unit — a department in a branch, or the whole branch. */
  async findForUserInUnit(
    userId: string,
    branchId: string,
    departmentId: string | null,
  ): Promise<DelegatedGrantDoc | null> {
    return this.model
      .findOne({
        userId: new Types.ObjectId(userId),
        branchId: new Types.ObjectId(branchId),
        departmentId: departmentId === null ? null : new Types.ObjectId(departmentId),
        isDeleted: false,
      })
      .lean<DelegatedGrantDoc>()
      .exec();
  }

  /**
   * Accounts holding `permissionKey` somewhere in `branchId` through a delegation — the whole
   * branch or any one of its departments. The fan-out's second read.
   */
  async distinctUserIdsHolding(permissionKey: string, branchId: string): Promise<string[]> {
    const ids = await this.model
      .distinct('userId', {
        branchId: new Types.ObjectId(branchId),
        permissionKeys: permissionKey,
        isDeleted: false,
      })
      .exec();
    return ids.map(String);
  }

  /** Live grants carrying any of `keys`, read inside the caller's transaction (`grantAlongside`). */
  async findHoldingAny(
    keys: readonly string[],
    session: ClientSession,
  ): Promise<DelegatedGrantDoc[]> {
    if (keys.length === 0) return [];
    return this.model
      .find({ permissionKeys: { $in: [...keys] }, isDeleted: false })
      .session(session)
      .lean<DelegatedGrantDoc[]>()
      .exec();
  }

  /**
   * Union `add` into one live grant's keys — the role repository's `addPermissionKeys`, for a
   * delegated grant: atomic, only while it still carries every key of `because`, strictly
   * additive, a system write, and it moves the version the delegation write checks, so a write
   * that read the grant before this one is refused instead of landing over it. Its unit — branch,
   * department — is untouched: the keys stay exactly where the grant already reached.
   */
  async addPermissionKeys(
    id: Types.ObjectId,
    because: readonly string[],
    add: readonly string[],
    session: ClientSession,
  ): Promise<DelegatedGrantDoc | null> {
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
      .lean<DelegatedGrantDoc>()
      .exec();
  }
}

export const delegatedGrantRepository = new DelegatedGrantRepository();
