// The read seam for the decisions queue and the accountability list. Writes go through the model
// directly — the service owns the status- and version-conditional updates that make the approval
// race-safe — and this exists for the SCOPED reads, where BaseRepository is the only place data
// scopes are enforced (ADR-004).
import { Types, type FilterQuery } from 'mongoose';
import { type ListAttendanceDecisionsQuery, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
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
}

export const decisionRepository = new DecisionRepository();
