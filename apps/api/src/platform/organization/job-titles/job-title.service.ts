import {
  PlatformEvents,
  type CreateJobTitle,
  type JobTitleDto,
  type ListOrgUnitsQuery,
  type Paginated,
  type UpdateJobTitle,
} from '@ecms/contracts';
import { type FilterQuery } from 'mongoose';
import { type ScopeSelector } from '../../../shared/types';
import { diffChanges } from '../../../shared/utils/diff';
import { auditService } from '../../audit';
import { emit } from '../../kernel/event-bus';
import { jobTitleRepository } from './job-title.repository';
import { type JobTitleDoc } from './job-title.model';

const entityRef = (id: string) => ({ moduleId: 'platform', entityType: 'jobTitle', entityId: id });

const snapshot = (doc: JobTitleDoc) => ({ code: doc.code, name: doc.name, status: doc.status });

class JobTitleService {
  async create(input: CreateJobTitle, by: string): Promise<JobTitleDoc> {
    const doc = await jobTitleRepository.create(
      { code: input.code, name: input.name, status: 'active' },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    await emit(PlatformEvents.OrgUnitChanged, {
      unitType: 'jobTitle',
      unitId: String(doc._id),
      change: 'created',
    });
    return doc;
  }

  async update(id: string, input: UpdateJobTitle, by: string): Promise<JobTitleDoc> {
    const before = await jobTitleRepository.getById(id);
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.status !== undefined) set.status = input.status;
    const after = await jobTitleRepository.updateById(id, set, { by, version: input.version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(after)),
    });
    await emit(PlatformEvents.OrgUnitChanged, {
      unitType: 'jobTitle',
      unitId: id,
      change: 'updated',
    });
    return after;
  }

  async softDelete(id: string, by: string): Promise<void> {
    await jobTitleRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
    await emit(PlatformEvents.OrgUnitChanged, {
      unitType: 'jobTitle',
      unitId: id,
      change: 'deleted',
    });
  }

  async getById(id: string): Promise<JobTitleDoc> {
    return jobTitleRepository.getById(id);
  }

  async list(query: ListOrgUnitsQuery, scope: ScopeSelector): Promise<Paginated<JobTitleDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.status !== undefined) filter.status = query.status;
    if (query.search !== undefined) {
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ code: pattern }, { 'name.ar': pattern }, { 'name.en': pattern }];
    }
    return jobTitleRepository.list({
      filter: filter as FilterQuery<JobTitleDoc>,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['code', 'status', 'createdAt'],
      scope,
    });
  }

  toDto(doc: JobTitleDoc): JobTitleDto {
    return {
      id: String(doc._id),
      code: doc.code,
      name: doc.name,
      status: doc.status,
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}

export const jobTitleService = new JobTitleService();
