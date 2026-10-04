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
}

export const itCustodyReceiptRepository = new ItCustodyReceiptRepository();
