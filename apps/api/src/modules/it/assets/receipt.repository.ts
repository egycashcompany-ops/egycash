import { BaseRepository } from '../../../shared/base/base.repository';
import { ItCustodyReceiptModel, type ItCustodyReceiptDoc } from './receipt.model';

class ItCustodyReceiptRepository extends BaseRepository<ItCustodyReceiptDoc> {
  constructor() {
    // Branch-scoped like the intervals it opened: a branch-scoped technician reads that branch's
    // receipts and no other's.
    super(ItCustodyReceiptModel, { branchField: 'branchId' });
  }
}

export const itCustodyReceiptRepository = new ItCustodyReceiptRepository();
