// The report roll-up, as a pure decision over already-fetched rows.
//
// WHY THIS IS NOT AN AGGREGATION PIPELINE. The legacy reports were two ~300-line `$facet`
// pipelines, and all three of their known defects came from pipeline mechanics rather than from
// business logic: package counts inflated by an `$unwind` over currencies (Q26), a grand total
// concatenated into the results array (Q27), and documents silently dropped by a `$zip` without
// `useLongestLength` followed by an `$unwind` without `preserveNullAndEmptyArrays` (Q28).
//
// A month of one desk's shipments is a small set. Rolling it up in code makes each of those three
// decisions a line somebody can read and a test somebody can write, which is worth more here than
// pushing the work into the database.
import {
  type OperationsBankReportRowDto,
  type OperationsCaptainReportRowDto,
  type OperationsReportTotalsDto,
} from '@ecms/contracts';

/** One shipment, flattened to exactly what the roll-up needs. */
export interface ReportInputRow {
  shipmentId: string;
  captainEmployeeId: string | null;
  captainName: string;
  bankId: string | null;
  bankName: string;
  /** Package counts belong to the SHIPMENT, counted once — the Q26 fix, in one place. */
  bagCount: number;
  cartonCount: number;
  boxCount: number;
  lines: { currencyId: string; currencyName: string; amount: number }[];
}

const emptyTotals = (): OperationsReportTotalsDto => ({
  shipmentCount: 0,
  bagCount: 0,
  cartonCount: 0,
  boxCount: 0,
  currencies: [],
});

/**
 * Fold one shipment into a running total.
 *
 * Note the ORDER of the two facts: the shipment is counted, and its packages added, BEFORE its
 * currency lines are walked — and independently of how many there are. That is the whole of the
 * Q26 fix, and the reason a shipment with no lines at all still counts (Q28).
 */
const addRow = (totals: OperationsReportTotalsDto, row: ReportInputRow): void => {
  totals.shipmentCount += 1;
  totals.bagCount += row.bagCount;
  totals.cartonCount += row.cartonCount;
  totals.boxCount += row.boxCount;

  for (const line of row.lines) {
    const existing = totals.currencies.find((c) => c.currencyId === line.currencyId);
    if (existing === undefined) {
      totals.currencies.push({
        currencyId: line.currencyId,
        currencyName: line.currencyName,
        amount: line.amount,
      });
    } else {
      existing.amount += line.amount;
    }
  }
};

/** Currencies in a stable order so two runs of the same report read identically. */
const sortCurrencies = (totals: OperationsReportTotalsDto): OperationsReportTotalsDto => ({
  ...totals,
  currencies: [...totals.currencies].sort((a, b) => a.currencyName.localeCompare(b.currencyName)),
});

interface Grouped<T> {
  rows: T[];
  grandTotal: OperationsReportTotalsDto;
}

const groupBy = <T>(
  rows: readonly ReportInputRow[],
  keyOf: (row: ReportInputRow) => string,
  build: (row: ReportInputRow, totals: OperationsReportTotalsDto) => T,
  sortKey: (built: T) => string,
): Grouped<T> => {
  const buckets = new Map<string, { sample: ReportInputRow; totals: OperationsReportTotalsDto }>();
  const grandTotal = emptyTotals();

  for (const row of rows) {
    const key = keyOf(row);
    const bucket = buckets.get(key) ?? { sample: row, totals: emptyTotals() };
    addRow(bucket.totals, row);
    buckets.set(key, bucket);
    // The grand total is accumulated ALONGSIDE, never by summing the rows afterwards — that is
    // what makes it impossible for it to disagree with them, and it is not one of them (Q27).
    addRow(grandTotal, row);
  }

  const built = [...buckets.values()].map((b) => build(b.sample, sortCurrencies(b.totals)));
  built.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  return { rows: built, grandTotal: sortCurrencies(grandTotal) };
};

export const captainReportRows = (
  rows: readonly ReportInputRow[],
): Grouped<OperationsCaptainReportRowDto> =>
  groupBy(
    rows,
    (row) => row.captainEmployeeId ?? '',
    (row, totals) => ({
      captainEmployeeId: row.captainEmployeeId,
      captainName: row.captainName,
      totals,
    }),
    (built) => built.captainName,
  );

export const bankReportRows = (
  rows: readonly ReportInputRow[],
): Grouped<OperationsBankReportRowDto> =>
  groupBy(
    rows,
    (row) => row.bankId ?? '',
    (row, totals) => ({ bankId: row.bankId, bankName: row.bankName, totals }),
    (built) => built.bankName,
  );

/**
 * The legacy default range: the whole of the current calendar month (contad_app.js:4862-4867).
 * Returned as a half-open [from, next) pair so the caller never has to reason about 23:59:59.999.
 */
export const defaultReportRange = (today: Date): { from: Date; toExclusive: Date } => {
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const toExclusive = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
  return { from, toExclusive };
};

/** An explicit range is inclusive of its end DAY, which is what a date picker means by it. */
export const explicitReportRange = (from: Date, to: Date): { from: Date; toExclusive: Date } => {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate() + 1));
  return { from: start, toExclusive: end };
};
