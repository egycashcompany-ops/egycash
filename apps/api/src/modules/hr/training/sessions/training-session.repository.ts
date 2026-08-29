// Session data access.
//
// BRANCH ONLY, and it is declared rather than forgotten. A session is held somewhere and belongs to
// that branch; it belongs to no department, because the people in the room come from several — so
// there is no department axis to declare here and `training-scope-guards.spec.ts` says so, beside
// the enrollment collection where the axis DOES belong. An undeclared field that ought to exist is
// the silent widening P-SCOPE-1 and F-REQ-1 were each written to catch.
import { Types, type FilterQuery } from 'mongoose';
import { type Paginated, type TrainingSessionStatus } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import { TrainingSessionModel, type TrainingSessionDoc } from './training-session.model';

export interface TrainingSessionListFilter {
  status?: readonly TrainingSessionStatus[] | undefined;
  courseId?: string | undefined;
  branchId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  search?: string | undefined;
}

class TrainingSessionRepository extends BaseRepository<TrainingSessionDoc> {
  constructor() {
    super(TrainingSessionModel, { branchField: 'branchId', softDelete: true });
  }

  async findByCode(code: string): Promise<TrainingSessionDoc | null> {
    return TrainingSessionModel.findOne({ code, isDeleted: false })
      .lean<TrainingSessionDoc>()
      .exec();
  }

  /**
   * Which of these sessions have NOT finished by `asOf` (P-HR-SEP D6) — ids in, ids out.
   *
   * THE CUTOFF IS THE SESSION'S END, NOT THE EXIT DATE, and the difference is a person who left on
   * the 20th and sat in a room on the 12th. Their seat there is history; the one on the 25th is a
   * booking for a chair nobody will fill. Comparing against the exit would take back both.
   */
  async listUnfinishedIdsSystem(ids: readonly string[], asOf: Date): Promise<Set<string>> {
    const valid = ids.filter((id) => Types.ObjectId.isValid(id));
    if (valid.length === 0) return new Set<string>();
    const rows = await TrainingSessionModel.find(
      { _id: { $in: valid.map((id) => new Types.ObjectId(id)) }, endsAt: { $gt: asOf } },
      { _id: 1 },
    )
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    return new Set(rows.map((row) => String(row._id)));
  }

  /** Does anything still point at this course? Deactivation is allowed; orphaning history is not. */
  async countLiveForCourse(courseId: string): Promise<number> {
    if (!Types.ObjectId.isValid(courseId)) return 0;
    return TrainingSessionModel.countDocuments({
      courseId: new Types.ObjectId(courseId),
      isDeleted: false,
      status: { $in: ['scheduled', 'running'] },
    }).exec();
  }

  async listFiltered(
    f: TrainingSessionListFilter,
    query: { page: number; pageSize: number; sortBy?: string | undefined; sortDir?: 'asc' | 'desc' | undefined },
    scope: ScopeSelector,
  ): Promise<Paginated<TrainingSessionDoc>> {
    const clauses: FilterQuery<TrainingSessionDoc>[] = [];
    if (f.status !== undefined) clauses.push({ status: { $in: f.status } });
    if (f.courseId !== undefined) clauses.push({ courseId: new Types.ObjectId(f.courseId) });
    if (f.branchId !== undefined) clauses.push({ branchId: new Types.ObjectId(f.branchId) });
    // A session OVERLAPS the window rather than starting inside it: a two-day course that began
    // yesterday is running today, and a reader asking «what is on this week» means to see it.
    if (f.from !== undefined) clauses.push({ endsAt: { $gte: f.from } });
    if (f.to !== undefined) clauses.push({ startsAt: { $lte: f.to } });
    if (f.search !== undefined && f.search.trim() !== '') {
      const pattern = new RegExp(f.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      clauses.push({
        $or: [
          { code: pattern },
          { courseKey: pattern },
          { 'courseName.ar': pattern },
          { 'courseName.en': pattern },
          { location: pattern },
          { trainerName: pattern },
        ],
      });
    }
    return this.list({
      filter: clauses.length === 0 ? {} : { $and: clauses },
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'startsAt',
      sortDir: query.sortDir ?? 'desc',
      sortableFields: ['startsAt', 'endsAt', 'code', 'status', 'createdAt'],
      scope,
    });
  }
}

export const trainingSessionRepository = new TrainingSessionRepository();
