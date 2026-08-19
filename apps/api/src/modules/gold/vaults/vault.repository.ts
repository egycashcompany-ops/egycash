import { Types } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../shared/types';
import { GoldVaultModel, type GoldVaultDoc } from './vault.model';

class GoldVaultRepository extends BaseRepository<GoldVaultDoc> {
  constructor() {
    super(GoldVaultModel, { branchField: 'branchId' });
  }

  /** Is this code already taken by a live vault? Drives the auto-uniquified code on create. */
  async codeTaken(code: string): Promise<boolean> {
    return this.exists({ code } as never);
  }

  async listOrdered(scope?: ScopeSelector): Promise<GoldVaultDoc[]> {
    return this.model
      .find(this.baseFilter(scope))
      .sort({ order: 1, createdAt: -1 })
      .lean<GoldVaultDoc[]>()
      .exec();
  }

  async setOrder(id: string, order: number, floorId?: string | null): Promise<void> {
    const set: Record<string, unknown> = { order };
    if (floorId !== undefined) {
      set.floorId = floorId === null ? null : new Types.ObjectId(floorId);
    }
    await this.model.updateOne({ _id: id }, { $set: set }).exec();
  }

  async detachFloor(floorId: string): Promise<void> {
    await this.model
      .updateMany({ floorId: new Types.ObjectId(floorId) }, { $set: { floorId: null } })
      .exec();
  }

  async countOnFloor(floorId: string): Promise<number> {
    return this.count({ floorId: new Types.ObjectId(floorId) } as never);
  }
}

export const goldVaultRepository = new GoldVaultRepository();
