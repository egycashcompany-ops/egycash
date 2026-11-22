import { Types } from 'mongoose';
import { BaseRepository } from '../../../shared/base/base.repository';
import { OperationsBankBranchModel, type OperationsBankBranchDoc } from './bank-branch.model';

class OperationsBankBranchRepository extends BaseRepository<OperationsBankBranchDoc> {
  constructor() {
    super(OperationsBankBranchModel, {}); // organization-level reference data, no org scoping
  }

  /** Active branch or null — the reference check shipment writes run against. */
  async findActiveById(id: string): Promise<OperationsBankBranchDoc | null> {
    const doc = await this.findById(id);
    return doc !== null && doc.isActive ? doc : null;
  }

  /**
   * Every live branch of one bank, stopped ones included — what a branch sheet is compared with
   * (Round 29, `import/`): the bank's unique name and code hold among all of them. A bank has a few
   * hundred branches; read whole, once a comparison.
   */
  async liveOfBank(bankId: string): Promise<OperationsBankBranchDoc[]> {
    return this.model
      .find({ bankId: new Types.ObjectId(bankId), isDeleted: false })
      .sort({ _id: 1 })
      .lean<OperationsBankBranchDoc[]>()
      .exec();
  }
}

export const operationsBankBranchRepository = new OperationsBankBranchRepository();
