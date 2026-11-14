// The reports on the boards' look — «تقرير البنوك» (`pages/BankReportPage.tsx`, the vault roll-up
// that shipped as «تجميع الخزينة» until Round 14) and «تقرير القادة» (`pages/CaptainReportPage.tsx`).
// «تجميع الخزينة هيكون زى الشاشة اللى بعتهالك بتاعت البنوك وتقرير القادة الشاشة هتكون الشاشة
// التانية»: the legacy screens' STRUCTURE — «من» / «إلى» over a table with a title strip, م | the
// key | the count | المصري | الدولار | اجمالي العملات | الحقائب | كرتونه | صندوق, and «الإجمالي»
// under the rows — worn in the look the owner approved on every Operations
// board this month (`ShipmentsBoard.tsx`): the dark one-row filter card with the history's date
// boxes, the dark rounded table with its dark head, the figures' face, the «عملات أخرى» breakdown.
//
// Built from the board's own pieces rather than copies of them — `BoardDateBox`, `BoardRefusal`,
// `BOARD_TABLE_LOOK`, `BAR_LAYOUT`, the breakdown dialog — so a fix to one of them reaches the
// reports too, and the reports cannot drift from the boards they sit beside in the menu.
//
// ROUND 12 — THE FILTERS, THE FILES, THE HEIGHT. On both reports: «شيل الديف اللى فيها الفلاتر بتاعت
// التاريخ وخليها زى الفلاتر عادى وزود ان اعمل فلتر ب اسم القائد [اسم البنك] و ان اكسيل او pdf», and
// «الصف بتاع الجماليات يفضل ظاهر حتى لو الجدول كبر يحصل اسكرول جوا الجدول». So:
//
//   · ONE BAR, THE BOARDS' — the dates no longer sit in a card of their own at the bar's start (the
//     «ديف» the owner circled): the bar runs the screen's width, as «سجل الشحنات»'s does, holding
//     the name filter (the boards' text box with its icon, widest), then «من» and «إلى» at a date's
//     own width, then the reset, then «Excel | PDF» — the Fleet boards' export pair — at its end;
//   · THE NAME FILTER narrows the rows as it is typed (`reportView`, Arabic folded), and «الإجمالي»
//     — and the vault's panel — FOLLOW it: the server's grand total with no name typed, the rows
//     on screen added up with one (the rows are disjoint, so nothing is counted twice);
//   · THE FILES are what the screen shows (`lib/report-export.ts`): the rows left, «الإجمالي» under
//     them, through the app's one xlsx writer and the company's report form;
//   · THE HEIGHT — on a computer the table's card runs to the bottom of the screen; its head stays
//     at the top and «الإجمالي» at the bottom of the card's own scroll, so the total is ALWAYS on
//     screen and only the rows move. The vault's panel beside it is as tall («عاوز حجمها يكون بطول
//     الشاشة كامله»), its list scrolling inside it when the currencies outrun it. On a phone the
//     cards stack and the page scrolls; the table's card stops at three quarters of the screen so
//     its total stays in sight there too.
//
// THREE THINGS THIS WILL NOT DO, each a legacy defect the server already fixed (as the old
// `ReportView` before it): it never adds the WHOLE report up — with no name typed, «الإجمالي» is
// the server's `grandTotal` (Q27); it never multiplies packages by currencies (Q26); and it never
// hides a row whose money is zero (Q28). What it does to the answer is a VIEW of it
// (`lib/report-board.ts`):
// the money split the boards' way, the currencies in the reference list's order, the unattributed
// row last, the name filter.
//
// «اجمالي العملات» IS NAMED «عملات أخرى» here: legacy's column was every currency that is neither the
// pound nor the dollar (`total_other`), which is exactly what the boards call «عملات أخرى» — so the
// reports use the boards' word for the boards' sum, and its click opens the boards' breakdown.
//
// NO «بحث» BUTTON. Legacy's dates waited for a press; the boards apply a filter as it is chosen, and
// a report a sibling of theirs does the same — one less step, and no screen showing figures for a
// period other than the one its boxes read.
import { useState, type HTMLAttributes, type ReactNode } from 'react';
import { MAX_PAGE_SIZE, type OperationsReportTotalsDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Input } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { formatAmount } from '../../../shared/lib/format';
import { useAppSelector } from '../../../store';
import { BOARD_FRAME } from '../../fleet/components/board-scroll';
import { DARK_FILTER_BAR } from '../../fleet/components/dark-filter-bar';
import { FilterWithIcon } from '../../fleet/components/FilterWithIcon';
import { BoardIcon, NUM, PATH } from '../../fleet/components/FuelCardBoard';
import { useOperationsCurrencies } from '../api/operations-queries';
import {
  reportCurrencyLookup,
  reportMoney,
  reportOtherCards,
  reportTableLines,
  type ReportBoardRow,
  type ReportMoney,
  type ReportTableLine,
} from '../lib/report-board';
import {
  printReportDocs,
  reportExportHeader,
  reportExportTable,
  reportPrintDoc,
  reportSheet,
  saveReportWorkbook,
  vaultPanelExport,
} from '../lib/report-export';
import { cairoToday } from '../lib/shipment-history';
import { FIGURE_TONE, OtherCurrenciesDialog } from './BoardFigures';
import {
  BAR_LAYOUT,
  BOARD_TABLE_LOOK,
  BoardDateBox,
  BoardRefusal,
  type BoardDatePicker,
} from './ShipmentsBoard';

