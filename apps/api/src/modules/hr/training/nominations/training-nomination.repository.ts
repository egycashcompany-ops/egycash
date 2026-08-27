// Nomination and enrollment data access.
//
// BOTH COLLECTIONS DECLARE BOTH AXES (D14). Each row is about a PERSON, so each is readable by
// whoever may read that person — and an undeclared scope field does not fail, does not warn and
// does not narrow: `scopeFilter` returns an empty filter and `baseFilter` drops it, which is how a
// department-scoped reader ends up served the whole organization. `training-scope-guards.spec.ts`
// holds both declarations.
import { Types, type FilterQuery } from 'mongoose';
import {
  type Paginated,
  type TrainingEnrollmentStatus,
  type TrainingNominationStatus,
} from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import { TrainingNominationModel, type TrainingNominationDoc } from './training-nomination.model';
import { TrainingEnrollmentModel, type TrainingEnrollmentDoc } from './training-enrollment.model';

export interface NominationListFilter {
  status?: readonly TrainingNominationStatus[] | undefined;
  sessionId?: string | undefined;
  employeeId?: string | undefined;
  search?: string | undefined;
}

class TrainingNominationRepository extends BaseRepository<TrainingNominationDoc> {
  constructor() {
    super(TrainingNominationModel, {
      branchField: 'branchId',
      departmentField: 'departmentId',
      softDelete: true,
    });
  }

  /** The one that would collide with a new request — see the model's partial unique index. */
  async findLive(employeeId: string, sessionId: string): Promise<TrainingNominationDoc | null> {
    if (!Types.ObjectId.isValid(employeeId) || !Types.ObjectId.isValid(sessionId)) return null;
    return TrainingNominationModel.findOne({
      employeeId: new Types.ObjectId(employeeId),
      sessionId: new Types.ObjectId(sessionId),
      status: { $in: ['draft', 'pendingApproval'] },
      isDeleted: false,
    })
      .lean<TrainingNominationDoc>()
      .exec();
  }

  async listFiltered(
    f: NominationListFilter,
    query: { page: number; pageSize: number; sortBy?: string | undefined; sortDir?: 'asc' | 'desc' | undefined },
    scope: ScopeSelector,
  ): Promise<Paginated<TrainingNominationDoc>> {
    const clauses: FilterQuery<TrainingNominationDoc>[] = [];
    if (f.status !== undefined) clauses.push({ status: { $in: f.status } });
    if (f.sessionId !== undefined) clauses.push({ sessionId: new Types.ObjectId(f.sessionId) });
    if (f.employeeId !== undefined) clauses.push({ employeeId: new Types.ObjectId(f.employeeId) });
    if (f.search !== undefined && f.search.trim() !== '') {
      const pattern = new RegExp(f.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      clauses.push({
        $or: [
          { employeeCode: pattern },
          { employeeName: pattern },
          { sessionCode: pattern },
          { courseKey: pattern },
        ],
      });
    }
    return this.list({
      filter: clauses.length === 0 ? {} : { $and: clauses },
      page: query.page,
      pageSize: query.pageSize,
      // The soonest session first: a queue is worked by what is closest to happening, not by what
      // was typed most recently.
      sortBy: query.sortBy ?? 'sessionStartsAt',
      sortDir: query.sortDir ?? 'asc',
      sortableFields: ['sessionStartsAt', 'createdAt', 'status', 'employeeName'],
      scope,
    });
  }
}

class TrainingEnrollmentRepository extends BaseRepository<TrainingEnrollmentDoc> {
  constructor() {
    super(TrainingEnrollmentModel, {
      branchField: 'branchId',
      departmentField: 'departmentId',
      softDelete: true,
    });
  }

  /**
   * How many seats a session has taken (D5).
   *
   * COUNTED UNSCOPED, deliberately: capacity is a property of the ROOM, and a department-scoped
   * approver must not be told there is space because the people already in it are somebody else's
   * department. Scope decides what a reader may SEE; it may not decide how many chairs there are.
   */
  async countOccupied(sessionId: string): Promise<number> {
    if (!Types.ObjectId.isValid(sessionId)) return 0;
    return TrainingEnrollmentModel.countDocuments({
      sessionId: new Types.ObjectId(sessionId),
      status: { $ne: 'cancelled' },
      isDeleted: false,
    }).exec();
  }

  async findLive(employeeId: string, sessionId: string): Promise<TrainingEnrollmentDoc | null> {
    if (!Types.ObjectId.isValid(employeeId) || !Types.ObjectId.isValid(sessionId)) return null;
    return TrainingEnrollmentModel.findOne({
      employeeId: new Types.ObjectId(employeeId),
      sessionId: new Types.ObjectId(sessionId),
      status: { $ne: 'cancelled' },
      isDeleted: false,
    })
      .lean<TrainingEnrollmentDoc>()
      .exec();
  }

  async listFiltered(
    f: {
      sessionId?: string | undefined;
      employeeId?: string | undefined;
      status?: readonly TrainingEnrollmentStatus[] | undefined;
    },
    query: { page: number; pageSize: number; sortBy?: string | undefined; sortDir?: 'asc' | 'desc' | undefined },
    scope: ScopeSelector,
  ): Promise<Paginated<TrainingEnrollmentDoc>> {
    const clauses: FilterQuery<TrainingEnrollmentDoc>[] = [];
    if (f.sessionId !== undefined) clauses.push({ sessionId: new Types.ObjectId(f.sessionId) });
    if (f.employeeId !== undefined) clauses.push({ employeeId: new Types.ObjectId(f.employeeId) });
    if (f.status !== undefined) clauses.push({ status: { $in: f.status } });
    return this.list({
      filter: clauses.length === 0 ? {} : { $and: clauses },
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy ?? 'employeeName',
      sortDir: query.sortDir ?? 'asc',
      sortableFields: ['employeeName', 'enrolledAt', 'status'],
      scope,
    });
  }
}

export const trainingNominationRepository = new TrainingNominationRepository();
export const trainingEnrollmentRepository = new TrainingEnrollmentRepository();
