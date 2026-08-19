import { BaseRepository } from '../../../shared/base/base.repository';
import { OperationsBankModel, type OperationsBankDoc } from './bank.model';

class OperationsBankRepository extends BaseRepository<OperationsBankDoc> {
  constructor() {
    super(OperationsBankModel, {}); // organization-level reference data, no org scoping
  }

  /** Active bank or null — the reference check shipment writes run against. */
  async findActiveById(id: string): Promise<OperationsBankDoc | null> {
    const doc = await this.findById(id);
    return doc !== null && doc.isActive ? doc : null;
  }
}

export const operationsBankRepository = new OperationsBankRepository();
