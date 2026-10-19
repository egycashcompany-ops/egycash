// The arrows on «كل الحركات» — the custody ledger's order, over the WHOLE filtered set.
//
// The ledger is read and folded in memory (see `custody.service.ts`), so the order is not handed
// to a query: it is applied here, to every movement the filters matched, BEFORE the page is cut —
// a page sorted on its own would be twenty-five rows pretending to be the ledger.
//
// The rule is the one every Fleet board follows (`driver-roster.ts`, the web's `sort-rows.ts`):
// the columns decide in the order they were clicked, and a missing value sorts LAST in either
// direction. Rows the columns cannot separate are closed the way `_id` closes them on every other
// board (`base.repository.ts`): in the LAST column's direction — the ledger's own order (newest
// first) under a descending arrow, that order turned round under an ascending one. So «التاريخ»
// ascending is the exact mirror of the default, entries of one day included, and a page boundary
// never swaps two equal rows.
import {
  FLEET_CUSTODY_SOURCES,
  fleetVehicleCodeOrderKey,
  type FleetCustodyMovementDto,
  type FleetCustodySource,
  type FleetSortEntry,
} from '@ecms/contracts';

/** What one movement offers the arrows. */
export interface CustodySortRow {
  date: Date;
  vehicleCode: string | null;
  source: FleetCustodySource;
  driverName: string | null;
  ref: FleetCustodyMovementDto['ref'];
  amount: number;
}

type SortValue = string | number | null;

/** «المصدر» in the table — the receipts screen, the ledger's one source. */
const REF_ORDER: readonly FleetCustodyMovementDto['ref'][] = ['receipt'];

/**
 * What each column is worth. The kind follows the filter's and the figures' order — «صيانة»، وقود،
 * كاوتش، غسيل — rather than the word's alphabet; the car's code follows the fleet's own order
 * (`fleetVehicleCodeOrderKey`), so «160» comes before «1500».
 */
const SORT_VALUE = {
  date: (row: CustodySortRow): SortValue => row.date.getTime(),
  vehicleCode: (row: CustodySortRow): SortValue => fleetVehicleCodeOrderKey(row.vehicleCode),
  source: (row: CustodySortRow): SortValue => FLEET_CUSTODY_SOURCES.indexOf(row.source),
  // A receipt that names no driver: `null`, so it sorts last whichever way the arrow points.
  driverName: (row: CustodySortRow): SortValue =>
    row.driverName === null || row.driverName.trim() === '' ? null : row.driverName,
  ref: (row: CustodySortRow): SortValue => REF_ORDER.indexOf(row.ref),
  amount: (row: CustodySortRow): SortValue => row.amount,
} as const;

export type CustodySortable = keyof typeof SORT_VALUE;

/** The columns a `?sort=` may name on the ledger — anything else is dropped, never a 400. */
export const CUSTODY_SORTABLE = Object.keys(SORT_VALUE) as CustodySortable[];

const isSortable = (by: string): by is CustodySortable => Object.hasOwn(SORT_VALUE, by);

/** Two values of one column. `null` always answers LAST — see the infinities below. */
const compareValues = (by: CustodySortable, left: SortValue, right: SortValue): number => {
  if (left === null && right === null) return 0;
  if (left === null) return Number.POSITIVE_INFINITY;
  if (right === null) return Number.NEGATIVE_INFINITY;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  // A name is compared as a WORD — Arabic in code-point order is not alphabetical order. The car's
  // order key is built for plain text order (its digits are left-padded), so it is compared so.
  if (by === 'driverName') return String(left).localeCompare(String(right), 'ar');
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
};

/**
 * The movements in the reader's order. No column (or none the ledger knows) → the list exactly
 * as it came, which is the ledger's own date order.
 */
export const sortCustodyMovements = <T extends CustodySortRow>(
  rows: readonly T[],
  sorts: readonly FleetSortEntry[],
): T[] => {
  const columns = sorts.flatMap((entry) =>
    isSortable(entry.by) ? [{ by: entry.by, dir: entry.dir === 'asc' ? 1 : -1 }] : [],
  );
  if (columns.length === 0) return [...rows];
  // The tie's direction: the last column's, as `_id` follows it on the other boards.
  const tie = (columns[columns.length - 1] as { dir: number }).dir;
  return rows
    .map((row, at) => ({ row, at }))
    .sort((a, b) => {
      for (const column of columns) {
        const value = SORT_VALUE[column.by];
        const verdict = compareValues(column.by, value(a.row), value(b.row));
        // A missing value sorts last in BOTH directions, so its verdict is not turned round.
        if (verdict === Number.POSITIVE_INFINITY) return 1;
        if (verdict === Number.NEGATIVE_INFINITY) return -1;
        if (verdict !== 0) return verdict * column.dir;
      }
      // The rows arrive newest first: a descending tie keeps that, an ascending one turns it.
      return (a.at - b.at) * -tie;
    })
    .map(({ row }) => row);
};
