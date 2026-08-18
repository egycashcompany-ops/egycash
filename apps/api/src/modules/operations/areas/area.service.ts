// Operational-area reference admin — the legacy `/data_edit` city section (contad_app.js:2033).
// Audited, no events (the fleet-catalog precedent every other Operations catalog follows).
//
// The legacy screen had one behaviour worth naming: DELETE was soft and had NO referential check
// (:2192), and because branches store the area as a STRING, deleting one orphaned nothing — it
// simply vanished from future suggestions while existing branches kept their text. That is
// PRESERVED here, and it is preserved honestly: deactivating an area takes it out of the
// suggestion list and leaves every branch that already carries the name exactly as it is. There
// is nothing to cascade, because nothing points at it.
import {
  type CreateOperationsArea,
  type ListOperationsReferenceQuery,
  type Paginated,
  type UpdateOperationsArea,
} from '@ecms/contracts';
import { auditService } from '../../../platform/audit';
import { diffChanges } from '../../../shared/utils/diff';
import { operationsAreaRepository } from './area.repository';
import { type OperationsAreaDoc } from './area.model';

const entityRef = (id: string) => ({
  moduleId: 'operations',
  entityType: 'area',
  entityId: id,
});

const snapshot = (doc: OperationsAreaDoc) => ({
  name: doc.name,
  nameEn: doc.nameEn,
  governorate: doc.governorate,
  isActive: doc.isActive,
});

class OperationsAreaService {
  async create(input: CreateOperationsArea, by: string): Promise<OperationsAreaDoc> {
    const doc = await operationsAreaRepository.create({ ...input, isActive: true }, { by });
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return doc;
  }

  async list(query: ListOperationsReferenceQuery): Promise<Paginated<OperationsAreaDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.search !== undefined && query.search !== '') {
      filter.$or = [
        { name: { $regex: query.search, $options: 'i' } },
        { nameEn: { $regex: query.search, $options: 'i' } },
        { governorate: { $regex: query.search, $options: 'i' } },
      ];
    }
    return operationsAreaRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['name', 'governorate', 'createdAt'],
    });
  }

  async update(id: string, input: UpdateOperationsArea, by: string): Promise<OperationsAreaDoc> {
    const before = await operationsAreaRepository.getById(id);
    const { version, ...fields } = input;
    const updated = await operationsAreaRepository.updateById(id, fields, { by, version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }
}

export const operationsAreaService = new OperationsAreaService();
