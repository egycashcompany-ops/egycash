// Evaluation-phase catalog admin. Localized, extensible, audited; deactivation (never
// hard-delete) preserves references from historical evaluation records. Mirrors the
// interview-stage catalog so the two configurable sequences behave identically.
import {
  type CreateEvaluationPhase,
  type ListEvaluationPhasesQuery,
  type Paginated,
  type UpdateEvaluationPhase,
} from '@ecms/contracts';
import { ConflictError } from '../../../../shared/errors';
import { auditService } from '../../../../platform/audit';
import { diffChanges } from '../../../../shared/utils/diff';
import { evaluationPhaseRepository } from './evaluation-phase.repository';
import { type EvaluationPhaseDoc } from './evaluation-phase.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'evaluationPhase', entityId: id });

const snapshot = (doc: EvaluationPhaseDoc) => ({
  name: doc.name,
  order: doc.order,
  active: doc.active,
  driversOnly: doc.driversOnly,
});

class EvaluationPhaseService {
  async create(input: CreateEvaluationPhase, by: string): Promise<EvaluationPhaseDoc> {
    const existing = await evaluationPhaseRepository.findByKey(input.key);
    if (existing !== null) throw new ConflictError(`Evaluation phase "${input.key}" already exists`);
    const clash = await evaluationPhaseRepository.findActiveByOrder(input.order);
    if (clash !== null) throw new ConflictError(`An active evaluation phase at order ${input.order} already exists`);
    const doc = await evaluationPhaseRepository.create(
      { key: input.key, name: input.name, order: input.order, active: true, driversOnly: input.driversOnly },
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
  async ensure(input: CreateEvaluationPhase): Promise<EvaluationPhaseDoc> {
    const existing = await evaluationPhaseRepository.findByKey(input.key);
    if (existing !== null) return existing;
    return evaluationPhaseRepository.create(
      { key: input.key, name: input.name, order: input.order, active: true, driversOnly: input.driversOnly },
      { by: null },
    );
  }

  async list(query: ListEvaluationPhasesQuery): Promise<Paginated<EvaluationPhaseDoc>> {
    const filter: Record<string, unknown> = {};
    if (query.active !== undefined) filter.active = query.active;
    // Phases form an ordered sequence: default to ascending by `order`.
    const explicitSort = query.sortBy !== undefined;
    return evaluationPhaseRepository.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: explicitSort ? query.sortBy : 'order',
      sortDir: explicitSort ? query.sortDir : 'asc',
      sortableFields: ['order', 'createdAt', 'key'],
    });
  }

  async getById(id: string): Promise<EvaluationPhaseDoc> {
    return evaluationPhaseRepository.getById(id);
  }

  async update(id: string, input: UpdateEvaluationPhase, by: string): Promise<EvaluationPhaseDoc> {
    const before = await evaluationPhaseRepository.getById(id);
    if (input.order !== undefined && input.order !== before.order) {
      const clash = await evaluationPhaseRepository.findActiveByOrder(input.order);
      if (clash !== null && String(clash._id) !== id) {
        throw new ConflictError(`An active evaluation phase at order ${input.order} already exists`);
      }
    }
    const set: Partial<EvaluationPhaseDoc> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.order !== undefined) set.order = input.order;
    if (input.active !== undefined) set.active = input.active;
    if (input.driversOnly !== undefined) set.driversOnly = input.driversOnly;
    const updated = await evaluationPhaseRepository.updateById(id, set, { by, version: input.version });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }
}

export const evaluationPhaseService = new EvaluationPhaseService();
