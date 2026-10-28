import { type Types } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { ItCustodyReceiptModel, type ItCustodyReceiptDoc } from './receipt.model';

class ItCustodyReceiptRepository extends BaseRepository<ItCustodyReceiptDoc> {
  private ready: Promise<void> | null = null;

  constructor() {
    // Branch-scoped like the intervals it opened: a branch-scoped technician reads that branch's
    // receipts and no other's.
    super(ItCustodyReceiptModel, { branchField: 'branchId' });
  }

  /**
   * Bring the collection into being, with its indexes, BEFORE the first hand-over writes to it.
   *
   * A receipt is first written inside the hand-over's transaction, and `autoIndex` is off in
   * production: without this, the collection would be created implicitly by an insert inside a
   * transaction — which older servers refuse outright — and its indexes would never be built.
   * Once per process; a failure is forgotten so the next hand-over tries again.
   */
  async ensureCollection(): Promise<void> {
    this.ready ??= ItCustodyReceiptModel.createIndexes().catch((error: unknown) => {
      this.ready = null;
      throw error;
    });
    await this.ready;
  }

  /**
   * Every receipt whose signed copy is filed — ids only, in one read, for the custody register's
   * «إيصال الاستلام» filter.
   *
   * Read the way the register's own receipt column reads its papers (`findByIdsSystem`): without
   * scope and in any state. The intervals are still read under the caller's scope; what this adds is
   * which of the papers they name are signed — and a branch-only transfer keeps the paper the asset
   * was handed over on, which can be another branch's. Read scoped, that interval would be filed
   * under «بانتظار التوقيع» while its own row says «موقّع».
   */
  async signedIds(): Promise<Types.ObjectId[]> {
    const rows = await this.model
      .find({ signedCopy: { $ne: null } })
      .select({ _id: 1 })
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    return rows.map((row) => row._id);
  }
}

export const itCustodyReceiptRepository = new ItCustodyReceiptRepository();
