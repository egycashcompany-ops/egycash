import { BaseRepository } from '../../../shared/base/base.repository';
import { GoldReceivingReceiptModel, type GoldReceivingReceiptDoc } from './receiving-receipt.model';

class GoldReceivingReceiptRepository extends BaseRepository<GoldReceivingReceiptDoc> {
  constructor() {
    super(GoldReceivingReceiptModel, { branchField: 'branchId' });
  }

  async numberTaken(receiptNumber: string, exceptId?: string): Promise<boolean> {
    const filter: Record<string, unknown> = { receiptNumber };
    if (exceptId !== undefined) filter._id = { $ne: exceptId };
    return this.exists(filter as never);
  }

  /** Print bookkeeping — a counter bump, deliberately outside the optimistic-version seam. */
  async recordPrint(id: string): Promise<{ printCount: number; lastPrintedAt: Date } | null> {
    const now = new Date();
    const updated = await this.model
      .findOneAndUpdate(
        { _id: id, isDeleted: false },
        { $inc: { printCount: 1 }, $set: { lastPrintedAt: now } },
        { new: true },
      )
      .lean<GoldReceivingReceiptDoc>()
      .exec();
    return updated === null
      ? null
      : { printCount: updated.printCount, lastPrintedAt: updated.lastPrintedAt ?? now };
  }
}

export const goldReceivingReceiptRepository = new GoldReceivingReceiptRepository();
