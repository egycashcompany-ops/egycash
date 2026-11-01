// The custody register as a file — «عايز يبقي فى زرارين بجانب تسليم عهدة بيـ Extract أكسيل و PDF
// للجدول المعمول (وأعتمد الفلتر طبعاً)». What every IT register's file shares — the walk over every
// page the filters match, the report form, the tab opened before the rows are gathered — is
// `register-export.ts`; this is what the custody table says.
//
// The columns are the table's, in its order, with the two codes the table stacks under a name given
// columns of their own: in a sheet a code is something to filter and sort by, not a caption. One
// column the table does not show — «تزود سيريال الأصول لما أعمل Extract»: the asset's serial, right
// after its code, written as TEXT, so a serial of digits keeps its leading zeros and is never summed.
import {
  IT_ASSIGNMENT_RECEIPT_STATES,
  type ItAssetAssignmentDto,
  type ItAssignmentReceiptState,
  type Locale,
} from '@ecms/contracts';
import { formatDate } from '../../../shared/lib/format';
import { type FleetReport } from '../../fleet/lib/fleet-report-print';
import { filterLine, itRegisterReport, namedFilter, type Translate } from './register-export';

export interface CustodyRegisterContext {
  t: Translate;
  locale: Locale;
  /** Branch id → its name, as the table resolves it. */
  branchName: ReadonlyMap<string, string>;
}

/** The status filter's three values — the screen's `open` param. */
export type CustodyOpenFilter = 'true' | 'false' | 'all';

/** The heading row, in the table's order — each code right after the name it belongs to. */
export const custodyRegisterHeader = (t: Translate): string[] => [
  t('it.custody.asset'),
  t('it.custody.export.assetCode'),
  t('it.assets.columns.serial'),
  t('it.custody.assignedAt'),
  t('it.custody.holder'),
  t('it.custody.export.holderCode'),
  t('it.assets.columns.branch'),
  t('it.custody.expectedReturnAt'),
  t('it.assets.columns.status'),
  t('it.custody.returnedAt'),
  t('it.custody.receipt.column'),
];

/**
 * One interval as a line of the file. `empty` is what a blank cell holds: nothing in the sheet,
 * where an empty cell is a filterable blank, and «—» on paper, where an empty box reads as
 * something left out.
 */
export const custodyRegisterLine = (
  row: ItAssetAssignmentDto,
  { t, locale, branchName }: CustodyRegisterContext,
  empty: string,
): string[] => {
  const day = (iso: string | null): string => (iso === null ? empty : formatDate(iso, locale));
  return [
    // The table's own fallbacks: an asset outside the reader's scope says so, and a holder HR
    // cannot name is shown by the id the row carries rather than by a guess.
    row.assetName ?? t('it.custody.assetUnknown'),
    row.assetCode ?? empty,
    // A blank for an asset registered without one — and for one outside the reader's scope, whose
    // serial is no more theirs to read than its name.
    row.assetSerialNumber ?? empty,
    day(row.assignedAt),
    row.assignedToEmployeeName ?? row.assignedToEmployeeId,
    row.assignedToEmployeeCode ?? empty,
    branchName.get(row.branchId) ?? empty,
    day(row.expectedReturnAt),
    row.returnedAt === null ? t('it.custody.open') : t('it.custody.closed'),
    day(row.returnedAt),
    // The receipt column's words, as its badge: signed, or waiting for the signature. An interval
    // with no receipt — handed over before receipts existed — has nothing to say.
    row.receiptId === null
      ? empty
      : row.receiptSigned === true
        ? t('it.custody.receipt.signed')
        : t('it.custody.receipt.awaitingSignature'),
  ];
};

/** The screen's `receipt` param as a receipt state — anything else is no receipt filter at all. */
export const receiptStateOf = (value: string): ItAssignmentReceiptState | null =>
  (IT_ASSIGNMENT_RECEIPT_STATES as readonly string[]).includes(value)
    ? (value as ItAssignmentReceiptState)
    : null;

/** A date window as paper writes it — each bound a day in the reader's words, null when open. */
export interface CustodyDayWindow {
  from: string | null;
  to: string | null;
}

/** The filters in force, as the printed page names them — `null` where a filter is not set. */
export interface CustodyRegisterFilters {
  open: CustodyOpenFilter;
  branch: string | null;
  holder: string | null;
  /** «الصنف» as typed. */
  search: string | null;
  /** `''` when a category is set but its name is not among the options. */
  category: string | null;
  /** «تاريخ التسليم»; null when neither bound is set. */
  assigned: CustodyDayWindow | null;
  /** Only what is still out past «موعد الإعادة». */
  overdue: boolean;
  /** «تاريخ الاسترجاع»; null when neither bound is set. */
  returned: CustodyDayWindow | null;
  receipt: ItAssignmentReceiptState | null;
}

/**
 * A day the reader PICKED, written for paper. The screen holds it as `YYYY-MM-DD`; read as an
 * instant that is UTC midnight, which prints as the day before anywhere west of Greenwich. Read at
 * local midnight it is the day that was picked, wherever the page is printed.
 */
const pickedDay = (day: string, locale: Locale): string => formatDate(`${day}T00:00:00`, locale);

