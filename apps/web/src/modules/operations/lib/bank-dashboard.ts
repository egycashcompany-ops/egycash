// «لوحة البنك بفروعه» (Round 25) — the decisions of a bank's dashboard over the server's answer
// (`GET /operations/reports/banks/:bankId/branches`), pure, so they are asserted directly.
//
// THE OWNER: «صفحة تقرير البنوك عاوز فى الجدول عند البنك فى الاخر بعد الصناديق يكون فيه سهم ادوس عليه
// يفتح زى داش برود كدا للبنك بالفروع بتاعته». The arrow at the end of a bank's row opens this
// dashboard over the page, for exactly the period the page shows; it is named in the address
// (`?bank=…`), so a link to it opens it, and Back closes it.
//
// WHAT THE SERVER DECIDES AND WHAT THIS DOES. The server rolls the bank's محصنات up by branch through
// the bank report's own roll-up — so the branches add up to the bank's row, and its `total` IS that
// row. This file only views it: the rows as the report table draws them, ordered by the column the
// reader clicked; the bars of the two charts; and the words of the address.
import {
  type OperationsBankBranchReportRowDto,
  type OperationsBankBranchReportSide,
  type OperationsCurrencyDto,
} from '@ecms/contracts';
import { reportMoney, type ReportBoardRow } from './report-board';

// ── The address ──────────────────────────────────────────────────────────────────────────────

/** The bank whose dashboard is open — absent, none is. */
export const BANK_DASHBOARD_PARAM = 'bank';
/** Which branch files a shipment — absent is «من فرع», the server's default. */
export const BANK_DASHBOARD_SIDE_PARAM = 'bankSide';

/** The side the address names: «إلى فرع» only when it says so, «من فرع» otherwise. */
export const bankDashboardSide = (value: string | null): OperationsBankBranchReportSide =>
  value === 'destination' ? 'destination' : 'origin';

/**
 * The address with the dashboard of `bankId` open (or, with null, closed) — every other parameter
 * kept: the period and the name filter are the page's, and the dashboard reads them.
 */
export const withBankDashboard = (
  params: URLSearchParams,
  bankId: string | null,
  side: OperationsBankBranchReportSide = 'origin',
): URLSearchParams => {
  const next = new URLSearchParams(params);
  if (bankId === null) {
    next.delete(BANK_DASHBOARD_PARAM);
    next.delete(BANK_DASHBOARD_SIDE_PARAM);
    return next;
  }
  next.set(BANK_DASHBOARD_PARAM, bankId);
  if (side === 'destination') next.set(BANK_DASHBOARD_SIDE_PARAM, side);
  else next.delete(BANK_DASHBOARD_SIDE_PARAM);
  return next;
};

// ── The rows ────────────────────────────────────────────────────────────────────────────────

/** A branch's row as the report table draws it — plus what the dashboard says beside its name. */
export interface BranchBoardRow extends ReportBoardRow {
  code: string | null;
  /** «المنطقة» — the branch's operations area. */
  areaName: string | null;
  /** The branch's own bank, when it is not this bank's branch. */
  otherBankName: string | null;
}

/**
 * The server's rows as the table's: keyed by the branch, a branch that no longer resolves drawn as
 * the report's unattributed bucket («غير منسوب») — kept, never dropped.
 */
export const branchBoardRows = (
  rows: readonly OperationsBankBranchReportRowDto[],
): BranchBoardRow[] =>
  rows.map((row) => ({
    key: row.branchId ?? 'unattributed',
    label: row.branchName,
    unattributed: row.branchId === null,
    totals: row.totals,
    code: row.branchCode,
    areaName: row.areaName,
    otherBankName: row.otherBankName,
  }));

// ── The order ────────────────────────────────────────────────────────────────────────────────

/** What the branches can be ordered by — the table's columns, in their order. */
export type BranchSortKey =
  'label' | 'detail' | 'count' | 'egp' | 'usd' | 'others' | 'bags' | 'cartons' | 'boxes';

export interface BranchSort {
  by: BranchSortKey;
  dir: 'asc' | 'desc';
}

/** The pound first — the money is what a bank's dashboard is read for — largest at the top. */
export const DEFAULT_BRANCH_SORT: BranchSort = { by: 'egp', dir: 'desc' };

const WORD_KEYS: ReadonlySet<BranchSortKey> = new Set(['label', 'detail']);

/**
 * A click on a column's head: the column the table is sorted by turns round; another starts at its
 * natural end — a name or an area from أ, a figure from the largest.
 */
