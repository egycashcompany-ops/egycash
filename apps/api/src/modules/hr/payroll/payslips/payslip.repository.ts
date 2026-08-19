// Payslip data access.
//
// `branchId` is the ADR-015 scope axis, denormalized from the employee at issue time exactly as
// the pay-item assignments do. Unlike those, these rows ARE scoped here rather than inheriting
// from an employee the caller resolved first: a payslip list is a list of many employees at once,
// so there is no single employee whose visibility it could follow.
//
// There is no update and no delete. The base class provides them; nothing in this phase calls
// them, and a payslip is a document somebody was paid against.
import { Types, type FilterQuery } from 'mongoose';
import { type PayrollReportDimension, type PayrollReportGroupBy } from '@ecms/contracts';
import { BaseRepository } from '../../../../shared/base/base.repository';
import { type ScopeSelector } from '../../../../shared/types';
import { composeGroupKey, type FilterPlan } from '../report-builder/report-dimensions';
import { PayslipModel, type PayslipDoc } from './payslip.model';

/**
 * One group of payslip LINES, as the database summed them (P-HR-14 / U14-1).
 *
 * A single row shape for every split: the fields a given split did not group by come back
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
  /**
   * P-HR-25 — the cost centre the PAYSLIP was stamped with at issue (P-HR-23), never re-derived
   * from today's membership. Null is an ordinary answer: nobody was placed, or the payslip predates
   * the stamp entirely.
   */
  costCenterId: string | null;
  lines: number;
  amountMinor: number;
}

/**
 * Every axis this collection can be grouped by, in ONE place (P-HR-25).
 *
 * The three splits U14-1 states and the axis P-HR-25's report takes read from the same map, so the
 * report and the breakdown cannot answer differently about the same dimension. A second copy of
 * these keys is where that drift would eventually appear.
 *
 * `currency` and `kind` lead every key: direction is what `kind` means, and a total spanning two
 * currencies is a defect rather than a summary.
 */
/**
 * Which dimensions each P-HR-25 axis is made of.
 *
 * Scope B1 needs COMPOSABLE dimensions — a report groups by branch and cost centre at once, which a
 * fixed map of whole keys cannot express. So the keys are now composed from the atomic fragments in
 * `report-dimensions.ts`, and these four axes are stated as the compositions they always were.
 *
 * `payslip-group-keys.spec.ts` holds the composition to the LITERAL keys P-HR-25 shipped, field for
 * field. Decomposing a working query is exactly the kind of change that looks equivalent and is not,
 * so the equivalence is proven rather than asserted in a comment.
 */
const AXIS_DIMENSIONS: Readonly<Record<PayrollReportGroupBy, readonly PayrollReportDimension[]>> = {
  origin: ['kind', 'origin'],
  payItem: ['kind', 'origin', 'payItem'],
  branch: ['kind', 'branch'],
  costCenter: ['kind', 'costCenter'],
};

const GROUP_KEYS: Readonly<Record<PayrollReportGroupBy, Readonly<Record<string, string>>>> = {
  origin: composeGroupKey(AXIS_DIMENSIONS.origin),
  payItem: composeGroupKey(AXIS_DIMENSIONS.payItem),
  branch: composeGroupKey(AXIS_DIMENSIONS.branch),
  costCenter: composeGroupKey(AXIS_DIMENSIONS.costCenter),
};

export { AXIS_DIMENSIONS };

/** A group exactly as the database returned it: the composed `_id`, and the two sums. */
export interface PayslipGroupRow {
  _id: Record<string, unknown>;
  lines: number;
  amountMinor: number;
}

