// Electronic Employee File data access (Stage 7). Branch-scoped via `branchId` so the platform
// own/branch/organization machinery (ADR-004, ADR-015) applies uniformly.
import { Types, type FilterQuery } from 'mongoose';
import { type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import { EmployeeFileModel, type EmployeeFileDoc } from './employee-file.model';

export interface EmployeeFileListFilter {
  status?: string | undefined;
  employeeId?: string | undefined;
  applicantId?: string | undefined;
  branchId?: string | undefined;
  search?: string | undefined;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class EmployeeFileRepository extends BaseRepository<EmployeeFileDoc> {
  constructor() {
    super(EmployeeFileModel, { branchField: 'branchId', softDelete: true });
  }

  /** The electronic file for an employee, if any (one per employee). */
  async findByEmployeeId(employeeId: string): Promise<EmployeeFileDoc | null> {
    if (!Types.ObjectId.isValid(employeeId)) return null;
    return this.model
      .findOne({ employeeId: new Types.ObjectId(employeeId), isDeleted: false })
      .lean<EmployeeFileDoc>()
      .exec();
  }

  private buildFilter(f: EmployeeFileListFilter): FilterQuery<EmployeeFileDoc> {
    const clauses: FilterQuery<EmployeeFileDoc>[] = [];
    if (f.status !== undefined) clauses.push({ status: f.status });
    if (f.employeeId !== undefined) clauses.push({ employeeId: new Types.ObjectId(f.employeeId) });
    if (f.applicantId !== undefined) clauses.push({ applicantId: new Types.ObjectId(f.applicantId) });
    if (f.branchId !== undefined) clauses.push({ branchId: new Types.ObjectId(f.branchId) });
    if (f.search !== undefined && f.search.trim() !== '') {
      const re = new RegExp(escapeRegExp(f.search.trim()), 'i');
      clauses.push({ employeeCode: re } as FilterQuery<EmployeeFileDoc>);
    }
    if (clauses.length === 0) return {};
    if (clauses.length === 1) return clauses[0] as FilterQuery<EmployeeFileDoc>;
    return { $and: clauses } as FilterQuery<EmployeeFileDoc>;
  }

  async listEmployeeFiles(params: {
    filter: EmployeeFileListFilter;
    page: number;
    pageSize: number;
    sortBy?: string | undefined;
    sortDir?: 'asc' | 'desc' | undefined;
    scope?: ScopeSelector | undefined;
  }): Promise<Paginated<EmployeeFileDoc>> {
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

export const employeeFileRepository = new EmployeeFileRepository();
