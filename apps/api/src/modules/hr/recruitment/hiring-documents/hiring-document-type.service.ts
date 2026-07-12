// Hiring document type catalog admin (Stage 6). Localized, extensible, audited; deactivation
// (never hard-delete) preserves references from historical hiring sets.
import {
  type CreateHiringDocumentType,
  type ListHiringDocumentTypesQuery,
  type Paginated,
  type UpdateHiringDocumentType,
} from '@ecms/contracts';
import { ConflictError } from '../../../../shared/errors';
import { auditService } from '../../../../platform/audit';
import { diffChanges } from '../../../../shared/utils/diff';
import { hiringDocumentTypeRepository } from './hiring-document-type.repository';
import { type HiringDocumentTypeDoc } from './hiring-document-type.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'hiringDocumentType', entityId: id });

const snapshot = (doc: HiringDocumentTypeDoc) => ({ name: doc.name, required: doc.required, active: doc.active });

class HiringDocumentTypeService {
  async create(input: CreateHiringDocumentType, by: string): Promise<HiringDocumentTypeDoc> {
    const existing = await hiringDocumentTypeRepository.findByKey(input.key);
    if (existing !== null) throw new ConflictError(`Hiring document type "${input.key}" already exists`);
    const doc = await hiringDocumentTypeRepository.create(
      { key: input.key, name: input.name, required: input.required, active: true },
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
  async ensure(input: CreateHiringDocumentType): Promise<HiringDocumentTypeDoc> {
    const existing = await hiringDocumentTypeRepository.findByKey(input.key);
    if (existing !== null) return existing;
    return hiringDocumentTypeRepository.create(
      { key: input.key, name: input.name, required: input.required, active: true },
      { by: null },
    );
  }

  async list(query: ListHiringDocumentTypesQuery): Promise<Paginated<HiringDocumentTypeDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.active !== undefined) filter.active = query.active;
    if (query.required !== undefined) filter.required = query.required;
    return hiringDocumentTypeRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['createdAt', 'key'],
    });
  }

  async getById(id: string): Promise<HiringDocumentTypeDoc> {
    return hiringDocumentTypeRepository.getById(id);
  }

  async update(id: string, input: UpdateHiringDocumentType, by: string): Promise<HiringDocumentTypeDoc> {
    const before = await hiringDocumentTypeRepository.getById(id);
    const set: Partial<HiringDocumentTypeDoc> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.required !== undefined) set.required = input.required;
    if (input.active !== undefined) set.active = input.active;
    const updated = await hiringDocumentTypeRepository.updateById(id, set, { by, version: input.version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }
}

export const hiringDocumentTypeService = new HiringDocumentTypeService();
