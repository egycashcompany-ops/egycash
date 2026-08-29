// Setting a goal, recording where it stands, and saying how it ended (P-HR-PRF §4, D1, D9, D14).
//
// THE STATE MACHINE IS NOT HERE — `goal-rules.ts` owns it. What IS here, and matters more, is what
// the service refuses to do: it never derives an outcome from `currentValue` against `targetValue`,
// and it never closes a goal because a date passed. Both would be one line, both would look like
// helpfulness, and both would be this module deciding something D9 says a person decides.
//
// A number reached for reasons nobody intended is not an achievement, and a target missed because
// the work was cancelled is not a failure. The system holds both numbers and has no way to tell
// those apart — which is exactly why it must not try.
import { Types } from 'mongoose';
import {
  HrPerformanceGoalEvents,
  type ClosePerformanceGoal,
  type CreatePerformanceGoal,
  type ListPerformanceGoalsQuery,
  type Paginated,
  type ProgressPerformanceGoal,
  type UpdatePerformanceGoal,
} from '@ecms/contracts';
import { BusinessRuleError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { diffChanges } from '../../../../shared/utils/diff';
import { performanceGoalRepository, performanceReviewRepository } from '../performance.repository';
import { canTransition, isOpen } from './goal-rules';
import { type PerformanceGoalDoc } from './performance-goal.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'performanceGoal', entityId: id });

const snapshot = (doc: PerformanceGoalDoc) => ({
  status: doc.status,
  title: doc.title,
  description: doc.description,
  targetValue: doc.targetValue,
  currentValue: doc.currentValue,
  unit: doc.unit,
  dueAt: doc.dueAt === null ? null : doc.dueAt.toISOString(),
  lastNote: doc.lastNote,
});

class PerformanceGoalService {
  async list(
    query: ListPerformanceGoalsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<PerformanceGoalDoc>> {
    const status =
      query.status === undefined
        ? undefined
        : Array.isArray(query.status)
          ? query.status
          : [query.status];
    return performanceGoalRepository.listFiltered(
      {
        reviewId: query.reviewId,
        cycleId: query.cycleId,
        employeeId: query.employeeId,
        status,
        search: query.search,
      },
      { page: query.page, pageSize: query.pageSize, sortBy: query.sortBy, sortDir: query.sortDir },
      scope,
    );
  }

  async getById(id: string, scope: ScopeSelector): Promise<PerformanceGoalDoc> {
    return performanceGoalRepository.getById(id, scope);
  }

  /**
   * Set a goal on a review.
   *
   * THE REVIEW IS READ, NOT TRUSTED, and everything about the person is taken from it (D1, D14):
   * the pair is in the round because the review exists, and both scope axes are already settled
   * there. Re-reading the employee would be a second answer to a question already answered — and
   * a goal created the week after a transfer would quietly disagree with the review it belongs to.
   *
   * Refused once the review has left `draft`: a goal added to an assessment somebody has already
   * submitted is a goal they were never assessed against.
   */
  async create(
    ctx: AuthContext,
    input: CreatePerformanceGoal,
    scope: ScopeSelector,
  ): Promise<PerformanceGoalDoc> {
    const review = await performanceReviewRepository.getById(input.reviewId, scope);
    if (review.status !== 'draft') {
      throw new BusinessRuleError(
        `goals can only be set while the review is open — this one is ${review.status}`,
      );
    }
    const doc = await performanceGoalRepository.create(
      {
        reviewId: review._id,
        cycleId: review.cycleId,
        employeeId: review.employeeId,
        employeeCode: review.employeeCode,
        employeeName: review.employeeName,
        title: input.title,
        description: input.description ?? null,
        targetValue: input.targetValue ?? null,
        currentValue: input.currentValue ?? null,
        unit: input.unit ?? null,
        status: 'active',
        dueAt: input.dueAt ?? null,
        lastNote: null,
        progressedAt: null,
        progressedBy: null,
        closedAt: null,
        closedBy: null,
        branchId: review.branchId,
        departmentId: review.departmentId,
      },
      { by: ctx.userId },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    await emit(HrPerformanceGoalEvents.Created, {
      goalId: String(doc._id),
      reviewId: String(doc.reviewId),
      cycleId: String(doc.cycleId),
    });
    return doc;
  }

  /** Editing the definition, while the goal is still open. */
  async update(
    ctx: AuthContext,
    id: string,
    input: UpdatePerformanceGoal,
    scope: ScopeSelector,
  ): Promise<PerformanceGoalDoc> {
    const before = await performanceGoalRepository.getById(id, scope);
    if (!isOpen(before.status)) {
      throw new BusinessRuleError(`a ${before.status} goal cannot be edited`);
    }
    const set: Partial<PerformanceGoalDoc> = {};
    if (input.title !== undefined) set.title = input.title;
    if (input.description !== undefined) set.description = input.description;
    if (input.targetValue !== undefined) set.targetValue = input.targetValue;
    if (input.unit !== undefined) set.unit = input.unit;
    if (input.dueAt !== undefined) set.dueAt = input.dueAt;

    const updated = await performanceGoalRepository.updateById(id, set, {
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
   * Where things stand — the write that happens repeatedly while the definition sits still.
   *
   * IT CHANGES NO STATUS. Reaching the target does not mark the goal achieved, and passing the due
   * date does not mark it missed; both are outcomes, and an outcome is `close`'s argument.
   */
  async progress(
    ctx: AuthContext,
    id: string,
    input: ProgressPerformanceGoal,
    scope: ScopeSelector,
  ): Promise<PerformanceGoalDoc> {
    const before = await performanceGoalRepository.getById(id, scope);
    if (!isOpen(before.status)) {
      throw new BusinessRuleError(`a ${before.status} goal no longer moves`);
    }
    const set: Partial<PerformanceGoalDoc> = {
      progressedAt: new Date(),
      progressedBy: new Types.ObjectId(ctx.userId),
    };
    if (input.currentValue !== undefined) set.currentValue = input.currentValue;
    if (input.note !== undefined) set.lastNote = input.note;

    const updated = await performanceGoalRepository.updateById(id, set, {
      by: ctx.userId,
      version: input.version,
      scope,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    await emit(HrPerformanceGoalEvents.Progressed, {
      goalId: id,
      reviewId: String(updated.reviewId),
      cycleId: String(updated.cycleId),
    });
    return updated;
  }

  /**
   * How it ended — STATED BY A PERSON (D9).
   *
   * The outcome arrives as an argument. Nothing here compares `currentValue` to `targetValue`,
   * because the comparison has no way to know whether a number was reached by the work it was set
   * for, and a goal is a claim about work rather than about a number.
   */
  async close(
    ctx: AuthContext,
    id: string,
    input: ClosePerformanceGoal,
    scope: ScopeSelector,
  ): Promise<PerformanceGoalDoc> {
    const before = await performanceGoalRepository.getById(id, scope);
    if (!canTransition(before.status, input.status)) {
      throw new BusinessRuleError(`a ${before.status} goal cannot become ${input.status}`);
    }
    const set: Partial<PerformanceGoalDoc> = {
      status: input.status,
      closedAt: new Date(),
      closedBy: new Types.ObjectId(ctx.userId),
    };
    if (input.note !== undefined) set.lastNote = input.note;

    const updated = await performanceGoalRepository.updateById(id, set, {
      by: ctx.userId,
      version: input.version,
      scope,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    await emit(HrPerformanceGoalEvents.Closed, {
      goalId: id,
      reviewId: String(updated.reviewId),
      cycleId: String(updated.cycleId),
    });
    return updated;
  }
}

export const performanceGoalService = new PerformanceGoalService();
