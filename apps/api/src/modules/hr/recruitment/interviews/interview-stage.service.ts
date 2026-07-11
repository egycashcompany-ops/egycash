// Interview stage catalog admin (Stage 3, OQ-31). Localized, extensible, audited;
// deactivation (never hard-delete) preserves references from historical interviews.
import {
  type CreateInterviewStage,
  type ListInterviewStagesQuery,
  type Paginated,
  type UpdateInterviewStage,
} from '@ecms/contracts';
import { ConflictError } from '../../../../shared/errors';
import { auditService } from '../../../../platform/audit';
import { diffChanges } from '../../../../shared/utils/diff';
import { interviewStageRepository } from './interview-stage.repository';
import { type InterviewStageDoc } from './interview-stage.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'interviewStage', entityId: id });

const snapshot = (doc: InterviewStageDoc) => ({ name: doc.name, order: doc.order, active: doc.active });

class InterviewStageService {
  async create(input: CreateInterviewStage, by: string): Promise<InterviewStageDoc> {
    const existing = await interviewStageRepository.findByKey(input.key);
    if (existing !== null) throw new ConflictError(`Interview stage "${input.key}" already exists`);
    const clash = await interviewStageRepository.findActiveByOrder(input.order);
    if (clash !== null) throw new ConflictError(`An active interview stage at order ${input.order} already exists`);
    const doc = await interviewStageRepository.create(
      { key: input.key, name: input.name, order: input.order, active: true },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return doc;
  }

  /** Idempotent create-if-missing for the boot seed. */
  async ensure(input: CreateInterviewStage): Promise<InterviewStageDoc> {
    const existing = await interviewStageRepository.findByKey(input.key);
    if (existing !== null) return existing;
    return interviewStageRepository.create(
      { key: input.key, name: input.name, order: input.order, active: true },
      { by: null },
    );
  }

  async list(query: ListInterviewStagesQuery): Promise<Paginated<InterviewStageDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.active !== undefined) filter.active = query.active;
    // Stages form an ordered sequence: default to ascending by `order` (the schema defaults
    // sortDir to 'desc', so key off an explicit sortBy to know the caller really chose one).
    const explicitSort = query.sortBy !== undefined;
    return interviewStageRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: explicitSort ? query.sortBy : 'order',
      sortDir: explicitSort ? query.sortDir : 'asc',
      sortableFields: ['order', 'createdAt', 'key'],
    });
  }

  async getById(id: string): Promise<InterviewStageDoc> {
    return interviewStageRepository.getById(id);
  }

  async update(id: string, input: UpdateInterviewStage, by: string): Promise<InterviewStageDoc> {
    const before = await interviewStageRepository.getById(id);
    if (input.order !== undefined && input.order !== before.order) {
      const clash = await interviewStageRepository.findActiveByOrder(input.order);
      if (clash !== null && String(clash._id) !== id) {
        throw new ConflictError(`An active interview stage at order ${input.order} already exists`);
      }
    }
    const set: Partial<InterviewStageDoc> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.order !== undefined) set.order = input.order;
    if (input.active !== undefined) set.active = input.active;
    const updated = await interviewStageRepository.updateById(id, set, { by, version: input.version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }
}

export const interviewStageService = new InterviewStageService();
