// Reading the rows a round opened, and fixing the one thing materialization can leave empty
// (P-HR-PRF D4, D5, D14).
//
// THIS PHASE READS AND ASSIGNS. It does not submit, return, finalize or excuse — those are P4,
// along with the evaluator's screen and the assessment itself. Shipping `finalize` here with
// nowhere to write an assessment would be a transition that destroys the ability to write one, so
// the lifecycle stays half-open on purpose and a round opened now cannot yet be closed.
//
// ASSIGNMENT IS HERE BECAUSE OPENING CAN LEAVE IT NULL. A department with no manager produces rows
// nobody is responsible for, and a round full of those with no way to fix them would be a phase
// that opened something nobody can run.
import { Types } from 'mongoose';
import {
  type AssignPerformanceEvaluator,
  type ListPerformanceReviewsQuery,
  type Paginated,
} from '@ecms/contracts';
import { BusinessRuleError, ValidationError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { diffChanges } from '../../../../shared/utils/diff';
import { employeeService } from '../../employee-management/employees/employee.service';
import { performanceReviewRepository } from '../performance.repository';
import { type PerformanceReviewDoc } from './performance-review.model';

const entityRef = (id: string) => ({
  moduleId: 'hr',
  entityType: 'performanceReview',
  entityId: id,
});

const snapshot = (doc: PerformanceReviewDoc) => ({
  status: doc.status,
  evaluatorId: doc.evaluatorId === null ? null : String(doc.evaluatorId),
  evaluatorName: doc.evaluatorName,
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
}

export const performanceReviewService = new PerformanceReviewService();
