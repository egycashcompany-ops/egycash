import { Types, type FilterQuery } from 'mongoose';
import { type ListShiftAssignmentsQuery, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { ShiftAssignmentModel, type ShiftAssignmentDoc } from './shift-assignment.model';

class ShiftAssignmentRepository extends BaseRepository<ShiftAssignmentDoc> {
  constructor() {
    super(ShiftAssignmentModel, { branchField: 'branchId' });
  }

  async findOpenForEmployee(employeeId: string): Promise<ShiftAssignmentDoc | null> {
    return this.model
      .findOne({ employeeId: new Types.ObjectId(employeeId), toDate: null, isDeleted: false })
      .lean<ShiftAssignmentDoc>()
      .exec();
  }

  async listAssignments(query: ListShiftAssignmentsQuery): Promise<Paginated<ShiftAssignmentDoc>> {
    const filter: FilterQuery<ShiftAssignmentDoc> = {};
    if (query.employeeId !== undefined) filter.employeeId = new Types.ObjectId(query.employeeId);
    if (query.shiftId !== undefined) filter.shiftId = new Types.ObjectId(query.shiftId);
    if (query.activeOn !== undefined) {
      filter.fromDate = { $lte: query.activeOn };
      filter.$or = [{ toDate: null }, { toDate: { $gte: query.activeOn } }];
    }
    return this.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: 'fromDate',
      sortDir: 'desc',
      sortableFields: ['fromDate', 'createdAt'],
    });
  }
}

export const shiftAssignmentRepository = new ShiftAssignmentRepository();
