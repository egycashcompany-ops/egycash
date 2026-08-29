// Reading the rows a round opened, and fixing the one thing materialization can leave empty
// (P-HR-PRF D4, D5, D14).
//
// THE ASSESSMENT ARRIVED IN P4. The half-open lifecycle P2 shipped on purpose is closed: a round
// can now be worked, finished and closed.
//
// WHO MAY WRITE IS RESOLVED THROUGH THE EMPLOYEE, not through the token. The review names an
// evaluator as a person in the org chart (D4), so «is this caller that person» is answered by
// finding the employee whose `userId` is the caller — one lookup, in the direction that survives
// a login being created late or replaced.
//
// ASSIGNMENT IS HERE BECAUSE OPENING CAN LEAVE IT NULL. A department with no manager produces rows
// nobody is responsible for, and a round full of those with no way to fix them would be a phase
// that opened something nobody can run.
import { Types } from 'mongoose';
import {
  HrPerformanceReviewEvents,
  type AssignPerformanceEvaluator,
  type ExcusePerformanceReview,
  type FinalizePerformanceReview,
  type ListPerformanceReviewsQuery,
  type Paginated,
  type ReturnPerformanceReview,
  type SubmitPerformanceReview,
} from '@ecms/contracts';
import { BusinessRuleError, ValidationError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { diffChanges } from '../../../../shared/utils/diff';
import { EXITED_REASON } from '../../shared/separation';
import { employeeService } from '../../employee-management/employees/employee.service';
import { employeeRepository } from '../../employee-management/employees/employee.repository';
import { performanceCycleRepository, performanceReviewRepository } from '../performance.repository';
import { isOnScale } from '../cycles/cycle-rules';
import { canTransition, isAssignedEvaluator, mayEvaluate } from './review-rules';
import { type PerformanceReviewDoc } from './performance-review.model';

const entityRef = (id: string) => ({
  moduleId: 'hr',
  entityType: 'performanceReview',
  entityId: id,
});

/**
 * The scope `listMine` reads with — organization, because the narrowing that matters is the
 * employee id and it comes from the token rather than from the request. Named rather than inlined
 * so the one place this feature reads past a caller's scope is a thing somebody can grep for.
 */
const SYSTEM_SCOPE: ScopeSelector = {
  scope: 'organization',
  userId: '',
  branchId: null,
  departmentId: null,
  sectionId: null,
};

const snapshot = (doc: PerformanceReviewDoc) => ({
  status: doc.status,
  evaluatorId: doc.evaluatorId === null ? null : String(doc.evaluatorId),
  evaluatorName: doc.evaluatorName,
  rating: doc.rating,
  strengths: doc.strengths,
  improvements: doc.improvements,
  returnedReason: doc.returnedReason,
});

/** The three ids every review event carries, and nothing else — see the payload for why. */
const factOf = (doc: PerformanceReviewDoc) => ({
  reviewId: String(doc._id),
  cycleId: String(doc.cycleId),
  employeeId: String(doc.employeeId),
});

class PerformanceReviewService {
  async list(
    query: ListPerformanceReviewsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<PerformanceReviewDoc>> {
    const status =
      query.status === undefined
        ? undefined
        : Array.isArray(query.status)
          ? query.status
          : [query.status];
    return performanceReviewRepository.listFiltered(
      {
        cycleId: query.cycleId,
        employeeId: query.employeeId,
        evaluatorId: query.evaluatorId,
        status,
        branchId: query.branchId,
        departmentId: query.departmentId,
        search: query.search,
      },
      { page: query.page, pageSize: query.pageSize, sortBy: query.sortBy, sortDir: query.sortDir },
      scope,
    );
  }

  /**
   * D15 — the employee's own FINALIZED reviews, and nothing before them.
   *
   * A draft is the evaluator thinking. A submitted review is somebody else's to decide. Showing an
   * employee either would turn the process into a negotiation instead of an assessment — and the
   * person being assessed is the one reader who cannot un-see an early draft.
   *
   * THE STATUS IS HARDCODED, NOT DEFAULTED, and the distinction is the whole guard: a default is a
   * thing a query parameter overrides, and the override would be one URL away from showing
   * somebody a draft assessment of themselves. This method takes no status at all.
   *
   * SYSTEM SCOPED, deliberately. The caller holds no `performanceReview.view` — most employees
   * never will — and requiring it would mean somebody could read their own review only if they
   * could also read everybody's.
   *
   * A caller with no employee record gets an empty page rather than an error: a login that is not
   * an employee has no reviews, which is an answer and not a fault.
   */
  async listMine(
    userId: string,
    query: { page: number; pageSize: number; sortDir?: 'asc' | 'desc' | undefined },
  ): Promise<Paginated<PerformanceReviewDoc>> {
    const me = await this.callerEmployeeId(userId);
    if (me === null) {
      return {
        items: [],
        meta: { page: 1, pageSize: query.pageSize, totalItems: 0, totalPages: 1 },
      };
    }
    return performanceReviewRepository.listFiltered(
      { employeeId: me, status: ['finalized'] },
      { page: query.page, pageSize: query.pageSize, sortBy: 'createdAt', sortDir: query.sortDir },
      SYSTEM_SCOPE,
    );
  }

  async getById(id: string, scope: ScopeSelector): Promise<PerformanceReviewDoc> {
    return performanceReviewRepository.getById(id, scope);
  }

  /**
   * Name the evaluator (D4), or replace the default with somebody else.
   *
   * DRAFT ONLY. Reassigning after an assessment has been written would attribute one person's words
   * to another — the review carries the evaluator's NAME beside the id (D7), so the row would end
   * up saying a thing that never happened rather than merely being wrong.
   *
   * THE EVALUATOR MAY NOT BE THE SUBJECT (D5). Third copy of «a key says what you may do, not who
   * you are», after `employeeLoan.approve` and `trainingNomination.decide`: nobody's permission
   * ever makes reviewing yourself sensible, so the check is in the service and not in the grant.
   *
   * The evaluator is read rather than trusted — an id that is not an employed person would produce
   * a review assigned to nobody, which reads in every queue exactly like one that works.
   */
  async assignEvaluator(
    ctx: AuthContext,
    id: string,
    input: AssignPerformanceEvaluator,
    scope: ScopeSelector,
  ): Promise<PerformanceReviewDoc> {
    const before = await performanceReviewRepository.getById(id, scope);
    if (before.status !== 'draft') {
      throw new BusinessRuleError(
        `only a draft review can be reassigned — this one is ${before.status}`,
      );
    }
    if (String(before.employeeId) === input.evaluatorId) {
      throw new BusinessRuleError('nobody reviews themselves');
    }
    const evaluator = await employeeService.getById(input.evaluatorId, scope);
    if (evaluator.status === 'exited') {
      throw new ValidationError([
        {
          field: 'evaluatorId',
          code: 'INVALID',
          message: 'this person has left — they cannot be assigned a review',
        },
      ]);
    }
    const updated = await performanceReviewRepository.updateById(
      id,
      {
        evaluatorId: new Types.ObjectId(input.evaluatorId),
        evaluatorName: evaluator.personal.fullNameAr,
      },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }

  /**
   * Which employee this login is, or null.
   *
   * `System` read on purpose: it answers «who am I», and narrowing it by the caller's own data
   * scope would make an evaluator with a branch scope unable to find themselves.
   */
  private async callerEmployeeId(userId: string): Promise<string | null> {
    const employee = await employeeRepository.findByUserIdSystem(userId);
    return employee === null ? null : String(employee._id);
  }

  /**
   * The evaluator's act — the rating and the words (D6, D8).
   *
   * THREE REFUSALS, EACH WITH ITS OWN MESSAGE, because they are three different problems and one
   * message would be wrong two thirds of the time: this is not your review to write, nobody
   * reviews themselves, and that is not a point on this round's scale.
   *
   * THE SCALE COMES FROM THE CYCLE. `isOnScale` has sat in `cycle-rules.ts` since P2 waiting for
   * this call — the round is the authority on which judgements were on offer, and a schema cannot
   * know which round a review is in.
   */
  async submit(
    ctx: AuthContext,
    id: string,
    input: SubmitPerformanceReview,
    scope: ScopeSelector,
  ): Promise<PerformanceReviewDoc> {
    const before = await performanceReviewRepository.getById(id, scope);
    if (!canTransition(before.status, 'submitted')) {
      throw new BusinessRuleError(`a ${before.status} review cannot be submitted`);
    }
    const me = await this.callerEmployeeId(ctx.userId);
    const assigned = before.evaluatorId === null ? null : String(before.evaluatorId);
    if (!isAssignedEvaluator(assigned, me)) {
      throw new BusinessRuleError('this review is assigned to somebody else');
    }
    if (me !== null && !mayEvaluate(String(before.employeeId), me)) {
      throw new BusinessRuleError('nobody reviews themselves');
    }
    const cycle = await performanceCycleRepository.getById(String(before.cycleId));
    if (!isOnScale(input.rating, { min: cycle.scaleMin, max: cycle.scaleMax })) {
      throw new ValidationError([
        {
          field: 'rating',
          code: 'INVALID',
          message: `this cycle is rated ${String(cycle.scaleMin)}–${String(cycle.scaleMax)}`,
        },
      ]);
    }
    const updated = await performanceReviewRepository.updateById(
      id,
      {
        status: 'submitted',
        rating: input.rating,
        strengths: input.strengths,
        improvements: input.improvements,
        submittedAt: new Date(),
        submittedBy: new Types.ObjectId(ctx.userId),
      },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    await emit(HrPerformanceReviewEvents.Submitted, factOf(updated));
    return updated;
  }

  /**
   * HR sending it back, with a reason.
   *
   * NOTHING IS CLEARED. The rating and both texts stay exactly as written, so the evaluator edits
   * one sentence rather than retyping an assessment — a return that wiped the work would be the
   * most expensive button on the screen, and the predictable result is that nobody presses it.
   */
  async returnToEvaluator(
    ctx: AuthContext,
    id: string,
    input: ReturnPerformanceReview,
    scope: ScopeSelector,
  ): Promise<PerformanceReviewDoc> {
    const before = await performanceReviewRepository.getById(id, scope);
    if (!canTransition(before.status, 'draft')) {
      throw new BusinessRuleError(`a ${before.status} review cannot be sent back`);
    }
    const updated = await performanceReviewRepository.updateById(
      id,
      { status: 'draft', returnedReason: input.reason },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    await emit(HrPerformanceReviewEvents.Returned, factOf(updated));
    return updated;
  }

  /**
   * HR closing it (D6) — and the moment the row becomes a record (D7).
   *
   * IT WRITES NO ASSESSMENT. Finalizing is agreeing that what the evaluator wrote IS the record;
   * a finalize that could change the rating would put a second author on one person's assessment
   * with nothing in the row to say which of them meant it.
   *
   * The denormalized names are LEFT AS THEY ARE rather than refreshed here. They were copied when
   * the cycle opened, which is when they were true — re-reading them at finalize would stamp
   * today's department onto an assessment of last year's work, which is the drift D7 exists to
   * prevent rather than a correction of it.
   */
  async finalize(
    ctx: AuthContext,
    id: string,
    input: FinalizePerformanceReview,
    scope: ScopeSelector,
  ): Promise<PerformanceReviewDoc> {
    const before = await performanceReviewRepository.getById(id, scope);
    if (!canTransition(before.status, 'finalized')) {
      throw new BusinessRuleError(`a ${before.status} review cannot be finalized`);
    }
    const updated = await performanceReviewRepository.updateById(
      id,
      {
        status: 'finalized',
        finalizedAt: new Date(),
        finalizedBy: new Types.ObjectId(ctx.userId),
      },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    await emit(HrPerformanceReviewEvents.Finalized, factOf(updated));
    return updated;
  }

  /**
   * Somebody who could not be reviewed this round.
   *
   * A REAL OUTCOME, NOT A DELETION, and it is what lets a cycle close without pretending. The
   * reason is required because «excused» with no explanation is a gap in the round's account of
   * itself that nobody can reconstruct a year later.
   */
  async excuse(
    ctx: AuthContext,
    id: string,
    input: ExcusePerformanceReview,
    scope: ScopeSelector,
  ): Promise<PerformanceReviewDoc> {
    const before = await performanceReviewRepository.getById(id, scope);
    if (!canTransition(before.status, 'excused')) {
      throw new BusinessRuleError(`a ${before.status} review cannot be excused`);
    }
    const updated = await performanceReviewRepository.updateById(
      id,
      {
        status: 'excused',
        excusedAt: new Date(),
        excusedBy: new Types.ObjectId(ctx.userId),
        excusedReason: input.reason,
      },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    await emit(HrPerformanceReviewEvents.Excused, factOf(updated));
    return updated;
  }

  // ── Event subscriber (P-HR-SEP F2) ────────────────────────────────────────

  /**
   * `hr.employee.exited` — excuse the rows the leaver's round can no longer finish.
   *
   * WHY THIS IS A DEFECT AND NOT A TIDY-UP. `close` refuses while any review is neither finalized
   * nor excused, and it names the COUNT rather than the reason. So one person resigning in the
   * middle of a round leaves a row with an evaluator who cannot evaluate them and a subject who is
   * not there — and the whole company's round stays open until somebody works out that the blocker
   * is a leaver and excuses that row by hand. Nothing tells them. Opening already excludes people
   * who had left BEFORE the round opened; this is the other half of the same rule.
   *
   * ONLY DRAFTS (D4) — see the repository for why a submitted review is left to its own path.
   *
   * PER ROW, NOT IN BULK, so each excuse carries its own audit entry and its own event: the audit
   * chokepoint is what reaches an open screen (ADR-029), and a queue that silently loses a row is
   * worse than one that shows a stale count. The list is one person's reviews, so the loop is
   * bounded by how many rounds they were in.
   */
  async onEmployeeExited(employeeId: string): Promise<number> {
    const drafts = await performanceReviewRepository.listDraftsForEmployeeSystem(employeeId);
    let excused = 0;
    for (const before of drafts) {
      const updated = await performanceReviewRepository.excuseDraftForEmployeeSystem(
        String(before._id),
        employeeId,
        EXITED_REASON,
      );
      // Null means somebody excused or submitted it between the read and the write — their
      // decision stands, and nothing is emitted for a row this call did not change.
      if (updated === null) continue;
      excused += 1;
      await auditService.record({
        entityRef: entityRef(String(before._id)),
        action: 'update',
        changes: diffChanges(snapshot(before), snapshot(updated)),
      });
      await emit(HrPerformanceReviewEvents.Excused, factOf(updated));
    }
    return excused;
  }
}

export const performanceReviewService = new PerformanceReviewService();
