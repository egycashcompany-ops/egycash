// Payslip data access.
//
// `branchId` is the ADR-015 scope axis, denormalized from the employee at issue time exactly as
// the pay-item assignments do. Unlike those, these rows ARE scoped here rather than inheriting
// from an employee the caller resolved first: a payslip list is a list of many employees at once,
// so there is no single employee whose visibility it could follow.
//
// There is no update and no delete. The base class provides them; nothing in this phase calls
// them, and a payslip is a document somebody was paid against.
import { Types } from 'mongoose';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { PayslipModel, type PayslipDoc } from './payslip.model';

/** One currency's worth of a run, as the database summed it. */
export interface PayslipRunTotalsRow {
  currency: string;
  payslips: number;
  totalEarningsMinor: number;
  totalDeductionsMinor: number;
  netMinor: number;
}

class PayslipRepository extends BaseRepository<PayslipDoc> {
  constructor() {
    super(PayslipModel, { branchField: 'branchId' });
  }

  /**
   * A run's money, summed in the database and grouped BY CURRENCY (P-HR-15-A).
   *
   * Grouped rather than totalled because the engine refuses a mixed-currency *employee* but nothing
   * says two employees must share a currency — adding them would be a defect wearing the costume of
   * a summary. Aggregated rather than read-and-summed because a run holds one row per employee and
   * a reconciliation must not depend on how many of them fit in a page.
   */
  async totalsForRun(runId: string): Promise<PayslipRunTotalsRow[]> {
    if (!Types.ObjectId.isValid(runId)) return [];
    const rows = await PayslipModel.aggregate<{
      _id: string;
      payslips: number;
      totalEarningsMinor: number;
      totalDeductionsMinor: number;
      netMinor: number;
    }>([
      { $match: { runId: new Types.ObjectId(runId), isDeleted: false } },
      {
        $group: {
          _id: '$currency',
          payslips: { $sum: 1 },
          totalEarningsMinor: { $sum: '$totalEarningsMinor' },
          totalDeductionsMinor: { $sum: '$totalDeductionsMinor' },
          netMinor: { $sum: '$netMinor' },
        },
      },
      { $sort: { _id: 1 } },
    ]).exec();
    return rows.map((row) => ({
      currency: row._id,
      payslips: row.payslips,
      totalEarningsMinor: row.totalEarningsMinor,
      totalDeductionsMinor: row.totalDeductionsMinor,
      netMinor: row.netMinor,
    }));
  }

  /**
   * What the `adjustment`-origin lines on this run's payslips come to, per currency.
   *
   * Earnings and deductions are concatenated and summed as POSITIVE amounts, because that is what
   * the other side of the comparison is: an adjustment's `amount` is always positive and its
   * direction is `kind`'s job (P-HR-04). Summing them signed here would compare two different
   * quantities and call the difference a discrepancy.
   */
  async adjustmentLineTotalsForRun(runId: string): Promise<{ currency: string; minor: number }[]> {
    if (!Types.ObjectId.isValid(runId)) return [];
    const rows = await PayslipModel.aggregate<{ _id: string; minor: number }>([
      { $match: { runId: new Types.ObjectId(runId), isDeleted: false } },
      {
        $project: {
          currency: 1,
          lines: { $concatArrays: ['$earnings', '$deductions'] },
        },
      },
      { $unwind: '$lines' },
      { $match: { 'lines.origin': 'adjustment' } },
      { $group: { _id: '$currency', minor: { $sum: { $ifNull: ['$lines.amountMinor', 0] } } } },
      { $sort: { _id: 1 } },
    ]).exec();
    return rows.map((row) => ({ currency: row._id, minor: row.minor }));
  }

  /** The employees this run issued to — the coverage check's "was paid" side. */
  async employeeIdsForRun(runId: string): Promise<string[]> {
    if (!Types.ObjectId.isValid(runId)) return [];
    const ids = await PayslipModel.distinct('employeeId', {
      runId: new Types.ObjectId(runId),
      isDeleted: false,
    }).exec();
    return ids.map(String);
  }
}

export const payslipRepository = new PayslipRepository();
