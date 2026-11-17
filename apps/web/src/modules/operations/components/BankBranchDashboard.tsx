// «لوحة البنك بفروعه» (Round 25) — one bank of «تقرير البنوك» (`pages/BankReportPage.tsx`), broken
// down by its branches.
//
// THE OWNER: «صفحة تقرير البنوك عاوز فى الجدول عند البنك فى الاخر بعد الصناديق يكون فيه سهم ادوس عليه
// يفتح زى داش برود كدا للبنك بالفروع بتاعته». The arrow at the end of a bank's row (after «الصناديق»)
// opens this, over the page, for exactly the period the page shows.
//
// THE WINDOW is the vault reports' one (`ReportModalFrame` — «تقرير الخزينة» and «لوحة تحكم» on
// «محصنات الخزينة» already open in it): over the whole screen, Escape or × to close, the focus kept
// inside and handed back to the arrow, the page behind held still — the owner's «زى داش برود» is
// the dashboard he already knows. A dedicated page would have lost the bank report behind it (its
// period, its name filter) for a view that is a closer look at one of its rows. It is still a link:
// the bank is in the address (`?bank=…`, `lib/bank-dashboard.ts`), so a copied address opens the
// same bank over the same period, and Back closes it.
//
// WHAT IT HOLDS, top to bottom — every section drawn even with nothing to count (a bank with no
// محصنة in the period reads 0s, not a blank window):
//   · the header: the bank's name, the period, «تُنسب كل محصنة إلى: من فرع | إلى فرع» (which of the
//     shipment's two branches files it — `side`, «من فرع» by default), and «Excel | PDF»;
//   · the seven figure tiles of the vault reports (`ReportFigureTiles`) — the bank's total, which IS
//     its row in the table behind (the server's promise);
//   · two charts, one measure each — never two scales on one axis: «المصري حسب الفرع» and «عدد
//     المحصنات حسب الفرع». Horizontal bars, because branch names are long and Arabic; one hue (the
//     brand's indigo, as «جدول التسليم» — one measure, one colour); the largest first, eight named and
//     the rest folded into one muted «باقي الفروع (n)» bar; the figure at each bar's tip; every
//     figure of the branch in the line's hover title. No legend: one series, named by the title;
//   · «بيان المحصنات لكل فرع» — the reports' own table (`ReportTable`) with «المنطقة» after the
//     branch, a branch of another bank saying whose, every head sortable (`sortBranchRows`), and
//     «الإجمالي» pinned under it — beside «إجمالي قيمة الشحنات» over the same total.
//
// READ ONLY WHILE OPEN: the window — and its query — is mounted only while a bank is named.
import { useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MAX_PAGE_SIZE, type Locale, type OperationsBankBranchReportSide } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { ApiError } from '../../../shared/lib/api-client';
import { cn } from '../../../shared/lib/cn';
import { formatAmount } from '../../../shared/lib/format';
import { pluralKey } from '../../../shared/lib/plural';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { useAppSelector } from '../../../store';
import { CARD, CardHead, NOTE } from '../../fleet/components/custody-dashboard-parts';
import { BoardIcon, NUM } from '../../fleet/components/FuelCardBoard';
import { useBankBranchReport, useOperationsCurrencies } from '../api/operations-queries';
import {
  DEFAULT_BRANCH_SORT,
  branchBars,
  branchBoardRows,
  nextBranchSort,
  sortBranchRows,
  type BranchBar,
  type BranchBoardRow,
  type BranchMeasure,
  type BranchSort,
} from '../lib/bank-dashboard';
import { reportMoney, reportTableLines, type ReportTableLine } from '../lib/report-board';
import { reportExportSubtitle } from '../lib/report-export';
import { ltrIsolate } from '../lib/shipment-log';
import { heldReportTiles } from '../lib/vault-held-report';
import { ReportExportPair, ReportTable, type ReportDetailColumn } from './ReportBoard';
import {
  ReportFigureTiles,
  ReportModalFrame,
  ReportModalTitle,
  ReportTilesSkeleton,
} from './ReportModal';
import { SHIPMENT_PATH } from './shipment-icons';
import { VaultValuePanel } from './VaultValuePanel';

/** What the page hands the dashboard: which bank, over which period, filed by which branch. */
interface DashboardProps {
  bankId: string;
  /** The bank's name as the page's row prints it — the title before the answer lands. */
  bankName: string;
  /** The page's period, both days inclusive ('YYYY-MM-DD'). */
  range: { from: string; to: string };
  side: OperationsBankBranchReportSide;
  onSide: (side: OperationsBankBranchReportSide) => void;
  onClose: () => void;
}