/**
 * The report's bar: the board's dark card across the screen, and its phone layout (two even
 * columns, the name filter across both). From a computer up the name filter takes the row's give
 * and each date keeps a date's width — as the history's dates do (`PERIOD_BAR_LAYOUT`) — rather
 * than three boxes sharing the row evenly, which made a date box half the screen wide.
 */
const REPORT_BAR = cn(
  DARK_FILTER_BAR,
  BAR_LAYOUT,
  'lg:[&>div>*:has(>input[type=date])]:!flex-none lg:[&>div>*:has(>input[type=date])]:!w-44',
);

/** A table or a panel of the report: the board table's own card. */
export const REPORT_CARD =
  'flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]';

/**
 * «الإجمالي» — the legacy light-blue row, in the board palette: the site's purple, the one tone no
 * row state uses (green, yellow and blue are the boards' stages). It stays at the bottom of the
 * table's own scroll while the rows move under it, as the head stays at the top.
 */
const TOTAL_ROW = cn(
  '[&_tr[data-report-total]_td]:sticky [&_tr[data-report-total]_td]:bottom-0 [&_tr[data-report-total]_td]:z-[1]',
  // Its top line as a shadow, not a border: a collapsed table's border does not travel with a
  // sticky cell, so it would stay behind with the rows.
  '[&_tr[data-report-total]_td]:shadow-[inset_0_2px_0_rgb(var(--brand-500)/0.45)]',
  '[&_tr[data-report-total]_td]:!bg-brand-50 dark:[&_tr[data-report-total]_td]:!bg-[#1c1a4a]',
  '[&_tr[data-report-total]_td]:!text-brand-800 dark:[&_tr[data-report-total]_td]:!text-brand-100',
  '[&_tr[data-report-total]_td]:!py-3 [&_tr[data-report-total]_td_*]:!font-black',
);

/** What marks «الإجمالي»'s row for `TOTAL_ROW` — a data attribute, which the row's props carry. */
const TOTAL_ROW_MARK = { 'data-report-total': 'true' } as HTMLAttributes<HTMLTableRowElement>;

/**
 * The table's columns are short — a number, a name, figures — so the floor per column is under
 * the default 7.5rem: nine columns then fit beside the vault's panel on a laptop. 5.25, a hair
 * under the boards' 5.5: at 1280px the panel widens to 22rem and leaves the table 790px, and
 * nine 5.5rem columns (792px) overflowed it by 2px — a sideways scrollbar under a table that
 * holds nothing hidden. On a phone the table scrolls sideways inside its card, never the page.
 */
const MIN_COLUMN_REM = 5.25;

/**
 * The report's content row: on a computer the table and the panel side by side, each as tall as
 * what is left of the screen under the bar (`items-stretch` — the panel takes the table card's
 * height, `VaultValuePanel.tsx`); on a phone stacked, the page scrolling.
 */
const REPORT_ROW = 'flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row lg:items-stretch';

