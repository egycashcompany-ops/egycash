import { Types, type FilterQuery } from 'mongoose';
import { type ListPunchesQuery, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { AttendancePunchModel, type AttendancePunchDoc } from './punch.model';

class PunchRepository extends BaseRepository<AttendancePunchDoc> {
  constructor() {
    // Evidence never soft-deletes (D9); scope rides the punch's own branch for list reads.
    super(AttendancePunchModel, { branchField: 'branchIdAtPunch', softDelete: false });
  }

  async listPunches(query: ListPunchesQuery): Promise<Paginated<AttendancePunchDoc>> {
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
