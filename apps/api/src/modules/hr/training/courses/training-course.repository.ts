// Catalogue data access. Organization-wide by design (see the model): a course belongs to the
// company, so there is no scope field to declare and none is silently missing.
import { type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { TrainingCourseModel, type TrainingCourseDoc } from './training-course.model';

class TrainingCourseRepository extends BaseRepository<TrainingCourseDoc> {
  constructor() {
    super(TrainingCourseModel, { softDelete: true });
  }

  async findByKey(key: string): Promise<TrainingCourseDoc | null> {
    return TrainingCourseModel.findOne({ key, isDeleted: false }).lean<TrainingCourseDoc>().exec();
  }

  async listFiltered(query: {
    page: number;
    pageSize: number;
    sortBy?: string | undefined;
    sortDir?: 'asc' | 'desc' | undefined;
    active?: boolean | undefined;
    search?: string | undefined;
  }): Promise<Paginated<TrainingCourseDoc>> {
    const filter: FilterQuery<TrainingCourseDoc> = {};
    if (query.active !== undefined) filter.active = query.active;
    if (query.search !== undefined && query.search.trim() !== '') {
      const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ key: pattern }, { 'name.ar': pattern }, { 'name.en': pattern }];
    }
    return this.list({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'order',
      sortDir: query.sortDir ?? 'asc',
      sortableFields: ['order', 'key', 'createdAt'],
    });
  }
}

export const trainingCourseRepository = new TrainingCourseRepository();
