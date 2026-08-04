// IT catalog admin (design §2.4). Configuration, not domain facts: audited, no events.
import {
  type CreateItCatalogItem,
  type ListItCatalogQuery,
  type Paginated,
  type UpdateItCatalogItem,
} from '@ecms/contracts';
import { ConflictError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { diffChanges } from '../../../shared/utils/diff';
import { itCatalogItemRepository } from './catalog-item.repository';
import { type ItCatalogItemDoc } from './catalog-item.model';

const entityRef = (id: string) => ({
  moduleId: 'it',
  entityType: 'catalogItem',
  entityId: id,
});

const snapshot = (doc: ItCatalogItemDoc) => ({
  kind: doc.kind,
  code: doc.code,
  name: doc.name,
  description: doc.description,
  sortOrder: doc.sortOrder,
  isActive: doc.isActive,
});

class ItCatalogItemService {
  async create(input: CreateItCatalogItem, by: string): Promise<ItCatalogItemDoc> {
    const existing = await itCatalogItemRepository.findByKindAndNameAr(input.kind, input.name.ar);
    if (existing !== null) {
      throw new ConflictError(`"${input.name.ar}" already exists in ${input.kind}`);
    }
    const doc = await itCatalogItemRepository.create(
      {
        kind: input.kind,
        code: input.code ?? null,
        name: input.name,
        description: input.description ?? null,
        sortOrder: input.sortOrder,
        isActive: true,
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return doc;
  }

  async list(query: ListItCatalogQuery): Promise<Paginated<ItCatalogItemDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.kind !== undefined) filter.kind = query.kind;
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    return itCatalogItemRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['createdAt', 'kind', 'sortOrder', 'name.ar'],
    });
  }

  async update(id: string, input: UpdateItCatalogItem, by: string): Promise<ItCatalogItemDoc> {
    const before = await itCatalogItemRepository.getById(id);
    const set: Partial<ItCatalogItemDoc> = {};
    if (input.code !== undefined) set.code = input.code;
    if (input.name !== undefined) set.name = input.name;
    if (input.description !== undefined) set.description = input.description;
    if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
    if (input.isActive !== undefined) set.isActive = input.isActive;
    const updated = await itCatalogItemRepository.updateById(id, set, {
      by,
      version: input.version,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }
}

export const itCatalogItemService = new ItCatalogItemService();
