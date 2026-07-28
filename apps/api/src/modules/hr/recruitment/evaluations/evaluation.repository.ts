// Evaluation data access. Scoped by branch via the denormalized `branchId`, so the platform
// own→section→department→branch→organization machinery applies (ADR-004, ADR-015).
import { Types, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import {
  assertNotSuperseded,
  assertNotWorkflowManaged,
  LIVE_ATTEMPT_ONLY,
} from '../workflow/workflow-guard';
import { type ScopeSelector } from '../../../../shared/types';
import { EvaluationModel, type EvaluationDoc } from './evaluation.model';

export interface EvaluationListFilter {
  applicantId?: string | undefined;
  phaseId?: string | undefined;
  status?: string | undefined;
  branchId?: string | undefined;
  createdFrom?: Date | undefined;
  createdTo?: Date | undefined;
}

class EvaluationRepository extends BaseRepository<EvaluationDoc> {
  constructor() {
    super(EvaluationModel, { branchField: 'branchId', softDelete: true });
  }

  /**
   * I13 — the workflow engine owns `status`, `attempt` and the supersede/placement markers.
   * A stage service updating its own domain data never touches them; attempting to does not
   * silently corrupt the pipeline, it throws.
   */
  override async updateById(
    id: string,
    set: Parameters<BaseRepository<EvaluationDoc>['updateById']>[1],
    meta: Parameters<BaseRepository<EvaluationDoc>['updateById']>[2],
  ): Promise<EvaluationDoc> {
    assertNotWorkflowManaged(set ?? {}, 'evaluation');
    return super.updateById(id, set, meta);
  }

  /**
   * I1 — a retired attempt is history, and history is not edited. The condition rides inside the
   * same atomic write as the change, so a return-to-stage landing mid-request cannot be overtaken
   * by a caller that read the record a moment earlier.
   */
  protected override writeConditions(): FilterQuery<EvaluationDoc> {
    return LIVE_ATTEMPT_ONLY as FilterQuery<EvaluationDoc>;
  }

  protected override assertWritable(current: EvaluationDoc): void {
    assertNotSuperseded(current, 'evaluation');
  }

  async findByApplicantAndPhase(applicantId: string, phaseId: string): Promise<EvaluationDoc | null> {
    if (!Types.ObjectId.isValid(applicantId) || !Types.ObjectId.isValid(phaseId)) return null;
    return this.model
      .findOne({
        applicantId: new Types.ObjectId(applicantId),
        phaseId: new Types.ObjectId(phaseId),
        supersededAt: null,
        isDeleted: false,
      })
      .sort({ attempt: -1 })
      .lean<EvaluationDoc>()
      .exec();
  }

  /** All of an applicant's evaluations, oldest phase first. */
  async findByApplicant(applicantId: string): Promise<EvaluationDoc[]> {
    if (!Types.ObjectId.isValid(applicantId)) return [];
    return this.model
      .find({ applicantId: new Types.ObjectId(applicantId), isDeleted: false })
      .sort({ phaseOrder: 1 })
      .lean<EvaluationDoc[]>()
      .exec();
  }

  private buildFilter(f: EvaluationListFilter): FilterQuery<EvaluationDoc> {
    const clauses: FilterQuery<EvaluationDoc>[] = [];
    if (f.applicantId !== undefined) clauses.push({ applicantId: new Types.ObjectId(f.applicantId) });
    if (f.phaseId !== undefined) clauses.push({ phaseId: new Types.ObjectId(f.phaseId) });
    if (f.status !== undefined) clauses.push({ status: f.status });
    if (f.branchId !== undefined) clauses.push({ branchId: new Types.ObjectId(f.branchId) });
    if (f.createdFrom !== undefined || f.createdTo !== undefined) {
      const range: Record<string, Date> = {};
      if (f.createdFrom !== undefined) range.$gte = f.createdFrom;
      if (f.createdTo !== undefined) range.$lte = f.createdTo;
      clauses.push({ createdAt: range } as FilterQuery<EvaluationDoc>);
    }
    if (clauses.length === 0) return {};
    if (clauses.length === 1) return clauses[0] as FilterQuery<EvaluationDoc>;
    return { $and: clauses } as FilterQuery<EvaluationDoc>;
  }

  async listEvaluations(params: {
    filter: EvaluationListFilter;
    page: number;
    pageSize: number;
    sortBy?: string | undefined;
    sortDir?: 'asc' | 'desc' | undefined;
    scope?: ScopeSelector | undefined;
  }): Promise<Paginated<EvaluationDoc>> {
    return this.list({
      filter: this.buildFilter(params.filter),
      page: params.page,
      pageSize: params.pageSize,
      sortBy: params.sortBy,
      sortDir: params.sortDir,
      sortableFields: ['createdAt', 'phaseOrder', 'decidedAt'],
      ...(params.scope === undefined ? {} : { scope: params.scope }),
    });
  }
}

export const evaluationRepository = new EvaluationRepository();
