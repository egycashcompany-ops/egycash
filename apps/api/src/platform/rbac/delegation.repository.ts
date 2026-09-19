// Data access only (ADR-003) — the sole place Mongoose is queried for delegated grants.
import { Types } from 'mongoose';
import { BaseRepository } from '../../shared/base/base.repository';
import { DelegatedGrantModel, type DelegatedGrantDoc } from './delegation.model';

class DelegatedGrantRepository extends BaseRepository<DelegatedGrantDoc> {
  constructor() {
    super(DelegatedGrantModel, { branchField: 'branchId' });
  }

  /** Every live grant an account holds, one per site. */
  async findForUser(userId: string): Promise<DelegatedGrantDoc[]> {
    return this.model
      .find({ userId: new Types.ObjectId(userId), isDeleted: false })
      .sort({ createdAt: 1 })
      .lean<DelegatedGrantDoc[]>()
      .exec();
  }

  /** The one live grant for an account in a site, or null. */
  async findForUserInBranch(userId: string, branchId: string): Promise<DelegatedGrantDoc | null> {
    return this.model
      .findOne({
        userId: new Types.ObjectId(userId),
        branchId: new Types.ObjectId(branchId),
        isDeleted: false,
      })
      .lean<DelegatedGrantDoc>()
      .exec();
  }

  /** Accounts holding `permissionKey` in `branchId` through a delegation — the fan-out's second read. */
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
