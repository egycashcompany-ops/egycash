// Applicant source catalog admin (Sprint 4.1 plan §3). Localized, extensible, audited;
// deactivation (never hard-delete) preserves source statistics.
import {
  type CreateApplicantSource,
  type ListApplicantSourcesQuery,
  type Paginated,
  type UpdateApplicantSource,
} from '@ecms/contracts';
import { ConflictError } from '../../../../shared/errors';
import { auditService } from '../../../../platform/audit';
import { diffChanges } from '../../../../shared/utils/diff';
import { applicantSourceRepository } from './applicant-source.repository';
import { type ApplicantSourceDoc } from './applicant-source.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'applicantSource', entityId: id });

const snapshot = (doc: ApplicantSourceDoc) => ({
  name: doc.name,
  kind: doc.kind,
  requiresDetail: doc.requiresDetail,
  active: doc.active,
});

class ApplicantSourceService {
  async create(input: CreateApplicantSource, by: string): Promise<ApplicantSourceDoc> {
    const existing = await applicantSourceRepository.findByKey(input.key);
    if (existing !== null) throw new ConflictError(`Applicant source "${input.key}" already exists`);
    const doc = await applicantSourceRepository.create(
      {
        key: input.key,
        name: input.name,
        kind: input.kind,
        requiresDetail: input.requiresDetail,
        active: true,
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

  /** Idempotent create-if-missing for the boot seed (§3). */
  async ensure(input: CreateApplicantSource): Promise<ApplicantSourceDoc> {
    const existing = await applicantSourceRepository.findByKey(input.key);
    if (existing !== null) return existing;
    const doc = await applicantSourceRepository.create(
      {
        key: input.key,
        name: input.name,
        kind: input.kind,
        requiresDetail: input.requiresDetail,
        active: true,
      },
      { by: null },
    );
    return doc;
  }

  async list(query: ListApplicantSourcesQuery): Promise<Paginated<ApplicantSourceDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.active !== undefined) filter.active = query.active;
    if (query.kind !== undefined) filter.kind = query.kind;
    return applicantSourceRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['createdAt', 'key'],
    });
  }

  async getById(id: string): Promise<ApplicantSourceDoc> {
    return applicantSourceRepository.getById(id);
  }

  async update(id: string, input: UpdateApplicantSource, by: string): Promise<ApplicantSourceDoc> {
    const before = await applicantSourceRepository.getById(id);
    const set: Partial<ApplicantSourceDoc> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.kind !== undefined) set.kind = input.kind;
    if (input.requiresDetail !== undefined) set.requiresDetail = input.requiresDetail;
    if (input.active !== undefined) set.active = input.active;
    const updated = await applicantSourceRepository.updateById(id, set, {
      by,
      version: input.version,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }
}

export const applicantSourceService = new ApplicantSourceService();
