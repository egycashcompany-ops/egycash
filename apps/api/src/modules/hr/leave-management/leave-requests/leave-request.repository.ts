// Leave request data access. Scoped by the denormalized placement fields; `own` additionally
// matches the SUBJECT employee's user through `ownerUserField` (C1-R) — the standard
// repo.list({scope}) idiom stays correct for self-service.
import { Types, type FilterQuery } from 'mongoose';
import {
  LEAVE_BLOCKING_STATUSES,
  LEAVE_PENDING_STATUSES,
  type ListLeaveRequestsQuery,
  type Paginated,
} from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import { LeaveRequestModel, type LeaveRequestDoc, type LeaveRequestEntity } from './leave-request.model';

class LeaveRequestRepository extends BaseRepository<LeaveRequestDoc> {
  constructor() {
    super(LeaveRequestModel, {
      branchField: 'branchId',
      departmentField: 'departmentId',
      sectionField: 'sectionId',
      ownerUserField: 'employeeUserId',
      softDelete: true,
    });
  }

  /** Hydrated (save-able) doc for lifecycle mutations. Unscoped — callers authorize first. */
  async findRawById(id: string): Promise<LeaveRequestEntity | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model.findOne({ _id: new Types.ObjectId(id), isDeleted: false }).exec();
  }

  /** Blocking requests of an employee overlapping [from, to], excluding one id (R2 recheck). */
  async findOverlapping(
    employeeId: string,
    from: Date,
    to: Date,
    excludeId?: string,
  ): Promise<LeaveRequestDoc[]> {
    const filter: FilterQuery<LeaveRequestDoc> = {
      employeeId: new Types.ObjectId(employeeId),
      status: { $in: [...LEAVE_BLOCKING_STATUSES] },
      startDate: { $lte: to },
      endDate: { $gte: from },
      isDeleted: false,
    };
    if (excludeId !== undefined) filter._id = { $ne: new Types.ObjectId(excludeId) };
    return this.model.find(filter).sort({ _id: 1 }).lean<LeaveRequestDoc[]>().exec();
  }

  /** Approved requests whose Cairo start date has arrived (activation task). */
  async findDueToActivate(today: Date): Promise<LeaveRequestEntity[]> {
    return this.model
      .find({ status: 'approved', startDate: { $lte: today }, isDeleted: false })
      .sort({ startDate: 1 })
      .exec();
  }

  /** Active requests whose Cairo end date has passed (completion task). */
  async findDueToComplete(today: Date): Promise<LeaveRequestEntity[]> {
    return this.model
      .find({ status: 'active', endDate: { $lt: today }, isDeleted: false })
      .sort({ endDate: 1 })
      .exec();
  }

  /** Pending requests created before the reminder cutoff (SLA nudge task). */
  async findPendingSince(cutoff: Date): Promise<LeaveRequestDoc[]> {
    return this.model
      .find({
        status: { $in: [...LEAVE_PENDING_STATUSES] },
        createdAt: { $lte: cutoff },
        isDeleted: false,
      })
      .lean<LeaveRequestDoc[]>()
      .exec();
  }

  /** Non-terminal requests of one employee (exit settlement, R12). */
  async findOpenForEmployee(employeeId: string): Promise<LeaveRequestEntity[]> {
    return this.model
      .find({
        employeeId: new Types.ObjectId(employeeId),
        status: { $in: [...LEAVE_BLOCKING_STATUSES] },
        isDeleted: false,
      })
      .exec();
  }

  /** pendingManager requests whose subject is one of the given employees (manager queue). */
  async findPendingManagerFor(employeeIds: string[]): Promise<LeaveRequestDoc[]> {
    if (employeeIds.length === 0) return [];
    return this.model
      .find({
        status: 'pendingManager',
        employeeId: { $in: employeeIds.map((id) => new Types.ObjectId(id)) },
        isDeleted: false,
      })
      .sort({ createdAt: 1 })
      .lean<LeaveRequestDoc[]>()
      .exec();
  }

  /** Any pending request within a scope (the HR queue). */
  async findPendingScoped(scope: ScopeSelector | undefined): Promise<LeaveRequestDoc[]> {
    const filter: FilterQuery<LeaveRequestDoc> = {
      status: { $in: [...LEAVE_PENDING_STATUSES] },
      isDeleted: false,
    };
    return this.model
      .find(scope === undefined ? filter : { $and: [filter, this.scopeFilter(scope)] })
      .sort({ createdAt: 1 })
      .lean<LeaveRequestDoc[]>()
      .exec();
  }

  /** Approved/active spans crossing a range (team calendar + Attendance read). */
  async findSpansInRange(from: Date, to: Date, scope: ScopeSelector | undefined): Promise<LeaveRequestDoc[]> {
    const filter: FilterQuery<LeaveRequestDoc> = {
      status: { $in: ['approved', 'active', 'completed'] },
      startDate: { $lte: to },
      endDate: { $gte: from },
      isDeleted: false,
    };
    return this.model
      .find(scope === undefined ? filter : { $and: [filter, this.scopeFilter(scope)] })
      .sort({ startDate: 1 })
      .limit(1000)
      .lean<LeaveRequestDoc[]>()
      .exec();
  }

  /** Occasions of a type ever REQUESTED by an employee in non-failed states (per-service caps). */
  async countOccasions(employeeId: string, typeId: string): Promise<number> {
    return this.model
      .countDocuments({
        employeeId: new Types.ObjectId(employeeId),
        typeId: new Types.ObjectId(typeId),
        status: { $in: [...LEAVE_BLOCKING_STATUSES, 'completed'] },
        isDeleted: false,
      })
      .exec();
  }

  private buildFilter(q: ListLeaveRequestsQuery): FilterQuery<LeaveRequestDoc> {
    const clauses: FilterQuery<LeaveRequestDoc>[] = [];
    if (q.status !== undefined) clauses.push({ status: q.status });
    if (q.typeId !== undefined) clauses.push({ typeId: new Types.ObjectId(q.typeId) });
    if (q.employeeId !== undefined) clauses.push({ employeeId: new Types.ObjectId(q.employeeId) });
    if (q.from !== undefined) clauses.push({ endDate: { $gte: q.from } });
    if (q.to !== undefined) clauses.push({ startDate: { $lte: q.to } });
    if (clauses.length === 0) return {};
    if (clauses.length === 1) return clauses[0] as FilterQuery<LeaveRequestDoc>;
    return { $and: clauses } as FilterQuery<LeaveRequestDoc>;
  }

  async listRequests(
    query: ListLeaveRequestsQuery,
    scope: ScopeSelector | undefined,
  ): Promise<Paginated<LeaveRequestDoc>> {
    return this.list({
      filter: this.buildFilter(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'createdAt',
      sortDir: query.sortDir ?? 'desc',
      sortableFields: ['createdAt', 'startDate'],
      ...(scope === undefined ? {} : { scope }),
    });
  }
}

export const leaveRequestRepository = new LeaveRequestRepository();
