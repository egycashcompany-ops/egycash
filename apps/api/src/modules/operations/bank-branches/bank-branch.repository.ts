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
}

export const operationsBankBranchRepository = new OperationsBankBranchRepository();
