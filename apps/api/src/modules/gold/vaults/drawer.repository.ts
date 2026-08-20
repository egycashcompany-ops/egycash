import { Types, type AnyBulkWriteOperation } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../shared/types';
import { GoldDrawerModel, type GoldDrawerDoc } from './drawer.model';

class GoldDrawerRepository extends BaseRepository<GoldDrawerDoc> {
  constructor() {
    // Drawers are operational rows, not business records: regenerating a layout DELETES them, so
    // they opt out of soft delete — a tombstoned drawer would collide on {vault, number}.
    super(GoldDrawerModel, { branchField: 'branchId', softDelete: false });
  }

  async findForVault(vaultId: string): Promise<GoldDrawerDoc[]> {
    return this.model
      .find({ vaultId: new Types.ObjectId(vaultId) })
      .sort({ number: 1 })
      .lean<GoldDrawerDoc[]>()
      .exec();
  }

  async countForVault(vaultId: string): Promise<number> {
    return this.model.countDocuments({ vaultId: new Types.ObjectId(vaultId) }).exec();
  }

  async countInScope(scope?: ScopeSelector): Promise<number> {
    return this.model.countDocuments(this.baseFilter(scope)).exec();
  }

  async deleteForVault(vaultId: string): Promise<void> {
    await this.model.deleteMany({ vaultId: new Types.ObjectId(vaultId) }).exec();
  }

  async insertPlan(docs: Partial<GoldDrawerDoc>[]): Promise<void> {
    await this.model.insertMany(docs, { ordered: true });
  }

  async bulk(ops: AnyBulkWriteOperation<GoldDrawerDoc>[], ordered: boolean): Promise<void> {
    if (ops.length === 0) return;
    await this.model.bulkWrite(ops, { ordered });
  }
}

export const goldDrawerRepository = new GoldDrawerRepository();
