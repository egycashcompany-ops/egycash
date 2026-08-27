import {
  PlatformEvents,
  type CreateJobTitle,
  type JobTitleDto,
  type ListOrgUnitsQuery,
  type OrgUnitOptionDto,
  type Paginated,
  type UpdateJobTitle,
} from '@ecms/contracts';
import { Types, type FilterQuery } from 'mongoose';
import { type ScopeSelector } from '../../../shared/types';
import { BusinessRuleError } from '../../../shared/errors';
import { diffChanges } from '../../../shared/utils/diff';
import { auditService } from '../../audit';
import { emit } from '../../kernel/event-bus';
import { resolveShiftLabels } from '../shift-label-seams';
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
  requiresDrivingTest: doc.requiresDrivingTest ?? false,
  fixedSalary: doc.fixedSalary ?? null,
  defaultShiftIds: (doc.defaultShiftIds ?? []).map(String),
  status: doc.status,
});

/** A salary band is coherent only when both ends are present and min ≤ max. */
const assertSalaryBand = (min: number | null, max: number | null): void => {
  if (min !== null && max !== null && min > max) {
    throw new BusinessRuleError('salaryMax must be ≥ salaryMin');
  }
};

/**
 * Is the job's fixed salary outside its own advisory band? (P-HR-22 — reported, never enforced.)
 *
 * The band was and stays advisory: the owner's ruling is a WARNING, so this returns a fact and
 * throws nothing. Turning the band into a constraint would be a new business rule, and inventing
 * one here would be the exact failure this codebase keeps refusing.
 */
const outsideBand = (doc: Pick<JobTitleDoc, 'fixedSalary' | 'salaryMin' | 'salaryMax'>): boolean => {
  const amount = doc.fixedSalary?.amount;
  if (amount === undefined) return false;
  return (
    (doc.salaryMin !== null && amount < doc.salaryMin) ||
    (doc.salaryMax !== null && amount > doc.salaryMax)
  );
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
        requiresDrivingTest: input.requiresDrivingTest ?? false,
        fixedSalary: input.fixedSalary ?? null,
        defaultShiftIds: (input.defaultShiftIds ?? []).map((id) => new Types.ObjectId(id)),
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
    if (input.requiresDrivingTest !== undefined) set.requiresDrivingTest = input.requiresDrivingTest;
    if (input.fixedSalary !== undefined) set.fixedSalary = input.fixedSalary;
    if (input.defaultShiftIds !== undefined) {
      set.defaultShiftIds = input.defaultShiftIds.map((sid) => new Types.ObjectId(sid));
    }
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

  /**
   * Reference options for form dropdowns — the same surface every other org unit exposes.
   *
   * IT WAS MISSING, AND NOTHING SAID SO. Branches, departments and sections all get `/options`
   * from `makeOrgUnitRouter`; job titles have a hand-written router and never gained it. Two
   * shipped screens — the notification rule editor and the announcement composer — call
   * `/platform/job-titles/options` and were reading a 404 as «no job titles exist», which is a
   * factual claim about the company's data made by a routing mistake.
   *
   * ORGANIZATION SCOPE AND NO `jobTitle.view`, deliberately, for the reason the shared factory
   * already records: somebody who may write a notification rule must be able to NAME a job title
   * without being able to read the catalogue. It carries id, code and name and nothing else — no
   * salary band, no grade, no shift defaults.
   */
  async options(): Promise<OrgUnitOptionDto[]> {
    const page = await jobTitleRepository.list({
      filter: { status: 'active' } as FilterQuery<JobTitleDoc>,
      page: 1,
      pageSize: 500,
      sortBy: 'code',
      sortDir: 'asc',
      sortableFields: ['code'],
      scope: { scope: 'organization', userId: '', branchId: null, departmentId: null, sectionId: null },
    });
    return page.items.map((doc) => ({ id: String(doc._id), code: doc.code, name: doc.name }));
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

  /**
   * DTOs with their candidate shifts NAMED (D-JOB-6 option C) — one seam call for the whole page.
   *
   * Batched rather than per-row on purpose: a list of forty jobs asks the seam once, and a screen
   * that renders labels must not turn into forty queries because the labels were convenient.
   *
   * The names are resolved by the server from what the server may already read. The caller gains
   * no reach: it could not list shifts before this method existed and still cannot.
   */
  async toDtos(docs: readonly JobTitleDoc[]): Promise<JobTitleDto[]> {
    const ids = [...new Set(docs.flatMap((doc) => (doc.defaultShiftIds ?? []).map(String)))];
    const labels = await resolveShiftLabels(ids);
    return docs.map((doc) => {
      const dto = this.toDto(doc);
      return {
        ...dto,
        defaultShifts: dto.defaultShiftIds.map((id) => ({ id, name: labels.get(id) ?? null })),
      };
    });
  }

  /** One job, named. Delegates so the two paths cannot drift. */
  async toDtoNamed(doc: JobTitleDoc): Promise<JobTitleDto> {
    const [dto] = await this.toDtos([doc]);
    // `toDtos` returns one entry per input; the fallback exists only to satisfy the type.
    return dto ?? this.toDto(doc);
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
      requiresDrivingTest: doc.requiresDrivingTest ?? false,
      fixedSalary: doc.fixedSalary ?? null,
      fixedSalaryOutsideBand: outsideBand(doc),
      defaultShiftIds: (doc.defaultShiftIds ?? []).map(String),
      // Unnamed here by design: only `toDtos` may fill these, because only it is allowed to be
      // async and only it batches the seam call. A caller reaching this method directly gets ids
      // and honest nulls rather than a silent per-row query.
      defaultShifts: (doc.defaultShiftIds ?? []).map((id) => ({ id: String(id), name: null })),
      status: doc.status,
      version: doc.__v,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}

export const jobTitleService = new JobTitleService();