export const nextBranchSort = (current: BranchSort, key: BranchSortKey): BranchSort =>
  current.by === key
    ? { by: key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
    : { by: key, dir: WORD_KEYS.has(key) ? 'asc' : 'desc' };

/** A row's figure for a column — the money split the boards' way (`reportMoney`). */
const figureOf = (
  row: BranchBoardRow,
  key: Exclude<BranchSortKey, 'label' | 'detail'>,
  catalog: readonly OperationsCurrencyDto[],
): number => {
  switch (key) {
    case 'count':
      return row.totals.shipmentCount;
    case 'bags':
      return row.totals.bagCount;
    case 'cartons':
      return row.totals.cartonCount;
    case 'boxes':
      return row.totals.boxCount;
    default: {
      const money = reportMoney(row.totals.currencies, catalog);
      return key === 'egp' ? money.egp : key === 'usd' ? money.usd : money.othersSum;
    }
  }
};

const byName = (a: BranchBoardRow, b: BranchBoardRow): number =>
  a.label.localeCompare(b.label, 'ar');

/**
 * The rows in the order asked for — ties by name, so two runs read alike — and the branch that no
 * longer resolves LAST whatever the order, just above «الإجمالي», as the reports keep their bucket.
 * A branch with no area sorts after every named one either way.
 */
export const sortBranchRows = (
  rows: readonly BranchBoardRow[],
  catalog: readonly OperationsCurrencyDto[],
  sort: BranchSort,
): BranchBoardRow[] => {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const compare = (a: BranchBoardRow, b: BranchBoardRow): number => {
    if (sort.by === 'label') return sign * byName(a, b);
    if (sort.by === 'detail') {
      const left = a.areaName ?? '';
      const right = b.areaName ?? '';
      if (left === '' && right === '') return byName(a, b);
      if (left === '' || right === '') return left === '' ? 1 : -1;
      return sign * left.localeCompare(right, 'ar') || byName(a, b);
    }
    return sign * (figureOf(a, sort.by, catalog) - figureOf(b, sort.by, catalog)) || byName(a, b);
  };
  return [...rows].sort((a, b) => Number(a.unattributed) - Number(b.unattributed) || compare(a, b));
};

// ── The two charts ───────────────────────────────────────────────────────────────────────────

/** What a chart measures: the pound, or how many محصنات. */
export type BranchMeasure = 'egp' | 'count';

/** One bar of a chart. */
export interface BranchBar {
  key: string;
  /** The branch's name — or, for the folded bar, empty (the screen words it with `rest`). */
  label: string;
  unattributed: boolean;
  otherBankName: string | null;
  value: number;
  /** Its length, as a share of the longest bar shown (0–1). */
  share: number;
  /** How many branches the folded «باقي الفروع» bar holds — 0 on a branch's own bar. */
  rest: number;
}

/** How many branches a chart names before folding the rest into one bar. */
export const BRANCH_BARS_SHOWN = 8;

/**
 * A chart's bars: the branches with any of the measure, largest first (ties by name, the bucket of
 * unresolved branches after a named one), the first
 * `limit` named and every further one folded into ONE bar, «باقي الفروع (n)» — a bank of sixty
 * branches stays a chart of nine lines. A branch with none of the measure is not a bar (the table
 * lists it); the bucket of unresolved branches is a bar like any other. Each bar's length is its
 * share of the longest shown, the folded one included.
 */
export const branchBars = (
  rows: readonly BranchBoardRow[],
  catalog: readonly OperationsCurrencyDto[],
  measure: BranchMeasure,
  limit = BRANCH_BARS_SHOWN,
): BranchBar[] => {
  const valued = rows
    .map((row) => ({ row, value: figureOf(row, measure, catalog) }))
    .filter((entry) => entry.value > 0)
    .sort(
      (a, b) =>
        b.value - a.value ||
        Number(a.row.unattributed) - Number(b.row.unattributed) ||
        byName(a.row, b.row),
    );
  const named = valued.slice(0, limit);
  const folded = valued.slice(limit);
  const bars: Omit<BranchBar, 'share'>[] = named.map(({ row, value }) => ({
    key: row.key,
    label: row.label,
    unattributed: row.unattributed,
    otherBankName: row.otherBankName,
    value,
    rest: 0,
  }));
  if (folded.length > 0) {
    bars.push({
      key: 'rest',
      label: '',
      unattributed: false,
      otherBankName: null,
      value: folded.reduce((sum, entry) => sum + entry.value, 0),
      rest: folded.length,
    });
  }
  const longest = bars.reduce((max, bar) => Math.max(max, bar.value), 0);
  return bars.map((bar) => ({ ...bar, share: longest === 0 ? 0 : bar.value / longest }));
};