// ── The header ────────────────────────────────────────────────────────────────────────────────

/** «من 2026-11-01 إلى 2026-11-30» — the page's period, each day kept in its own order. */
const PeriodChip = ({ range }: { range: { from: string; to: string } }): JSX.Element => {
  const t = useT();
  return (
    <span
      data-bank-dashboard-period="true"
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600 dark:border-[#223048] dark:bg-[#0a0e17] dark:text-slate-300',
        NUM,
      )}
    >
      <BoardIcon d={[...SHIPMENT_PATH.calendar]} className="h-3.5 w-3.5 text-brand-500" />
      {t('operations.bankDashboard.period', {
        from: ltrIsolate(range.from),
        to: ltrIsolate(range.to),
      })}
    </span>
  );
};

const SIDES: readonly OperationsBankBranchReportSide[] = ['origin', 'destination'];
const SIDE_WORD: Record<OperationsBankBranchReportSide, string> = {
  origin: 'operations.shipment.origin',
  destination: 'operations.shipment.destination',
};
const SIDE_HINT: Record<OperationsBankBranchReportSide, string> = {
  origin: 'operations.bankDashboard.side.originHint',
  destination: 'operations.bankDashboard.side.destinationHint',
};

/**
 * «تُنسب كل محصنة إلى: من فرع | إلى فرع» — the boards' two-way switch. A shipment names two branches;
 * the dashboard files it under one, «من فرع» unless the reader turns it. Each half says what it
 * means in its hover title.
 */
const SideSwitch = ({
  side,
  onSide,
}: {
  side: OperationsBankBranchReportSide;
  onSide: (side: OperationsBankBranchReportSide) => void;
}): JSX.Element => {
  const t = useT();
  const labelId = useId();
  return (
    <span className="inline-flex shrink-0 items-center gap-2">
      <span id={labelId} className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
        {t('operations.bankDashboard.side.label')}
      </span>
      <span
        role="group"
        aria-labelledby={labelId}
        data-bank-dashboard-side={side}
        className="inline-flex items-center gap-0.5 rounded-lg border border-slate-300 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800/80"
      >
        {SIDES.map((value) => {
          const on = value === side;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={on}
              title={t(SIDE_HINT[value])}
              data-bank-dashboard-side-option={value}
              onClick={() => {
                if (!on) onSide(value);
              }}
              className={cn(
                'whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 sm:text-xs',
                on
                  ? 'bg-white text-brand-700 shadow-sm dark:bg-brand-500/20 dark:text-brand-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white',
              )}
            >
              {t(SIDE_WORD[value])}
            </button>
          );
        })}
      </span>
    </span>
  );
};

// ── The charts ────────────────────────────────────────────────────────────────────────────────

/** The bar's name: the branch's, «غير منسوب» for the bucket, «باقي الفروع (n)» for the fold. */
const useBarLabel = (): ((bar: BranchBar) => string) => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (bar) =>
    bar.rest > 0
      ? t('operations.bankDashboard.chart.rest', { count: formatAmount(bar.rest, locale) })
      : bar.unattributed
        ? t('operations.reports.unattributed')
        : bar.label;
};

/**
 * One chart — one measure, one hue. Each line: the branch's name, then its bar from the baseline
 * (the start side, a hairline), its rounded data end and its figure just past it; the folded
 * «باقي الفروع» bar is the muted slate, so it never reads as a branch. The line's hover title, and
 * its name to a screen reader, carry the branch's count, pound and dollar (the table carries all).
 */
