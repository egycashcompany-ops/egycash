// Employee data access (Stage 5). Branch-scoped via `branchId` so the platform
// own/branch/organization machinery (ADR-004, ADR-015) applies uniformly.
import { Types, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import { EmployeeModel, type EmployeeDoc } from './employee.model';

export interface EmployeeListFilter {
  status?: string | undefined;
  applicantId?: string | undefined;
  jobOfferId?: string | undefined;
  branchId?: string | undefined;
  search?: string | undefined;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class EmployeeRepository extends BaseRepository<EmployeeDoc> {
  constructor() {
    super(EmployeeModel, { branchField: 'branchId', softDelete: true });
  }

  /** The employee created from a given accepted offer, if any (duplicate-hire guard). */
  async findByOfferId(jobOfferId: string): Promise<EmployeeDoc | null> {
    if (!Types.ObjectId.isValid(jobOfferId)) return null;
    return this.model
      .findOne({ jobOfferId: new Types.ObjectId(jobOfferId), isDeleted: false })
      .lean<EmployeeDoc>()
      .exec();
  }

  private buildFilter(f: EmployeeListFilter): FilterQuery<EmployeeDoc> {
    const clauses: FilterQuery<EmployeeDoc>[] = [];
    if (f.status !== undefined) clauses.push({ status: f.status });
    if (f.applicantId !== undefined) clauses.push({ applicantId: new Types.ObjectId(f.applicantId) });
    if (f.jobOfferId !== undefined) clauses.push({ jobOfferId: new Types.ObjectId(f.jobOfferId) });
    if (f.branchId !== undefined) clauses.push({ branchId: new Types.ObjectId(f.branchId) });
    if (f.search !== undefined && f.search.trim() !== '') {
      const re = new RegExp(escapeRegExp(f.search.trim()), 'i');
      clauses.push({ $or: [{ code: re }, { applicantCode: re }] } as FilterQuery<EmployeeDoc>);
    }
    if (clauses.length === 0) return {};
    if (clauses.length === 1) return clauses[0] as FilterQuery<EmployeeDoc>;
    return { $and: clauses } as FilterQuery<EmployeeDoc>;
  }

  async listEmployees(params: {
    filter: EmployeeListFilter;
    page: number;
    pageSize: number;
    sortBy?: string | undefined;
    sortDir?: 'asc' | 'desc' | undefined;
    scope?: ScopeSelector | undefined;
  }): Promise<Paginated<EmployeeDoc>> {
    return this.list({
      filter: this.buildFilter(params.filter),
      page: params.page,
      pageSize: params.pageSize,
      sortBy: params.sortBy,
      sortDir: params.sortDir,
      sortableFields: ['createdAt', 'code', 'hiredAt'],
      ...(params.scope === undefined ? {} : { scope: params.scope }),
    });
  }
}

export const employeeRepository = new EmployeeRepository();
