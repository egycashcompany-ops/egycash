// Bank reference admin. Configuration, not domain facts: audited, no events (the fleet-catalog
// precedent). Uniqueness of opsName/code is enforced by the partial unique indexes; the create
// path surfaces the duplicate as a ConflictError exactly as BaseRepository maps code 11000.
import {
  type CreateOperationsBank,
  type ListOperationsReferenceQuery,
  type Paginated,
  type UpdateOperationsBank,
} from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { diffChanges } from '../../../shared/utils/diff';
import { operationsBankRepository } from './bank.repository';
import { type OperationsBankDoc } from './bank.model';

const entityRef = (id: string) => ({
  moduleId: 'operations',
  entityType: 'bank',
  entityId: id,
});

const snapshot = (doc: OperationsBankDoc) => ({
  code: doc.code,
  name: doc.name,
  opsName: doc.opsName,
  slogan: doc.slogan,
  sortOrder: doc.sortOrder,
  isActive: doc.isActive,
});

class OperationsBankService {
  async create(input: CreateOperationsBank, by: string): Promise<OperationsBankDoc> {
    const doc = await operationsBankRepository.create({ ...input, isActive: true }, { by });
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return doc;
  }

  async list(query: ListOperationsReferenceQuery): Promise<Paginated<OperationsBankDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.search !== undefined && query.search !== '') {
      filter.$or = [
        { opsName: { $regex: query.search, $options: 'i' } },
        { 'name.ar': { $regex: query.search, $options: 'i' } },
        { 'name.en': { $regex: query.search, $options: 'i' } },
      ];
    }
    return operationsBankRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['code', 'opsName', 'sortOrder', 'createdAt'],
    });
  }

  async update(id: string, input: UpdateOperationsBank, by: string): Promise<OperationsBankDoc> {
    const before = await operationsBankRepository.getById(id);
    const { version, ...fields } = input;
    const updated = await operationsBankRepository.updateById(id, fields, { by, version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }
}

export const operationsBankService = new OperationsBankService();
