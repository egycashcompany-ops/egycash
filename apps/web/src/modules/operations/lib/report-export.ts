// The reports as files — «وزود ان اعمل … و ان اكسيل او pdf», on «تقرير القادة» and «تقرير البنوك»
// (the vault roll-up, «تجميع الخزينة» until Round 14).
//
// EXACTLY WHAT IS SHOWN. A report is not paged and is already in the browser, so — unlike the Fleet
// and IT registers, which ask the server again for every page their filters match — the file is
// the table on screen: the rows the name filter left, in the screen's order, numbered as the screen
// numbers them, with «الإجمالي» under them (the server's grand total, or with a name typed the
// shown rows' own — `reportView`), the money split into «المصري» / «الدولار» / «عملات أخرى» by the
// same classifier the table uses (`reportMoney`). The vault's file carries its panel as well,
// «إجمالي قيمة الشحنات», read off the same total.
//
// ONE WRITER, ONE LETTERHEAD. The workbook is the app's one `.xlsx` writer
// (`shared/lib/xlsx-writer.ts`) and the print is the company's report form
// (`fleet/lib/fleet-report-print.ts`, its `totalLine` for a total with a figure under every column),
// as every export in the app — a second copy of either is how two files of one app come to differ.
// Everything here is pure but the two last functions, which hand the result to the browser.
import {
  type Locale,
  type OperationsCurrencyDto,
  type OperationsReportTotalsDto,
} from '@ecms/contracts';
import { saveBlob } from '../../../shared/lib/api-client';
import { formatAmount } from '../../../shared/lib/format';
import {
  buildXlsxBook,
  xlsxFilename,
  type XlsxCell,
  type XlsxSheet,
} from '../../../shared/lib/xlsx-writer';
import { printFleetReport, type FleetReport } from '../../fleet/lib/fleet-report-print';
import { reportMoney, vaultValuePanel, type ReportTableLine } from './report-board';
import { ltrIsolate } from './shipment-log';

export type Translate = (key: string, params?: Record<string, string | number>) => string;

/** A report's table as a file holds it — its header after «م», its rows, and «الإجمالي». */
export interface ReportExportTable {
  /** The screen's own column heads, after «م» (the writers number the rows themselves). */
  header: string[];
  /** One per row shown: the name, the count, the pound, the dollar, «عملات أخرى», the packages. */
  rows: XlsxCell[][];
  /** «الإجمالي» across the same columns — null when there is no row to total. */
  total: XlsxCell[] | null;
}

/** The table's column heads after «م», in the screen's order (`ReportBoard.tsx`'s columns). */
export const reportExportHeader = (
  t: Translate,
  keyHeader: string,
  countHeader: string,
): string[] => [
  keyHeader,
  countHeader,
  t('operations.reportBoard.pound'),
  t('operations.reportBoard.dollar'),
  t('operations.board.figures.otherCurrencies'),
  t('operations.reportBoard.bags'),
  t('operations.reportBoard.cartons'),
  t('operations.reportBoard.boxes'),
];

/** One line's figures, after its name — as numbers, so a sheet can still add them up. */
const figuresOf = (
  totals: OperationsReportTotalsDto,
  catalog: readonly OperationsCurrencyDto[],
): number[] => {
  const money = reportMoney(totals.currencies, catalog);
  return [
    totals.shipmentCount,
    money.egp,
    money.usd,
    money.othersSum,
    totals.bagCount,
    totals.cartonCount,
    totals.boxCount,
  ];
};

/**
 * The table's lines (`reportTableLines` — the rows shown, then «الإجمالي») as the files' cells.
 * `nameOf` is the screen's own: a row's name, «غير منسوب» for the bucket, «الإجمالي» for the total.
 */
export const reportExportTable = (
  lines: readonly ReportTableLine[],
  catalog: readonly OperationsCurrencyDto[],
  header: string[],
  nameOf: (line: ReportTableLine) => string,
): ReportExportTable => {
  const rows: XlsxCell[][] = [];
  let total: XlsxCell[] | null = null;
  for (const line of lines) {
    const cells = [nameOf(line), ...figuresOf(line.totals, catalog)];
    if (line.kind === 'total') total = cells;
    else rows.push(cells);
  }
  return { header, rows, total };
};

/** «إجمالي قيمة الشحنات» as a two-column list: the two sums at its top, then every currency. */
export interface PanelExport {
  header: string[];
  rows: XlsxCell[][];
}

/**
 * The vault's panel, top to bottom as the screen lists it (`vaultValuePanel` over the SAME total as
 * the table — the shown rows' when a name is typed): «إجمالي المصري», «إجمالي العملات الأجنبية»,
 * then each currency of the reference list but the pound, its zeros included.
 */
export const vaultPanelExport = (
  t: Translate,
  total: OperationsReportTotalsDto,
  catalog: readonly OperationsCurrencyDto[],
): PanelExport => {
  const panel = vaultValuePanel(total.currencies, catalog);
  return {
    header: [t('operations.reportExport.item'), t('operations.reportExport.amount')],
    rows: [
      [t('operations.vaultReport.totalPound'), panel.egp],
      [t('operations.vaultReport.totalForeign'), panel.foreign],
      ...panel.lines.map((line) => [line.name, line.amount]),
    ],
  };
};

/**
 * The line under a printed title — what the page is a view OF: the period (none on a live report),
 * and the name filter when one is typed. A filter in force is never left off the paper: a report
 * narrowed to one captain that printed without saying so would read as everyone's.
 */
