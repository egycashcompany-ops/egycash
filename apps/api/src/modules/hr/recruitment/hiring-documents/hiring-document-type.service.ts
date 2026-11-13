// Hiring document type catalog admin (Stage 6). Localized, extensible, audited; deactivation
// (never hard-delete) preserves references from historical hiring sets.
import {
  type CreateHiringDocumentType,
  type ListHiringDocumentTypesQuery,
  type Paginated,
  type UpdateHiringDocumentType,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { ConflictError, ValidationError } from '../../../../shared/errors';
import { auditService } from '../../../../platform/audit';
import { jobTitleRepository } from '../../../../platform/organization';
import { matchesJob, type JobNames } from '../../shared/job-match';
import { diffChanges } from '../../../../shared/utils/diff';
import { hiringDocumentTypeRepository } from './hiring-document-type.repository';
import { jobScope, type HiringDocumentTypeDoc } from './hiring-document-type.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'hiringDocumentType', entityId: id });

const snapshot = (doc: HiringDocumentTypeDoc) => ({
  name: doc.name,
  required: doc.required,
  active: doc.active,
  allJobs: jobScope(doc).allJobs,
  jobTitleIds: jobScope(doc).jobTitleIds.map(String).join(','),
});

/** A boot-seeded type: as created, its jobs optional (every job). */
export type HiringDocumentTypeSeed = Omit<CreateHiringDocumentType, 'allJobs' | 'jobTitleIds'> &
  Partial<Pick<CreateHiringDocumentType, 'allJobs' | 'jobTitleIds'>>;

const objectIds = (ids: readonly string[]): Types.ObjectId[] => ids.map((id) => new Types.ObjectId(id));

class HiringDocumentTypeService {
  async create(input: CreateHiringDocumentType, by: string): Promise<HiringDocumentTypeDoc> {
    const existing = await hiringDocumentTypeRepository.findByKey(input.key);
    if (existing !== null) throw new ConflictError(`Hiring document type "${input.key}" already exists`);
    const doc = await hiringDocumentTypeRepository.create(
      {
        key: input.key,
        name: input.name,
        required: input.required,
        active: true,
        allJobs: input.allJobs,
        jobTitleIds: objectIds(input.jobTitleIds),
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

  /** Idempotent create-if-missing for the boot seed. A seed row is for every job unless it says. */
  async ensure(input: HiringDocumentTypeSeed): Promise<HiringDocumentTypeDoc> {
    const existing = await hiringDocumentTypeRepository.findByKey(input.key);
    if (existing !== null) return existing;
    return hiringDocumentTypeRepository.create(
      {
        key: input.key,
        name: input.name,
        required: input.required,
        active: true,
        allJobs: input.allJobs ?? true,
        jobTitleIds: objectIds(input.jobTitleIds ?? []),
      },
      { by: null },
    );
  }

  /**
   * The boot seed of a type collected from SOME jobs only (A27, stage 3 — the crew leader's weapon
   * declaration), the jobs found by name as the printed papers find theirs.
   *
   *   · Missing, it is written for the jobs carrying the name. With no such job yet it waits — a
   *     type for no job is refused — and is written on the boot after one is created.
   *   · Written, and never edited by a person since, a job by that name created since is added.
   *   · Edited by a person (its jobs ticked, a job removed, deactivated) it is final: left alone.
   */
  async ensureForJobs(input: HiringDocumentTypeSeed, jobs: JobNames): Promise<HiringDocumentTypeDoc | null> {
    const titles = await jobTitleRepository.activeNamesSystem();
    const matched = titles.filter((title) => matchesJob(jobs, title.name.ar)).map((title) => title._id);
    const existing = await hiringDocumentTypeRepository.findByKey(input.key);
    if (existing === null) {
      if (matched.length === 0) return null;
      return hiringDocumentTypeRepository.create(
        { key: input.key, name: input.name, required: input.required, active: true, allJobs: false, jobTitleIds: matched },
        { by: null },
      );
    }
    if (existing.updatedBy !== null) return existing;
    const held = jobScope(existing).jobTitleIds;
    const added = matched.filter((id) => !held.some((own) => String(own) === String(id)));
    if (jobScope(existing).allJobs || added.length === 0) return existing;
    const updated = await hiringDocumentTypeRepository.updateById(
      String(existing._id),
      { jobTitleIds: [...held, ...added] },
      { by: null, version: existing.__v },
    );
    await auditService.record({
      entityRef: entityRef(String(existing._id)),
      action: 'update',
      changes: diffChanges(snapshot(existing), snapshot(updated)),
      actor: { userId: null, ip: null, userAgent: null },
    });
    return updated;
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
    if (input.allJobs !== undefined) set.allJobs = input.allJobs;
    if (input.jobTitleIds !== undefined) set.jobTitleIds = objectIds(input.jobTitleIds);
    // A type for chosen jobs with none chosen would be collected from nobody (A27).
    const after = jobScope({ ...jobScope(before), ...set });
    if (!after.allJobs && after.jobTitleIds.length === 0) {
      throw new ValidationError([
        { field: 'body.jobTitleIds', code: 'REQUIRED', message: 'a document type for chosen jobs needs at least one job' },
      ]);
    }
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
