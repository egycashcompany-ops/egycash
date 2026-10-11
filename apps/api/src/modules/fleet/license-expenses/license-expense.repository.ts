import { type FilterQuery, type PipelineStage } from 'mongoose';
import {
  type FleetLicenseExpensePaidBy,
  type FleetLicenseExpenseTotalsDto,
  type Paginated,
} from '@ecms/contracts';
import {
  BaseRepository,
  type ListParams,
  type SortDerivedField,
} from '../../../shared/base/base.repository';
import { FleetLicenseExpenseModel, type FleetLicenseExpenseDoc } from './license-expense.model';

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