/** A figure in a cell: the figures' face, isolated left-to-right, never broken over two lines. */
const Figure = ({ value, dim = false }: { value: string; dim?: boolean }): JSX.Element => (
  <span
    dir="ltr"
    className={cn('whitespace-nowrap', NUM, dim && 'text-slate-400 dark:text-slate-500')}
  >
    {value}
  </span>
);

/** The strip across the top of a card — legacy's black band over each table, in the board's look. */
export const ReportTitle = ({
  icon,
  title,
  aside,
}: {
  icon: readonly string[];
  title: string;
  /** A note at the strip's far end, after the title. */
  aside?: ReactNode;
}): JSX.Element => (
  <div
    data-report-title="true"
    className="flex shrink-0 items-center gap-2.5 border-b border-slate-200 bg-gradient-to-l from-brand-500/10 via-transparent to-transparent px-4 py-3 dark:border-slate-800"
  >
    <span
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
        FIGURE_TONE.count,
      )}
    >
      <BoardIcon d={[...icon]} className="h-4 w-4" />
    </span>
    <h2 className="min-w-0 flex-1 text-sm font-black text-slate-900 sm:text-[15px] dark:text-white">
      {title}
    </h2>
    {aside}
  </div>
);

/** Which row's «عملات أخرى» is open — its money and the name it is over. */
interface OpenOthers {
  money: ReportMoney;
  name: string;
}

/** A line's name as the table shows it: the row's, «غير منسوب» for the bucket, «الإجمالي». */
const useLineName = (): ((line: ReportTableLine) => string) => {
  const t = useT();
  return (line) =>
    line.kind === 'total'
      ? t('operations.reportBoard.total')
      : line.unattributed
        ? t('operations.reports.unattributed')
        : line.label;
};

/**
 * One report's table in its card — the title strip, the nine columns, «الإجمالي» pinned under the
 * rows, the «عملات أخرى» breakdown. The reports' board draws it (`ReportBoard`), and so does
 * «سجل الخزينة»'s live «تقرير الخزينة» (`VaultHeldReportDialog.tsx`) — the same table «بيان الشحنات
 * لكل بنك» over what the vault holds now («نفس الداتا … ونفس الشكل وكل حاجه»).
 */
