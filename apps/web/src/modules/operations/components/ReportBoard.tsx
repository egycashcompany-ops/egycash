// The reports on the boards' look — «تجميع الخزينة» (`pages/VaultReportPage.tsx`) and «تقرير القادة»
// (`pages/CaptainReportPage.tsx`). «تجميع الخزينة هيكون زى الشاشة اللى بعتهالك بتاعت البنوك وتقرير
// القادة الشاشة هتكون الشاشة التانية»: the legacy screens' STRUCTURE — «من» / «إلى» over a table with
// a title strip, م | the key | the count | المصري | الدولار | اجمالي العملات | الحقائب | كرتونه |
// صندوق, and «الإجمالي» under the rows — worn in the look the owner approved on every Operations
// board this month (`ShipmentsBoard.tsx`): the dark one-row filter card with the history's date
// boxes, the dark rounded table with its dark head, the figures' face, the «عملات أخرى» breakdown.
//
// Built from the board's own pieces rather than copies of them — `BoardDateBox`, `BoardRefusal`,
// `BOARD_TABLE_LOOK`, `BAR_LAYOUT`, the breakdown dialog — so a fix to one of them reaches the
// reports too, and the reports cannot drift from the boards they sit beside in the menu.
//
// THREE THINGS THIS WILL NOT DO, each a legacy defect the server already fixed (as `ReportView`
// before it): it never adds the rows up — «الإجمالي» is the server's `grandTotal` (Q27); it never
// multiplies packages by currencies (Q26); and it never hides a row whose money is zero (Q28).
// What it does to the answer is a VIEW of it (`lib/report-board.ts`): the money split the boards'
// way, the currencies in the reference list's order, the unattributed row last.
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
import { cn } from '../../../shared/lib/cn';
import { formatAmount } from '../../../shared/lib/format';
import { useAppSelector } from '../../../store';
import { BOARD_FRAME } from '../../fleet/components/board-scroll';
import { DARK_FILTER_BAR } from '../../fleet/components/dark-filter-bar';
import { BoardIcon, NUM } from '../../fleet/components/FuelCardBoard';
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
import { FIGURE_TONE, OtherCurrenciesDialog } from './BoardFigures';
import {
  BAR_LAYOUT,
  BOARD_TABLE_LOOK,
  BoardDateBox,
  BoardRefusal,
  type BoardDatePicker,
} from './ShipmentsBoard';

/**
 * The report's bar: the board's dark card and its phone layout (two even columns). A report has
 * only its two dates, so from a tablet up the card holds just them — at the start, as legacy's
 * «من» / «الى» sat — rather than a screen-wide band with two boxes at one end: each date keeps a
 * date's width instead of the Fleet bar's even share of the whole row.
 */
const REPORT_BAR = cn(
  DARK_FILTER_BAR,
  BAR_LAYOUT,
  'sm:[&>div]:!w-fit',
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
}: {
  icon: readonly string[];
  title: string;
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
  </div>
);

/** Which row's «عملات أخرى» is open — its money and the name it is over. */
interface OpenOthers {
  money: ReportMoney;
  name: string;
}

export const ReportBoard = ({
  label,
  title,
  titleIcon,
  keyHeader,
  countHeader,
  rows,
  grandTotal,
  loading,
  error,
  onRetry,
  empty,
  refusal = null,
  datePickers,
  periodActive,
  onResetPeriod,
  aside,
}: {
  /** The screen's name, for a reader — the page draws no title, as no board does. */
  label: string;
  /** The table's strip — «بيان الشحنات لكل بنك», «بيان عدد الشحنات لكل قائد طاقم». */
  title: string;
  titleIcon: readonly string[];
  /** What the rows are keyed on — «البنك», «اسم القائد». */
  keyHeader: string;
  /** What the count counts — «عدد المحصنات» on the vault, «عدد الشحنات» on the captains. */
  countHeader: string;
  /** The server's rows, in the order to draw them (`reportRowsInOrder`). */
  rows: readonly ReportBoardRow[];
  /** The server's own total — drawn as «الإجمالي», never a sum of `rows` (Q27). */
  grandTotal: OperationsReportTotalsDto | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  empty: string;
  /** Why the report was not asked for — said in the table's place (an inverted range). */
  refusal?: string | null;
  /** «من» and «إلى». The page owns their values and what they ask the server for. */
  datePickers: readonly BoardDatePicker[];
  /** The period is not the page's default — the reset has something to undo. */
  periodActive: boolean;
  onResetPeriod: () => void;
  /** Beside the table at its far side (the left on an Arabic page), under it on a phone — the vault's panel. */
  aside?: ReactNode;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  // The boards' own query, so the catalog is one cache across them: the money is split by it.
  const currencies = useOperationsCurrencies({ page: 1, pageSize: MAX_PAGE_SIZE });
  const catalog = currencies.data?.items ?? [];
  const [others, setOthers] = useState<OpenOthers | null>(null);

  const lines = reportTableLines(rows, grandTotal);
  // A line's money, split once per draw — the pound, the dollar, the others.
  const moneyOf = new Map(
    lines.map((line) => [line.key, reportMoney(line.totals.currencies, catalog)]),
  );
  const money = (line: ReportTableLine): ReportMoney =>
    moneyOf.get(line.key) ?? { egp: 0, usd: 0, others: [], othersSum: 0 };
  const nameOf = (line: ReportTableLine): string =>
    line.kind === 'total'
      ? t('operations.reportBoard.total')
      : line.unattributed
        ? t('operations.reports.unattributed')
        : line.label;

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
    <div className={BOARD_FRAME} role="region" aria-label={label} data-report-board="true">
      <div className={REPORT_BAR} data-report-filters="true">
        <FilterBar hasActiveFilters={periodActive} onClear={onResetPeriod}>
          {datePickers.map((picker) => (
            <BoardDateBox key={picker.param} picker={picker} />
          ))}
        </FilterBar>
      </div>

      {refusal !== null ? (
        <BoardRefusal>{refusal}</BoardRefusal>
      ) : (
        // On a computer the table and the panel sit side by side and each scrolls inside its own
        // card, the head and «الإجمالي» staying put; on a phone they stack and the page scrolls.
        <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row lg:items-start">
          <section className={cn(REPORT_CARD, 'lg:max-h-full lg:flex-1')} data-report-table="true">
            <ReportTitle icon={titleIcon} title={title} />
            <div
              className={cn(
                BOARD_TABLE_LOOK,
                TOTAL_ROW,
                // The card draws the frame; the table inside it fills it and scrolls.
                'flex min-h-0 flex-col [&>div]:min-h-0 [&>div]:!rounded-none [&>div]:!border-0',
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
          </section>
          {aside}
        </div>
      )}

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
    </div>
  );
};