const BranchBarsCard = ({
  measure,
  rows,
  loading,
}: {
  measure: BranchMeasure;
  rows: readonly BranchBoardRow[];
  loading: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const currencies = useOperationsCurrencies({ page: 1, pageSize: MAX_PAGE_SIZE });
  const catalog = currencies.data?.items ?? [];
  const titleId = useId();
  const labelOf = useBarLabel();
  const ready = !loading && currencies.data !== undefined;
  const bars = ready ? branchBars(rows, catalog, measure) : [];
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const words = (bar: BranchBar): string => {
    const label = labelOf(bar);
    const row = bar.rest > 0 ? undefined : byKey.get(bar.key);
    if (row === undefined) return `${label} — ${formatAmount(bar.value, locale)}`;
    const money = reportMoney(row.totals.currencies, catalog);
    return t('operations.bankDashboard.chart.bar', {
      label,
      count: formatAmount(row.totals.shipmentCount, locale),
      egp: formatAmount(money.egp, locale),
      usd: formatAmount(money.usd, locale),
    });
  };
  return (
    <section
      aria-labelledby={titleId}
      data-bank-dashboard-chart={measure}
      className={cn(CARD, 'flex min-w-0 flex-col rounded-2xl p-4')}
    >
      <CardHead
        id={titleId}
        title={
          <>
            <BoardIcon
              d={[...(measure === 'egp' ? SHIPMENT_PATH.money : SHIPMENT_PATH.shipment)]}
              className="h-4 w-4 text-brand-600 dark:text-brand-400"
            />
            {t(
              measure === 'egp'
                ? 'operations.bankDashboard.chart.egp'
                : 'operations.bankDashboard.chart.count',
            )}
          </>
        }
        note={t('operations.bankDashboard.chart.note')}
      />
      {!ready ? (
        <div className="space-y-2.5" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-5 rounded-md" />
          ))}
        </div>
      ) : bars.length === 0 ? (
        <p className={cn(NOTE, 'py-6 text-center')} data-bank-dashboard-chart-empty={measure}>
          {t(
            measure === 'egp'
              ? 'operations.bankDashboard.chart.noneEgp'
              : 'operations.bankDashboard.chart.noneCount',
          )}
        </p>
      ) : (
        <ul className="space-y-1" aria-labelledby={titleId}>
          {bars.map((bar) => {
            const said = words(bar);
            const folded = bar.rest > 0;
            return (
              <li
                key={bar.key}
                data-bank-dashboard-bar={bar.key}
                data-value={bar.value}
                title={said}
                aria-label={said}
                // The whole line is the hover target — far bigger than a thin bar.
                className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] items-center gap-x-2.5 rounded-md px-1.5 py-1 transition hover:bg-slate-50 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] dark:hover:bg-slate-800/50"
              >
                <span
                  aria-hidden
                  className={cn(
                    'truncate text-xs font-bold',
                    folded || bar.unattributed
                      ? 'text-slate-500 dark:text-slate-400'
                      : 'text-slate-700 dark:text-slate-200',
                  )}
                >
                  {labelOf(bar)}
                </span>
                <span
                  aria-hidden
                  className="flex min-w-0 items-center gap-1.5 border-s border-slate-200 py-0.5 dark:border-slate-700"
                >
                  <span
                    className={cn(
                      'h-3.5 shrink-0 rounded-e-[4px]',
                      folded ? 'bg-slate-400 dark:bg-slate-500' : 'bg-brand-600 dark:bg-brand-500',
                    )}
                    // Room kept for the figure at the tip; never thinner than a hairline.
                    style={{ width: `max(2px, calc((100% - 5.5rem) * ${bar.share}))` }}
                  />
                  <span
                    dir="ltr"
                    className={cn(
                      'shrink-0 whitespace-nowrap text-[11px] font-bold text-slate-700 dark:text-slate-200',
                      NUM,
                    )}
                  >
                    {formatAmount(bar.value, locale)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

// ── The window ────────────────────────────────────────────────────────────────────────────────

/** «4 فروع» — how many branches the table lists, in the form the count takes. */
const BranchCount = ({ count }: { count: number }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <span
      data-bank-dashboard-branch-count={count}
      className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700 dark:bg-brand-500/15 dark:text-brand-200"
    >
      {t(pluralKey('operations.bankDashboard.branchCount', locale, count), {
        count: formatAmount(count, locale),
      })}
    </span>
  );
};

const BankDashboardModal = ({
  bankId,
  bankName,
  range,
  side,
  onSide,
  onClose,
}: DashboardProps): JSX.Element => {
  const t = useT();
  const titleId = useId();
  const report = useBankBranchReport(bankId, { ...range, side });
  const currencies = useOperationsCurrencies({ page: 1, pageSize: MAX_PAGE_SIZE });
  const catalog = currencies.data?.items ?? [];
  const [sort, setSort] = useState<BranchSort>(DEFAULT_BRANCH_SORT);

  // Only this bank's answer is ever drawn; a flip of the side holds the last one, dimmed, until the
  // new one lands (the query's placeholder).
  const data = report.data?.bankId === bankId ? report.data : undefined;
  const current = data !== undefined && data.side === side;
  const name = data?.bankName ?? bankName;
  const rows = data === undefined ? [] : sortBranchRows(branchBoardRows(data.rows), catalog, sort);
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const rowOf = (line: ReportTableLine): BranchBoardRow | undefined =>
    line.kind === 'row' ? byKey.get(line.key) : undefined;
  const lines = reportTableLines(rows, data?.total);
  const detail: ReportDetailColumn = {
    header: t('operations.shipment.area'),
    of: (line) => rowOf(line)?.areaName ?? null,
  };
  const failed = data === undefined && report.isError;
  const notFound = report.error instanceof ApiError && report.error.status === 404;
  const loading = data === undefined && !failed;

  const head = (close: ReactNode): JSX.Element => (
    <div className="flex items-start gap-3">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
        <ReportModalTitle id={titleId}>
          {t('operations.bankDashboard.title', { bank: name })}
        </ReportModalTitle>
        <div className="flex flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <PeriodChip range={range} />
            <SideSwitch side={side} onSide={onSide} />
          </span>
          <ReportExportPair
            title={t('operations.bankDashboard.table')}
            keyHeader={t('operations.bankDashboard.branch')}
            countHeader={t('operations.vaultReport.securedCount')}
            lines={current ? lines : []}
            total={data?.total}
            detail={detail}
            exportSpec={{
              name: t('operations.bankDashboard.title', { bank: name }),
              // The period and the bank under the printed title, and which branch files a row.
              subtitle: [
                reportExportSubtitle(t, {
                  period: range,
                  filter: { label: t('operations.bankDashboard.subtitle.bank'), value: name },
                }),
                t('operations.bankDashboard.subtitle.side', { side: t(SIDE_WORD[side]) }),
              ].join(' · '),
              withValuePanel: true,
            }}
          />
        </div>
      </div>
      {close}
    </div>
  );

  return (
    <ReportModalFrame
      mark="bank-dashboard"
      titleId={titleId}
      onClose={onClose}
      dimmed={data !== undefined && (!current || report.isFetching)}
      // Every section at its own height: the window scrolls, the branch table's rows inside it.
      bodyClassName="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-5 lg:px-8 lg:py-6"
      head={head}
    >
      {failed ? (
        <div className={cn(CARD, 'rounded-2xl')} data-bank-dashboard-error="true">
          <ErrorState
            error={report.error}
            {...(notFound ? { description: t('operations.bankDashboard.notFound') } : {})}
            onRetry={() => void report.refetch()}
          />
        </div>
      ) : (
        <>
          {data === undefined || currencies.data === undefined ? (
            <ReportTilesSkeleton mark="bank-dashboard" />
          ) : (
            <ReportFigureTiles
              mark="bank-dashboard"
              label={t('operations.bankDashboard.figures')}
              tiles={heldReportTiles(data.total, catalog)}
            />
          )}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2" data-bank-dashboard-charts="true">
            <BranchBarsCard measure="egp" rows={rows} loading={loading} />
            <BranchBarsCard measure="count" rows={rows} loading={loading} />
          </div>
          {/* The table and its panel as «تقرير الخزينة» lays them out: side by side on a computer,
              capped, the branches scrolling between the head and «الإجمالي»; stacked on a phone. */}
          <div
            className="flex flex-col gap-4 lg:max-h-[34rem] lg:flex-row lg:items-stretch"
            data-bank-dashboard-section="branches"
          >
            <ReportTable
              title={t('operations.bankDashboard.table')}
              titleIcon={SHIPMENT_PATH.bank}
              titleAside={data === undefined ? undefined : <BranchCount count={rows.length} />}
              keyHeader={t('operations.bankDashboard.branch')}
              countHeader={t('operations.vaultReport.securedCount')}
              rows={rows}
              total={data?.total}
              loading={loading}
              error={null}
              onRetry={() => void report.refetch()}
              empty={t('operations.bankDashboard.empty')}
              detail={detail}
              labelNote={(line) => {
                const other = rowOf(line)?.otherBankName ?? null;
                return other === null
                  ? null
                  : t('operations.bankDashboard.otherBank', { bank: other });
              }}
              sort={{
                by: sort.by,
                dir: sort.dir,
                onChange: (key) => setSort((now) => nextBranchSort(now, key)),
              }}
              className="max-lg:max-h-[70vh] lg:min-h-0 lg:flex-1"
            />
            <VaultValuePanel
              grandTotal={data?.total}
              loading={loading}
              className="max-lg:max-h-[60vh] lg:w-80 lg:shrink-0 xl:w-[22rem]"
            />
          </div>
        </>
      )}
    </ReportModalFrame>
  );
};

/**
 * «لوحة البنك بفروعه» over the whole screen, in a portal, while a bank is named — nothing mounted,
 * and nothing read, while none is.
 */
export const BankBranchDashboard = ({
  bankId,
  ...props
}: Omit<DashboardProps, 'bankId'> & { bankId: string | null }): JSX.Element | null =>
  bankId === null
    ? null
    : createPortal(<BankDashboardModal bankId={bankId} {...props} />, document.body);
