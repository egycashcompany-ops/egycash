// Job Offer data access (Stage 4). Branch-scoped via `branchId` so the platform
// own/branch/organization machinery (ADR-004, ADR-015) applies uniformly.
import { Types, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { assertNotWorkflowManaged } from '../workflow/workflow-guard';
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

  /**
   * I13 — the workflow engine owns `status`, `attempt` and the supersede/placement markers.
   * A stage service updating its own domain data never touches them; attempting to does not
   * silently corrupt the pipeline, it throws.
   */
  override async updateById(
    id: string,
    set: Parameters<BaseRepository<JobOfferDoc>['updateById']>[1],
    meta: Parameters<BaseRepository<JobOfferDoc>['updateById']>[2],
  ): Promise<JobOfferDoc> {
    assertNotWorkflowManaged(set ?? {}, 'jobOffer');
    return super.updateById(id, set, meta);
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

  /**
   * The attempt a NEW offer for this applicant takes (I12). Terminal offers keep
   * `supersededAt: null`, so a re-offer after a withdrawn/rejected/expired one must claim the
   * next attempt rather than collide with the live-record unique index.
   */
  async nextAttemptFor(applicantId: string): Promise<number> {
    if (!Types.ObjectId.isValid(applicantId)) return 1;
    const latest = await this.model
      .findOne({ applicantId: new Types.ObjectId(applicantId), isDeleted: false })
      .sort({ attempt: -1 })
      .select('attempt')
      .lean<{ attempt: number }>()
      .exec();
    return latest === null ? 1 : latest.attempt + 1;
  }

  /** Every offer an applicant has ever held, newest first (history, never filtered). */
  async findByApplicant(applicantId: string): Promise<JobOfferDoc[]> {
    if (!Types.ObjectId.isValid(applicantId)) return [];
    return this.model
      .find({ applicantId: new Types.ObjectId(applicantId), isDeleted: false })
      .sort({ createdAt: -1 })
      .lean<JobOfferDoc[]>()
      .exec();
  }

  /** The applicant's accepted offer, if any (the Employee-Creation gate for Stage 5). */
  async findAcceptedByApplicantId(applicantId: string): Promise<JobOfferDoc | null> {
    if (!Types.ObjectId.isValid(applicantId)) return null;
    return this.model
      .findOne({
        applicantId: new Types.ObjectId(applicantId),
        status: 'accepted',
        supersededAt: null,
        isDeleted: false,
      })
      .lean<JobOfferDoc>()
      .exec();
  }

  /**
   * Among `applicantIds`, the ones holding an offer that BLOCKS drafting a new one — a drafted,
   * sent or accepted one. A `waiting` record is the queue itself (I11), never a block.
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
        supersededAt: null,
        status: { $in: ['draft', 'sent', 'accepted'] },
      })
      .select('applicantId')
      .lean<{ applicantId: Types.ObjectId }[]>()
      .exec();
    return new Set(rows.map((r) => String(r.applicantId)));
  }

  /** Sent offers whose validity has lapsed as of `asOf` — the automatic-expiration sweep. */
  async findOverdueSent(asOf: Date, limit = 500): Promise<JobOfferDoc[]> {
    return this.model
      .find({ status: 'sent', isDeleted: false, supersededAt: null, 'terms.validUntil': { $lte: asOf } })
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
