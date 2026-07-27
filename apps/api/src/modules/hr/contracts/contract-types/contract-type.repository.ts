// Data access only (ADR-003).
import { BaseRepository } from '../../../../shared/base/base.repository';
import { ContractTypeModel, type ContractTypeDoc } from './contract-type.model';

class ContractTypeRepository extends BaseRepository<ContractTypeDoc> {
  constructor() {
    super(ContractTypeModel, {});
  }

  async listAll(): Promise<ContractTypeDoc[]> {
    return this.model.find({ isDeleted: false }).sort({ createdAt: 1 }).lean<ContractTypeDoc[]>().exec();
  }
}

export const contractTypeRepository = new ContractTypeRepository();
