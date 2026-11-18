import { Types, type ClientSession, type FilterQuery, type PipelineStage } from 'mongoose';
import {
  FLEET_LICENSE_EXPENSE_KINDS,
  type FleetDashboardPeriodLicenceSpendDto,
  type FleetLicenseExpenseKind,
  type FleetLicenseExpensePaidBy,
  type FleetLicenseExpenseSettleStatus,
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
// are both halves' lists — or, under «النوع» / «التسوية», the MATCHED halves' only (D05). Each is
// spelled ONCE here, as an aggregation expression, and used twice — to order the table before the
// page is cut, and to sum the whole filtered set for the strip — so the column, its arrow and the
// figure above it cannot disagree.

/** Both memos' lines as one array — a half that is not there has none. */
const ALL_LINES = {
  $concatArrays: [{ $ifNull: ['$renewal.items', []] }, { $ifNull: ['$extension.items', []] }],
};

/** One line's cost inside `$reduce`: its amount — none written is nothing — times its count. */
const LINE_COST = {
  $multiply: [{ $ifNull: ['$$this.amount', 0] }, { $ifNull: ['$$this.count', 1] }],
};

/**
 * WHICH MEMOS of a record a filtered question is about (D05). A record holds up to two memos — a
 * renewal and an extension — and «النوع» / «التسوية» filter memo by memo
 * (license-expense.service.ts `expenseFilter`), so the figures must add up the memos that matched
 * and never their sibling: `kind` → that memo; `waiting` → the memos with no settlement; `settled`
 * → the settled ones; both → the memos that are both. Neither → every memo the record holds.
 */
export interface LicenseExpenseHalves {
  kind?: FleetLicenseExpenseKind | undefined;
  status?: FleetLicenseExpenseSettleStatus | undefined;
}

/** A half is there when it is not null — a missing field reads as null, not as «there». */
const holds = (half: 'renewal' | 'extension') => ({ $ne: [{ $ifNull: [`$${half}`, null] }, null] });

/** The memos `halves` can name at all — a `kind` rules the other out before any row is read. */
const halvesAsked = (halves: LicenseExpenseHalves): FleetLicenseExpenseKind[] =>
  FLEET_LICENSE_EXPENSE_KINDS.filter((half) => halves.kind === undefined || halves.kind === half);

/**
 * Whether one memo of the record is among those asked: held, and in the asked state. A missing
 * settlement field reads as null — waiting, as the filter's own clause reads it.
 */
const halfMatches = (half: FleetLicenseExpenseKind, halves: LicenseExpenseHalves) => {
  if (halves.status === undefined) return holds(half);
  const settled = { $ne: [{ $ifNull: [`$${settlementField(half)}`, null] }, null] };
  return { $and: [holds(half), halves.status === 'settled' ? settled : { $not: [settled] }] };
};

/** No `kind` and no `status`: every memo a record holds — the record's own figures. */
const isWhole = (halves: LicenseExpenseHalves | undefined): boolean =>
  halves === undefined || (halves.kind === undefined && halves.status === undefined);

/** The matched memos' lines as one array — `ALL_LINES` when every memo is asked. */
const matchedLines = (halves: LicenseExpenseHalves | undefined) =>
  halves === undefined || isWhole(halves)
    ? ALL_LINES
    : {
        $concatArrays: halvesAsked(halves).map((half) => ({
          $cond: [halfMatches(half, halves), { $ifNull: [`$${half}.items`, []] }, []],
        })),
      };

/**
 * «عدد المذكرات» — the MEMOS, never the records: a record holding a renewal and an extension is
 * two memos, each printed on its own sheet and each settled on its own (D05). Under a filter, the
 * memos that matched.
 */
const memosCountExpression = (halves: LicenseExpenseHalves = {}) => ({
  $add: halvesAsked(halves).map((half) => ({ $cond: [halfMatches(half, halves), 1, 0] })),
});

/** What the memo's lines add up to — all of them, or only those paid one way. */
export const linesTotalExpression = (
  paidBy?: FleetLicenseExpensePaidBy,
  halves?: LicenseExpenseHalves,
) => ({
  $reduce: {
    input: matchedLines(halves),
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

/**
 * One line's cost in whole piastres: its amount to the piastre, times its count. «تفصيل مصروفات
 * الفترة» sums its four groups this way so each pair adds up EXACTLY to the same total — every line
 * is in one memo and paid one way. For an amount entered in pounds and piastres (`egp()`), it is
 * the strip's `LINE_COST` to the piastre.
 */
const LINE_PIASTRES = {
  $multiply: [
    { $round: [{ $multiply: [{ $ifNull: ['$$this.amount', 0] }, 100] }, 0] },
    { $ifNull: ['$$this.count', 1] },
  ],
};

/** Σ `LINE_PIASTRES` over `input` — all its lines, or only those paid one way. */
const linesPiastres = (input: unknown, paidBy?: FleetLicenseExpensePaidBy) => ({
  $reduce: {
    input,
    initialValue: 0,
    in: {
      $add: [
        '$$value',
        paidBy === undefined
          ? LINE_PIASTRES
          : { $cond: [{ $eq: ['$$this.paidBy', paidBy] }, LINE_PIASTRES, 0] },
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

/** The cars the matched memos name — `CARS_COUNT_EXPRESSION` when every memo is asked. */
const carsCountExpression = (halves: LicenseExpenseHalves | undefined) =>
  halves === undefined || isWhole(halves)
    ? CARS_COUNT_EXPRESSION
    : {
        $add: halvesAsked(halves).map((half) => ({
          $cond: [halfMatches(half, halves), { $size: { $ifNull: [`$${half}.vehicles`, []] } }, 0],
        })),
      };

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

/**
 * The same keys under a filtered question: the cars and the money of the MATCHED memos (D05), so
 * a column's arrow orders the figures its cells and the strip print. «النوع» still ranks the
 * memos the record holds — it is the pills, not a figure.
 */
export const licenseExpenseSorts = (
  halves: LicenseExpenseHalves | undefined,
): readonly SortDerivedField[] =>
  halves === undefined || isWhole(halves)
    ? LICENSE_EXPENSE_SORTS
    : [
        { key: 'kindOrder', expression: KIND_ORDER_EXPRESSION },
        { key: 'carsCount', expression: carsCountExpression(halves) },
        { key: 'visaTotal', expression: toPiastre(linesTotalExpression('visa', halves)) },
        { key: 'cashTotal', expression: toPiastre(linesTotalExpression('cash', halves)) },
        { key: 'total', expression: toPiastre(linesTotalExpression(undefined, halves)) },
      ];

interface TotalsRow {
  count: number;
  cars: number;
  /** Whole piastres. */
  visa: number;
  cash: number;
}

interface SpendRow {
  count: number;
  cars: number;
  visa: number;
  cash: number;
  renewal: number;
  extension: number;
}

/** Whole piastres → pounds, never `-0`. */
const fromPiastres = (piastres: number): number => {
  const rounded = Math.round(piastres);
  return rounded === 0 ? 0 : rounded / 100;
};

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

  /**
   * «حذف العملية» of a settlement: one memo of a record is «لم تُسوَّ بعد» again — only while THAT
   * settlement still holds it (the condition rides inside the write), so a part another settlement
   * took is never touched. The record unlocks only when its other memo is not settled either (the
   * lock is the record's). Bypasses `writeConditions` exactly as `markSettled` does, and bumps the
   * version, so an edit opened before it is told it is stale. `false` when the condition missed.
   */
  async releaseSettlement(
    id: string,
    part: FleetLicenseExpenseKind,
    operationId: Types.ObjectId,
    by: string | null,
    session: ClientSession,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const field = settlementField(part);
    const result = await this.model
      .updateOne(
        { _id: new Types.ObjectId(id), isDeleted: false, [`${field}.operationId`]: operationId },
        {
          $set: {
            [field]: null,
            updatedBy: by === null || !Types.ObjectId.isValid(by) ? null : new Types.ObjectId(by),
          },
          $inc: { __v: 1 },
        },
        { session },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  /**
   * The table: the date, and every figure the screen derives, each with its arrow — over the
   * matched memos when `halves` filters (D05).
   */
  async listExpenses(
    params: ListParams<FleetLicenseExpenseDoc>,
    halves?: LicenseExpenseHalves,
  ): Promise<Paginated<FleetLicenseExpenseDoc>> {
    const sorts = licenseExpenseSorts(halves);
    return this.list({
      ...params,
      sortableFields: ['date', 'createdAt', 'updatedAt', ...sorts.map((field) => field.key)],
      sortDerived: sorts,
    });
  }

  /**
   * «الإحصائيات» over EVERY record `filter` matches — in the database, never over a page: no
   * `$skip`, no `$limit`, and the same soft-delete gate (`baseFilter`) the list passes through.
   *
   * The figures are the MATCHED memos' (`halves`, D05): under «النوع» or «التسوية» a record's other
   * memo — another kind, or already settled — adds no money, no cars and no count, so «لم تُسوَّ»
   * reads what «تسوية عهدة» would take off the fund. `count` is memos, not records. The money is
   * summed line by line in whole piastres (D51) — `spendDigest`'s arithmetic, so the strip and the
   * dashboard's «مصروفات التراخيص في الفترة» agree to the piastre.
   */
  async totals(
    filter: FilterQuery<FleetLicenseExpenseDoc>,
    halves?: LicenseExpenseHalves,
  ): Promise<FleetLicenseExpenseTotalsDto> {
    const lines = matchedLines(halves);
    const pipeline: PipelineStage[] = [
      { $match: this.baseFilter(undefined, filter) },
      {
        $group: {
          _id: null,
          count: { $sum: memosCountExpression(halves) },
          cars: { $sum: carsCountExpression(halves) },
          visa: { $sum: linesPiastres(lines, 'visa') },
          cash: { $sum: linesPiastres(lines, 'cash') },
        },
      },
    ];
    const [row] = await this.model.aggregate<TotalsRow>(pipeline).exec();
    return {
      count: row?.count ?? 0,
      cars: row?.cars ?? 0,
      visaTotal: fromPiastres(row?.visa ?? 0),
      cashTotal: fromPiastres(row?.cash ?? 0),
    };
  }

  /**
   * «مصروفات التراخيص في الفترة» and «تفصيل مصروفات الفترة» (the fleet dashboard's R2
   * `licenceSpend`) — ONE aggregate over every record `filter` matches, through
   * `ix_license_expense_date` when it names a day: the register's own count and cars (the strip's
   * expressions — `count` is memos, D05), and the money split twice — by memo (the renewal's
   * lines, the extension's) and by payment (visa, cash) — each in whole piastres, so renewal +
   * extension = visa + cash = total. `halves` narrows to the matched memos exactly as `totals`.
   */
  async spendDigest(
    filter: FilterQuery<FleetLicenseExpenseDoc>,
    halves?: LicenseExpenseHalves,
  ): Promise<FleetDashboardPeriodLicenceSpendDto> {
    const lines = matchedLines(halves);
    // One memo's own column: its lines when it is asked (and, filtered, when it matched); none when
    // `kind` names the other.
    const half = (kind: FleetLicenseExpenseKind) =>
      halves === undefined || isWhole(halves)
        ? { $ifNull: [`$${kind}.items`, []] }
        : halves.kind !== undefined && halves.kind !== kind
          ? []
          : matchedLines({ ...halves, kind });
    const pipeline: PipelineStage[] = [
      { $match: this.baseFilter(undefined, filter) },
      {
        $group: {
          _id: null,
          count: { $sum: memosCountExpression(halves) },
          cars: { $sum: carsCountExpression(halves) },
          visa: { $sum: linesPiastres(lines, 'visa') },
          cash: { $sum: linesPiastres(lines, 'cash') },
          renewal: { $sum: linesPiastres(half('renewal')) },
          extension: { $sum: linesPiastres(half('extension')) },
        },
      },
    ];
    const [row] = await this.model.aggregate<SpendRow>(pipeline).exec();
    const visa = Math.round(row?.visa ?? 0);
    const cash = Math.round(row?.cash ?? 0);
    return {
      count: row?.count ?? 0,
      cars: row?.cars ?? 0,
      visa: fromPiastres(visa),
      cash: fromPiastres(cash),
      renewal: fromPiastres(row?.renewal ?? 0),
      extension: fromPiastres(row?.extension ?? 0),
      total: fromPiastres(visa + cash),
    };
  }
}

export const fleetLicenseExpenseRepository = new FleetLicenseExpenseRepository();
