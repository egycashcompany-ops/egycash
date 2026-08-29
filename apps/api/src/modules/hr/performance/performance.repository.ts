// Performance data access — the round, and the rows the round opens.
//
// THE TWO COLLECTIONS DECLARE DIFFERENT THINGS ON PURPOSE. A REVIEW is about a person, so it
// declares both axes; a CYCLE is not, so it declares neither. That asymmetry is the one this
// codebase has been bitten by twice — an undeclared scope field does not fail, does not warn and
// does not narrow: `scopeFilter` returns an empty filter, `baseFilter` drops the empty clause, and
// a department-scoped reader is served the whole organization. So the requirement is held in
// source by `performance-scope-guards.spec.ts`, which names the review as needing both and the
// cycle as exempt — an exemption stated is a decision; an exemption assumed is F-B1-1 again.
import { Types, type FilterQuery } from 'mongoose';
import {
  type Paginated,
  type PerformanceCycleStatus,
  type PerformanceGoalStatus,
  type PerformanceReviewStatus,
} from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { BusinessRuleError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { PerformanceCycleModel, type PerformanceCycleDoc } from './cycles/performance-cycle.model';
import {
  PerformanceReviewModel,
  type PerformanceReviewDoc,
} from './reviews/performance-review.model';
import { PerformanceGoalModel, type PerformanceGoalDoc } from './goals/performance-goal.model';

export interface CycleListFilter {
  status?: readonly PerformanceCycleStatus[] | undefined;
  search?: string | undefined;
}

export interface GoalListFilter {
  reviewId?: string | undefined;
  cycleId?: string | undefined;
  employeeId?: string | undefined;
  status?: readonly PerformanceGoalStatus[] | undefined;
  search?: string | undefined;
}

export interface ReviewListFilter {
  cycleId?: string | undefined;
  employeeId?: string | undefined;
  evaluatorId?: string | undefined;
  status?: readonly PerformanceReviewStatus[] | undefined;
  branchId?: string | undefined;
  departmentId?: string | undefined;
  search?: string | undefined;
}

const escaped = (search: string): RegExp =>
  new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

/**
 * The cycle. NO SCOPE FIELDS, and the omission is the decision D3 implies: a round is a company
 * object that NAMES branches and departments, not a row placed in one. A branch manager reading
 * «which rounds exist» should see the round their people are in, which is a question about the
 * scope the cycle names — not about a placement the cycle does not have.
 */
class PerformanceCycleRepository extends BaseRepository<PerformanceCycleDoc> {
  constructor() {
    super(PerformanceCycleModel, { softDelete: true });
  }

  async listFiltered(
    f: CycleListFilter,
    query: {
      page: number;
      pageSize: number;
      sortBy?: string | undefined;
      sortDir?: 'asc' | 'desc' | undefined;
    },
    scope: ScopeSelector,
  ): Promise<Paginated<PerformanceCycleDoc>> {
    const clauses: FilterQuery<PerformanceCycleDoc>[] = [];
    if (f.status !== undefined) clauses.push({ status: { $in: f.status } });
    if (f.search !== undefined && f.search.trim() !== '') {
      const pattern = escaped(f.search);
      clauses.push({ $or: [{ 'name.ar': pattern }, { 'name.en': pattern }] });
    }
    return this.list({
      filter: (clauses.length === 0 ? {} : { $and: clauses }) as FilterQuery<PerformanceCycleDoc>,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['periodEnd', 'createdAt'],
      scope,
    });
  }
}

/** The review. BOTH AXES, stamped from the employee at materialization (D14). */
class PerformanceReviewRepository extends BaseRepository<PerformanceReviewDoc> {
  constructor() {
    super(PerformanceReviewModel, {
      branchField: 'branchId',
      departmentField: 'departmentId',
      softDelete: true,
    });
  }

  /**
   * D7 — A FINALIZED REVIEW IS IMMUTABLE, and so is an excused one.
   *
   * This is a write CONDITION rather than a check in the service, and the difference is not
   * stylistic: the condition rides inside the same atomic `findOneAndUpdate` as the write, so a
   * concurrent finalize cannot be overtaken by a request that read the row a moment earlier. A
   * pre-check has a window; this does not.
   *
   * It also means the rule holds for every write through this repository, including ones nobody
   * has written yet. `training-immutability.spec.ts` counts update paths because the training
   * record had no such seam; here the seam is the guard, and the spec beside it proves the seam
   * is declared rather than counting the callers who respect it.
   */
  protected override writeConditions(): FilterQuery<PerformanceReviewDoc> {
    return { status: { $nin: ['finalized', 'excused'] } } as FilterQuery<PerformanceReviewDoc>;
  }

  /**
   * Why a write missed, when it missed because the row is closed.
   *
   * Called with the row as it actually is, BEFORE the miss is reported as a version conflict or a
   * 404 — so somebody trying to edit a finalized review is told that, rather than being told to
   * refresh and try again with a message that would never come true.
   */
  protected override assertWritable(current: PerformanceReviewDoc): void {
    if (current.status === 'finalized' || current.status === 'excused') {
      throw new BusinessRuleError(`a ${current.status} review is a record and cannot be changed`);
    }
  }

  async listFiltered(
    f: ReviewListFilter,
    query: {
      page: number;
      pageSize: number;
      sortBy?: string | undefined;
      sortDir?: 'asc' | 'desc' | undefined;
    },
    scope: ScopeSelector,
  ): Promise<Paginated<PerformanceReviewDoc>> {
    const clauses: FilterQuery<PerformanceReviewDoc>[] = [];
    if (f.cycleId !== undefined) clauses.push({ cycleId: new Types.ObjectId(f.cycleId) });
    if (f.employeeId !== undefined) clauses.push({ employeeId: new Types.ObjectId(f.employeeId) });
    if (f.evaluatorId !== undefined)
      clauses.push({ evaluatorId: new Types.ObjectId(f.evaluatorId) });
    if (f.status !== undefined) clauses.push({ status: { $in: f.status } });
    if (f.branchId !== undefined) clauses.push({ branchId: new Types.ObjectId(f.branchId) });
    if (f.departmentId !== undefined) {
      clauses.push({ departmentId: new Types.ObjectId(f.departmentId) });
    }
    if (f.search !== undefined && f.search.trim() !== '') {
      const pattern = escaped(f.search);
      clauses.push({ $or: [{ employeeName: pattern }, { employeeCode: pattern }] });
    }
    return this.list({
      filter: (clauses.length === 0 ? {} : { $and: clauses }) as FilterQuery<PerformanceReviewDoc>,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['employeeCode', 'createdAt'],
      scope,
    });
  }

  /**
   * Open one review, and say whether this call is what opened it.
   *
   * `$setOnInsert` and nothing else, which is what makes materialization idempotent: a second run
   * over a round somebody has already worked on finds the row and writes NOTHING — not the status,
   * not the evaluator, and above all not the rating. The alternative, an upsert with `$set`, would
   * turn every retried open into an assessment being replaced by a blank one, silently, with the
   * `updatedAt` stamp as the only trace.
   *
   * The boolean is `upsertedCount`, so the caller's «created» is the database's answer rather than
   * a count of rows it hoped were new.
   */
  async openForEmployee(
    cycleId: string,
    employeeId: string,
    fields: Pick<
      PerformanceReviewDoc,
      | 'cycleName'
      | 'employeeCode'
      | 'employeeName'
      | 'evaluatorId'
      | 'evaluatorName'
      | 'branchId'
      | 'departmentId'
    >,
    by: string,
  ): Promise<boolean> {
    const stamp = new Types.ObjectId(by);
    const result = await PerformanceReviewModel.updateOne(
      {
        cycleId: new Types.ObjectId(cycleId),
        employeeId: new Types.ObjectId(employeeId),
        isDeleted: false,
      },
      {
        $setOnInsert: {
          cycleId: new Types.ObjectId(cycleId),
          employeeId: new Types.ObjectId(employeeId),
          ...fields,
          status: 'draft',
          rating: null,
          submittedAt: null,
          submittedBy: null,
          finalizedAt: null,
          finalizedBy: null,
          excusedAt: null,
          excusedBy: null,
          excusedReason: null,
          createdBy: stamp,
          updatedBy: stamp,
        },
      },
      { upsert: true },
    ).exec();
    return result.upsertedCount > 0;
  }

  /** Every live row in this round. The cycle's `reviewCount` is this, never a hoped-for total. */
  async countInCycle(cycleId: string): Promise<number> {
    return PerformanceReviewModel.countDocuments({
      cycleId: new Types.ObjectId(cycleId),
      isDeleted: false,
    }).exec();
  }

  /**
   * How many rows in this round have NOT reached a terminal state (§4).
   *
   * Counted rather than listed because the close guard's answer is a number, and its refusal says
   * that number: «17 reviews are still open» tells somebody what to go and do, where «cannot close»
   * tells them only that they may not.
   *
   * UNSCOPED, deliberately. This is the round's own arithmetic, not a read of people — a branch
   * manager closing nothing must still not be told a round is closable because the reviews they
   * cannot see happen to be finished.
   */
  async countUnfinished(cycleId: string): Promise<number> {
    return PerformanceReviewModel.countDocuments({
      cycleId: new Types.ObjectId(cycleId),
      status: { $nin: ['finalized', 'excused'] },
      isDeleted: false,
    }).exec();
  }
}

/**
 * The goal. BOTH AXES, stamped from the REVIEW it hangs off (D14).
 *
 * Fifth collection in this codebase to carry the requirement, and the fourth spec to hold it —
 * stamped from the review rather than re-read from the employee, because the review is the row
 * that already settled which person this is and where they sit. Reading the employee again would
 * be a second answer to a question already answered, and a goal created the week after a transfer
 * would silently disagree with the review it belongs to.
 */
class PerformanceGoalRepository extends BaseRepository<PerformanceGoalDoc> {
  constructor() {
    super(PerformanceGoalModel, {
      branchField: 'branchId',
      departmentField: 'departmentId',
      softDelete: true,
    });
  }

  async listFiltered(
    f: GoalListFilter,
    query: {
      page: number;
      pageSize: number;
      sortBy?: string | undefined;
      sortDir?: 'asc' | 'desc' | undefined;
    },
    scope: ScopeSelector,
  ): Promise<Paginated<PerformanceGoalDoc>> {
    const clauses: FilterQuery<PerformanceGoalDoc>[] = [];
    if (f.reviewId !== undefined) clauses.push({ reviewId: new Types.ObjectId(f.reviewId) });
    if (f.cycleId !== undefined) clauses.push({ cycleId: new Types.ObjectId(f.cycleId) });
    if (f.employeeId !== undefined) clauses.push({ employeeId: new Types.ObjectId(f.employeeId) });
    if (f.status !== undefined) clauses.push({ status: { $in: f.status } });
    if (f.search !== undefined && f.search.trim() !== '') {
      const pattern = escaped(f.search);
      clauses.push({ $or: [{ title: pattern }, { employeeName: pattern }] });
    }
    return this.list({
      filter: (clauses.length === 0 ? {} : { $and: clauses }) as FilterQuery<PerformanceGoalDoc>,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['dueAt', 'createdAt'],
      scope,
    });
  }
}

export const performanceCycleRepository = new PerformanceCycleRepository();
export const performanceReviewRepository = new PerformanceReviewRepository();
export const performanceGoalRepository = new PerformanceGoalRepository();
