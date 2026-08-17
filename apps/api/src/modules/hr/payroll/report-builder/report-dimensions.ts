// The server-side maps — the security core of scope B1.
//
// EVERY DATABASE PATH IN THE REPORT BUILDER IS WRITTEN HERE, AND NOWHERE ELSE. A request carries
// names from a closed vocabulary (`'branch'`), never paths (`'$branchId'`), and this file is the
// only place that turns one into the other. That is what makes "no field path from the user reaches
// Mongo" true by construction: there is no path in a request to reach it with.
//
// PURE. No database, no request, no clock — every function here is a value in and a value out, which
// is why the whole of it is testable without a connection.
//
// WHAT IS DELIBERATELY ABSENT: no `$where`, no `$expr`, no `$function`, no regular expression built
// from input, and no way to name a collection, a stage or an operator. A filter chooses a value; it
// never chooses a shape.
import { Types, type FilterQuery } from 'mongoose';
import {
  PAYROLL_REPORT_NULL_VALUE,
  type PayrollReportDimension,
  type PayrollReportFilter,
  type PayrollReportFilterField,
} from '@ecms/contracts';

/**
 * Present in every grouping key, always.
 *
 * Not a dimension and not selectable: there is no exchange rate anywhere in this system, so a row
 * spanning two currencies would be a defect wearing the costume of a summary. It leads the key
 * rather than being appended, so every `_id` reads currency-first.
 */
export const CURRENCY_KEY: Readonly<Record<string, string>> = { currency: '$currency' };

/**
 * One dimension's contribution to the grouping key.
 *
 * `payItem` contributes TWO fields, and that is not an inconsistency: the id identifies the item and
 * the code is what the LINE stored, kept so a later rename cannot restate a document somebody was
 * paid against. `branch` and `costCenter` read the payslip's own snapshot fields.
 */
export const DIMENSION_KEYS: Readonly<
  Record<PayrollReportDimension, Readonly<Record<string, string>>>
> = {
  kind: { kind: '$lines.kind' },
  origin: { origin: '$lines.origin' },
  payItem: { payItemId: '$lines.payItemId', code: '$lines.code' },
  branch: { branchId: '$branchId' },
  costCenter: { costCenterId: '$costCenterId' },
};

/**
 * The grouping key for a set of dimensions.
 *
 * Currency first, then the dimensions in the order this vocabulary declares them, so the same
 * selection always produces the same key whatever order the caller listed it in.
 */
export const composeGroupKey = (
  dimensions: readonly PayrollReportDimension[],
): Record<string, string> => {
  const key: Record<string, string> = { ...CURRENCY_KEY };
  for (const dimension of ORDERED_DIMENSIONS) {
    if (dimensions.includes(dimension)) Object.assign(key, DIMENSION_KEYS[dimension]);
  }
  return key;
};

/** The canonical order — the same one the contract declares. */
const ORDERED_DIMENSIONS: readonly PayrollReportDimension[] = [
  'kind',
  'origin',
  'payItem',
  'branch',
  'costCenter',
];

// ── Filters ─────────────────────────────────────────────────────────────────

/**
 * Where each filterable field lives in the pipeline.
 *
 * This is not decoration. A payslip-level field (`branchId`) can be matched BEFORE the lines are
 * unwound, and a line-level field (`lines.kind`) only after — matching a line field too early would
 * silently compare against an array, and matching a payslip field too late would work but scan more
 * documents than it needs to.
 */
const FILTER_PATHS: Readonly<Record<PayrollReportFilterField, { path: string; stage: 'pre' | 'post' }>> = {
  currency: { path: 'currency', stage: 'pre' },
  branch: { path: 'branchId', stage: 'pre' },
  costCenter: { path: 'costCenterId', stage: 'pre' },
  kind: { path: 'lines.kind', stage: 'post' },
  origin: { path: 'lines.origin', stage: 'post' },
  payItem: { path: 'lines.payItemId', stage: 'post' },
};

const ID_VALUED: readonly PayrollReportFilterField[] = ['payItem', 'branch', 'costCenter'];

/**
 * A filter value, as the database stores it.
 *
 * `none` becomes `null` — the real group of payslips issued before cost centres existed, and of
 * lines belonging to no pay item. An id becomes an ObjectId. Everything else is the string it
 * already was; the contract has already refused anything that does not fit its field.
 */
