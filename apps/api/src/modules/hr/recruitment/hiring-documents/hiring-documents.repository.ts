// Hiring Documents data access (Stage 6). Branch-scoped via `branchId` so the platform
// own/branch/organization machinery (ADR-004, ADR-015) applies uniformly.
import { Types, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import { HiringDocumentsModel, type HiringDocumentsDoc } from './hiring-documents.model';

export interface HiringDocumentsListFilter {
  status?: string | undefined;
  employeeId?: string | undefined;
  branchId?: string | undefined;
  search?: string | undefined;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class HiringDocumentsRepository extends BaseRepository<HiringDocumentsDoc> {
  constructor() {
    super(HiringDocumentsModel, { branchField: 'branchId', softDelete: true });
  }

  /** The hiring-documents set for an employee, if any (one per employee). */
  async findByEmployeeId(employeeId: string): Promise<HiringDocumentsDoc | null> {
    if (!Types.ObjectId.isValid(employeeId)) return null;
    return this.model
      .findOne({ employeeId: new Types.ObjectId(employeeId), isDeleted: false })
      .lean<HiringDocumentsDoc>()
      .exec();
  }

  private buildFilter(f: HiringDocumentsListFilter): FilterQuery<HiringDocumentsDoc> {
    const clauses: FilterQuery<HiringDocumentsDoc>[] = [];
    if (f.status !== undefined) clauses.push({ status: f.status });
    if (f.employeeId !== undefined) clauses.push({ employeeId: new Types.ObjectId(f.employeeId) });
    if (f.branchId !== undefined) clauses.push({ branchId: new Types.ObjectId(f.branchId) });
    if (f.search !== undefined && f.search.trim() !== '') {
      const re = new RegExp(escapeRegExp(f.search.trim()), 'i');
      clauses.push({ employeeCode: re } as FilterQuery<HiringDocumentsDoc>);
    }
    if (clauses.length === 0) return {};
    if (clauses.length === 1) return clauses[0] as FilterQuery<HiringDocumentsDoc>;
    return { $and: clauses } as FilterQuery<HiringDocumentsDoc>;
  }

  async listHiringDocuments(params: {
    filter: HiringDocumentsListFilter;
    page: number;
    pageSize: number;
    sortBy?: string | undefined;
    sortDir?: 'asc' | 'desc' | undefined;
    scope?: ScopeSelector | undefined;
  }): Promise<Paginated<HiringDocumentsDoc>> {
    return this.list({
      filter: this.buildFilter(params.filter),
      page: params.page,
      pageSize: params.pageSize,
      sortBy: params.sortBy,
      sortDir: params.sortDir,
      sortableFields: ['createdAt', 'employeeCode'],
      ...(params.scope === undefined ? {} : { scope: params.scope }),
    });
  }
}

export const hiringDocumentsRepository = new HiringDocumentsRepository();
