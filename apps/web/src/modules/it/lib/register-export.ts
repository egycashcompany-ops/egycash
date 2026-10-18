// The IT registers as files — Excel and a printed PDF of a list screen, as filtered. The custody
// register had it first («زرارين بجانب تسليم عهدة بيـ Extract أكسيل و PDF للجدول المعمول (وأعتمد
// الفلتر طبعاً)»), then the asset register («اعمل نفس الزرارين في شاشة الأصول»); what the two
// share is here, and what each one's table says is its own file (`custody-register-export.ts`,
// `asset-register-export.ts`).
//
// WHAT THE FILTERS MATCHED, NOT WHAT THE PAGE SHOWS. The tables are paged; a reader who narrows a
// register and presses Excel means all of it. So the export asks the server again with the
// screen's own filters and sort, the paging taken off, and walks every page — the Fleet screens'
// rule, through the Fleet screens' own walk (`fleet/lib/fleet-sheet.ts`).
//
// ONE WRITER, ONE LETTERHEAD. The workbook is the app's one `.xlsx` writer (apps/web carries no
// spreadsheet library, by house rule) and the print is the company's report form; both live under
// Fleet, which needed them first, and are pure — no Fleet state, no Fleet request. Writing a
// second copy of either here is how two exports of the same app come to look different.
import { type Paginated } from '@ecms/contracts';
import { type QueryParams } from '../../../shared/lib/api-client';
import { openPrintWindow, writePrintWindow } from '../../../shared/lib/print-window';
import { buildFleetReportHtml, type FleetReport } from '../../fleet/lib/fleet-report-print';
import { fetchFilteredRows, filtersOnly } from '../../fleet/lib/fleet-sheet';

export type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Every row the screen's filters match, in the table's order.
 *
 * `params` are the SCREEN's — its filters and its sort, exactly what the table asked — with the
 * paging taken off, so the walk starts on the first page whichever page the reader is on and goes
 * to the last. `list` is the register's own request; a test passes a stub.
 */
export const gatherRegister = <T>(
  params: QueryParams,
  list: (params: QueryParams) => Promise<Paginated<T>>,
): Promise<T[]> =>
  fetchFilteredRows((page, pageSize) => list({ ...filtersOnly(params), page, pageSize }));

/**
 * A named filter on paper: its name, or — when a filter is SET but its name cannot be had (an id
 * not among the options, options not loaded yet) — the word saying one is set. A filter in force
 * is never dropped from the line: a register narrowed to one branch that printed without saying so
 * would read as the company's.
 */
export const namedFilter = (
  t: Translate,
  value: string | null,
  labels: { all: string; one: string },
): string => (value === null ? t(labels.all) : value === '' ? t(labels.one) : value);

/** The line under the title, its parts joined; `null` parts are filters not set. */
export const filterLine = (parts: readonly (string | null)[]): string =>
  parts.filter((part): part is string => part !== null).join(' · ');

/**
 * A register on the company's report form, under the IT sector: a list, not a form that goes up
 * for signature, so it carries no signature block.
 */
export const itRegisterReport = ({
  t,
  title,
  header,
  rows,
  subtitle,
  orientation,
}: {
  t: Translate;
  title: string;
  header: readonly string[];
  rows: readonly (readonly string[])[];
  subtitle: string;
  orientation: 'portrait' | 'landscape';
}): FleetReport => ({
  title,
  department: t('it.export.department'),
  subtitle,
  header,
  rows,
  totals: [],
  serialHeader: t('it.export.serial'),
  emptyLabel: t('it.export.empty'),
  orientation,
});

/**
 * Print a register — the tab first, while the click still counts as the reader's, then the rows,
 * then the page. Gathering every page takes a moment, and a tab opened after it would be a pop-up
 * the browser no longer believes the reader asked for: that is why the IT receipt opens its tab
 * first, and this does the same.
 *
 * False when the browser blocked the tab. A failed gather closes the tab it opened and rejects,
 * so the caller says why rather than leaving a tab that waits forever.
 */
export const printItRegister = async (
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
