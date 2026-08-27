// Record data access. Both axes declared (D14): a record is about a person.
import { Types, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import { TrainingRecordModel, type TrainingRecordDoc } from './training-record.model';

class TrainingRecordRepository extends BaseRepository<TrainingRecordDoc> {
  constructor() {
    super(TrainingRecordModel, {
      branchField: 'branchId',
      departmentField: 'departmentId',
      softDelete: true,
    });
  }

  async listFiltered(
    f: {
      employeeId?: string | undefined;
      courseId?: string | undefined;
      sessionId?: string | undefined;
      search?: string | undefined;
    },
    query: { page: number; pageSize: number; sortBy?: string | undefined; sortDir?: 'asc' | 'desc' | undefined },
    scope: ScopeSelector,
  ): Promise<Paginated<TrainingRecordDoc>> {
    const clauses: FilterQuery<TrainingRecordDoc>[] = [];
    if (f.employeeId !== undefined) clauses.push({ employeeId: new Types.ObjectId(f.employeeId) });
    if (f.courseId !== undefined) clauses.push({ courseId: new Types.ObjectId(f.courseId) });
    if (f.sessionId !== undefined) clauses.push({ sessionId: new Types.ObjectId(f.sessionId) });
    if (f.search !== undefined && f.search.trim() !== '') {
      const pattern = new RegExp(f.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      clauses.push({
        $or: [
          { employeeCode: pattern },
          { employeeName: pattern },
          { courseKey: pattern },
          { courseNameAr: pattern },
          { courseNameEn: pattern },
          { sessionCode: pattern },
        ],
      });
    }
    return this.list({
      filter: clauses.length === 0 ? {} : { $and: clauses },
      page: query.page,
      pageSize: query.pageSize,
      // Newest first: a training history is read from what happened most recently backwards.
      sortBy: query.sortBy ?? 'completedAt',
      sortDir: query.sortDir ?? 'desc',
      sortableFields: ['completedAt', 'employeeName', 'courseKey'],
      scope,
    });
  }
}

export const trainingRecordRepository = new TrainingRecordRepository();
