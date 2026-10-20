import { Types, type ClientSession, type FilterQuery, type PipelineStage } from 'mongoose';
import {
  type FleetLicenseExpenseKind,
  type FleetLicenseExpensePaidBy,
  type FleetLicenseExpenseTotalsDto,
  type Paginated,
} from '@ecms/contracts';
import {
  BaseRepository,
  type ListParams,
  type SortDerivedField,
} from '../../../shared/base/base.repository';
import { BusinessRuleError } from '../../../shared/errors';
import { FleetLicenseExpenseModel, type FleetLicenseExpenseDoc } from './license-expense.model';
import {
  LICENSE_EXPENSE_WRITABLE,
  licenseExpenseLockedMessage,
  settledDayOf,
  settlementField,
} from './license-expense-lock';

// «الإحصائيات» and the arrows on the money and the cars read figures a memo never stores: a total is
// every line's amount times its count, over the renewal and the extension together, and the cars
// are both halves' lists. Each is spelled ONCE here, as an aggregation expression, and used twice —
// to order the table before the page is cut, and to sum the whole filtered set for the strip — so
// the column, its arrow and the figure above it cannot disagree.

/** Both memos' lines as one array — a half that is not there has none. */
const ALL_LINES = {
  $concatArrays: [{ $ifNull: ['$renewal.items', []] }, { $ifNull: ['$extension.items', []] }],
};

/** One line's cost inside `$reduce`: its amount — none written is nothing — times its count. */
const LINE_COST = {
  $multiply: [{ $ifNull: ['$$this.amount', 0] }, { $ifNull: ['$$this.count', 1] }],
};

/** What the memo's lines add up to — all of them, or only those paid one way. */
export const linesTotalExpression = (paidBy?: FleetLicenseExpensePaidBy) => ({
  $reduce: {
    input: ALL_LINES,
    initialValue: 0,
    in: {
      $add: [
        '$$value',
        paidBy === undefined
          ? LINE_COST
          : { $cond: [{ $eq: ['$$this.paidBy', paidBy] }, LINE_COST, 0] },
      ],
    },
  },
});

/** How many cars the record names — the renewal's and the extension's, hand-typed plates too. */
export const CARS_COUNT_EXPRESSION = {
  $add: [
    { $size: { $ifNull: ['$renewal.vehicles', []] } },
    { $size: { $ifNull: ['$extension.vehicles', []] } },
  ],
};

/** A half is there when it is not null — a missing field reads as null, not as «there». */
const holds = (half: 'renewal' | 'extension') => ({ $ne: [{ $ifNull: [`$${half}`, null] }, null] });

/**
 * «النوع» in the order the column reads: a renewal, then a record holding both, then an extension —
 * the pills left to right.
 */
export const KIND_ORDER_EXPRESSION = {
  $cond: [holds('renewal'), { $cond: [holds('extension'), 1, 0] }, 2],
};

/**
 * A sum ordered as the cell prints it — to the piastre. 0.1 + 0.2 by the card is 0.30000000000000004
 * in the database and «0.30» on the screen; unrounded, it would sort ABOVE a memo of 0.30 and never
 * reach the next arrow («ثم التاريخ»), which is the whole point of ordering by two columns.
 */
const toPiastre = (expression: unknown) => ({ $round: [expression, 2] });

/** The table's computed sort keys — names of this repository's choosing, never stored. */
export const LICENSE_EXPENSE_SORTS: readonly SortDerivedField[] = [
  { key: 'kindOrder', expression: KIND_ORDER_EXPRESSION },
  { key: 'carsCount', expression: CARS_COUNT_EXPRESSION },
  { key: 'visaTotal', expression: toPiastre(linesTotalExpression('visa')) },
  { key: 'cashTotal', expression: toPiastre(linesTotalExpression('cash')) },
  { key: 'total', expression: toPiastre(linesTotalExpression()) },
];

/** To the piastre — a `$sum` of pounds carries binary residue the strip would print. */
const roundMoney = (value: number): number => {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
};

interface TotalsRow {
  count: number;
  cars: number;
  visaTotal: number;
  cashTotal: number;
}

class FleetLicenseExpenseRepository extends BaseRepository<FleetLicenseExpenseDoc> {
  constructor() {
    // No org placement of its own: a memo is the department's paperwork, and who may read it is
    // decided by `fleetLicenseExpense.view` alone.
    super(FleetLicenseExpenseModel, {});
  }