/** No filters — what every P-HR-14 / P-HR-25 read passes, since none of them filters. */
const EMPTY_FILTERS: FilterPlan = { pre: [], post: [] };

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
    super(PayslipModel, { branchField: 'branchId', departmentField: 'departmentId' });
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
    return this.groupLines(runId, scope, GROUP_KEYS.origin);
  }

  /** The same lines, split by the catalog item behind them (null for a leave or loan line). */
  async lineTotalsByPayItemForRun(
    runId: string,
    scope: ScopeSelector,
  ): Promise<PayslipLineGroupRow[]> {
    return this.groupLines(runId, scope, GROUP_KEYS.payItem);
  }

  /** The same lines, split by the branch the payslip was issued in (ADR-015, denormalized). */
  async lineTotalsByBranchForRun(
    runId: string,
    scope: ScopeSelector,
  ): Promise<PayslipLineGroupRow[]> {
    return this.groupLines(runId, scope, GROUP_KEYS.branch);
  }

  /**
   * The same lines again, split by an axis the CALLER chose (P-HR-25).
   *
   * The axis is a closed enum, so this adds no reach: every value it can take is a key the three
   * methods above were already allowed to group by, and the pipeline — including the scoped
   * `$match` — is the same one.
   */
  async lineTotalsByAxisForRun(
    runId: string,
    scope: ScopeSelector,
    axis: PayrollReportGroupBy,
  ): Promise<PayslipLineGroupRow[]> {
    return this.groupLines(runId, scope, GROUP_KEYS[axis]);
  }

  /**
   * The same lines again, grouped by SEVERAL dimensions at once and optionally filtered (scope B1).
   *
   * Returns the raw group rows rather than `PayslipLineGroupRow`, because a report's key is composed
   * from whichever dimensions it selected and no fixed shape can name them all. It runs the same
   * pipeline as everything above — the same scoped `$match`, the same concatenation, the same
   * positive sums — so a report can arrange what the breakdown shows, and can never reach past it.
   */
  async lineTotalsForReport(
    runId: string,
    scope: ScopeSelector,
    dimensions: readonly PayrollReportDimension[],
    filters: FilterPlan,
  ): Promise<PayslipGroupRow[]> {
    return this.aggregateGroups(runId, scope, composeGroupKey(dimensions), filters);
  }

  /**
   * The one pipeline behind every split — only the group key and the optional filters differ.
   *
   * Written once rather than five times because the parts that MUST NOT drift are the parts they
   * share: the scoped `$match`, the earnings-and-deductions concatenation, and the positive sum.
   * A second copy of this is where a missing `baseFilter` would eventually appear.
   */
  private async groupLines(
    runId: string,
    scope: ScopeSelector,
    key: Record<string, string>,
  ): Promise<PayslipLineGroupRow[]> {
    const rows = await this.aggregateGroups(runId, scope, key, EMPTY_FILTERS);
    return rows.map((row) => ({
      currency: String(row._id['currency'] ?? ''),
      kind: String(row._id['kind'] ?? ''),
      origin: row._id['origin'] === undefined ? null : String(row._id['origin']),
      payItemId: row._id['payItemId'] == null ? null : String(row._id['payItemId']),
      code: row._id['code'] === undefined ? null : String(row._id['code']),
      branchId: row._id['branchId'] == null ? null : String(row._id['branchId']),
      costCenterId: row._id['costCenterId'] == null ? null : String(row._id['costCenterId']),
      lines: row.lines,
      amountMinor: row.amountMinor,
    }));
  }

  private async aggregateGroups(
    runId: string,
    scope: ScopeSelector,
    key: Record<string, string>,
    filters: FilterPlan,
  ): Promise<PayslipGroupRow[]> {
    if (!Types.ObjectId.isValid(runId)) return [];
    const rows = await PayslipModel.aggregate<PayslipGroupRow>([
      // The caller's scope, through the same filter the paginated read uses — a branch reader must
      // be shown their branch's cost and nothing wider (audit finding A2).
      //
      // A user filter is one of the ADDITIONAL `$match` stages below, never this one. A `$match`
      // after a `$match` can only narrow what survived the first, so nothing a report asks for can
      // widen the scope — a property of the pipeline's shape, not of a check somebody must remember.
      { $match: this.baseFilter(scope, { runId: new Types.ObjectId(runId) }) },
      ...(filters.pre.length === 0
        ? []
        : [{ $match: { $and: filters.pre } as FilterQuery<PayslipDoc> }]),
      {
        $project: {
          currency: 1,
          branchId: 1,
          // P-HR-25 — carried through so the cost-centre axis can group by it. It is the stamp the
          // payslip was issued with, and projecting it changes no figure.
          costCenterId: 1,
          lines: { $concatArrays: ['$earnings', '$deductions'] },
        },
      },
      { $unwind: '$lines' },
      // Line-level filters land here rather than above: before the unwind, `lines.kind` would be
      // compared against an array instead of a value.
      ...(filters.post.length === 0 ? [] : [{ $match: { $and: filters.post } }]),
      {
        $group: {
          _id: key,
          lines: { $sum: 1 },
          amountMinor: { $sum: { $ifNull: ['$lines.amountMinor', 0] } },
        },
      },
      { $sort: { '_id.currency': 1, '_id.kind': 1, '_id.origin': 1, '_id.code': 1 } },
    ]).exec();
    return rows;
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
