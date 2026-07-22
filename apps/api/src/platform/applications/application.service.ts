import { Types, type FilterQuery } from 'mongoose';
import {
  type ApplicationDto,
  type CreateApplication,
  type ListApplicationsQuery,
  type Paginated,
  type UpdateApplication,
} from '@ecms/contracts';
import { type ScopeSelector } from '../../shared/types';
import { BusinessRuleError } from '../../shared/errors';
import { diffChanges } from '../../shared/utils/diff';
import { auditService } from '../audit';
// A leaf-repository import (not the application-categories barrel) — avoids a service import cycle.
import { applicationCategoryRepository } from '../application-categories/application-category.repository';
import { applicationRepository } from './application.repository';
import { type ApplicationDoc } from './application.model';

const entityRef = (id: string) => ({
  moduleId: 'platform',
  entityType: 'application',
  entityId: id,
});

const snapshot = (doc: ApplicationDoc) => ({
  name: doc.name,
  icon: doc.icon,
  route: doc.route,
  categoryId: doc.categoryId,
  sortOrder: doc.sortOrder,
  status: doc.status,
});

class ApplicationService {
  /** The owning category must exist and be active. */
  private async assertCategoryActive(categoryId: string): Promise<void> {
    const category = await applicationCategoryRepository.findById(categoryId);
    if (category === null || category.status !== 'active') {
      throw new BusinessRuleError('Application must belong to an existing active category');
    }
  }

  async create(input: CreateApplication, by: string): Promise<ApplicationDoc> {
    await this.assertCategoryActive(input.categoryId);
    const doc = await applicationRepository.create(
      {
        name: input.name,
        icon: input.icon,
        route: input.route,
        categoryId: new Types.ObjectId(input.categoryId),
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

  async update(id: string, input: UpdateApplication, by: string): Promise<ApplicationDoc> {
    const before = await applicationRepository.getById(id);
    if (input.categoryId !== undefined) await this.assertCategoryActive(input.categoryId);
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.icon !== undefined) set.icon = input.icon;
    if (input.route !== undefined) set.route = input.route;
    if (input.categoryId !== undefined) set.categoryId = new Types.ObjectId(input.categoryId);
    if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
    if (input.status !== undefined) set.status = input.status;
    const after = await applicationRepository.updateById(id, set, { by, version: input.version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(after)),
    });
    return after;
  }

  async softDelete(id: string, by: string): Promise<void> {
    await applicationRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
  }

  async getById(id: string): Promise<ApplicationDoc> {
    return applicationRepository.getById(id);
  }

  async list(query: ListApplicationsQuery, scope: ScopeSelector): Promise<Paginated<ApplicationDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.status !== undefined) filter.status = query.status;
    if (query.categoryId !== undefined) filter.categoryId = new Types.ObjectId(query.categoryId);
    if (query.search !== undefined) {
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ 'name.ar': pattern }, { 'name.en': pattern }, { route: pattern }];
    }
    return applicationRepository.list({
      filter: filter as FilterQuery<ApplicationDoc>,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['sortOrder', 'status', 'createdAt'],
      scope,
    });
  }

  toDto(doc: ApplicationDoc): ApplicationDto {
    return {
      id: String(doc._id),
      name: doc.name,
      icon: doc.icon,
      route: doc.route,
      categoryId: String(doc.categoryId),
      sortOrder: doc.sortOrder,
      status: doc.status,
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}

export const applicationService = new ApplicationService();
