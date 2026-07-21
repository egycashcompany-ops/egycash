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
import { BusinessRuleError } from '../../../shared/errors';
import { diffChanges } from '../../../shared/utils/diff';
import { auditService } from '../../audit';
import { emit } from '../../kernel/event-bus';
import { jobTitleRepository } from './job-title.repository';
import { type JobTitleDoc } from './job-title.model';

const entityRef = (id: string) => ({ moduleId: 'platform', entityType: 'jobTitle', entityId: id });

const snapshot = (doc: JobTitleDoc) => ({
  code: doc.code,
  name: doc.name,
  jobGrade: doc.jobGrade,
  description: doc.description,
  salaryMin: doc.salaryMin,
  salaryMax: doc.salaryMax,
  requiredQualifications: doc.requiredQualifications,
  requiredExperienceYears: doc.requiredExperienceYears,
  status: doc.status,
});

/** A salary band is coherent only when both ends are present and min ≤ max. */
const assertSalaryBand = (min: number | null, max: number | null): void => {
  if (min !== null && max !== null && min > max) {
    throw new BusinessRuleError('salaryMax must be ≥ salaryMin');
  }
};

class JobTitleService {
  async create(input: CreateJobTitle, by: string): Promise<JobTitleDoc> {
    const doc = await jobTitleRepository.create(
      {
        code: input.code,
        name: input.name,
        jobGrade: input.jobGrade,
        description: input.description ?? null,
        salaryMin: input.salaryMin ?? null,
        salaryMax: input.salaryMax ?? null,
        requiredQualifications: input.requiredQualifications ?? null,
        requiredExperienceYears: input.requiredExperienceYears ?? null,
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
      unitType: 'jobTitle',
      unitId: String(doc._id),
      change: 'created',
    });
    return doc;
  }

  async update(id: string, input: UpdateJobTitle, by: string): Promise<JobTitleDoc> {
    const before = await jobTitleRepository.getById(id);
    // Merged-state validation: a partial update touching only one salary bound must still be
    // coherent against the stored value (the schema-level refine only sees the payload).
    assertSalaryBand(
      input.salaryMin !== undefined ? input.salaryMin : before.salaryMin,
      input.salaryMax !== undefined ? input.salaryMax : before.salaryMax,
    );
    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.status !== undefined) set.status = input.status;
    if (input.jobGrade !== undefined) set.jobGrade = input.jobGrade;
    if (input.description !== undefined) set.description = input.description;
    if (input.salaryMin !== undefined) set.salaryMin = input.salaryMin;
    if (input.salaryMax !== undefined) set.salaryMax = input.salaryMax;
    if (input.requiredQualifications !== undefined)
      set.requiredQualifications = input.requiredQualifications;
    if (input.requiredExperienceYears !== undefined)
      set.requiredExperienceYears = input.requiredExperienceYears;
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
      jobGrade: doc.jobGrade,
      description: doc.description,
      salaryMin: doc.salaryMin,
      salaryMax: doc.salaryMax,
      requiredQualifications: doc.requiredQualifications,
      requiredExperienceYears: doc.requiredExperienceYears,
      status: doc.status,
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}

export const jobTitleService = new JobTitleService();
