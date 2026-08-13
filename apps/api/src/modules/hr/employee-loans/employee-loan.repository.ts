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
import { LoanRepaymentModel, type LoanRepaymentDoc } from './loan-repayment.model';

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

  /**
   * What one employee's month costs in instalments (P-HR-05-B).
   *
   * `planned` OR `deducted` — and the second one is the subtle half. A month's compensation is a
   * function of that month's SCHEDULE, not of whether a payslip has happened to be issued yet:
   * once a payslip takes an instalment the row becomes `deducted`, and if this read dropped it,
   * re-opening that month afterwards would show a smaller deduction than the issued document
   * does. PY-8's stance, applied here — a past month does not restate itself.
   *
   * Recording stays idempotent on the other side of the port, so a month whose instalment is
   * already in the ledger prices the same and repays nothing twice.
   *
   * `cancelled` is excluded: it is an intention somebody withdrew, and no month ever owed it.
   */
  async chargeableForEmployeePeriod(
    employeeId: string,
    period: string,
  ): Promise<LoanInstallmentDoc[]> {
    return LoanInstallmentModel.find({
      employeeId: new Types.ObjectId(employeeId),
      period,
      status: { $in: ['planned', 'deducted'] },
      isDeleted: false,
    })
      .sort({ seq: 1 })
      .lean<LoanInstallmentDoc[]>()
      .exec();
  }

  /** The rows an exit withdraws: still intended, and in a month that starts after the last day. */
  async plannedForEmployeeAfter(employeeId: string, period: string): Promise<LoanInstallmentDoc[]> {
    return LoanInstallmentModel.find({
      employeeId: new Types.ObjectId(employeeId),
      period: { $gt: period },
      status: 'planned',
      isDeleted: false,
    })
      .sort({ period: 1 })
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

/** The append-only side (P-HR-05-B). Reads and one insert; nothing here updates a row. */
class LoanRepaymentRepository {
  async forLoan(loanId: string): Promise<LoanRepaymentDoc[]> {
    return LoanRepaymentModel.find({ loanId: new Types.ObjectId(loanId) })
      .sort({ recordedAt: 1 })
      .lean<LoanRepaymentDoc[]>()
      .exec();
  }

  async forLoans(loanIds: readonly string[]): Promise<Map<string, LoanRepaymentDoc[]>> {
    const rows = await LoanRepaymentModel.find({
      loanId: { $in: loanIds.map((id) => new Types.ObjectId(id)) },
    })
      .sort({ recordedAt: 1 })
      .lean<LoanRepaymentDoc[]>()
      .exec();
    const byLoan = new Map<string, LoanRepaymentDoc[]>();
    for (const row of rows) {
      const key = String(row.loanId);
      byLoan.set(key, [...(byLoan.get(key) ?? []), row]);
    }
    return byLoan;
  }

  /** What payroll has taken from one loan so far, in minor units. */
  async repaidMinor(loanId: string): Promise<number> {
    const rows = await this.forLoan(loanId);
    return rows.reduce((sum, row) => sum + row.amountMinor, 0);
  }
}

export const employeeLoanRepository = new EmployeeLoanRepository();
export const loanInstallmentRepository = new LoanInstallmentRepository();
export const loanRepaymentRepository = new LoanRepaymentRepository();
