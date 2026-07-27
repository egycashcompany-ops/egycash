// Contract-type catalog rules (design D4a): plain audited CRUD; archive — never delete.
import {
  type ContractTypeDto,
  type CreateContractType,
  type UpdateContractType,
} from '@ecms/contracts';
import { auditService } from '../../../../platform/audit';
import { contractTypeRepository } from './contract-type.repository';
import { type ContractTypeDoc } from './contract-type.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'contractType', entityId: id });

class ContractTypeService {
  async create(input: CreateContractType, by: string): Promise<ContractTypeDoc> {
    const doc = await contractTypeRepository.create(
      {
        name: input.name,
        allowsEndDate: input.allowsEndDate,
        multipleActiveAllowed: input.multipleActiveAllowed,
        status: 'active',
      },
      { by },
    );
    await auditService.record({ entityRef: entityRef(String(doc._id)), action: 'create' });
    return doc;
  }

  async update(id: string, input: UpdateContractType, by: string): Promise<ContractTypeDoc> {
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.allowsEndDate !== undefined) set.allowsEndDate = input.allowsEndDate;
    if (input.multipleActiveAllowed !== undefined) set.multipleActiveAllowed = input.multipleActiveAllowed;
    if (input.status !== undefined) set.status = input.status;
    const after = await contractTypeRepository.updateById(id, set, { by, version: input.version });
    await auditService.record({ entityRef: entityRef(id), action: 'update' });
    return after;
  }

  async getById(id: string): Promise<ContractTypeDoc> {
    return contractTypeRepository.getById(id);
  }

  async listAll(): Promise<ContractTypeDoc[]> {
    return contractTypeRepository.listAll();
  }

  toDto(doc: ContractTypeDoc): ContractTypeDto {
    return {
      id: String(doc._id),
      name: doc.name,
      allowsEndDate: doc.allowsEndDate,
      multipleActiveAllowed: doc.multipleActiveAllowed,
      status: doc.status,
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}

export const contractTypeService = new ContractTypeService();