  /**
   * «تسوية عهدة» locks a record: once either memo is settled, no edit and no delete passes — the
   * condition rides inside the same atomic write, so a settlement landing between a read and its
   * write is never overtaken (license-expense-lock.ts).
   */
  protected override writeConditions(): FilterQuery<FleetLicenseExpenseDoc> {
    return { ...LICENSE_EXPENSE_WRITABLE };
  }

  protected override assertWritable(current: FleetLicenseExpenseDoc): void {
    const day = settledDayOf(current);
    if (day !== null)
      throw new BusinessRuleError(licenseExpenseLockedMessage(String(current._id), day));
  }

  /** The live records among `ids`, read inside the settlement's transaction. */
  async findLiveByIds(
    ids: readonly string[],
    session?: ClientSession,
  ): Promise<FleetLicenseExpenseDoc[]> {
    const distinct = [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id));
    if (distinct.length === 0) return [];
    return this.model
      .find({ _id: { $in: distinct.map((id) => new Types.ObjectId(id)) }, isDeleted: false })
      .session(session ?? null)
      .lean<FleetLicenseExpenseDoc[]>()
      .exec();
  }

  /**
   * Every live record with a memo still waiting for its settlement — what «تسوية عهدة» offers.
   * Oldest first.
   */
  async findUnsettled(): Promise<FleetLicenseExpenseDoc[]> {
    return this.model
      .find({
        isDeleted: false,
        $or: [
          { renewal: { $ne: null }, renewalSettlement: null },
          { extension: { $ne: null }, extensionSettlement: null },
        ],
      })
      .sort({ date: 1, createdAt: 1, _id: 1 })
      .lean<FleetLicenseExpenseDoc[]>()
      .exec();
  }

  /**
   * Settle one memo of a record — only if the record is live, holds that memo, and nobody settled
   * it first. `false` when the condition missed (the caller aborts the whole settlement). Bumps
   * the version, so an edit opened before it is told it is stale rather than overwriting it.
   */
  async markSettled(
    id: string,
    part: FleetLicenseExpenseKind,
    settlement: { operationId: Types.ObjectId; settledAt: Date },
    by: string,
    session: ClientSession,
  ): Promise<boolean> {
    const field = settlementField(part);
    const result = await this.model
      .updateOne(
        { _id: new Types.ObjectId(id), isDeleted: false, [part]: { $ne: null }, [field]: null },
        {
          $set: { [field]: settlement, updatedBy: new Types.ObjectId(by) },
          $inc: { __v: 1 },
        },
        { session },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  /** The table: the date, and every figure the screen derives, each with its arrow. */
  async listExpenses(
    params: ListParams<FleetLicenseExpenseDoc>,
  ): Promise<Paginated<FleetLicenseExpenseDoc>> {
    return this.list({
      ...params,
      sortableFields: [
        'date',
        'createdAt',
        'updatedAt',
        ...LICENSE_EXPENSE_SORTS.map((field) => field.key),
      ],
      sortDerived: LICENSE_EXPENSE_SORTS,
    });
  }

  /**
   * «الإحصائيات» over EVERY memo `filter` matches — in the database, never over a page: no `$skip`,
   * no `$limit`, and the same soft-delete gate (`baseFilter`) the list passes through.
   */
  async totals(filter: FilterQuery<FleetLicenseExpenseDoc>): Promise<FleetLicenseExpenseTotalsDto> {
    const pipeline: PipelineStage[] = [
      { $match: this.baseFilter(undefined, filter) },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          cars: { $sum: CARS_COUNT_EXPRESSION },
          visaTotal: { $sum: linesTotalExpression('visa') },
          cashTotal: { $sum: linesTotalExpression('cash') },
        },
      },
    ];
    const [row] = await this.model.aggregate<TotalsRow>(pipeline).exec();
    return {
      count: row?.count ?? 0,
      cars: row?.cars ?? 0,
      visaTotal: roundMoney(row?.visaTotal ?? 0),
      cashTotal: roundMoney(row?.cashTotal ?? 0),
    };
  }
}

export const fleetLicenseExpenseRepository = new FleetLicenseExpenseRepository();