const dayWindow = (from: string, to: string, locale: Locale): CustodyDayWindow | null =>
  from === '' && to === ''
    ? null
    : {
        from: from === '' ? null : pickedDay(from, locale),
        to: to === '' ? null : pickedDay(to, locale),
      };

/**
 * The screen's filters, named for paper.
 *
 * A FILTER IN FORCE IS NEVER DROPPED. A register narrowed to one person or one branch that printed
 * without saying so would read as the company's — and an empty one as «nobody holds anything
 * anywhere». So when a filter is set and its name cannot be had, the line still says it is set:
 *   · the holder by the gathered rows' own name first (every one of them is that person's), then
 *     the chip's, then the id the table itself falls back to;
 *   · the branch and the category by name, or «فرع محدد» / «فئة محددة» when the id is not among the
 *     options (a closed branch, an archived category, options not loaded yet) — an id on paper says
 *     nothing to the reader.
 * The status is read the way the request reads it: anything but «true» or «all» is the returned.
 */
export const custodyRegisterFilters = ({
  locale,
  openParam,
  branchId,
  branchName,
  employeeId,
  holderLabel,
  search,
  categoryId,
  categoryName,
  assignedFrom,
  assignedTo,
  overdue,
  returnedFrom,
  returnedTo,
  receipt,
  rows,
}: {
  locale: Locale;
  openParam: string;
  branchId: string;
  branchName: ReadonlyMap<string, string>;
  employeeId: string;
  holderLabel: string;
  search: string;
  categoryId: string;
  categoryName: ReadonlyMap<string, string>;
  assignedFrom: string;
  assignedTo: string;
  overdue: boolean;
  returnedFrom: string;
  returnedTo: string;
  receipt: string;
  rows: readonly ItAssetAssignmentDto[];
}): CustodyRegisterFilters => ({
  open: openParam === 'all' ? 'all' : openParam === 'true' ? 'true' : 'false',
  branch: branchId === '' ? null : (branchName.get(branchId) ?? ''),
  holder:
    employeeId === ''
      ? null
      : rows.find((row) => row.assignedToEmployeeId === employeeId)?.assignedToEmployeeName ||
        holderLabel ||
        employeeId,
  search: search.trim() === '' ? null : search.trim(),
  category: categoryId === '' ? null : (categoryName.get(categoryId) ?? ''),
  assigned: dayWindow(assignedFrom, assignedTo, locale),
  overdue,
  returned: dayWindow(returnedFrom, returnedTo, locale),
  receipt: receiptStateOf(receipt),
});

/** «من … إلى …», or the one bound that is set. */
const windowText = (t: Translate, window: CustodyDayWindow): string =>
  window.from !== null && window.to !== null
    ? t('it.export.dayRange', { from: window.from, to: window.to })
    : window.from !== null
      ? t('it.export.dayFrom', { from: window.from })
      : t('it.export.dayTo', { to: window.to ?? '' });

/** The receipt filter in the receipt column's own words. */
const receiptText = (t: Translate, state: ItAssignmentReceiptState): string =>
  state === 'signed'
    ? t('it.custody.receipt.signed')
    : state === 'unsigned'
      ? t('it.custody.receipt.awaitingSignature')
      : t('it.custody.receipt.none');

/**
 * What the printed page is a view OF, under its title: the status filter, the branch, then every
 * other filter that is set — the holder, «الصنف», the category, the two date windows, «موعد
 * الإعادة», the receipt — and the day it was taken: a register on paper is only true as of a date.
 * A branch set but unnamed (`''`) prints as «فرع محدد», a category as «فئة محددة».
 */
export const custodyRegisterSubtitle = (
  t: Translate,
  filters: CustodyRegisterFilters & { asOf: string },
): string =>
  filterLine([
    filters.open === 'true'
      ? t('it.custody.filterOpen')
      : filters.open === 'false'
        ? t('it.custody.filterClosed')
        : t('it.custody.filterAll'),
    namedFilter(t, filters.branch, { all: 'it.assets.allBranches', one: 'it.export.oneBranch' }),
    filters.holder === null ? null : t('it.export.holderIs', { name: filters.holder }),
    filters.search === null ? null : t('it.export.searchIs', { q: filters.search }),
    filters.category === null
      ? null
      : namedFilter(t, filters.category, {
          all: 'it.assets.allCategories',
          one: 'it.export.oneCategory',
        }),
    filters.assigned === null
      ? null
      : t('it.custody.export.assignedIs', { range: windowText(t, filters.assigned) }),
    filters.overdue ? t('it.custody.filters.overdue') : null,
    filters.returned === null
      ? null
      : t('it.custody.export.returnedIs', { range: windowText(t, filters.returned) }),
    filters.receipt === null
      ? null
      : t('it.custody.export.receiptIs', { state: receiptText(t, filters.receipt) }),
    t('it.export.asOf', { date: filters.asOf }),
  ]);

/** The printed register: the company's report form, landscape for eleven columns, nobody signs it. */
export const custodyRegisterReport = (
  rows: readonly ItAssetAssignmentDto[],
  context: CustodyRegisterContext,
  subtitle: string,
): FleetReport =>
  itRegisterReport({
    t: context.t,
    title: context.t('it.nav.custody'),
    header: custodyRegisterHeader(context.t),
    rows: rows.map((row) => custodyRegisterLine(row, context, '—')),
    subtitle,
    orientation: 'landscape',
  });
