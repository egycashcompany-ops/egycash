// Data access only (ADR-003) — the sole place Mongoose is queried for delegated grants.
import { Types } from 'mongoose';
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
}

export const delegatedGrantRepository = new DelegatedGrantRepository();
