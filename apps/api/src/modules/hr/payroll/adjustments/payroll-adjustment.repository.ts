// Payroll adjustment data access (P-HR-04).
//
// Visibility is INHERITED FROM THE EMPLOYEE for the per-employee reads — the caller scopes the
// employee first and these rows follow, the same contract pay-item assignments and Personnel
// Actions have. The organization-wide list (the approval queue) takes a scope of its own, because
// there is no single employee to inherit from.
import { Types } from 'mongoose';
import { toMinorUnits, type ListPayrollAdjustmentsQuery, type Paginated } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { NotFoundError } from '../../../../shared/errors';
import { type ScopeSelector } from '../../../../shared/types';
import { PayrollAdjustmentModel, type PayrollAdjustmentDoc } from './payroll-adjustment.model';

/** The states an entry still counts in — everything but a cancelled one. */
const LIVE_STATUSES = ['draft', 'pendingApproval', 'approved'] as const;

class PayrollAdjustmentRepository extends BaseRepository<PayrollAdjustmentDoc> {
  constructor() {
    super(PayrollAdjustmentModel, { branchField: 'branchId' });
  }

  async getForEmployee(employeeId: string, id: string): Promise<PayrollAdjustmentDoc> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundError('payroll adjustment not found');
    const doc = await PayrollAdjustmentModel.findOne({
      _id: new Types.ObjectId(id),
      employeeId: new Types.ObjectId(employeeId),
      isDeleted: false,
    })
      .lean<PayrollAdjustmentDoc>()
      .exec();
    if (doc === null) throw new NotFoundError('payroll adjustment not found');
    return doc;
  }

  /**
   * The APPROVED entries for one employee and one month — what payroll is allowed to see.
   *
   * Nothing else reaches the engine: a draft is a proposal and a rejected one went back to draft,
   * so neither is a figure anybody has agreed to pay.
   */
  async approvedFor(employeeId: string, period: string): Promise<PayrollAdjustmentDoc[]> {
    return PayrollAdjustmentModel.find({
      employeeId: new Types.ObjectId(employeeId),
      period,
      status: 'approved',
      isDeleted: false,
    })
      .sort({ kind: 1, createdAt: 1 })
      .lean<PayrollAdjustmentDoc[]>()
      .exec();
  }

  /**
   * Every APPROVED adjustment for a period, summed per currency (P-HR-15-A).
   *
   * The reconciliation's "should have been priced" side. Aggregated rather than listed because a
   * month's approvals are not bounded by a page size, and a reconciliation that silently truncated
   * would report a discrepancy it invented.
   *
   * `amount` is summed as stored — always positive, direction is `kind`'s job — which is exactly
   * how the payslip side counts it.
   */
  async approvedTotalsForPeriod(
    period: string,
    scope: ScopeSelector,
  ): Promise<{ currency: string; count: number; minor: number }[]> {
    const rows = await PayrollAdjustmentModel.aggregate<{
      _id: string;
      count: number;
      amount: number;
    }>([
      // Scoped like every other read of this collection: a branch reader reconciles their branch,
      // and comparing a scoped payslip total against an organization-wide approval total would
      // report a discrepancy that does not exist.
      { $match: this.baseFilter(scope, { period, status: 'approved' }) },
      { $group: { _id: '$currency', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      { $sort: { _id: 1 } },
    ]).exec();
    return rows.map((row) => ({
      currency: row._id,
      count: row.count,
      // Stored in major units on the adjustment; converted once, here, so the caller compares
      // minor units with minor units rather than two different scales.
      minor: toMinorUnits(row.amount),
    }));
  }

  /**
   * An identical LIVE entry in the same month — the double-submit this refuses.
   *
   * Cancelled entries are excluded on purpose: cancelling one and recording it correctly is the
   * normal way to fix a mistake, and a rule that counted the cancelled row would block the fix.
   */
  async findDuplicate(
    employeeId: string,
    period: string,
    kind: string,
    reason: string,
    excludeId?: string,
  ): Promise<PayrollAdjustmentDoc | null> {
    return PayrollAdjustmentModel.findOne({
      employeeId: new Types.ObjectId(employeeId),
      period,
      kind,
      reason,
      status: { $in: LIVE_STATUSES },
      isDeleted: false,
      ...(excludeId === undefined ? {} : { _id: { $ne: new Types.ObjectId(excludeId) } }),
    })
      .lean<PayrollAdjustmentDoc>()
      .exec();
  }

  async listForEmployee(
    employeeId: string,
    query: ListPayrollAdjustmentsQuery,
  ): Promise<Paginated<PayrollAdjustmentDoc>> {
    return this.list({
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['period', 'createdAt', 'amount'],
      filter: {
        employeeId: new Types.ObjectId(employeeId),
        ...(query.period === undefined ? {} : { period: query.period }),
        ...(query.kind === undefined ? {} : { kind: query.kind }),
        ...(query.status === undefined ? {} : { status: query.status }),
      } as never,
    });
  }

  /** The organization-wide read: the approval queue, and a period's entries. */
  async listScoped(
    query: ListPayrollAdjustmentsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<PayrollAdjustmentDoc>> {
    return this.list({
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      sortableFields: ['period', 'createdAt', 'amount'],
      scope,
      filter: {
        ...(query.employeeId === undefined
          ? {}
          : { employeeId: new Types.ObjectId(query.employeeId) }),
        ...(query.period === undefined ? {} : { period: query.period }),
        ...(query.kind === undefined ? {} : { kind: query.kind }),
        ...(query.status === undefined ? {} : { status: query.status }),
      } as never,
    });
  }
}

export const payrollAdjustmentRepository = new PayrollAdjustmentRepository();
