// Evaluation data access. Scoped by branch via the denormalized `branchId`, so the platform
// own→section→department→branch→organization machinery applies (ADR-004, ADR-015).
import { Types, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import { EvaluationModel, type EvaluationDoc } from './evaluation.model';

export interface EvaluationListFilter {
  applicantId?: string | undefined;
  phaseId?: string | undefined;
  status?: string | undefined;
  branchId?: string | undefined;
}

class EvaluationRepository extends BaseRepository<EvaluationDoc> {
  constructor() {
    super(EvaluationModel, { branchField: 'branchId', softDelete: true });
  }

  async findByApplicantAndPhase(applicantId: string, phaseId: string): Promise<EvaluationDoc | null> {
    if (!Types.ObjectId.isValid(applicantId) || !Types.ObjectId.isValid(phaseId)) return null;
    return this.model
      .findOne({
        applicantId: new Types.ObjectId(applicantId),
        phaseId: new Types.ObjectId(phaseId),
        isDeleted: false,
      })
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
