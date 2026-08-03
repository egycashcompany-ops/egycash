// Fleet catalog admin (design §2.10). Configuration, not domain facts: audited, no events.
import {
  type CreateFleetCatalogItem,
  type ListFleetCatalogQuery,
  type Paginated,
  type UpdateFleetCatalogItem,
} from '@ecms/contracts';
import { ConflictError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetCatalogItemRepository } from './catalog-item.repository';
import { type FleetCatalogItemDoc } from './catalog-item.model';

const entityRef = (id: string) => ({
  moduleId: 'fleet',
  entityType: 'catalogItem',
  entityId: id,
});

const snapshot = (doc: FleetCatalogItemDoc) => ({
  kind: doc.kind,
  name: doc.name,
  countsForAlarm: doc.countsForAlarm,
  isActive: doc.isActive,
});

class FleetCatalogItemService {
  async create(input: CreateFleetCatalogItem, by: string): Promise<FleetCatalogItemDoc> {
    const existing = await fleetCatalogItemRepository.findByKindAndNameAr(
      input.kind,
      input.name.ar,
    );
    if (existing !== null) {
      throw new ConflictError(`"${input.name.ar}" already exists in ${input.kind}`);
    }
    const doc = await fleetCatalogItemRepository.create(
      {
        kind: input.kind,
        name: input.name,
        countsForAlarm: input.countsForAlarm,
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

  /** Idempotent create-if-missing for the boot seed. */
  async ensure(input: CreateFleetCatalogItem): Promise<FleetCatalogItemDoc> {
    const existing = await fleetCatalogItemRepository.findByKindAndNameAr(
      input.kind,
      input.name.ar,
    );
    if (existing !== null) return existing;
    return fleetCatalogItemRepository.create(
      {
        kind: input.kind,
        name: input.name,
        countsForAlarm: input.countsForAlarm,
        isActive: true,
      },
      { by: null },
    );
  }

  async list(query: ListFleetCatalogQuery): Promise<Paginated<FleetCatalogItemDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.kind !== undefined) filter.kind = query.kind;
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    return fleetCatalogItemRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['createdAt', 'kind', 'name.ar'],
    });
  }

  async update(
    id: string,
    input: UpdateFleetCatalogItem,
    by: string,
  ): Promise<FleetCatalogItemDoc> {
    const before = await fleetCatalogItemRepository.getById(id);
    if (input.countsForAlarm === true && before.kind !== 'workType') {
      throw new ConflictError('only a workType can count for the maintenance alarm');
    }
    const set: Partial<FleetCatalogItemDoc> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.countsForAlarm !== undefined) set.countsForAlarm = input.countsForAlarm;
    if (input.isActive !== undefined) set.isActive = input.isActive;
    const updated = await fleetCatalogItemRepository.updateById(id, set, {
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

export const fleetCatalogItemService = new FleetCatalogItemService();
