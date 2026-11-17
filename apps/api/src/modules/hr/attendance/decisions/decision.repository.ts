// The read seam for the decisions queue and the accountability list. Writes go through the model
// directly — the service owns the status- and version-conditional updates that make the approval
// race-safe — and this exists for the SCOPED reads, where BaseRepository is the only place data
// scopes are enforced (ADR-004).
import { Types, type FilterQuery } from 'mongoose';
import {
  type AttendanceDecisionSignalsQuery,
  type ListAttendanceDecisionsQuery,
  type Paginated,
} from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import { orgScopeMatch } from '../../../../shared/base/org-scope-match';
import { AttendanceDecisionModel, type AttendanceDecisionDoc } from './decision.model';

class DecisionRepository extends BaseRepository<AttendanceDecisionDoc> {
  constructor() {
    super(AttendanceDecisionModel, { branchField: 'branchId' });
  }

  private buildFilter(query: ListAttendanceDecisionsQuery): FilterQuery<AttendanceDecisionDoc> {
    const filter: FilterQuery<AttendanceDecisionDoc> = {};
    // Lists, ORed within each — the queue asks for one status, the review screen for several.
    if (query.status !== undefined && query.status.length > 0) filter.status = { $in: query.status };
    if (query.type !== undefined && query.type.length > 0) filter.type = { $in: query.type };
    if (query.employeeId !== undefined) filter.employeeId = new Types.ObjectId(query.employeeId);
    if (query.branchId !== undefined && query.branchId.length > 0) {
      filter.branchId = { $in: query.branchId.map((id) => new Types.ObjectId(id)) };
    }
    // "Which days has this manager been deciding?" — the §4 accountability question, and the
    // reason `decidedBy` is indexed.
    if (query.decidedBy !== undefined) filter.decidedBy = new Types.ObjectId(query.decidedBy);
    if (query.from !== undefined || query.to !== undefined) {
      filter.workDate = {
        ...(query.from === undefined ? {} : { $gte: query.from }),
        ...(query.to === undefined ? {} : { $lte: query.to }),
      };
    }
    return filter;
  }

  async listDecisions(
    query: ListAttendanceDecisionsQuery,
    scope?: ScopeSelector,
  ): Promise<Paginated<AttendanceDecisionDoc>> {
    return this.list({
      filter: this.buildFilter(query),
      page: query.page,
      pageSize: query.pageSize,
      // Newest first: a queue is worked from the top, and a review reads as a history.
      sortBy: 'createdAt',
      sortDir: query.sortDir ?? 'desc',
      sortableFields: ['createdAt', 'workDate'],
      ...(scope === undefined ? {} : { scope }),
    });
  }

  /**
   * Decisions per manager over a window — one grouped pass, not a page counted in the client.
   *
   * `revoke` rows are excluded: undoing a decision is not a second decision about the day, and
   * counting it would make a manager who corrected their own mistake look busier than one who left
   * it standing.
   *
   * The caller's data scope is applied here the way the list applies it, because this read answers
   * the same question over the same rows — a branch manager's review shows their branch.
   */
  async countByDecider(
    query: AttendanceDecisionSignalsQuery,
    scope?: ScopeSelector,
  ): Promise<{ decidedBy: string; total: number; overrodePunch: number }[]> {
    const filter: FilterQuery<AttendanceDecisionDoc> = {
      workDate: { $gte: query.from, $lte: query.to },
      type: { $ne: 'revoke' },
      decidedBy: { $ne: null },
      isDeleted: false,
    };
    if (query.branchId !== undefined && query.branchId.length > 0) {
      filter.branchId = { $in: query.branchId.map((id) => new Types.ObjectId(id)) };
    }
    const reach = scope === undefined ? null : orgScopeMatch(scope, { branch: 'branchId' }, { finerNarrowsToBranch: true });
    const match = reach == null ? filter : ({ $and: [filter, reach] } as FilterQuery<AttendanceDecisionDoc>);

    const rows = await AttendanceDecisionModel.aggregate<{
      _id: Types.ObjectId;
      total: number;
      overrodePunch: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: '$decidedBy',
          total: { $sum: 1 },
          overrodePunch: { $sum: { $cond: ['$overrodePunch', 1, 0] } },
        },
      },
    ]).exec();
    return rows.map((row) => ({
      decidedBy: String(row._id),
      total: row.total,
      overrodePunch: row.overrodePunch,
    }));
  }
}

export const decisionRepository = new DecisionRepository();
