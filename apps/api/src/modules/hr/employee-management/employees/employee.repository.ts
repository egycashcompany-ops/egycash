// Employee data access. Scoped by the full org hierarchy via the denormalized
// branch/department/section fields, so the platform own→section→department→branch→organization
// machinery (ADR-004, ADR-015, ADR-017) applies uniformly. System lookups (national-id guard,
// due scheduled work) are deliberately unscoped — they serve boot/scheduler/guard flows.
import { Types, type FilterQuery } from 'mongoose';
import { EMPLOYED_STATUSES, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import { normalizeArabic } from '../../shared/arabic';
import { EmployeeModel, type EmployeeDoc } from './employee.model';

export interface EmployeeListFilter {
  status?: string | undefined;
  employed?: boolean | undefined;
  origin?: string | undefined;
  applicantId?: string | undefined;
  jobOfferId?: string | undefined;
  branchId?: string | undefined;
  departmentId?: string | undefined;
  sectionId?: string | undefined;
  jobTitleId?: string | undefined;
  managerId?: string | undefined;
  employmentType?: string | undefined;
  search?: string | undefined;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class EmployeeRepository extends BaseRepository<EmployeeDoc> {
  constructor() {
    super(EmployeeModel, {
      branchField: 'branchId',
      departmentField: 'departmentId',
      sectionField: 'sectionId',
      softDelete: true,
    });
  }

  /** The employee created from a given accepted offer, if any (duplicate-hire guard). */
  async findByOfferId(jobOfferId: string): Promise<EmployeeDoc | null> {
    if (!Types.ObjectId.isValid(jobOfferId)) return null;
    return this.model
      .findOne({ jobOfferId: new Types.ObjectId(jobOfferId), isDeleted: false })
      .lean<EmployeeDoc>()
      .exec();
  }

  /**
   * Unscoped person-identity lookup by national id (duplicate guard + rehire check — frozen
   * design F2/I6). One person = one employee, whatever their branch, so scoping cannot apply.
   */
  async findByNationalIdSystem(nationalId: string): Promise<EmployeeDoc | null> {
    return this.model.findOne({ 'personal.nationalId': nationalId, isDeleted: false }).exec();
  }

  /** Employed direct reports of a manager (exit direct-reports decision + subordinates view). */
  async findDirectReports(managerId: string, scope?: ScopeSelector): Promise<EmployeeDoc[]> {
    const filter: FilterQuery<EmployeeDoc> = {
      'employment.managerId': new Types.ObjectId(managerId),
      status: { $in: [...EMPLOYED_STATUSES] },
      isDeleted: false,
    };
    return this.model
      .find(scope === undefined ? filter : { $and: [filter, this.scopeFilter(scope)] })
      .sort({ code: 1 })
      .exec();
  }

  /** Hydrated (save-able) doc for the Personnel Actions engine's apply path. Unscoped. */
  async findRawById(id: string): Promise<(EmployeeDoc & { save: () => Promise<unknown> }) | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model.findOne({ _id: new Types.ObjectId(id), isDeleted: false }).exec();
  }

  /** Atomically allocate the next Personnel Action sequence number for an employee. */
  async allocateActionSeq(id: string): Promise<number | null> {
    const doc = await this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id) },
        { $inc: { actionSeq: 1 } },
        { new: true, projection: { actionSeq: 1 } },
      )
      .exec();
    return doc === null ? null : doc.actionSeq;
  }

  /** Repoint every direct report of `fromUserId` to `toUserId` (or clear). Returns matched count. */
  async reassignDirectReports(fromUserId: string, toUserId: string | null): Promise<number> {
    const res = await this.model
      .updateMany(
        { 'employment.managerId': new Types.ObjectId(fromUserId), isDeleted: false },
        { $set: { 'employment.managerId': toUserId === null ? null : new Types.ObjectId(toUserId) } },
      )
      .exec();
    return res.modifiedCount;
  }

  /** Employees whose probation deadline falls inside the window (the reminder task). */
  async findProbationEndingSystem(from: Date, to: Date): Promise<EmployeeDoc[]> {
    return this.model
      .find({
        status: 'probation',
        isDeleted: false,
        'probation.failed': false,
        'probation.confirmedAt': null,
        $or: [
          { 'probation.extendedTo': { $gte: from, $lte: to } },
          { 'probation.extendedTo': null, 'probation.endDate': { $gte: from, $lte: to } },
        ],
      })
      .exec();
  }

  private buildFilter(f: EmployeeListFilter): FilterQuery<EmployeeDoc> {
    const clauses: FilterQuery<EmployeeDoc>[] = [];
    if (f.status !== undefined) clauses.push({ status: f.status });
    if (f.employed !== undefined)
      clauses.push(
        f.employed ? { status: { $in: [...EMPLOYED_STATUSES] } } : { status: 'exited' },
      );
    if (f.origin !== undefined) clauses.push({ origin: f.origin });
    if (f.applicantId !== undefined) clauses.push({ applicantId: new Types.ObjectId(f.applicantId) });
    if (f.jobOfferId !== undefined) clauses.push({ jobOfferId: new Types.ObjectId(f.jobOfferId) });
    if (f.branchId !== undefined) clauses.push({ branchId: new Types.ObjectId(f.branchId) });
    if (f.departmentId !== undefined) clauses.push({ departmentId: new Types.ObjectId(f.departmentId) });
    if (f.sectionId !== undefined) clauses.push({ sectionId: new Types.ObjectId(f.sectionId) });
    if (f.jobTitleId !== undefined)
      clauses.push({ 'employment.jobTitleId': new Types.ObjectId(f.jobTitleId) });
    if (f.managerId !== undefined)
      clauses.push({ 'employment.managerId': new Types.ObjectId(f.managerId) });
    if (f.employmentType !== undefined) clauses.push({ 'employment.employmentType': f.employmentType });
    if (f.search !== undefined && f.search.trim() !== '') {
      const term = f.search.trim();
      const re = new RegExp(escapeRegExp(term), 'i');
      const nameRe = new RegExp(escapeRegExp(normalizeArabic(term)), 'i');
      clauses.push({
        $or: [{ code: re }, { applicantCode: re }, { 'personal.searchName': nameRe }],
      } as FilterQuery<EmployeeDoc>);
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
