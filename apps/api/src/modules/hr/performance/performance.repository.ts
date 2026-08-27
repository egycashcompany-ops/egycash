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
  type PerformanceReviewStatus,
} from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../shared/types';
import { PerformanceCycleModel, type PerformanceCycleDoc } from './cycles/performance-cycle.model';
import {
  PerformanceReviewModel,
  type PerformanceReviewDoc,
} from './reviews/performance-review.model';

export interface CycleListFilter {
  status?: readonly PerformanceCycleStatus[] | undefined;
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

export const performanceCycleRepository = new PerformanceCycleRepository();
export const performanceReviewRepository = new PerformanceReviewRepository();
