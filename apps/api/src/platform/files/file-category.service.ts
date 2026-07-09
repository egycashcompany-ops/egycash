// Admin catalog of file categories (fileCategory.manage).
import {
  type CreateFileCategory,
  type FileCategoryDto,
  type PaginationQuery,
  type Paginated,
  type UpdateFileCategory,
} from '@ecms/contracts';
import { diffChanges } from '../../shared/utils/diff';
import { auditService } from '../audit';
import { fileCategoryRepository } from './file-category.repository';
import { type FileCategoryDoc } from './file-category.model';

const entityRef = (id: string) => ({
  moduleId: 'platform',
  entityType: 'fileCategory',
  entityId: id,
});

const snapshot = (doc: FileCategoryDoc) => ({
  key: doc.key,
  name: doc.name,
  allowedMimeTypes: doc.allowedMimeTypes,
  maxSizeMb: doc.maxSizeMb,
  retentionDays: doc.retentionDays,
  status: doc.status,
});

class FileCategoryService {
  async create(input: CreateFileCategory, by: string | null): Promise<FileCategoryDoc> {
    const doc = await fileCategoryRepository.create(
      {
        key: input.key,
        name: input.name,
        allowedMimeTypes: input.allowedMimeTypes,
        maxSizeMb: input.maxSizeMb,
        retentionDays: input.retentionDays,
        status: 'active',
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

  async update(id: string, input: UpdateFileCategory, by: string): Promise<FileCategoryDoc> {
    const before = await fileCategoryRepository.getById(id);
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.allowedMimeTypes !== undefined) set.allowedMimeTypes = input.allowedMimeTypes;
    if (input.maxSizeMb !== undefined) set.maxSizeMb = input.maxSizeMb;
    if (input.retentionDays !== undefined) set.retentionDays = input.retentionDays;
    if (input.status !== undefined) set.status = input.status;
    const after = await fileCategoryRepository.updateById(id, set, {
      by,
      version: input.version,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(after)),
    });
    return after;
  }

  async softDelete(id: string, by: string): Promise<void> {
    await fileCategoryRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
  }

  async list(query: PaginationQuery): Promise<Paginated<FileCategoryDoc>> {
    return fileCategoryRepository.list({
      page: query.page,
      pageSize: query.pageSize,
      sortableFields: ['key', 'createdAt'],
    });
  }

  /** Idempotent — used by seeds. */
  async ensure(input: CreateFileCategory): Promise<FileCategoryDoc> {
    const existing = await fileCategoryRepository.findByKey(input.key);
    if (existing !== null) return existing;
    return this.create(input, null);
  }

  toDto(doc: FileCategoryDoc): FileCategoryDto {
    return {
      id: String(doc._id),
      key: doc.key,
      name: doc.name,
      allowedMimeTypes: doc.allowedMimeTypes,
      maxSizeMb: doc.maxSizeMb,
      retentionDays: doc.retentionDays,
      status: doc.status,
      version: doc.__v,
    };
  }
}

export const fileCategoryService = new FileCategoryService();