const storedValue = (field: PayrollReportFilterField, value: string): unknown => {
  if (value === PAYROLL_REPORT_NULL_VALUE) return null;
  if (ID_VALUED.includes(field)) return new Types.ObjectId(value);
  return value;
};

/** One filter as a Mongo condition. The OPERATOR comes from a closed enum; only values are input. */
const condition = (filter: PayrollReportFilter): FilterQuery<unknown> => {
  const { path } = FILTER_PATHS[filter.field];
  const values = filter.values.map((value) => storedValue(filter.field, value));
  const single = values[0];

  if (filter.op === 'eq') return { [path]: single };
  if (filter.op === 'ne') return { [path]: { $ne: single } };
  if (filter.op === 'in') return { [path]: { $in: values } };
  return { [path]: { $nin: values } };
};

export interface FilterPlan {
  /** Matched before the lines are unwound — payslip-level fields. */
  pre: FilterQuery<unknown>[];
  /** Matched after — line-level fields. */
  post: FilterQuery<unknown>[];
}

/**
 * Every filter, split by the stage it belongs to.
 *
 * THESE ARE ADDITIONAL STAGES, never a replacement for the scoped `$match` that precedes them. A
 * `$match` after another `$match` can only narrow what survived the first, so no filter — however
 * it is written — can widen `baseFilter(scope, { runId })`. That is a property of the pipeline's
 * shape rather than of any check performed here, which is why it cannot be forgotten.
 */
export const planFilters = (filters: readonly PayrollReportFilter[]): FilterPlan => {
  const plan: FilterPlan = { pre: [], post: [] };
  for (const filter of filters) {
    plan[FILTER_PATHS[filter.field].stage].push(condition(filter));
  }
  return plan;
};

// ── Sorting ─────────────────────────────────────────────────────────────────

/**
 * The value a row sorts by, for one key.
 *
 * Sorting happens in JavaScript rather than in the pipeline, for one reason that decides it: a
 * calculated column does not exist until after the aggregation, so a report sorted by one could not
 * be sorted by the database at all. Doing it in one place for every key beats doing it in two places
 * for two kinds of key, and the row count here is bounded by the cardinality of the dimensions
 * rather than by the number of payslips.
 */
export interface SortableRow {
  currency: string;
  measures: Record<string, number>;
  calculated: Record<string, number | null>;
  cells: { dimension: PayrollReportDimension; id: string | null; code: string | null }[];
}

const sortValue = (row: SortableRow, key: string): string | number | null => {
  if (key === 'currency') return row.currency;
  if (key in row.measures) return row.measures[key] ?? null;
  if (key in row.calculated) return row.calculated[key] ?? null;
  const cell = row.cells.find((c) => c.dimension === key);
  if (cell === undefined) return null;
  return cell.code ?? cell.id;
};

/**
 * Deterministic order.
 *
 * A `null` — an uncomputable column, an absent dimension — sorts last in both directions rather than
 * jumping to the top when the direction flips, because "unknown" is not a small number.
 *
 * The tiebreak is what makes this deterministic rather than merely sorted: two rows that tie on the
 * requested key are ordered by currency and then by their dimension values, so the same data comes
 * back in the same order every time. Without it, a report would quietly reshuffle between two runs
 * that asked the identical question.
 */
export const sortRows = <T extends SortableRow>(
  rows: readonly T[],
  sort: { key: string; direction: 'asc' | 'desc' } | null,
): T[] => {
  const tiebreak = (a: T, b: T): number =>
    a.currency.localeCompare(b.currency) ||
    a.cells
      .map((c) => c.code ?? c.id ?? '')
      .join('|')
      .localeCompare(b.cells.map((c) => c.code ?? c.id ?? '').join('|'));

  return [...rows].sort((a, b) => {
    if (sort === null) return tiebreak(a, b);
    const left = sortValue(a, sort.key);
    const right = sortValue(b, sort.key);

    if (left === null && right === null) return tiebreak(a, b);
    if (left === null) return 1;
    if (right === null) return -1;

    const compared =
      typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right));
    if (compared !== 0) return sort.direction === 'asc' ? compared : -compared;
    return tiebreak(a, b);
  });
};
