// Job Offer data access (Stage 4). Branch-scoped via `branchId` so the platform
// own/branch/organization machinery (ADR-004, ADR-015) applies uniformly.
import { Types, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import { JobOfferModel, type JobOfferDoc } from './job-offer.model';

export interface JobOfferListFilter {
  status?: string | undefined;
  applicantId?: string | undefined;
  branchId?: string | undefined;

  search?: string | undefined;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class JobOfferRepository extends BaseRepository<JobOfferDoc> {
  constructor() {
    super(JobOfferModel, { branchField: 'branchId', softDelete: true });
  }

  /** The applicant's current LIVE (waiting/draft/sent) offer, if any. */
  async findActiveByApplicantId(applicantId: string): Promise<JobOfferDoc | null> {
    if (!Types.ObjectId.isValid(applicantId)) return null;
    return this.model
      .findOne({
        applicantId: new Types.ObjectId(applicantId),
        status: { $in: ['waiting', 'draft', 'sent'] },
        supersededAt: null,
        isDeleted: false,
      })
      .lean<JobOfferDoc>()
      .exec();
  }

  /** The applicant's accepted offer, if any (the Employee-Creation gate for Stage 5). */
  async findAcceptedByApplicantId(applicantId: string): Promise<JobOfferDoc | null> {
    if (!Types.ObjectId.isValid(applicantId)) return null;
    return this.model
      .findOne({ applicantId: new Types.ObjectId(applicantId), status: 'accepted', isDeleted: false })
      .lean<JobOfferDoc>()
      .exec();
  }

  /**
   * Among `applicantIds`, the ones holding an offer that BLOCKS drafting a new one —
   * a live (waiting/draft/sent) offer or an accepted one. Feeds the awaiting-offer queue.
   */
  async applicantIdsWithBlockingOffer(applicantIds: string[]): Promise<Set<string>> {
    const objectIds = applicantIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (objectIds.length === 0) return new Set();
    const rows = await this.model
      .find({
        applicantId: { $in: objectIds },
        isDeleted: false,
        $or: [{ status: { $in: ['waiting', 'draft', 'sent'] } }, { status: 'accepted' }],
      })
      .select('applicantId')
      .lean<{ applicantId: Types.ObjectId }[]>()
      .exec();
    return new Set(rows.map((r) => String(r.applicantId)));
  }

  /** Sent offers whose validity has lapsed as of `asOf` — the automatic-expiration sweep. */
  async findOverdueSent(asOf: Date, limit = 500): Promise<JobOfferDoc[]> {
    return this.model
      .find({ status: 'sent', isDeleted: false, 'terms.validUntil': { $lte: asOf } })
      .limit(limit)
      .lean<JobOfferDoc[]>()
      .exec();
  }

  private buildFilter(f: JobOfferListFilter): FilterQuery<JobOfferDoc> {
    const clauses: FilterQuery<JobOfferDoc>[] = [];
    if (f.status !== undefined) clauses.push({ status: f.status });
    if (f.applicantId !== undefined) clauses.push({ applicantId: new Types.ObjectId(f.applicantId) });
    if (f.branchId !== undefined) clauses.push({ branchId: new Types.ObjectId(f.branchId) });
    if (f.search !== undefined && f.search.trim() !== '') {
      const re = new RegExp(escapeRegExp(f.search.trim()), 'i');
      clauses.push({
        $or: [{ code: re }, { applicantCode: re }, { applicantName: re }],
      } as FilterQuery<JobOfferDoc>);
    }
    if (clauses.length === 0) return {};
    if (clauses.length === 1) return clauses[0] as FilterQuery<JobOfferDoc>;
    return { $and: clauses } as FilterQuery<JobOfferDoc>;
  }

  async listOffers(params: {
    filter: JobOfferListFilter;
    page: number;
    pageSize: number;
    sortBy?: string | undefined;
    sortDir?: 'asc' | 'desc' | undefined;
    scope?: ScopeSelector | undefined;
  }): Promise<Paginated<JobOfferDoc>> {
    return this.list({
      filter: this.buildFilter(params.filter),
      page: params.page,
      pageSize: params.pageSize,
      sortBy: params.sortBy,
      sortDir: params.sortDir,
      sortableFields: ['createdAt', 'status'],
      ...(params.scope === undefined ? {} : { scope: params.scope }),
    });
  }
}

export const jobOfferRepository = new JobOfferRepository();