export const reportExportSubtitle = (
  t: Translate,
  {
    period,
    filter,
  }: {
    period?: { from: string; to: string } | undefined;
    filter?: { label: string; value: string } | undefined;
  },
): string =>
  [
    // Each day isolated left-to-right: inside the Arabic line «2026-11-30» otherwise reads as
    // three numbers and prints «30-11-2026» (`ltrIsolate`, as «السجل» writes a day).
    period === undefined
      ? null
      : t('operations.reportExport.period', {
          from: ltrIsolate(period.from),
          to: ltrIsolate(period.to),
        }),
    filter === undefined || filter.value.trim() === ''
      ? null
      : t('operations.reportExport.filter', { label: filter.label, value: filter.value.trim() }),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

/** A table as a sheet of the workbook — numbers kept numbers, «الإجمالي» as its bottom line. */
export const reportSheet = (
  name: string,
  serialHeader: string,
  table: {
    header: readonly string[];
    rows: readonly (readonly XlsxCell[])[];
    total?: XlsxCell[] | null;
  },
): XlsxSheet => ({
  name,
  serialHeader,
  header: table.header,
  rows: table.rows,
  ...(table.total === undefined || table.total === null ? {} : { totals: table.total }),
});

/** A cell as the screen prints it — a figure in the boards' digits, with its thousands marks. */
const printed = (cell: XlsxCell, locale: Locale): string =>
  typeof cell === 'number' ? formatAmount(cell, locale) : cell;

/**
 * A table on the company's report form: the Operations department under the letterhead, the period
 * and filter under the title, «الإجمالي» as the table's own bottom line. A list nobody signs, so no
 * signature block (the IT registers' rule).
 */
export const reportPrintDoc = ({
  t,
  locale,
  title,
  subtitle,
  table,
}: {
  t: Translate;
  locale: Locale;
  title: string;
  subtitle: string;
  table: {
    header: readonly string[];
    rows: readonly (readonly XlsxCell[])[];
    total?: XlsxCell[] | null;
  };
}): FleetReport => ({
  title,
  department: t('operations.reportExport.department'),
  subtitle,
  header: table.header,
  rows: table.rows.map((row) => row.map((cell) => printed(cell, locale))),
  totals: [],
  ...(table.total === undefined || table.total === null
    ? {}
    : { totalLine: table.total.map((cell) => printed(cell, locale)) }),
  serialHeader: t('operations.reportBoard.serial'),
  emptyLabel: t('operations.reportExport.empty'),
});

/**
 * A further table a screen's files carry after its own (Round 17 — «لوحة تحكم» on «محصنات الخزينة»:
 * «تنبيهات التسليم», «جدول التسليم», «مدة البقاء في الخزينة»): a sheet of the workbook and a printed
 * page each, in the order given, after the table and the vault's panel. A screen with none — every
 * report — writes the files it always wrote.
 */
export interface ReportExtraSection {
  /** The sheet's name and the printed page's title. */
  name: string;
  /** The column heads after «م». */
  header: string[];
  rows: XlsxCell[][];
  /** «الإجمالي» under the rows — null for a list whose lines overlap (the alerts). */
  total: XlsxCell[] | null;
}

/** Everything a screen's two files hold, in their order. */
export interface ReportFiles {
  /** The table's strip — its sheet's name. */
  tableName: string;
  /** The screen's name — the printed title. */
  name: string;
  /** The line under every printed title. */
  subtitle: string;
  table: ReportExportTable;
  /** The vault's «إجمالي قيمة الشحنات», with its name — null on a report without one. */
  panel: { name: string; list: PanelExport } | null;
  extras: readonly ReportExtraSection[];
}

/** The workbook's sheets: the table, the vault's panel, then each further section. */
export const reportFileSheets = (serialHeader: string, files: ReportFiles): XlsxSheet[] => [
  reportSheet(files.tableName, serialHeader, files.table),
  ...(files.panel === null ? [] : [reportSheet(files.panel.name, serialHeader, files.panel.list)]),
  ...files.extras.map((extra) => reportSheet(extra.name, serialHeader, extra)),
];

/** The printed pages, in the same order — each on the company form, under the same subtitle. */
export const reportFileDocs = (t: Translate, locale: Locale, files: ReportFiles): FleetReport[] => [
  reportPrintDoc({ t, locale, title: files.name, subtitle: files.subtitle, table: files.table }),
  ...(files.panel === null
    ? []
    : [
        reportPrintDoc({
          t,
          locale,
          title: files.panel.name,
          subtitle: files.subtitle,
          table: files.panel.list,
        }),
      ]),
  ...files.extras.map((extra) =>
    reportPrintDoc({ t, locale, title: extra.name, subtitle: files.subtitle, table: extra }),
  ),
];

/** Write the workbook and hand it to the browser — named for the screen and the Cairo day. */
export const saveReportWorkbook = (stem: string, sheets: readonly XlsxSheet[], day: string): void =>
  saveBlob(buildXlsxBook(sheets), xlsxFilename(stem, day));

/**
 * Print the pages (the vault's: its table, then its panel on a page of its own, each with the
 * letterhead). False when the browser blocked the tab — the caller says so rather than nothing.
 */
export const printReportDocs = (docs: readonly FleetReport[]): boolean => {
  try {
    printFleetReport(docs);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message === 'popup blocked') return false;
    throw error;
  }
};
