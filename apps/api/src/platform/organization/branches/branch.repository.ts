import { Types } from 'mongoose';
import { type LocalizedString } from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { BranchModel, type BranchDoc } from './branch.model';

const exact = (s: string): RegExp => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

class BranchRepository extends BaseRepository<BranchDoc> {
  constructor() {
    // A branch-scoped caller sees exactly their own branch record.
    super(BranchModel, { branchField: '_id' });
  }

  /** A live branch whose Arabic or English name matches (case-insensitive), excluding `excludeId`. */
  async findByName(name: LocalizedString, excludeId?: string): Promise<BranchDoc | null> {
    const filter: Record<string, unknown> = {
      isDeleted: false,
      $or: [{ 'name.ar': exact(name.ar) }, { 'name.en': exact(name.en) }],
    };
    if (excludeId !== undefined) filter._id = { $ne: new Types.ObjectId(excludeId) };
    return this.model.findOne(filter).lean<BranchDoc>().exec();
  }
}

export const branchRepository = new BranchRepository();
