import { BaseRepository } from '../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../shared/types';
import { GoldFloorModel, type GoldFloorDoc } from './floor.model';

class GoldFloorRepository extends BaseRepository<GoldFloorDoc> {
  constructor() {
    super(GoldFloorModel, { branchField: 'branchId' });
  }

  /** The whole ordered list — floors are a handful per branch and the board renders them all. */
  async listOrdered(scope?: ScopeSelector): Promise<GoldFloorDoc[]> {
    return this.model
      .find(this.baseFilter(scope))
      .sort({ order: 1, createdAt: 1 })
      .lean<GoldFloorDoc[]>()
      .exec();
  }

  async setOrder(id: string, order: number): Promise<void> {
    await this.model.updateOne({ _id: id }, { $set: { order } }).exec();
  }
}

export const goldFloorRepository = new GoldFloorRepository();
