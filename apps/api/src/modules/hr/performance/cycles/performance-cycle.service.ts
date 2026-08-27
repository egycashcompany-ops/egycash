// The round: defining it, opening it, closing it (P-HR-PRF §4, D1, D2, D3, D8).
//
// THE STATE MACHINE IS NOT HERE. `cycle-rules.ts` owns it, pure and arguable without a database,
// and this service does what a service does: read, check, write, audit, emit. A refused transition
// is a `BusinessRuleError` naming both states, because «cannot close» tells the caller nothing they
// can act on.
//
// OPENING IS THE ONLY ACT THAT MATTERS HERE, and almost none of it is in this file: it delegates to
// the materializer and then records what came back. That split is deliberate — the round's
// lifecycle and the writing of several hundred rows are two things, and folding them together is
// how «open» quietly becomes the place people add rules about who is really in scope.
import { Types } from 'mongoose';
import {
  DEFAULT_PERFORMANCE_SCALE,
  HrPerformanceEvents,
  type ClosePerformanceCycle,
  type CreatePerformanceCycle,
  type ListPerformanceCyclesQuery,
  type OpenPerformanceCycle,
  type Paginated,
  type PerformanceCycleOpenResultDto,
  type PerformanceCycleScope,
  type UpdatePerformanceCycle,
} from '@ecms/contracts';
import { BusinessRuleError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { diffChanges } from '../../../../shared/utils/diff';
import { performanceCycleRepository, performanceReviewRepository } from '../performance.repository';
import { materializeReviews } from './cycle-materializer';
import { canTransition, isEditable } from './cycle-rules';
import { type PerformanceCycleDoc } from './performance-cycle.model';

const entityRef = (id: string) => ({
  moduleId: 'hr',
  entityType: 'performanceCycle',
  entityId: id,
});

const snapshot = (doc: PerformanceCycleDoc) => ({
  status: doc.status,
  nameAr: doc.name.ar,
  periodStart: doc.periodStart.toISOString(),
  periodEnd: doc.periodEnd.toISOString(),
  scopeKind: doc.scopeKind,
  scopeBranchIds: doc.scopeBranchIds.map(String).join(','),
  scopeDepartmentIds: doc.scopeDepartmentIds.map(String).join(','),
  scaleMin: doc.scaleMin,
  scaleMax: doc.scaleMax,
  dueAt: doc.dueAt === null ? null : doc.dueAt.toISOString(),
  note: doc.note,
  reviewCount: doc.reviewCount,
});

/** The union flattened onto the three stored fields — one place, so the two never disagree. */
const storedScope = (scope: PerformanceCycleScope) => ({
  scopeKind: scope.kind,
  scopeBranchIds:
    scope.kind === 'filter' ? (scope.branchIds ?? []).map((id) => new Types.ObjectId(id)) : [],
  scopeDepartmentIds:
    scope.kind === 'filter' ? (scope.departmentIds ?? []).map((id) => new Types.ObjectId(id)) : [],
});

class PerformanceCycleService {
  async list(
    query: ListPerformanceCyclesQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<PerformanceCycleDoc>> {
    const status =
      query.status === undefined
        ? undefined
        : Array.isArray(query.status)
          ? query.status
          : [query.status];
    return performanceCycleRepository.listFiltered(
      { status, search: query.search },
      { page: query.page, pageSize: query.pageSize, sortBy: query.sortBy, sortDir: query.sortDir },
      scope,
    );
  }

  async getById(id: string, scope: ScopeSelector): Promise<PerformanceCycleDoc> {
    return performanceCycleRepository.getById(id, scope);
  }

  async create(ctx: AuthContext, input: CreatePerformanceCycle): Promise<PerformanceCycleDoc> {
    const scale = input.scale ?? DEFAULT_PERFORMANCE_SCALE;
    const doc = await performanceCycleRepository.create(
      {
        name: input.name,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        status: 'draft',
        ...storedScope(input.scope),
        scaleMin: scale.min,
        scaleMax: scale.max,
        scaleLabels: 'labels' in scale ? (scale.labels ?? []) : [],
        dueAt: input.dueAt ?? null,
        note: input.note ?? null,
        openedAt: null,
        openedBy: null,
        reviewCount: 0,
        closedAt: null,
        closedBy: null,
        closeNote: null,
      },
      { by: ctx.userId },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return doc;
  }

  /**
   * Editing the round's definition. DRAFT ONLY, and this is D2 doing work rather than a courtesy.
   *
   * Once opened, the reviews exist: moving the scope underneath them would leave rows for people
   * the round no longer names, and changing the scale would mean two reviews in one round rated on
   * different rulers — which is the exact comparison §8 Q5 exists to protect.
   */
  async update(
    ctx: AuthContext,
    id: string,
    input: UpdatePerformanceCycle,
    scope: ScopeSelector,
  ): Promise<PerformanceCycleDoc> {
    const before = await performanceCycleRepository.getById(id, scope);
    if (!isEditable(before.status)) {
      throw new BusinessRuleError(
        `only a draft cycle can be edited — this one is ${before.status}`,
      );
    }
    const set: Partial<PerformanceCycleDoc> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.periodStart !== undefined) set.periodStart = input.periodStart;
    if (input.periodEnd !== undefined) set.periodEnd = input.periodEnd;
    if (input.scope !== undefined) Object.assign(set, storedScope(input.scope));
    if (input.scale !== undefined) {
      set.scaleMin = input.scale.min;
      set.scaleMax = input.scale.max;
      set.scaleLabels = input.scale.labels ?? [];
    }
    if (input.dueAt !== undefined) set.dueAt = input.dueAt;
    if (input.note !== undefined) set.note = input.note;

    // Checked against the MERGED state, not against what arrived: moving only the start past the
    // stored end is exactly how an incoherent period gets written.
    const periodStart = set.periodStart ?? before.periodStart;
    const periodEnd = set.periodEnd ?? before.periodEnd;
    if (periodEnd.getTime() < periodStart.getTime()) {
      throw new BusinessRuleError('a period cannot end before it starts');
    }

    const updated = await performanceCycleRepository.updateById(id, set, {
      by: ctx.userId,
      version: input.version,
      scope,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }

  /**
   * Open the round — the act D2 is about.
   *
   * The order is: check, materialize, THEN mark open. Writing the status first would leave a round
   * that says it is open and holds no rows if the materializer throws, and a round in that state
   * is indistinguishable from one whose scope matched nobody. Doing it last means a failure leaves
   * a draft somebody can simply open again.
   *
   * The count that lands on the cycle is the DATABASE's answer (`created` plus whatever already
   * existed), not the number of employees this run walked — those differ exactly when opening is
   * retried, which is the case the count has to survive.
   */
  async open(
    ctx: AuthContext,
    id: string,
    input: OpenPerformanceCycle,
    scope: ScopeSelector,
  ): Promise<{ cycle: PerformanceCycleDoc; result: PerformanceCycleOpenResultDto }> {
    const before = await performanceCycleRepository.getById(id, scope);
    if (!canTransition(before.status, 'open')) {
      throw new BusinessRuleError(`a ${before.status} cycle cannot be opened`);
    }
    const result = await materializeReviews(before, ctx.userId);
    if (result.matched === 0) {
      throw new BusinessRuleError('this cycle’s scope matches nobody — nothing would be reviewed');
    }
    const reviewCount = await performanceReviewRepository.countInCycle(id);
    const updated = await performanceCycleRepository.updateById(
      id,
      {
        status: 'open',
        openedAt: new Date(),
        openedBy: new Types.ObjectId(ctx.userId),
        reviewCount,
      },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    await emit(HrPerformanceEvents.CycleOpened, { cycleId: id, reviewCount });
    return { cycle: updated, result };
  }

  /**
   * Close the round. Refused while any review is still open (§4).
   *
   * THE REFUSAL NAMES THE NUMBER, because that is the difference between a message somebody can act
   * on and one they can only be annoyed by. «17 reviews are still open» sends them to a queue;
   * «cannot close» sends them to whoever wrote this.
   */
  async close(
    ctx: AuthContext,
    id: string,
    input: ClosePerformanceCycle,
    scope: ScopeSelector,
  ): Promise<PerformanceCycleDoc> {
    const before = await performanceCycleRepository.getById(id, scope);
    if (!canTransition(before.status, 'closed')) {
      throw new BusinessRuleError(`a ${before.status} cycle cannot be closed`);
    }
    const unfinished = await performanceReviewRepository.countUnfinished(id);
    if (unfinished > 0) {
      throw new BusinessRuleError(
        `${unfinished} review(s) in this cycle are neither finalized nor excused`,
      );
    }
    const updated = await performanceCycleRepository.updateById(
      id,
      {
        status: 'closed',
        closedAt: new Date(),
        closedBy: new Types.ObjectId(ctx.userId),
        closeNote: input.note ?? null,
      },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    await emit(HrPerformanceEvents.CycleClosed, { cycleId: id, reviewCount: updated.reviewCount });
    return updated;
  }
}

export const performanceCycleService = new PerformanceCycleService();
