// Interview data access (Stage 3). Branch-scoped via `branchId` so the platform
// own/branch/organization machinery (ADR-004, ADR-015) applies uniformly.
import { Types, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import { InterviewModel, type InterviewDoc } from './interview.model';

export interface InterviewListFilter {
  status?: string | undefined;
  outcome?: string | undefined;
  applicantId?: string | undefined;
  stageId?: string | undefined;
  interviewerId?: string | undefined;
  branchId?: string | undefined;
  scheduledFrom?: Date | undefined;
  scheduledTo?: Date | undefined;
}

/** Interviews at a stage that are not cancelled — i.e. that "occupy" the round. */
const ACTIVE_STATUSES = ['scheduled', 'completed'];

class InterviewRepository extends BaseRepository<InterviewDoc> {
  constructor() {
    super(InterviewModel, { branchField: 'branchId', softDelete: true });
  }

  /** A non-cancelled interview for this applicant at the given stage order, if any. */
  async findActiveAtStage(applicantId: string, stageOrder: number): Promise<InterviewDoc | null> {
    if (!Types.ObjectId.isValid(applicantId)) return null;
    return this.model
      .findOne({
        applicantId: new Types.ObjectId(applicantId),
        stageOrder,
        isDeleted: false,
        status: { $in: ACTIVE_STATUSES },
      })
      .lean<InterviewDoc>()
      .exec();
  }

  /** Whether the applicant has a passed interview at the given stage order. */
  async hasPassedStage(applicantId: string, stageOrder: number): Promise<boolean> {
    if (!Types.ObjectId.isValid(applicantId)) return false;
    const found = await this.model
      .exists({
        applicantId: new Types.ObjectId(applicantId),
        stageOrder,
        isDeleted: false,
        status: 'completed',
        outcome: 'passed',
      })
      .exec();
    return found !== null;
  }

  private buildFilter(f: InterviewListFilter): FilterQuery<InterviewDoc> {
    const clauses: FilterQuery<InterviewDoc>[] = [];
    if (f.status !== undefined) clauses.push({ status: f.status });
    if (f.outcome !== undefined) clauses.push({ outcome: f.outcome });
    if (f.applicantId !== undefined) clauses.push({ applicantId: new Types.ObjectId(f.applicantId) });
    if (f.stageId !== undefined) clauses.push({ stageId: new Types.ObjectId(f.stageId) });
    if (f.interviewerId !== undefined) {
      clauses.push({ interviewerIds: new Types.ObjectId(f.interviewerId) });
    }
    if (f.branchId !== undefined) clauses.push({ branchId: new Types.ObjectId(f.branchId) });
    if (f.scheduledFrom !== undefined || f.scheduledTo !== undefined) {
      const range: Record<string, Date> = {};
      if (f.scheduledFrom !== undefined) range.$gte = f.scheduledFrom;
      if (f.scheduledTo !== undefined) range.$lte = f.scheduledTo;
      clauses.push({ scheduledAt: range } as FilterQuery<InterviewDoc>);
    }
    if (clauses.length === 0) return {};
    if (clauses.length === 1) return clauses[0] as FilterQuery<InterviewDoc>;
    return { $and: clauses } as FilterQuery<InterviewDoc>;
  }

  async listInterviews(params: {
    filter: InterviewListFilter;
    page: number;
    pageSize: number;
    sortBy?: string | undefined;
    sortDir?: 'asc' | 'desc' | undefined;
    scope?: ScopeSelector | undefined;
  }): Promise<Paginated<InterviewDoc>> {
    return this.list({
      filter: this.buildFilter(params.filter),
      page: params.page,
      pageSize: params.pageSize,
      sortBy: params.sortBy,
      sortDir: params.sortDir,
      sortableFields: ['scheduledAt', 'createdAt', 'stageOrder'],
      ...(params.scope === undefined ? {} : { scope: params.scope }),
    });
  }
}

export const interviewRepository = new InterviewRepository();
