import { type ClientSession, type Types } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { collectionReady } from './ensure-collection';
import { ItMobileLineReceiptModel, type ItMobileLineReceiptDoc } from './line-receipt.model';

class ItMobileLineReceiptRepository extends BaseRepository<ItMobileLineReceiptDoc> {
  readonly ensureCollection = collectionReady(ItMobileLineReceiptModel);

  constructor() {
    // Branch-scoped like the intervals they were signed for.
    super(ItMobileLineReceiptModel, { branchField: 'branchId' });
  }

  /**
   * Whether a line paper already carries this F-14 number — the device hand-over's half of the
   * two-way guard (`assets/receipt-number.ts`). Every row, deleted or not, as `ux_form_number`
   * counts them: a number once on a paper is that paper's.
   */
  async holdsFormNumber(formNumber: number): Promise<boolean> {
    return (await this.model.exists({ formNumber }).exec()) !== null;
  }

  /**
   * The paper follows the line it was signed for to its new branch — the branch is only the
   * paper's read scope (it prints no branch), so the IT team of the branch that now keeps the
   * line can print it again and file its signed copy.
   */
  async moveToBranch(
    receiptId: Types.ObjectId,
    branchId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    await this.model
      .updateOne(
        { _id: receiptId, isDeleted: false },
        { $set: { branchId }, $inc: { __v: 1 } },
        { session },
      )
      .exec();
  }
}

export const itMobileLineReceiptRepository = new ItMobileLineReceiptRepository();
