// Currency reference admin (Q33 NORMALIZE — the legacy data_lists singleton becomes entities).
// Audited, no events (fleet-catalog precedent).
import {
  type CreateOperationsCurrency,
  type ListOperationsReferenceQuery,
  type Paginated,
  type UpdateOperationsCurrency,
} from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { diffChanges } from '../../../shared/utils/diff';
import { operationsCurrencyRepository } from './currency.repository';
import { type OperationsCurrencyDoc } from './currency.model';

const entityRef = (id: string) => ({
  moduleId: 'operations',
  entityType: 'currency',
  entityId: id,
});

const snapshot = (doc: OperationsCurrencyDoc) => ({
  code: doc.code,
  name: doc.name,
  legacyAliases: doc.legacyAliases,
  isActive: doc.isActive,
});

class OperationsCurrencyService {
  async create(input: CreateOperationsCurrency, by: string): Promise<OperationsCurrencyDoc> {
    const doc = await operationsCurrencyRepository.create({ ...input, isActive: true }, { by });
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return doc;
  }

  async list(query: ListOperationsReferenceQuery): Promise<Paginated<OperationsCurrencyDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.search !== undefined && query.search !== '') {
      filter.$or = [
        { code: { $regex: query.search, $options: 'i' } },
        { name: { $regex: query.search, $options: 'i' } },
      ];
    }
    return operationsCurrencyRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['code', 'name', 'createdAt'],
    });
  }

  async update(
    id: string,
    input: UpdateOperationsCurrency,
    by: string,
  ): Promise<OperationsCurrencyDoc> {
    const before = await operationsCurrencyRepository.getById(id);
    const { version, ...fields } = input;
    const updated = await operationsCurrencyRepository.updateById(id, fields, { by, version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }
}

export const operationsCurrencyService = new OperationsCurrencyService();
