import { type FilterQuery } from 'mongoose';
import {
  type ApplicationDto,
  type CreateApplication,
  type ListApplicationsQuery,
  type Paginated,
  type UpdateApplication,
} from '@ecms/contracts';
import { type ScopeSelector } from '../../shared/types';
import { diffChanges } from '../../shared/utils/diff';
import { auditService } from '../audit';
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
  category: doc.category,
  sortOrder: doc.sortOrder,
  status: doc.status,
});

class ApplicationService {
  async create(input: CreateApplication, by: string): Promise<ApplicationDoc> {
    const doc = await applicationRepository.create(
      {
        name: input.name,
        icon: input.icon,
        route: input.route,
        category: input.category,
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
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.icon !== undefined) set.icon = input.icon;
    if (input.route !== undefined) set.route = input.route;
    if (input.category !== undefined) set.category = input.category;
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
    if (query.category !== undefined) filter.category = query.category;
    if (query.search !== undefined) {
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { 'name.ar': pattern },
        { 'name.en': pattern },
        { category: pattern },
        { route: pattern },
      ];
    }
    return applicationRepository.list({
      filter: filter as FilterQuery<ApplicationDoc>,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['sortOrder', 'category', 'status', 'createdAt'],
      scope,
    });
  }

  toDto(doc: ApplicationDoc): ApplicationDto {
    return {
      id: String(doc._id),
      name: doc.name,
      icon: doc.icon,
      route: doc.route,
      category: doc.category,
      sortOrder: doc.sortOrder,
      status: doc.status,
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}

export const applicationService = new ApplicationService();
