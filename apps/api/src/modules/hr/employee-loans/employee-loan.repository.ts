// Employee loan data access (P-HR-05).
//
// Visibility is INHERITED FROM THE EMPLOYEE for the per-employee reads — the caller scopes the
// employee first and these rows follow, the same contract pay-item assignments, Personnel Actions
// and payroll adjustments all have. The organization-wide list (the approval queue) takes a scope
// of its own, because there is no single employee to inherit from.
import { Types } from 'mongoose';
import {
  LIVE_EMPLOYEE_LOAN_STATUSES,
  type ListEmployeeLoansQuery,
  type Paginated,
} from '@ecms/contracts';
import { BaseRepository } from '../../../shared/base/base.repository';
import { NotFoundError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { EmployeeLoanModel, type EmployeeLoanDoc } from './employee-loan.model';
import { LoanInstallmentModel, type LoanInstallmentDoc } from './loan-installment.model';

class EmployeeLoanRepository extends BaseRepository<EmployeeLoanDoc> {
  constructor() {
    super(EmployeeLoanModel, { branchField: 'branchId' });
  }

  async getForEmployee(employeeId: string, id: string): Promise<EmployeeLoanDoc> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundError('loan not found');
    const doc = await EmployeeLoanModel.findOne({
      _id: new Types.ObjectId(id),
      employeeId: new Types.ObjectId(employeeId),
      isDeleted: false,
    })
      .lean<EmployeeLoanDoc>()
      .exec();
    if (doc === null) throw new NotFoundError('loan not found');
    return doc;
  }

  /**
   * D3 — the loan already on its way, if there is one.
   *
   * `pendingApproval | approved | active`: the states from which a loan becomes active with nobody
   * deciding anything further. A `draft` deliberately does not count — it is a proposal, and one
   * forgotten draft would otherwise lock an employee out of ever borrowing again.
   */
  async findLive(employeeId: string, excludeId?: string): Promise<EmployeeLoanDoc | null> {
    return EmployeeLoanModel.findOne({
      employeeId: new Types.ObjectId(employeeId),
      status: { $in: LIVE_EMPLOYEE_LOAN_STATUSES },
      isDeleted: false,
      ...(excludeId === undefined ? {} : { _id: { $ne: new Types.ObjectId(excludeId) } }),
    })
      .lean<EmployeeLoanDoc>()
      .exec();
  }

  async listForEmployee(
    employeeId: string,
    query: ListEmployeeLoansQuery,
  ): Promise<Paginated<EmployeeLoanDoc>> {
    return this.list({
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['createdAt', 'principal', 'firstPeriod'],
      filter: {
        employeeId: new Types.ObjectId(employeeId),
        ...(query.type === undefined ? {} : { type: query.type }),
        ...(query.status === undefined ? {} : { status: query.status }),
      } as never,
    });
  }

  /** The organization-wide read: the approval queue, and the outstanding-loans list. */
  async listScoped(
    query: ListEmployeeLoansQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<EmployeeLoanDoc>> {
    return this.list({
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['createdAt', 'principal', 'firstPeriod'],
      scope,
      filter: {
        ...(query.employeeId === undefined
          ? {}
          : { employeeId: new Types.ObjectId(query.employeeId) }),
        ...(query.type === undefined ? {} : { type: query.type }),
        ...(query.status === undefined ? {} : { status: query.status }),
      } as never,
    });
  }
}

class LoanInstallmentRepository {
  /** One loan's schedule, in the order it reads. Cancelled rows included — they are history. */
  async forLoan(loanId: string): Promise<LoanInstallmentDoc[]> {
    return LoanInstallmentModel.find({ loanId: new Types.ObjectId(loanId), isDeleted: false })
      .sort({ seq: 1 })
      .lean<LoanInstallmentDoc[]>()
      .exec();
  }

  /** The rows a reschedule may touch: still intended, and in a month nobody has closed. */
  async plannedForLoan(loanId: string): Promise<LoanInstallmentDoc[]> {
    return LoanInstallmentModel.find({
      loanId: new Types.ObjectId(loanId),
      status: 'planned',
      isDeleted: false,
    })
      .sort({ seq: 1 })
      .lean<LoanInstallmentDoc[]>()
      .exec();
  }

  async forLoans(loanIds: readonly string[]): Promise<Map<string, LoanInstallmentDoc[]>> {
    const rows = await LoanInstallmentModel.find({
      loanId: { $in: loanIds.map((id) => new Types.ObjectId(id)) },
      isDeleted: false,
    })
      .sort({ seq: 1 })
      .lean<LoanInstallmentDoc[]>()
      .exec();
    const byLoan = new Map<string, LoanInstallmentDoc[]>();
    for (const row of rows) {
      const key = String(row.loanId);
      byLoan.set(key, [...(byLoan.get(key) ?? []), row]);
    }
    return byLoan;
  }
}

export const employeeLoanRepository = new EmployeeLoanRepository();
export const loanInstallmentRepository = new LoanInstallmentRepository();
