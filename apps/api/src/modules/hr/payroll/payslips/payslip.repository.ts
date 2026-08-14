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
import { type ScopeSelector } from '../../../../shared/types';
import { PayslipModel, type PayslipDoc } from './payslip.model';

/**
 * One group of payslip LINES, as the database summed them (P-HR-14 / U14-1).
 *
 * A single row shape for all three splits: the fields a given split did not group by come back
 * null, so the service maps one shape rather than three and no split can quietly grow a key the
 * others do not have.
 */
export interface PayslipLineGroupRow {
  currency: string;
  kind: string;
  origin: string | null;
  payItemId: string | null;
  code: string | null;
  branchId: string | null;
  lines: number;
  amountMinor: number;
}

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
  async totalsForRun(runId: string, scope: ScopeSelector): Promise<PayslipRunTotalsRow[]> {
    if (!Types.ObjectId.isValid(runId)) return [];
    const rows = await PayslipModel.aggregate<{
      _id: string;
      payslips: number;
      totalEarningsMinor: number;
      totalDeductionsMinor: number;
      netMinor: number;
    }>([
      // `baseFilter` rather than a hand-written clause: the caller's scope must narrow this
      // exactly as it narrows the paginated read beside it, or a branch reader would be handed
      // organization-wide money.
      { $match: this.baseFilter(scope, { runId: new Types.ObjectId(runId) }) },
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
  async adjustmentLineTotalsForRun(
    runId: string,
    scope: ScopeSelector,
  ): Promise<{ currency: string; minor: number }[]> {
    if (!Types.ObjectId.isValid(runId)) return [];
    const rows = await PayslipModel.aggregate<{ _id: string; minor: number }>([
      { $match: this.baseFilter(scope, { runId: new Types.ObjectId(runId) }) },
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

  /**
   * A run's lines, summed by (currency, kind, origin) — P-HR-14 / U14-1.
   *
   * SUMMED POSITIVE INSIDE EACH `kind`, never netted. Direction is what `kind` means, so an earning
   * and a deduction are two answers rather than one difference; subtracting them here would be a
   * choice about what offsets what, which is accounting rather than arithmetic.
   *
   * `$ifNull` on the amount for the same reason the adjustment aggregate has it: a stored payslip
   * line always carries a figure — PY-7 refuses to issue one that does not — and the guard costs
   * nothing while making the query honest about the field being nullable in the contract.
   */
  async lineTotalsByOriginForRun(runId: string, scope: ScopeSelector): Promise<PayslipLineGroupRow[]> {
    return this.groupLines(runId, scope, {
      currency: '$currency',
      kind: '$lines.kind',
      origin: '$lines.origin',
    });
  }

  /** The same lines, split by the catalog item behind them (null for a leave or loan line). */
  async lineTotalsByPayItemForRun(
    runId: string,
    scope: ScopeSelector,
  ): Promise<PayslipLineGroupRow[]> {
    return this.groupLines(runId, scope, {
      currency: '$currency',
      kind: '$lines.kind',
      origin: '$lines.origin',
      payItemId: '$lines.payItemId',
      code: '$lines.code',
    });
  }

  /** The same lines, split by the branch the payslip was issued in (ADR-015, denormalized). */
  async lineTotalsByBranchForRun(
    runId: string,
    scope: ScopeSelector,
  ): Promise<PayslipLineGroupRow[]> {
    return this.groupLines(runId, scope, {
      currency: '$currency',
      kind: '$lines.kind',
      branchId: '$branchId',
    });
  }

  /**
   * The one pipeline behind all three splits — only the group key differs.
   *
   * Written once rather than three times because the parts that MUST NOT drift are the parts they
   * share: the scoped `$match`, the earnings-and-deductions concatenation, and the positive sum.
   * A second copy of this is where a missing `baseFilter` would eventually appear.
   */
  private async groupLines(
    runId: string,
    scope: ScopeSelector,
    key: Record<string, string>,
  ): Promise<PayslipLineGroupRow[]> {
    if (!Types.ObjectId.isValid(runId)) return [];
    const rows = await PayslipModel.aggregate<{
      _id: Record<string, unknown>;
      lines: number;
      amountMinor: number;
    }>([
      // The caller's scope, through the same filter the paginated read uses — a branch reader must
      // be shown their branch's cost and nothing wider (audit finding A2).
      { $match: this.baseFilter(scope, { runId: new Types.ObjectId(runId) }) },
      { $project: { currency: 1, branchId: 1, lines: { $concatArrays: ['$earnings', '$deductions'] } } },
      { $unwind: '$lines' },
      {
        $group: {
          _id: key,
          lines: { $sum: 1 },
          amountMinor: { $sum: { $ifNull: ['$lines.amountMinor', 0] } },
        },
      },
      { $sort: { '_id.currency': 1, '_id.kind': 1, '_id.origin': 1, '_id.code': 1 } },
    ]).exec();
    return rows.map((row) => ({
      currency: String(row._id['currency'] ?? ''),
      kind: String(row._id['kind'] ?? ''),
      origin: row._id['origin'] === undefined ? null : String(row._id['origin']),
      payItemId: row._id['payItemId'] == null ? null : String(row._id['payItemId']),
      code: row._id['code'] === undefined ? null : String(row._id['code']),
      branchId: row._id['branchId'] == null ? null : String(row._id['branchId']),
      lines: row.lines,
      amountMinor: row.amountMinor,
    }));
  }

  /** The employees this run issued to — the coverage check's "was paid" side. */
  async employeeIdsForRun(runId: string, scope: ScopeSelector): Promise<string[]> {
    if (!Types.ObjectId.isValid(runId)) return [];
    const ids = await PayslipModel.distinct(
      'employeeId',
      this.baseFilter(scope, { runId: new Types.ObjectId(runId) }),
    ).exec();
    return ids.map(String);
  }
}

export const payslipRepository = new PayslipRepository();
