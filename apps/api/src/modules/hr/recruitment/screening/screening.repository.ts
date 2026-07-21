// Screening data access (Sprint 4.2, Stage 2). Branch-scoped via `branchId` so the
// platform own/branch/organization machinery (ADR-004, ADR-015) applies uniformly.
import { Types, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import { ScreeningModel, type ScreeningDoc } from './screening.model';

export interface ScreeningListFilter {
  status?: string | undefined;
  applicantId?: string | undefined;
  branchId?: string | undefined;
  decidedFrom?: Date | undefined;
  decidedTo?: Date | undefined;
  createdFrom?: Date | undefined;
  createdTo?: Date | undefined;
}

class ScreeningRepository extends BaseRepository<ScreeningDoc> {
  constructor() {
    super(ScreeningModel, { branchField: 'branchId', softDelete: true });
  }

  /** The live screening for an applicant, if any (one per applicant). */
  async findByApplicantId(applicantId: string): Promise<ScreeningDoc | null> {
    if (!Types.ObjectId.isValid(applicantId)) return null;
    return this.model
      .findOne({ applicantId: new Types.ObjectId(applicantId), isDeleted: false })
      .lean<ScreeningDoc>()
      .exec();
  }

  /** Of the given applicant ids, those that already have a screening — for the "awaiting" view. */
  async applicantIdsWithScreening(ids: string[]): Promise<Set<string>> {
    const objectIds = ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    if (objectIds.length === 0) return new Set();
    const rows = await this.model
      .find({ applicantId: { $in: objectIds }, isDeleted: false })
      .select('applicantId')
      .lean<{ applicantId: Types.ObjectId }[]>()
      .exec();
    return new Set(rows.map((r) => String(r.applicantId)));
  }

  /** Accepted screenings (most-recently-decided first) — the interview-eligibility read model. */
  async listAccepted(
    limit: number,
    branchId: string | undefined,
    scope?: ScopeSelector,
  ): Promise<ScreeningDoc[]> {
    const extra: FilterQuery<ScreeningDoc> = { status: 'accepted', isDeleted: false };
    if (branchId !== undefined && Types.ObjectId.isValid(branchId)) {
      extra.branchId = new Types.ObjectId(branchId);
    }
    return this.model
      .find(this.baseFilter(scope, extra))
      .sort({ decidedAt: -1 })
      .limit(limit)
      .lean<ScreeningDoc[]>()
      .exec();
  }

  private buildFilter(f: ScreeningListFilter): FilterQuery<ScreeningDoc> {
    const clauses: FilterQuery<ScreeningDoc>[] = [];
    if (f.status !== undefined) clauses.push({ status: f.status });
    if (f.applicantId !== undefined) clauses.push({ applicantId: new Types.ObjectId(f.applicantId) });
    if (f.branchId !== undefined) clauses.push({ branchId: new Types.ObjectId(f.branchId) });
    if (f.decidedFrom !== undefined || f.decidedTo !== undefined) {
      const range: Record<string, Date> = {};
      if (f.decidedFrom !== undefined) range.$gte = f.decidedFrom;
      if (f.decidedTo !== undefined) range.$lte = f.decidedTo;
      clauses.push({ decidedAt: range } as FilterQuery<ScreeningDoc>);
    }
    if (f.createdFrom !== undefined || f.createdTo !== undefined) {
      const range: Record<string, Date> = {};
      if (f.createdFrom !== undefined) range.$gte = f.createdFrom;
      if (f.createdTo !== undefined) range.$lte = f.createdTo;
      clauses.push({ createdAt: range } as FilterQuery<ScreeningDoc>);
    }
    if (clauses.length === 0) return {};
    if (clauses.length === 1) return clauses[0] as FilterQuery<ScreeningDoc>;
    return { $and: clauses } as FilterQuery<ScreeningDoc>;
  }

  async listScreenings(params: {
    filter: ScreeningListFilter;
    page: number;
    pageSize: number;
    sortBy?: string | undefined;
    sortDir?: 'asc' | 'desc' | undefined;
    scope?: ScopeSelector | undefined;
  }): Promise<Paginated<ScreeningDoc>> {
    return this.list({
      filter: this.buildFilter(params.filter),
      page: params.page,
      pageSize: params.pageSize,
      sortBy: params.sortBy,
      sortDir: params.sortDir,
      sortableFields: ['createdAt', 'decidedAt', 'status'],
      ...(params.scope === undefined ? {} : { scope: params.scope }),
    });
  }
}

export const screeningRepository = new ScreeningRepository();
