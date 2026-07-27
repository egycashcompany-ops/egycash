// Timeline data access (RW14 / I5). APPEND-ONLY by construction: this repository exposes an
// idempotent `append` and read helpers, and deliberately offers NO update and NO delete — the one
// mutation it allows is stamping `supersededAt` when a return-to-stage retires an attempt (RW13),
// which marks history rather than changing it.
//
// Branch-scoped via `branchId` so the platform own/branch/organization machinery applies
// uniformly (ADR-004, ADR-015).
import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import { type BaseDocFields } from '../../../../shared/base/base.model';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import { RecruitmentTimelineModel, type RecruitmentTimelineDoc } from './recruitment-timeline.model';

export interface TimelineListFilter {
  type?: string | undefined;
  correlationType?: string | undefined;
  correlationId?: string | undefined;
  stageKind?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  includeSuperseded?: boolean | undefined;
}

type NewEntry = Omit<RecruitmentTimelineDoc, keyof BaseDocFields>;

class RecruitmentTimelineRepository extends BaseRepository<RecruitmentTimelineDoc> {
  constructor() {
    super(RecruitmentTimelineModel, { branchField: 'branchId', softDelete: false });
  }

  /**
   * Append one entry, idempotently on `sourceKey` (I5). A duplicate key means the entry already
   * exists — the stored one is returned untouched, so a retry, a concurrent writer and the
   * reconciliation task can never produce two rows for the same happening, and can never rewrite
   * an entry's `eventId`.
   */
  async append(entry: NewEntry, session?: ClientSession): Promise<RecruitmentTimelineDoc> {
    try {
      const created = await this.model.create([entry], session === undefined ? {} : { session });
      // `create` with an array returns one document per input — exactly one here.
      return created[0]!.toObject<RecruitmentTimelineDoc>();
    } catch (error) {
      if (error instanceof Error && error.message.includes('E11000')) {
        const existing = await this.model
          .findOne({ sourceKey: entry.sourceKey })
          .lean<RecruitmentTimelineDoc>()
          .exec();
        if (existing !== null) return existing;
      }
      throw error;
    }
  }

  /** One candidate's history, newest first. */
  async listForApplicant(
    applicantId: string,
    filter: TimelineListFilter,
    limit: number,
    scope?: ScopeSelector,
  ): Promise<RecruitmentTimelineDoc[]> {
    if (!Types.ObjectId.isValid(applicantId)) return [];
    const extra: FilterQuery<RecruitmentTimelineDoc> = {
      applicantId: new Types.ObjectId(applicantId),
      ...this.buildFilter(filter),
    };
    return this.model
      .find(this.baseFilter(scope, extra))
      .sort({ at: -1, _id: -1 })
      .limit(limit)
      .lean<RecruitmentTimelineDoc[]>()
      .exec();
  }

  /** Total entries for a candidate (the timeline summary's `total`, I6). */
  async countForApplicant(applicantId: string): Promise<number> {
    if (!Types.ObjectId.isValid(applicantId)) return 0;
    return this.model.countDocuments({ applicantId: new Types.ObjectId(applicantId) }).exec();
  }

  /** Entries by their public ids — used to echo back exactly what an action produced (I6). */
  async findByEventIds(eventIds: string[]): Promise<RecruitmentTimelineDoc[]> {
    if (eventIds.length === 0) return [];
    return this.model
      .find({ eventId: { $in: eventIds } })
      .sort({ at: 1 })
      .lean<RecruitmentTimelineDoc[]>()
      .exec();
  }

  /** The source keys already present for a candidate — drives the reconciliation task (I5). */
  async existingSourceKeys(applicantId: string): Promise<Set<string>> {
    if (!Types.ObjectId.isValid(applicantId)) return new Set();
    const rows = await this.model
      .find({ applicantId: new Types.ObjectId(applicantId) })
      .select('sourceKey')
      .lean<{ sourceKey: string }[]>()
      .exec();
    return new Set(rows.map((r) => r.sourceKey));
  }

  /**
   * Mark the entries of a superseded attempt (RW13/A8). The ONLY mutation this repository
   * permits, and it adds a marker rather than changing what happened — entries stay visible.
   */
  async markSuperseded(
    applicantId: string,
    correlationIds: string[],
    at: Date,
    session?: ClientSession,
  ): Promise<number> {
    if (!Types.ObjectId.isValid(applicantId) || correlationIds.length === 0) return 0;
    const result = await this.model
      .updateMany(
        {
          applicantId: new Types.ObjectId(applicantId),
          correlationId: { $in: correlationIds },
          supersededAt: null,
        },
        { $set: { supersededAt: at } },
        session === undefined ? {} : { session },
      )
      .exec();
    return result.modifiedCount;
  }

  /** The scope field follows the applicant on reassignment (RW2 step 3) — history stays visible. */
  async syncBranch(
    applicantId: string,
    branchId: Types.ObjectId | null,
    session?: ClientSession,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(applicantId)) return;
    await this.model
      .updateMany(
        { applicantId: new Types.ObjectId(applicantId) },
        { $set: { branchId } },
        session === undefined ? {} : { session },
      )
      .exec();
  }

  private buildFilter(f: TimelineListFilter): FilterQuery<RecruitmentTimelineDoc> {
    const filter: FilterQuery<RecruitmentTimelineDoc> = {};
    if (f.type !== undefined) filter.type = f.type;
    if (f.correlationType !== undefined) filter.correlationType = f.correlationType;
    if (f.correlationId !== undefined) filter.correlationId = f.correlationId;
    if (f.stageKind !== undefined) filter.stageKind = f.stageKind;
    if (f.includeSuperseded === false) filter.supersededAt = null;
    if (f.from !== undefined || f.to !== undefined) {
      const range: Record<string, Date> = {};
      if (f.from !== undefined) range.$gte = f.from;
      if (f.to !== undefined) range.$lte = f.to;
      filter.at = range as FilterQuery<RecruitmentTimelineDoc>['at'];
    }
    return filter;
  }
}

export const recruitmentTimelineRepository = new RecruitmentTimelineRepository();
