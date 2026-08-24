import { BaseRepository } from '../../../shared/base/base.repository';
import { GoldTransferModel, type GoldTransferDoc } from './transfer.model';

class GoldTransferRepository extends BaseRepository<GoldTransferDoc> {
  constructor() {
    super(GoldTransferModel, { branchField: 'branchId' });
  }

  async recordPrint(id: string): Promise<{ printCount: number; lastPrintedAt: Date } | null> {
    const now = new Date();
    const updated = await this.model
      .findOneAndUpdate(
        { _id: id, isDeleted: false },
        { $inc: { printCount: 1 }, $set: { lastPrintedAt: now } },
        { new: true },
      )
      .lean<GoldTransferDoc>()
      .exec();
    return updated === null
      ? null
      : { printCount: updated.printCount, lastPrintedAt: updated.lastPrintedAt ?? now };
  }
}

export const goldTransferRepository = new GoldTransferRepository();