export const ReportTable = ({
  title,
  titleIcon,
  titleAside,
  keyHeader,
  countHeader,
  rows,
  total,
  loading,
  error,
  onRetry,
  empty,
  className,
}: {
  /** The table's strip — «بيان الشحنات لكل بنك», «بيان عدد الشحنات لكل قائد طاقم». */
  title: string;
  titleIcon: readonly string[];
  titleAside?: ReactNode;
  /** What the rows are keyed on — «البنك», «اسم القائد». */
  keyHeader: string;
  /** What the count counts — «عدد المحصنات» on the vault, «عدد الشحنات» on the captains. */
  countHeader: string;
  /** The rows to draw, in their order (`reportRowsInOrder`, then the name filter — `reportView`). */
  rows: readonly ReportBoardRow[];
  /** «الإجمالي» — the server's grand total, or the shown rows' with a name typed (`reportView`). */
  total: OperationsReportTotalsDto | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  empty: string;
  /** The card's size where it sits — the reports' full height, the vault history's capped one. */
  className?: string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  // The boards' own query, so the catalog is one cache across them: the money is split by it.
  const currencies = useOperationsCurrencies({ page: 1, pageSize: MAX_PAGE_SIZE });
  const catalog = currencies.data?.items ?? [];
  const [others, setOthers] = useState<OpenOthers | null>(null);
  const nameOf = useLineName();

  const lines = reportTableLines(rows, total);
  // A line's money, split once per draw — the pound, the dollar, the others.
  const moneyOf = new Map(
    lines.map((line) => [line.key, reportMoney(line.totals.currencies, catalog)]),
  );
  const money = (line: ReportTableLine): ReportMoney =>
    moneyOf.get(line.key) ?? { egp: 0, usd: 0, others: [], othersSum: 0 };

  // Counts and money in ONE set of digits, the boards' amounts' (Western, with thousands
  // separators): a row reading «١٤» beside «48,500,000» reads as two different tables.
  const figure = (value: number): JSX.Element => (
    <Figure value={formatAmount(value, locale)} dim={value === 0} />
  );

  const columns: Column<ReportTableLine>[] = [
    {
      key: 'serial',
      header: t('operations.reportBoard.serial'),
      align: 'center',
      headerClassName: 'w-12',
      render: (line) => (line.kind === 'row' ? figure(line.serial) : null),
    },
    {
      key: 'label',
      header: keyHeader,
      render: (line) =>
        line.kind === 'row' && line.unattributed ? (
          // Worded as it always was, and muted: a bucket, not a bank or a captain.
          <span className="text-slate-500 dark:text-slate-400">{nameOf(line)}</span>
        ) : (
          <span className="block min-w-[6rem] max-w-[14rem] whitespace-normal leading-tight">
            {nameOf(line)}
          </span>
        ),
    },
    {
      key: 'count',
      header: countHeader,
      align: 'center',
      render: (line) => figure(line.totals.shipmentCount),
    },
    {
      key: 'egp',
      header: t('operations.reportBoard.pound'),
      align: 'center',
      render: (line) => figure(money(line).egp),
    },
    {
      key: 'usd',
      header: t('operations.reportBoard.dollar'),
      align: 'center',
      render: (line) => figure(money(line).usd),
    },
    {
      key: 'others',
      header: t('operations.board.figures.otherCurrencies'),
      align: 'center',
      // A sum of DIFFERENT currencies, so a click lists each one apart — the boards' «عملات أخرى»
      // pill and its dialog. Nothing to list on a zero.
      render: (line) => {
        const own = money(line);
        if (own.othersSum === 0) return figure(0);
        const name = nameOf(line);
        return (
          <button
            type="button"
            data-report-others={line.key}
            aria-haspopup="dialog"
            title={t('operations.board.figures.otherCurrenciesHint')}
            onClick={() => setOthers({ money: own, name })}
            // `[&&]`: the board table sizes every button in a cell as an icon square; this one is
            // a figure, as wide as its digits.
            className="[&&]:!h-auto [&&]:!w-auto rounded-md px-1.5 py-0.5 text-amber-700 underline decoration-amber-500/50 decoration-dotted underline-offset-4 transition hover:bg-amber-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 dark:text-amber-300"
          >
            <Figure value={formatAmount(own.othersSum, locale)} />
            {/* What the figure is, for a reader — said AFTER the figure, never in place of it: an
                `aria-label` would replace the button's own digits, and a screen reader would
                announce a description with no amount (the boards' pill is named by its content
                too). */}
            <span className="sr-only">{t('operations.reportBoard.othersOf', { name })}</span>
          </button>
        );
      },
    },
    {
      key: 'bags',
      header: t('operations.reportBoard.bags'),
      align: 'center',
      render: (line) => figure(line.totals.bagCount),
    },
    {
      key: 'cartons',
      header: t('operations.reportBoard.cartons'),
      align: 'center',
      render: (line) => figure(line.totals.cartonCount),
    },
    {
      key: 'boxes',
      header: t('operations.reportBoard.boxes'),
      align: 'center',
      render: (line) => figure(line.totals.boxCount),
    },
  ];

  const shownOthers = others === null ? null : reportOtherCards(others.money);

  return (
    <section className={cn(REPORT_CARD, className)} data-report-table="true">
      <ReportTitle icon={titleIcon} title={title} aside={titleAside} />
      <div
        className={cn(
          BOARD_TABLE_LOOK,
          TOTAL_ROW,
          // The card draws the frame; the table inside it takes the card's height left under the
          // strip, and only its rows scroll — under the head, over «الإجمالي». `flex-1` from a
          // computer up only: on a phone the card's height is its content's, up to its cap, and a
          // zero basis there would fold the table to nothing.
          'flex min-h-0 flex-col lg:flex-1 [&>div]:min-h-0 lg:[&>div]:flex-1 [&>div]:!rounded-none [&>div]:!border-0',
          '[&_thead_th]:!text-center [&_thead_th:nth-child(2)]:!text-start',
        )}
      >
        <DataTable
          columns={columns}
          rows={lines}
          rowKey={(line) => line.key}
          rowProps={(line) => (line.kind === 'total' ? TOTAL_ROW_MARK : undefined)}
          loading={loading || currencies.isLoading}
          error={error}
          onRetry={onRetry}
          empty={empty}
          embedded
          stickyHead
          minColumnWidth={MIN_COLUMN_REM}
        />
      </div>

      <OtherCurrenciesDialog
        open={others !== null}
        onClose={() => setOthers(null)}
        cards={shownOthers ?? []}
        sum={others?.money.othersSum ?? 0}
        currencyOf={reportCurrencyLookup(catalog, others?.money.others ?? [])}
        locale={locale}
        subtitle={
          others === null ? undefined : t('operations.reportBoard.othersOf', { name: others.name })
        }
      />
    </section>
  );
};

/** The two export buttons — the Fleet boards' «Excel | PDF» pair, in the bar's trailing group. */
const EXPORT_PAIR =
  'inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-300 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800/80';
const EXPORT_BUTTON =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 text-[11px] font-semibold text-slate-800 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:gap-1.5 sm:px-2.5 sm:py-1.5 sm:text-xs dark:text-slate-200';

/** The name filter of the bar — «اسم القائد» or «اسم البنك»: the boards' text box with its icon. */
export interface ReportNameFilter {
  /** Its name — on the box, as its placeholder, and to a screen reader. */
  label: string;
  icon: readonly string[];
  value: string;
  onChange: (value: string) => void;
}

/** What the files are called and say, beside the table they carry. */
export interface ReportExportSpec {
  /** The file's stem and the printed title — the screen's name. */
  name: string;
  /** The line under the printed title: the period, and the name filter when one is typed. */
  subtitle: string;
  /** The vault's: carry «إجمالي قيمة الشحنات» too — a second sheet, a second printed page. */
  withValuePanel?: boolean;
}

/**
 * «Excel | PDF» over a report's table — the reports' bar end, and «تقرير الخزينة»'s header on
 * «سجل الخزينة» (`VaultHeldReportDialog.tsx`), so the live report's files are the period report's
 * files over another answer: the lines the table draws, «الإجمالي» under them, and — on the vault —
 * «إجمالي قيمة الشحنات» as a second sheet and a second printed page.
 */
export const ReportExportPair = ({
  title,
  keyHeader,
  countHeader,
  lines,
  total,
  exportSpec,
}: {
  /** The table's strip — the sheet's name. */
  title: string;
  keyHeader: string;
  countHeader: string;
  /** The lines the table draws (`reportTableLines`) — none, and there is nothing to export. */
  lines: readonly ReportTableLine[];
  /** «الإجمالي» — what the vault's panel is read off. */
  total: OperationsReportTotalsDto | undefined;
  exportSpec: ReportExportSpec;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const currencies = useOperationsCurrencies({ page: 1, pageSize: MAX_PAGE_SIZE });
  const catalog = currencies.data?.items ?? [];
  const nameOf = useLineName();

  // The money waits for the catalog it is split by, as the table's does.
  const canExport = lines.length > 0 && currencies.data !== undefined;

  const table = () =>
    reportExportTable(lines, catalog, reportExportHeader(t, keyHeader, countHeader), nameOf);
  const panel = () =>
    exportSpec.withValuePanel === true && total !== undefined
      ? vaultPanelExport(t, total, catalog)
      : null;

  const exportExcel = (): void => {
    const own = panel();
    saveReportWorkbook(
      exportSpec.name,
      [
        reportSheet(title, t('operations.reportBoard.serial'), table()),
        ...(own === null
          ? []
          : [
              reportSheet(
                t('operations.vaultReport.value'),
                t('operations.reportBoard.serial'),
                own,
              ),
            ]),
      ],
      cairoToday(),
    );
  };
  const exportPdf = (): void => {
    const own = panel();
    const docs = [
      reportPrintDoc({
        t,
        locale,
        title: exportSpec.name,
        subtitle: exportSpec.subtitle,
        table: table(),
      }),
      ...(own === null
        ? []
        : [
            reportPrintDoc({
              t,
              locale,
              title: t('operations.vaultReport.value'),
              subtitle: exportSpec.subtitle,
              table: own,
            }),
          ]),
    ];
    if (!printReportDocs(docs)) toast.error(t('operations.reportExport.popupBlocked'));
  };

  return (
    <span className={EXPORT_PAIR} data-report-export="true">
      <button
        type="button"
        data-report-export-excel="true"
        disabled={!canExport}
        onClick={exportExcel}
        className={cn(
          EXPORT_BUTTON,
          'hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/60 dark:hover:text-emerald-300',
        )}
      >
        <BoardIcon d={PATH.excel} className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        Excel
      </button>
      <span aria-hidden className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
      <button
        type="button"
        data-report-export-pdf="true"
        disabled={!canExport}
        onClick={exportPdf}
        className={cn(
          EXPORT_BUTTON,
          'hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400',
        )}
      >
        <BoardIcon d={PATH.pdf} className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
        PDF
      </button>
    </span>
  );
};

export const ReportBoard = ({
  label,
  title,
  titleIcon,
  keyHeader,
  countHeader,
  rows,
  total,
  loading,
  error,
  onRetry,
  empty,
  refusal = null,
  nameFilter,
  datePickers,
  filtersActive,
  onResetFilters,
  exportSpec,
  aside,
}: {
  /** The screen's name, for a reader — the page draws no title, as no board does. */
  label: string;
  title: string;
  titleIcon: readonly string[];
  keyHeader: string;
  countHeader: string;
  /** The rows SHOWN, in the order to draw them — the name filter already applied (`reportView`). */
  rows: readonly ReportBoardRow[];
  /** «الإجمالي» for those rows (`reportView`): the server's grand total, or theirs with a name typed. */
  total: OperationsReportTotalsDto | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  empty: string;
  /** Why the report was not asked for — said in the table's place (an inverted range). */
  refusal?: string | null;
  nameFilter: ReportNameFilter;
  /** «من» and «إلى». The page owns their values and what they ask the server for. */
  datePickers: readonly BoardDatePicker[];
  /** A name is typed, or the period is not the page's default — the reset has something to undo. */
  filtersActive: boolean;
  onResetFilters: () => void;
  exportSpec: ReportExportSpec;
  /** Beside the table at its far side (the left on an Arabic page), under it on a phone — the vault's panel. */
  aside?: ReactNode;
}): JSX.Element => {
  // The files carry the lines the table draws — nothing to carry while there are none (loading,
  // refused, empty, or a name that matched nobody).
  const lines = refusal === null ? reportTableLines(rows, total) : [];
  const exports = (
    <ReportExportPair
      title={title}
      keyHeader={keyHeader}
      countHeader={countHeader}
      lines={lines}
      total={total}
      exportSpec={exportSpec}
    />
  );

  return (
    <div className={BOARD_FRAME} role="region" aria-label={label} data-report-board="true">
      <div className={REPORT_BAR} data-report-filters="true">
        <FilterBar hasActiveFilters={filtersActive} onClear={onResetFilters} trailing={exports}>
          {/* «فلتر ب اسم القائد» / «ب اسم البنك» — first, as the name is the table's first column
              after «م»; the boards' text box, applied as it is typed. */}
          <FilterWithIcon
            icon={nameFilter.icon}
            tone="text-emerald-600 dark:text-emerald-400"
            className="w-56 shrink-0 max-sm:col-span-2"
          >
            <Input
              density="tight"
              data-report-name-filter="true"
              aria-label={nameFilter.label}
              placeholder={nameFilter.label}
              value={nameFilter.value}
              onChange={(e) => nameFilter.onChange(e.target.value)}
            />
          </FilterWithIcon>
          {datePickers.map((picker) => (
            <BoardDateBox key={picker.param} picker={picker} />
          ))}
        </FilterBar>
      </div>

      {refusal !== null ? (
        <BoardRefusal>{refusal}</BoardRefusal>
      ) : (
        <div className={REPORT_ROW} data-report-row="true">
          <ReportTable
            title={title}
            titleIcon={titleIcon}
            keyHeader={keyHeader}
            countHeader={countHeader}
            rows={rows}
            total={total}
            loading={loading}
            error={error}
            onRetry={onRetry}
            empty={empty}
            // A computer: the card runs to the screen's bottom (its rows scroll inside it). A
            // phone: at most three quarters of the screen, so its «الإجمالي» stays in sight.
            className="max-lg:max-h-[75vh] lg:min-h-0 lg:flex-1"
          />
          {aside}
        </div>
      )}
    </div>
  );
};
