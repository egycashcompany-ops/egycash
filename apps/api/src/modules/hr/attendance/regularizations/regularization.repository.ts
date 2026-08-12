// The read seam for the AT-6 queue. Writes still go through the model directly (the service owns
// the status/version-conditional updates that make the two-step chain race-safe); this exists for
// the SCOPED reads, where BaseRepository is the only place data scopes are enforced (ADR-004).
import { Types, type FilterQuery } from 'mongoose';
import { type ListAttendanceRegularizationsQuery, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import {
  AttendanceRegularizationModel,
  type AttendanceRegularizationDoc,
} from './regularization.model';

class RegularizationRepository extends BaseRepository<AttendanceRegularizationDoc> {
  constructor() {
    super(AttendanceRegularizationModel, { branchField: 'branchId' });
  }

  private buildFilter(
    query: ListAttendanceRegularizationsQuery,
  ): FilterQuery<AttendanceRegularizationDoc> {
    const filter: FilterQuery<AttendanceRegularizationDoc> = {};
    if (query.status !== undefined) filter.status = query.status;
    if (query.employeeId !== undefined) filter.employeeId = new Types.ObjectId(query.employeeId);
    if (query.branchId !== undefined) filter.branchId = new Types.ObjectId(query.branchId);
    if (query.from !== undefined || query.to !== undefined) {
      filter.workDate = {
        ...(query.from === undefined ? {} : { $gte: query.from }),
        ...(query.to === undefined ? {} : { $lte: query.to }),
      };
    }
    return filter;
  }

  async listRegularizations(
    query: ListAttendanceRegularizationsQuery,
    scope?: ScopeSelector,
  ): Promise<Paginated<AttendanceRegularizationDoc>> {
    return this.list({
      filter: this.buildFilter(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'createdAt',
      sortDir: query.sortDir ?? 'desc',
      sortableFields: ['createdAt', 'workDate', 'status'],
      ...(scope === undefined ? {} : { scope }),
    });
  }

  /** The manager half of the worklist: these employees' requests awaiting the MANAGER step. */
  async findPendingManagerFor(employeeIds: string[]): Promise<AttendanceRegularizationDoc[]> {
    return this.model
      .find({
        employeeId: { $in: employeeIds.map((id) => new Types.ObjectId(id)) },
        status: 'pendingManager',
        isDeleted: false,
      })
      .lean<AttendanceRegularizationDoc[]>()
      .exec();
  }

  /**
   * The HR half: everything still pending inside the caller's scope. Both steps, because a
   * `decideRegularization` holder is also the manager step's deadlock escape (R9) — approving
   * there still advances to `pendingHr` rather than to `approved`.
   */
  async findPendingScoped(scope: ScopeSelector): Promise<AttendanceRegularizationDoc[]> {
    return this.model
      .find(
        this.baseFilter(scope, {
          status: { $in: ['pendingManager', 'pendingHr'] },
        } as FilterQuery<AttendanceRegularizationDoc>),
      )
      .lean<AttendanceRegularizationDoc[]>()
      .exec();
  }
}

export const regularizationRepository = new RegularizationRepository();
