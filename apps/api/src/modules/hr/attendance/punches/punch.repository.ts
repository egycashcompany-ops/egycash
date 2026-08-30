import { Types, type FilterQuery } from 'mongoose';
import { type ListPunchesQuery, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import { AttendancePunchModel, type AttendancePunchDoc } from './punch.model';

class PunchRepository extends BaseRepository<AttendancePunchDoc> {
  constructor() {
    // Evidence never soft-deletes (D9).
    //
    // THE AXIS IS THE EMPLOYEE'S BRANCH, NOT THE PUNCH'S. Before AT-D1 this scoped on
    // `branchIdAtPunch`, which was harmless only because import stamped the employee's own branch
    // into it. D12.7 made that field record the DEVICE's location, so scoping on it would have
    // silently changed who reads what: a manager would gain other branches' people who punched on
    // their wall, and lose their own person who punched at head office. Reach follows the person.
    super(AttendancePunchModel, { branchField: 'employeeBranchId', softDelete: false });
  }

  /**
   * THE SCOPE IS PASSED, and before AT-D1 it was not.
   *
   * This method declared a branch axis on the class and then called `list` without a selector.
   * `baseFilter(undefined)` adds no clause, so the read returned every punch in the organization
   * to every caller holding `attendance.view` — a key the attendance migration grants to the
   * Employee Self-Service role. The declaration was there; nothing carried it to the query.
   *
   * It is fixed here rather than filed away because this phase is about that exact axis on that
   * exact collection, and shipping a change to which branch a punch records while leaving the read
   * unscoped would be indefensible.
   */
  async listPunches(
    query: ListPunchesQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<AttendancePunchDoc>> {
    const filter: FilterQuery<AttendancePunchDoc> = {};
    if (query.employeeId !== undefined) filter.employeeId = new Types.ObjectId(query.employeeId);
    if (query.source !== undefined) filter.source = query.source;
    if (query.importBatchId !== undefined) filter.importBatchId = query.importBatchId;
    if (query.from !== undefined || query.to !== undefined) {
      filter.at = {
        ...(query.from === undefined ? {} : { $gte: query.from }),
        ...(query.to === undefined ? {} : { $lte: query.to }),
      };
    }
    return this.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: 'at',
      sortDir: 'desc',
      sortableFields: ['at', 'createdAt'],
      scope,
    });
  }

  /** The engine's read: every punch for one employee inside a window, oldest first. */
  async listForWindow(
    employeeId: Types.ObjectId,
    from: Date,
    to: Date,
  ): Promise<AttendancePunchDoc[]> {
    return this.model
      .find({ employeeId, at: { $gte: from, $lte: to }, supersededBy: null })
      .sort({ at: 1 })
      .lean<AttendancePunchDoc[]>()
      .exec();
  }
}

export const punchRepository = new PunchRepository();
