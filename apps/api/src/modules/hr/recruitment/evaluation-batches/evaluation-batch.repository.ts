// Evaluation-batch data access. Scoped by branch via the denormalized `branchId`, so the platform
// own→section→department→branch→organization machinery applies (ADR-004, ADR-015).
//
// Soft delete is DISABLED for this collection: a batch is permanent (RW8) and there is no delete
// path at all — cancelling is the retirement action, and cancelled batches stay listed forever.
import { Types, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import { EvaluationBatchModel, type EvaluationBatchDoc } from './evaluation-batch.model';

/** The statuses that still hold a candidate — used by the "already in an open batch" guard. */
export const OPEN_BATCH_STATUSES = ['draft', 'issued'] as const;

export interface EvaluationBatchListFilter {
  phaseId?: string | undefined;
  /** RW7 — the phases the caller may see; an unfiltered list is restricted to exactly these. */
  phaseIds?: string[] | undefined;
  status?: string | undefined;
  branchId?: string | undefined;
  issuedFrom?: Date | undefined;
  issuedTo?: Date | undefined;
  search?: string | undefined;
}

class EvaluationBatchRepository extends BaseRepository<EvaluationBatchDoc> {
  constructor() {
    super(EvaluationBatchModel, { branchField: 'branchId', softDelete: false });
  }

  /**
   * The applicants already held by an OPEN batch of this phase. Membership is exclusive: an
   * applicant may not be sent out twice for the same check at the same time.
   */
  async applicantsInOpenBatches(phaseId: string, applicantIds: string[]): Promise<Set<string>> {
    if (!Types.ObjectId.isValid(phaseId) || applicantIds.length === 0) return new Set();
    const ids = applicantIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    if (ids.length === 0) return new Set();
    const rows = await this.model
      .find(
        {
          phaseId: new Types.ObjectId(phaseId),
          status: { $in: OPEN_BATCH_STATUSES },
          'items.applicantId': { $in: ids },
          'items.result': { $ne: 'voided' },
        },
        { 'items.applicantId': 1, 'items.result': 1 },
      )
      .lean<{ items: { applicantId: Types.ObjectId; result: string }[] }[]>()
      .exec();
    const held = new Set<string>();
    const wanted = new Set(ids.map(String));
    for (const row of rows) {
      for (const item of row.items) {
        const key = String(item.applicantId);
        if (item.result !== 'voided' && wanted.has(key)) held.add(key);
      }
    }
    return held;
  }

  private buildFilter(f: EvaluationBatchListFilter): FilterQuery<EvaluationBatchDoc> {
    const clauses: FilterQuery<EvaluationBatchDoc>[] = [];
    if (f.phaseId !== undefined) clauses.push({ phaseId: new Types.ObjectId(f.phaseId) });
    if (f.phaseIds !== undefined) {
      clauses.push({ phaseId: { $in: f.phaseIds.map((id) => new Types.ObjectId(id)) } } as FilterQuery<EvaluationBatchDoc>);
    }
    if (f.status !== undefined) clauses.push({ status: f.status });
    if (f.branchId !== undefined) clauses.push({ branchId: new Types.ObjectId(f.branchId) });
    if (f.issuedFrom !== undefined) clauses.push({ issuedAt: { $gte: f.issuedFrom } });
    if (f.issuedTo !== undefined) clauses.push({ issuedAt: { $lte: f.issuedTo } });
    if (f.search !== undefined && f.search.trim() !== '') {
      const rx = new RegExp(f.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      clauses.push({ $or: [{ code: rx }, { title: rx }] } as FilterQuery<EvaluationBatchDoc>);
    }
    if (clauses.length === 0) return {};
    if (clauses.length === 1) return clauses[0] as FilterQuery<EvaluationBatchDoc>;
    return { $and: clauses } as FilterQuery<EvaluationBatchDoc>;
  }

  async listBatches(params: {
    filter: EvaluationBatchListFilter;
    page: number;
    pageSize: number;
    sortBy?: string | undefined;
    sortDir?: 'asc' | 'desc' | undefined;
    scope?: ScopeSelector | undefined;
  }): Promise<Paginated<EvaluationBatchDoc>> {
    return this.list({
      filter: this.buildFilter(params.filter),
      page: params.page,
      pageSize: params.pageSize,
      sortBy: params.sortBy,
      sortDir: params.sortDir,
      sortableFields: ['createdAt', 'code', 'issuedAt', 'returnedAt'],
      ...(params.scope === undefined ? {} : { scope: params.scope }),
    });
  }

  /** Worker-side read: the package job runs outside any request scope. */
  async findByIdSystem(id: string): Promise<EvaluationBatchDoc | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model.findById(id).lean<EvaluationBatchDoc>().exec();
  }

  /** Worker-side write: the package job has no `version` and no caller to attribute. */
  async systemSet(id: string, set: Record<string, unknown>): Promise<void> {
    if (!Types.ObjectId.isValid(id)) return;
    await this.model.updateOne({ _id: new Types.ObjectId(id) }, { $set: set }).exec();
  }
}

export const evaluationBatchRepository = new EvaluationBatchRepository();
