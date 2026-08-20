import { BaseRepository } from '../../../shared/base/base.repository';
import { GoldDeliveryReceiptModel, type GoldDeliveryReceiptDoc } from './delivery-receipt.model';

class GoldDeliveryReceiptRepository extends BaseRepository<GoldDeliveryReceiptDoc> {
  constructor() {
    super(GoldDeliveryReceiptModel, { branchField: 'branchId' });
  }

  async recordPrint(id: string): Promise<{ printCount: number; lastPrintedAt: Date } | null> {
    const now = new Date();
    const updated = await this.model
      .findOneAndUpdate(
        { _id: id, isDeleted: false },
        { $inc: { printCount: 1 }, $set: { lastPrintedAt: now } },
        { new: true },
      )
      .lean<GoldDeliveryReceiptDoc>()
      .exec();
    return updated === null
      ? null
      : { printCount: updated.printCount, lastPrintedAt: updated.lastPrintedAt ?? now };
  }
}

export const goldDeliveryReceiptRepository = new GoldDeliveryReceiptRepository();
