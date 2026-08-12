import { Types, type FilterQuery } from 'mongoose';
import { type ListAttendanceDaysQuery, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { AttendanceDayModel, type AttendanceDayDoc } from './day-record.model';

class DayRecordRepository extends BaseRepository<AttendanceDayDoc> {
  constructor() {
    super(AttendanceDayModel, { branchField: 'branchId' });
  }

  async listDays(
    query: Omit<ListAttendanceDaysQuery, 'employeeId' | 'branchId'> &
      Partial<Pick<ListAttendanceDaysQuery, 'employeeId' | 'branchId'>>,
  ): Promise<Paginated<AttendanceDayDoc>> {
    const filter: FilterQuery<AttendanceDayDoc> = {
      workDate: { $gte: query.from, $lte: query.to },
    };
    if (query.employeeId !== undefined) filter.employeeId = new Types.ObjectId(query.employeeId);
    if (query.branchId !== undefined) filter.branchId = new Types.ObjectId(query.branchId);
    if (query.status !== undefined) filter.status = query.status;
    return this.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: 'workDate',
      sortDir: 'desc',
      sortableFields: ['workDate', 'createdAt'],
    });
  }
}

export const dayRecordRepository = new DayRecordRepository();
