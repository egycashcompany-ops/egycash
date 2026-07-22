import { type FilterQuery } from 'mongoose';
import {
  ErrorCodes,
  type ApplicationCategoryDto,
  type CreateApplicationCategory,
  type ListApplicationCategoriesQuery,
  type Paginated,
  type UpdateApplicationCategory,
} from '@ecms/contracts';
import { type ScopeSelector } from '../../shared/types';
import { BusinessRuleError } from '../../shared/errors';
import { diffChanges } from '../../shared/utils/diff';
import { auditService } from '../audit';
// A leaf-repository import (not the applications barrel) — avoids a service-level import cycle.
import { applicationRepository } from '../applications/application.repository';
import { applicationCategoryRepository } from './application-category.repository';
import { type ApplicationCategoryDoc } from './application-category.model';

const entityRef = (id: string) => ({
  moduleId: 'platform',
  entityType: 'applicationCategory',
  entityId: id,
});

const snapshot = (doc: ApplicationCategoryDoc) => ({
  name: doc.name,
  icon: doc.icon,
  sortOrder: doc.sortOrder,
  status: doc.status,
});

class ApplicationCategoryService {
  async create(input: CreateApplicationCategory, by: string): Promise<ApplicationCategoryDoc> {
    const doc = await applicationCategoryRepository.create(
      {
        name: input.name,
        icon: input.icon ?? null,
        sortOrder: input.sortOrder ?? 0,
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

  async update(
    id: string,
    input: UpdateApplicationCategory,
    by: string,
  ): Promise<ApplicationCategoryDoc> {
    const before = await applicationCategoryRepository.getById(id);
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.icon !== undefined) set.icon = input.icon ?? null;
    if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
    if (input.status !== undefined) set.status = input.status;
    const after = await applicationCategoryRepository.updateById(id, set, { by, version: input.version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(after)),
    });
    return after;
  }

  async softDelete(id: string, by: string): Promise<void> {
    // Guard: a category still referenced by applications cannot be removed (avoids orphaning).
    const inUse = await applicationRepository.exists({ categoryId: id });
    if (inUse) {
      throw new BusinessRuleError(
        'Cannot delete a category that still has applications',
        ErrorCodes.APPLICATION_CATEGORY_IN_USE,
      );
    }
    await applicationCategoryRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
  }

  async getById(id: string): Promise<ApplicationCategoryDoc> {
    return applicationCategoryRepository.getById(id);
  }

  async list(
    query: ListApplicationCategoriesQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<ApplicationCategoryDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.status !== undefined) filter.status = query.status;
    if (query.search !== undefined) {
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ 'name.ar': pattern }, { 'name.en': pattern }];
    }
    return applicationCategoryRepository.list({
      filter: filter as FilterQuery<ApplicationCategoryDoc>,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['sortOrder', 'status', 'createdAt'],
      scope,
    });
  }

  toDto(doc: ApplicationCategoryDoc): ApplicationCategoryDto {
    return {
      id: String(doc._id),
      name: doc.name,
      icon: doc.icon,
      sortOrder: doc.sortOrder,
      status: doc.status,
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}

export const applicationCategoryService = new ApplicationCategoryService();
