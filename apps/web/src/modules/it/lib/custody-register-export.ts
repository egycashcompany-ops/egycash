// The custody register as a file — «عايز يبقي فى زرارين بجانب تسليم عهدة بيـ Extract أكسيل و PDF
// للجدول المعمول (وأعتمد الفلتر طبعاً)».
//
// WHAT THE FILTERS MATCHED, NOT WHAT THE PAGE SHOWS. The table is paged; a reader who narrows the
// register to one branch's open custody and presses Excel means all of it. So the export asks the
// server again with the screen's own filters and sort, the paging taken off, and walks every page
// — the Fleet screens' rule, through the Fleet screens' own walk (`fleet/lib/fleet-sheet.ts`).
//
// ONE WRITER, ONE LETTERHEAD. The workbook is the app's one `.xlsx` writer (apps/web carries no
// spreadsheet library, by house rule) and the print is the company's report form; both live under
// Fleet, which needed them first, and are pure — no Fleet state, no Fleet request. Writing a
// second copy of either here is how two exports of the same app come to look different.
//
// The columns are the table's, in its order, with the two codes the table stacks under a name given
// columns of their own: in a sheet a code is something to filter and sort by, not a caption.
import { type ItAssetAssignmentDto, type Locale, type Paginated } from '@ecms/contracts';
import { type QueryParams } from '../../../shared/lib/api-client';
import { formatDate } from '../../../shared/lib/format';
import { openPrintWindow, writePrintWindow } from '../../../shared/lib/print-window';
import { buildFleetReportHtml, type FleetReport } from '../../fleet/lib/fleet-report-print';
import { fetchFilteredRows, filtersOnly } from '../../fleet/lib/fleet-sheet';

type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface CustodyRegisterContext {
  t: Translate;
  locale: Locale;
  /** Branch id → its name, as the table resolves it. */
  branchName: ReadonlyMap<string, string>;
}

/** The status filter's three values — the screen's `open` param. */
export type CustodyOpenFilter = 'true' | 'false' | 'all';

/**
 * Every interval the screen's filters match, in the table's order.
 *
 * `params` are the SCREEN's — its filters and its sort, exactly what the table asked — with the
 * paging taken off, so the walk starts on the first page whichever page the reader is on and goes
 * to the last. `list` is the register's own request; a test passes a stub.
 */
export const gatherCustodyRegister = (
  params: QueryParams,
  list: (params: QueryParams) => Promise<Paginated<ItAssetAssignmentDto>>,
): Promise<ItAssetAssignmentDto[]> =>
  fetchFilteredRows((page, pageSize) => list({ ...filtersOnly(params), page, pageSize }));

/** The heading row, in the table's order — each code right after the name it belongs to. */
export const custodyRegisterHeader = (t: Translate): string[] => [
  t('it.custody.asset'),
  t('it.custody.export.assetCode'),
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

/** The filters in force, as the printed page names them — `null` where a filter is not set. */
export interface CustodyRegisterFilters {
  open: CustodyOpenFilter;
  branch: string | null;
  holder: string | null;
}

/**
 * The screen's filters, named for paper.
 *
 * A FILTER IN FORCE IS NEVER DROPPED. A register narrowed to one person or one branch that printed
 * without saying so would read as the company's — and an empty one as «nobody holds anything
 * anywhere». So when a filter is set and its name cannot be had, the line still says it is set:
 *   · the holder by the gathered rows' own name first (every one of them is that person's), then
 *     the chip's, then the id the table itself falls back to;
 *   · the branch by name, or «فرع محدد» when the id is not among the options (a closed branch, or
 *     options not loaded yet) — an id on paper says nothing to the reader.
 * The status is read the way the request reads it: anything but «true» or «all» is the returned.
 */
export const custodyRegisterFilters = ({
  openParam,
  branchId,
  branchName,
  employeeId,
  holderLabel,
  rows,
}: {
  openParam: string;
  branchId: string;
  branchName: ReadonlyMap<string, string>;
  employeeId: string;
  holderLabel: string;
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
});

/**
 * What the printed page is a view OF, under its title: the status filter, the branch, the holder
 * when one is set, and the day it was taken — a register on paper is only true as of a date. A
 * branch set but unnamed (`''`) prints as «فرع محدد».
 */
export const custodyRegisterSubtitle = (
  t: Translate,
  filters: CustodyRegisterFilters & { asOf: string },
): string =>
  [
    filters.open === 'true'
      ? t('it.custody.filterOpen')
      : filters.open === 'false'
        ? t('it.custody.filterClosed')
        : t('it.custody.filterAll'),
    filters.branch === null
      ? t('it.assets.allBranches')
      : filters.branch === ''
        ? t('it.custody.export.oneBranch')
        : filters.branch,
    filters.holder === null ? null : t('it.custody.export.holderIs', { name: filters.holder }),
    t('it.custody.export.asOf', { date: filters.asOf }),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

/** The printed register: the company's report form, landscape for ten columns, nobody signs it. */
export const custodyRegisterReport = (
  rows: readonly ItAssetAssignmentDto[],
  context: CustodyRegisterContext,
  subtitle: string,
): FleetReport => {
  const { t } = context;
  return {
    title: t('it.nav.custody'),
    department: t('it.custody.export.department'),
    subtitle,
    header: custodyRegisterHeader(t),
    rows: rows.map((row) => custodyRegisterLine(row, context, '—')),
    totals: [],
    serialHeader: t('it.custody.export.serial'),
    emptyLabel: t('it.custody.export.empty'),
    orientation: 'landscape',
  };
};

/**
 * Print the register — the tab first, while the click still counts as the reader's, then the
 * rows, then the page. Gathering every page takes a moment, and a tab opened after it would be a
 * pop-up the browser no longer believes the reader asked for: that is why the IT receipt opens its
 * tab first, and this does the same.
 *
 * False when the browser blocked the tab. A failed gather closes the tab it opened and rejects,
 * so the caller says why rather than leaving a tab that waits forever.
 */
export const printCustodyRegister = async (
  load: () => Promise<FleetReport>,
  waiting: string,
): Promise<boolean> => {
  const win = openPrintWindow(waiting);
  if (win === null) return false;
  try {
    writePrintWindow(win, buildFleetReportHtml(await load()));
    return true;
  } catch (error) {
    win.close();
    throw error;
  }
};
