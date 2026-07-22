import { type FilterQuery } from 'mongoose';
import { Types } from 'mongoose';
import {
  PlatformEvents,
  type CreateJobPosition,
  type JobPositionDto,
  type ListJobPositionsQuery,
  type Paginated,
  type UpdateJobPosition,
} from '@ecms/contracts';
import { type ScopeSelector } from '../../../shared/types';
import { BusinessRuleError } from '../../../shared/errors';
import { diffChanges } from '../../../shared/utils/diff';
import { auditService } from '../../audit';
import { emit } from '../../kernel/event-bus';
import { departmentRepository } from '../departments';
import { sectionRepository } from '../sections';
import { jobPositionRepository } from './job-position.repository';
import { type JobPositionDoc } from './job-position.model';

const entityRef = (id: string) => ({
  moduleId: 'platform',
  entityType: 'jobPosition',
  entityId: id,
});

const snapshot = (doc: JobPositionDoc) => ({
  name: doc.name,
  departmentId: doc.departmentId,
  sectionId: doc.sectionId,
  description: doc.description,
  status: doc.status,
});

class JobPositionService {
  /** The owning department must exist and be active (checked only where the department may change). */
  private async assertDepartmentActive(departmentId: string): Promise<void> {
    const department = await departmentRepository.findById(departmentId);
    if (department === null || department.status !== 'active') {
      throw new BusinessRuleError('Job position must belong to an existing active department');
    }
  }

  /** An optional section must exist, be active, and belong to the owning department. */
  private async assertSection(departmentId: string, sectionId: string | null): Promise<void> {
    if (sectionId === null) return;
    const section = await sectionRepository.findById(sectionId);
    if (section === null || section.status !== 'active') {
      throw new BusinessRuleError('Job position section must be an existing active section');
    }
    if (String(section.departmentId) !== String(departmentId)) {
      throw new BusinessRuleError('Job position section must belong to the selected department');
    }
  }

  async create(input: CreateJobPosition, by: string): Promise<JobPositionDoc> {
    await this.assertDepartmentActive(input.departmentId);
    await this.assertSection(input.departmentId, input.sectionId ?? null);
    const doc = await jobPositionRepository.create(
      {
        name: input.name,
        departmentId: new Types.ObjectId(input.departmentId),
        sectionId: input.sectionId == null ? null : new Types.ObjectId(input.sectionId),
        description: input.description ?? null,
        status: 'active',
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    await emit(PlatformEvents.OrgUnitChanged, {
      unitType: 'jobPosition',
      unitId: String(doc._id),
      change: 'created',
    });
    return doc;
  }

  async update(id: string, input: UpdateJobPosition, by: string): Promise<JobPositionDoc> {
    const before = await jobPositionRepository.getById(id);
    // The owning department is immutable; a changed section is re-validated against it.
    if (input.sectionId !== undefined) {
      await this.assertSection(String(before.departmentId), input.sectionId ?? null);
    }
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.status !== undefined) set.status = input.status;
    if (input.description !== undefined) set.description = input.description;
    if (input.sectionId !== undefined) {
      set.sectionId = input.sectionId == null ? null : new Types.ObjectId(input.sectionId);
    }
    const after = await jobPositionRepository.updateById(id, set, { by, version: input.version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(after)),
    });
    await emit(PlatformEvents.OrgUnitChanged, {
      unitType: 'jobPosition',
      unitId: id,
      change: 'updated',
    });
    return after;
  }

  async softDelete(id: string, by: string): Promise<void> {
    await jobPositionRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
    await emit(PlatformEvents.OrgUnitChanged, {
      unitType: 'jobPosition',
      unitId: id,
      change: 'deleted',
    });
  }

  async getById(id: string): Promise<JobPositionDoc> {
    return jobPositionRepository.getById(id);
  }

  async list(query: ListJobPositionsQuery, scope: ScopeSelector): Promise<Paginated<JobPositionDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.status !== undefined) filter.status = query.status;
    if (query.departmentId !== undefined) filter.departmentId = new Types.ObjectId(query.departmentId);
    if (query.sectionId !== undefined) filter.sectionId = new Types.ObjectId(query.sectionId);
    if (query.search !== undefined) {
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ 'name.ar': pattern }, { 'name.en': pattern }];
    }
    return jobPositionRepository.list({
      filter: filter as FilterQuery<JobPositionDoc>,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['status', 'createdAt'],
      scope,
    });
  }

  toDto(doc: JobPositionDoc): JobPositionDto {
    return {
      id: String(doc._id),
      name: doc.name,
      departmentId: String(doc.departmentId),
      sectionId: doc.sectionId === null ? null : String(doc.sectionId),
      description: doc.description,
      status: doc.status,
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}

export const jobPositionService = new JobPositionService();
