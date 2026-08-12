import { Types, type FilterQuery } from 'mongoose';
import { type ListAttendanceDaysQuery, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { BusinessRuleError } from '../../../../shared/errors';
import { type ScopeSelector } from '../../../../shared/types';
import { AttendanceDayModel, type AttendanceDayDoc } from './day-record.model';

class DayRecordRepository extends BaseRepository<AttendanceDayDoc> {
  constructor() {
    super(AttendanceDayModel, { branchField: 'branchId' });
  }

  /**
   * The §4 freeze guard, on EVERY write through this seam (AT-5): the condition rides inside the
   * same atomic update, so a freeze landing between a read and its write is never overtaken —
   * the same discipline the engine's upsert has carried since AT-3.
   */
  protected override writeConditions(): FilterQuery<AttendanceDayDoc> {
    return { frozenAt: null };
  }

  protected override assertWritable(current: AttendanceDayDoc): void {
    if (current.frozenAt !== null) {
      throw new BusinessRuleError(
        'this day is frozen — corrections flow forward as adjustments, never as restatements',
      );
    }
  }

  async listDays(
    query: Omit<ListAttendanceDaysQuery, 'employeeId' | 'branchId'> &
      Partial<Pick<ListAttendanceDaysQuery, 'employeeId' | 'branchId'>>,
    options: { employeeIds?: string[] | undefined; scope?: ScopeSelector | undefined } = {},
  ): Promise<Paginated<AttendanceDayDoc>> {
    const filter: FilterQuery<AttendanceDayDoc> = {
      workDate: { $gte: query.from, $lte: query.to },
    };
    if (query.employeeId !== undefined) filter.employeeId = new Types.ObjectId(query.employeeId);
    if (query.branchId !== undefined) filter.branchId = new Types.ObjectId(query.branchId);
    if (query.status !== undefined) filter.status = query.status;
    // The section filter arrives pre-resolved to employee ids (day rows carry only the branch).
    // An explicit employeeId — including the own-scope forcing — always wins: the section can
    // only NARROW it to nothing, never widen it.
    if (options.employeeIds !== undefined) {
      if (query.employeeId !== undefined) {
        if (!options.employeeIds.includes(query.employeeId)) {
          filter.employeeId = { $in: [] };
        }
      } else {
        filter.employeeId = { $in: options.employeeIds.map((id) => new Types.ObjectId(id)) };
      }
    }
    return this.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: 'workDate',
      sortDir: 'desc',
      sortableFields: ['workDate', 'createdAt'],
      ...(options.scope === undefined ? {} : { scope: options.scope }),
    });
  }
}

export const dayRecordRepository = new DayRecordRepository();
