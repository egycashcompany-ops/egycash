// The consumables register as a file (FR-20) — the IT registers' Excel and PDF, on the store's
// screen: every item the filters match, in the table's order, not the page on screen. What every
// IT register's file shares is `register-export.ts`; this is what the consumables table says.
//
// The columns are the table's — the code, the item, its type, the branch whose store keeps it,
// the unit, what is on hand, what was issued, what was scrapped, the minimum — then two the table
// carries as marks rather than columns: whether the item has reached its minimum («بلغ الحد
// الأدنى», the table's highlight) and whether it is still active. A file has no colour to read.
//
// THE QUANTITIES ARE NUMBERS IN THE SHEET, so a column of stock sums and sorts as stock; on paper
// they are written in the reader's digits like every figure of the report form.
import { type ItConsumableDto, type Locale } from '@ecms/contracts';
import { formatNumber } from '../../../shared/lib/format';
import { type XlsxCell } from '../../../shared/lib/xlsx-writer';
import { type FleetReport } from '../../fleet/lib/fleet-report-print';
import { filterLine, itRegisterReport, namedFilter, type Translate } from './register-export';

export interface ConsumableRegisterContext {
  t: Translate;
  locale: Locale;
  /** Branch id → its name, as the table resolves it. */
  branchName: ReadonlyMap<string, string>;
  /** Type id → its name, from the `consumableType` catalog the table reads. */
  typeName: ReadonlyMap<string, string>;
}

/** The heading row, in the table's order, then the two marks. */
export const consumableRegisterHeader = (t: Translate): string[] => [
  t('it.consumables.columns.code'),
  t('it.consumables.columns.name'),
  t('it.consumables.columns.type'),
  t('it.assets.columns.branch'),
  t('it.consumables.columns.unit'),
  t('it.consumables.columns.onHand'),
  t('it.consumables.columns.issued'),
  t('it.consumables.columns.scrapped'),
  t('it.consumables.columns.minQty'),
  t('it.consumables.belowMin'),
  t('it.assets.columns.status'),
];

/**
 * One item as a line of the workbook. `empty` is what a blank cell holds — nothing in the sheet,
 * «—» on paper. The four quantities are numbers (an item with no minimum leaves that cell blank).
 */
export const consumableRegisterLine = (
  row: ItConsumableDto,
  { t, branchName, typeName }: ConsumableRegisterContext,
  empty: string,
): XlsxCell[] => [
  row.code,
  row.name,
  typeName.get(row.typeId) ?? empty,
  branchName.get(row.branchId) ?? empty,
  row.unit,
  row.onHandQty,
  row.issuedQty,
  row.scrappedQty,
  row.minQty ?? empty,
  row.belowMin ? t('it.consumables.belowMin') : empty,
  row.active ? t('it.consumables.state.active') : t('it.consumables.state.inactive'),
];

/** A line of the workbook as the report form prints it: every cell words, numbers in its digits. */
export const paperCells = (cells: readonly XlsxCell[], locale: Locale): string[] =>
  cells.map((cell) => (typeof cell === 'number' ? formatNumber(cell, locale) : cell));

/** The screen's `active` param: the active items (its default), the retired ones, or both. */
export type ConsumableActiveFilter = 'true' | 'false' | 'all';

/** The filters in force, as the printed page names them — `null` where a filter is not set. */
export interface ConsumableRegisterFilters {
  active: ConsumableActiveFilter;
  /** `''` when a type is set but its name is not among the options. */
  type: string | null;
  /** `''` when a branch is set but its name is not among the options. */
  branch: string | null;
  belowMin: boolean;
  search: string | null;
}

/**
 * The screen's filters, named for paper. A filter in force is never dropped: a type or a branch
 * whose name cannot be had prints as «نوع محدد» / «فرع محدد» rather than vanishing.
 */
export const consumableRegisterFilters = ({
  active,
  typeId,
  typeName,
  branchId,
  branchName,
  belowMin,
  search,
}: {
  active: string;
  typeId: string;
  typeName: ReadonlyMap<string, string>;
  branchId: string;
  branchName: ReadonlyMap<string, string>;
  belowMin: boolean;
  search: string;
}): ConsumableRegisterFilters => ({
  active: active === 'all' ? 'all' : active === 'false' ? 'false' : 'true',
  type: typeId === '' ? null : (typeName.get(typeId) ?? ''),
  branch: branchId === '' ? null : (branchName.get(branchId) ?? ''),
  belowMin,
  search: search.trim() === '' ? null : search.trim(),
});

/**
 * What the printed page is a view OF, under its title: which items (active, retired, both), the
 * type, the branch, «بلغ الحد الأدنى», the search, and the day it was taken — a store's figures on
 * paper are only true as of a date.
 */
export const consumableRegisterSubtitle = (
  t: Translate,
  filters: ConsumableRegisterFilters & { asOf: string },
): string =>
  filterLine([
    filters.active === 'true'
      ? t('it.consumables.filterActive')
      : filters.active === 'false'
        ? t('it.consumables.filterInactive')
        : t('it.consumables.filterAllStates'),
    namedFilter(t, filters.type, {
      all: 'it.consumables.allTypes',
      one: 'it.consumables.export.oneType',
    }),
    namedFilter(t, filters.branch, { all: 'it.assets.allBranches', one: 'it.export.oneBranch' }),
    filters.belowMin ? t('it.consumables.belowMinOnly') : null,
    filters.search === null ? null : t('it.export.searchIs', { q: filters.search }),
    t('it.export.asOf', { date: filters.asOf }),
  ]);

/** The printed register: the company's report form, landscape for eleven columns, nobody signs it. */
export const consumableRegisterReport = (
  rows: readonly ItConsumableDto[],
  context: ConsumableRegisterContext,
  subtitle: string,
): FleetReport =>
  itRegisterReport({
    t: context.t,
    title: context.t('it.nav.consumables'),
    header: consumableRegisterHeader(context.t),
    rows: rows.map((row) => paperCells(consumableRegisterLine(row, context, '—'), context.locale)),
    subtitle,
    orientation: 'landscape',
  });
