// «لوحة تحكم» on «محصنات الخزينة» (Round 16, `pages/SecuredDispatchPage.tsx`).
//
// THE OWNER: «دلوقتي محصنات الخزينة أنا عايز يكون فيها لوحة تحكم اللي هي داشبورد جنب الإحصائيات». Two
// screens he already knows set its shape: Fleet's custody board, whose «لوحة تحكم» right beside
// «الإحصائيات» opens «كل حاجة بالتفصيل» over the whole screen and over the board's OWN filters
// (`fleet/components/CustodyDashboard.tsx`), and «تقرير الخزينة» on «سجل الخزينة», the vault's own
// window (`VaultHeldReportDialog.tsx`). So:
//
//   · THE WINDOW is the vault reports' one (`ReportModal.tsx` — the same portal, header and ×,
//     Escape order, focus trap, focus return, page held still, dark and light), not a third copy;
//   · WHAT IT READS is the board's own rows — the rows SHOWN, after every filter and before the
//     pages — handed to it by the page's toolbar, the way the custody dashboard follows its
//     board's filters. The money and the days are worked out in the browser
//     (`lib/secured-dispatch-dashboard.ts`), so nothing here can disagree with the table under it.
//     The packages are the custody's, read by shipment (`useVaultPackaging`);
//   · A LINE AT THE TOP says which filters are in force — or «كل المحصنات بالخزينة — بلا فلتر» —
//     with «إعادة ضبط الفلاتر», which clears the board's own filters (the dashboard follows them).
//
// THE SECTIONS, in the order they are read, every one drawn even when it has nothing to count — the
// custody rule «على الاقل الاشكال موجودة»:
//   a. the seven figure tiles of «تقرير الخزينة» (`ReportFigureTiles`), «عملات أخرى» opening the
//      boards' breakdown over the window;
//   b. the alerts, in the custody dashboard's amber banner: «متأخرة», «تسليمها اليوم», «تسليمها غدًا»,
//      «بدون يوم تسليم», «لم تُوزَّع على سيارة» — each a count and its pound. «تسليمها اليوم» and
//      «تسليمها غدًا» are a delivery day, which the board's own «تاريخ التسليم» can show: clicked,
//      the board is filtered to that day and the window closes (custody's «onShowMaintenance»). The
//      three others cannot be said by the board's filters, so they are read, not clicked;
//   c. «جدول التسليم» — how many are due on each delivery day: late, today, the next seven days one by
//      one, then later. One hue (it is one measure), the count written on each column that has one,
//      and the pound in the column's hover title;
//   d. «مدة البقاء في الخزينة» — how long they have waited since the vault received them, in Cairo
//      days: today, 1–2, 3–6, 7 and more, counts and the pound;
//   e. «بيان الشحنات لكل بنك» — the very `ReportTable` of «تقرير الخزينة», «الإجمالي» pinned, and
//      «إجمالي قيمة الشحنات» beside it, over the rows shown;
//   f. Excel and PDF of that table and its panel — the reports' own files (`ReportExportPair`) — in
//      the header, where «تقرير الخزينة» has them.
import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MAX_PAGE_SIZE, type Locale, type OperationsSecuredDispatchRowDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { formatAmount } from '../../../shared/lib/format';
import { useAppSelector } from '../../../store';
import { CARD, CardHead, NOTE } from '../../fleet/components/custody-dashboard-parts';
import { BoardIcon, NUM, PATH } from '../../fleet/components/FuelCardBoard';
import {
  useOperationsBanks,
  useOperationsCurrencies,
  useVaultPackaging,
} from '../api/operations-queries';
import { type DayBoardFilters } from '../lib/day-board';
import { reportTableLines } from '../lib/report-board';
import {
  AGING_BUCKETS,
  DASHBOARD_ALERTS,
  dashboardAlertDay,
  dashboardFilterChips,
  scheduleHeights,
  securedDispatchDashboard,
  type AgingBucket,
  type DashboardAlert,
  type DashboardFigure,
  type DashboardFilterParam,
  type ScheduleBucket,
} from '../lib/secured-dispatch-dashboard';
import { ltrIsolate } from '../lib/shipment-log';
import { ReportExportPair, ReportTable } from './ReportBoard';
import {
  ReportFigureTiles,
  ReportModalFrame,
  ReportModalTitle,
  ReportTilesSkeleton,
} from './ReportModal';
import { SHIPMENT_PATH } from './shipment-icons';
import { VaultValuePanel } from './VaultValuePanel';

/** What the dashboard can ask of the board behind it — each optional, the dashboard draws without. */
export interface SecuredDispatchDashboardActions {
  /** «إعادة ضبط الفلاتر»: the board's own filters cleared, the delivery day with them. */
  onClearFilters?: (() => void) | undefined;
  /** An alert that is a delivery day: the board's «تاريخ التسليم» set to it, the window closed. */
  onShowDay?: ((day: string) => void) | undefined;
}

interface DashboardProps extends SecuredDispatchDashboardActions {
  onClose: () => void;
  /** The board's rows SHOWN — every filter applied, every page of them. */
  rows: readonly OperationsSecuredDispatchRowDto[];
  /** The server's today, 'YYYY-MM-DD' — what «متأخرة» and «اليوم» are judged by. */
  today: string;
  /** The board's filters as it reads them (`offeredFilters`), for the line at the top. */
  filters: Pick<DayBoardFilters, DashboardFilterParam>;
  /** The screen's delivery day, or null for every day the vault holds. */
  date: string | null;
  /**
   * The board is asking the server for its list again — «إعادة ضبط الفلاتر» dropped the delivery
   * day, so the vault's whole list is read anew — and has no rows to hand in until it lands.
   */
  pending?: boolean | undefined;
}

/** «2026-11-14» → «11-14»: the year is this week's, and the column is narrow. */
const monthDay = (day: string): string => day.slice(5);

/** The day's name — «السبت» — read on the UTC calendar the delivery day is stored on. */
const weekdayOf = (day: string, locale: Locale): string =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00.000Z`));

// ── The header's end: the day the dashboard is judged on ─────────────────────────────────────

/** «اليوم 2026-11-14» — the server's day, the one «متأخرة» and «غدًا» are counted from. */
const TodayChip = ({ today }: { today: string }): JSX.Element => {
  const t = useT();
  return (
    <span
      data-dispatch-dashboard-today="true"
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600 dark:border-[#223048] dark:bg-[#0a0e17] dark:text-slate-300',
        NUM,
      )}
    >
      {/* Live — the vault as the board reads it now: the custody dashboard's emerald dot. */}
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      {t('operations.secured.dashboard.today', { day: ltrIsolate(today) })}
    </span>
  );
};

// ── (0) The line at the top: the filters in force ────────────────────────────────────────────

/** Each filter's name as its box says it. */
const FILTER_LABEL: Record<DashboardFilterParam | 'date', string> = {
  vehicle: 'operations.board.vehicleCode',
  bank: 'operations.board.bank',
  origin: 'operations.shipment.origin',
  destination: 'operations.shipment.destination',
  area: 'operations.shipment.area',
  captain: 'operations.board.captain',
  date: 'operations.shipment.deliveryDate',
  stage: 'operations.common.status',
  notes: 'operations.shipment.notes',
};

/** The filters in force as words — «اسم البنك: الأهلي» — for the line, and for the files' subtitle. */
const useFilterWords = (
  filters: DashboardProps['filters'],
  date: string | null,
): { chips: { param: string; text: string }[]; summary: string } => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const chips = dashboardFilterChips(filters, date).map(({ param, value }) => ({
    param,
    text: `${t(FILTER_LABEL[param])}: ${
      param === 'stage'
        ? t(`operations.board.stage.${value}`)
        : param === 'date'
          ? ltrIsolate(value)
          : value
    }`,
  }));
  return {
    chips,
    summary:
      chips.length === 0
        ? t('operations.secured.dashboard.filters.none')
        : chips.map((chip) => chip.text).join(locale === 'ar' ? '، ' : ', '),
  };
};

const FilterLine = ({
  chips,
  onClearFilters,
}: {
  chips: { param: string; text: string }[];
  onClearFilters?: (() => void) | undefined;
}): JSX.Element => {
  const t = useT();
  // The reset leaves with the filters it clears. The focus it held goes to this line — which now
  // says «بلا فلتر» — and not to the page's <body>, where a keyboard or a screen reader would lose
  // its place in the window.
  const self = useRef<HTMLElement>(null);
  return (
    <section
      ref={self}
      tabIndex={-1}
      data-dispatch-dashboard-section="filters"
      aria-label={t('operations.secured.dashboard.filters.label')}
      className={cn(
        CARD,
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl px-4 py-2.5 focus:outline-none',
      )}
    >
      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400">
        <BoardIcon d={PATH.eye} className="h-3.5 w-3.5" />
        {t('operations.secured.dashboard.filters.label')}
      </span>
      {chips.length === 0 ? (
        <span
          data-dispatch-dashboard-filters="none"
          className="text-xs font-bold text-slate-700 dark:text-slate-200"
        >
          {t('operations.secured.dashboard.filters.none')}
        </span>
      ) : (
        <ul className="flex min-w-0 flex-wrap gap-2" data-dispatch-dashboard-filters="true">
          {chips.map((chip) => (
            <li
              key={chip.param}
              data-dispatch-dashboard-filter={chip.param}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 dark:border-[#223048] dark:bg-[#0a0e17] dark:text-white"
            >
              {chip.text}
            </li>
          ))}
        </ul>
      )}
      {chips.length > 0 && onClearFilters !== undefined && (
        <button
          type="button"
          data-dispatch-dashboard-reset="true"
          onClick={() => {
            onClearFilters();
            self.current?.focus();
          }}
          className="ms-auto shrink-0 text-xs font-bold text-emerald-700 transition hover:underline dark:font-medium dark:text-emerald-400 dark:hover:text-emerald-300"
        >
          {t('operations.secured.dashboard.filters.reset')}
        </button>
      )}
    </section>
  );
};

// ── (b) The alerts ────────────────────────────────────────────────────────────────────────────

/**
 * Each alert's mark — an icon and a tone beside its words, never the colour alone. «متأخرة» in the
 * board's own red and «تسليمها اليوم» in its amber, as the rows' marks under «تاريخ التسليم»; the
 * others in quiet tones of their own.
 */
const ALERT_LOOK: Record<DashboardAlert, { icon: readonly string[]; tone: string }> = {
  overdue: {
    icon: PATH.warn,
    tone: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  },
  today: {
    icon: SHIPMENT_PATH.calendar,
    tone: 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200',
  },
  tomorrow: {
    icon: SHIPMENT_PATH.calendar,
    tone: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  },
  undated: {
    icon: SHIPMENT_PATH.info,
    tone: 'bg-slate-200 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300',
  },
  unplaced: {
    icon: PATH.truck,
    tone: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  },
};

/** One alert's body: its mark and name, the count, the pound, and what it means. */
const AlertBody = ({
  alert,
  figure,
  hint,
  action,
}: {
  alert: DashboardAlert;
  figure: DashboardFigure;
  hint: string;
  action: ReactNode;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const look = ALERT_LOOK[alert];
  const none = figure.count === 0;
  return (
    <>
      <span className="flex items-center gap-2">
        <span
          className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', look.tone)}
        >
          <BoardIcon d={[...look.icon]} className="h-4 w-4" />
        </span>
        <span className="min-w-0 text-xs font-bold text-slate-800 dark:text-slate-100">
          {t(`operations.secured.dashboard.alerts.${alert}`)}
        </span>
      </span>
      <span className="flex flex-wrap items-baseline gap-x-1.5">
        <span
          dir="ltr"
          data-dispatch-alert-count={alert}
          className={cn(
            'text-xl font-black',
            none ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-white',
            NUM,
          )}
        >
          {formatAmount(figure.count, locale)}
        </span>
        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
          {t('operations.secured.dashboard.unit')}
        </span>
      </span>
      <span className="flex flex-wrap items-baseline gap-x-1 text-xs">
        <span
          dir="ltr"
          data-dispatch-alert-egp={alert}
          className={cn(
            'font-bold',
            none ? 'text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-200',
            NUM,
          )}
        >
          {formatAmount(figure.egp, locale)}
        </span>
        <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500">EGP</span>
      </span>
      <span className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">{hint}</span>
      {action}
    </>
  );
};

/** An alert's card in the banner — its frame and its hover when it can be clicked. */
const ALERT_CARD =
  'flex min-w-0 flex-col items-start gap-1.5 rounded-xl border border-amber-200/80 bg-white/80 p-3 text-start dark:border-[rgba(42,58,84,.65)] dark:bg-[#0c1220]/70';

/**
 * The custody dashboard's amber banner (`CustodyAlerts`) — its heading and warning mark — holding
 * the five alerts side by side on a computer, two to a row between, one to a row on a phone. Every
 * alert stays, at zero, so the banner reads the same every day: what is missing is a 0, never a gap.
 */
const DispatchAlerts = ({
  alerts,
  today,
  onShowDay,
}: {
  alerts: Record<DashboardAlert, DashboardFigure>;
  today: string;
  onShowDay?: ((day: string) => void) | undefined;
}): JSX.Element => {
  const t = useT();
  const titleId = useId();
  return (
    <section
      data-dispatch-dashboard-section="alerts"
      aria-labelledby={titleId}
      className="rounded-2xl border border-amber-200/90 bg-amber-50/80 p-3.5 shadow-sm dark:border-amber-500/40 dark:bg-amber-950/20 dark:bg-[linear-gradient(180deg,rgba(19,26,43,.82)_0%,rgba(13,18,30,.92)_100%)] dark:shadow-[0_8px_24px_-4px_rgba(0,0,0,.5),inset_0_1px_0_0_rgba(255,255,255,.04)] dark:backdrop-blur-[12px]"
    >
      <div className="mb-3 flex items-center gap-2.5">
        <div className="shrink-0 rounded-lg bg-amber-100 p-1.5 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
          <BoardIcon d={PATH.warn} className="h-4 w-4" />
        </div>
        <h3
          id={titleId}
          className="text-sm font-bold text-amber-900 dark:font-semibold dark:text-amber-200"
        >
          {t('operations.secured.dashboard.alerts.title')}
        </h3>
      </div>
      <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
        {DASHBOARD_ALERTS.map((alert) => {
          const figure = alerts[alert];
          const day = dashboardAlertDay(alert, today);
          const hint = t(`operations.secured.dashboard.alerts.${alert}Hint`, {
            day: day === null ? '' : ltrIsolate(day),
          });
          // A delivery day the board's own filter can show — and something there to show.
          const clickable = onShowDay !== undefined && day !== null && figure.count > 0;
          return (
            <li key={alert} className="flex min-w-0">
              {clickable ? (
                <button
                  type="button"
                  data-dispatch-dashboard-alert={alert}
                  data-alert-day={day}
                  onClick={() => onShowDay(day)}
                  className={cn(
                    ALERT_CARD,
                    'w-full cursor-pointer transition hover:border-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60 dark:hover:border-amber-400/50',
                  )}
                >
                  <AlertBody
                    alert={alert}
                    figure={figure}
                    hint={hint}
                    action={
                      <span className="mt-auto inline-flex items-center gap-1 pt-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                        {t('operations.secured.dashboard.alerts.show')}
                        <svg
                          viewBox="0 0 24 24"
                          aria-hidden
                          className="h-3 w-3 rtl:-scale-x-100"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2.5}
                        >
                          <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    }
                  />
                </button>
              ) : (
                <div data-dispatch-dashboard-alert={alert} className={cn(ALERT_CARD, 'w-full')}>
                  <AlertBody alert={alert} figure={figure} hint={hint} action={null} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

// ── (c) «جدول التسليم» ────────────────────────────────────────────────────────────────────────

/** The column's name under it — «متأخرة», «اليوم», the day's name, «لاحقًا». */
const useBucketLabel = (): ((bucket: ScheduleBucket) => { name: string; day: string | null }) => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (bucket) => {
    if (bucket.kind === 'overdue') {
      return { name: t('operations.secured.dashboard.schedule.overdue'), day: null };
    }
    if (bucket.kind === 'later') {
      return { name: t('operations.secured.dashboard.schedule.later'), day: null };
    }
    const day = bucket.day ?? '';
    return {
      name:
        bucket.kind === 'today'
          ? t('operations.secured.dashboard.schedule.today')
          : weekdayOf(day, locale),
      day: monthDay(day),
    };
  };
};

/**
 * One measure — how many are due — so ONE hue (the brand's indigo, a step lighter on the dark
 * card: both pass the palette check against their surface), columns no wider than 24px with a 4px
 * rounded cap on one baseline, the count written on each column that has one (a zero column has
 * no figure — the baseline already says it). The pound is the column's hover title and its name
 * to a screen reader, which reads the columns as a list.
 */
const DeliverySchedule = ({
  buckets,
  undated,
}: {
  buckets: readonly ScheduleBucket[];
  undated: DashboardFigure;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const labelOf = useBucketLabel();
  const heights = scheduleHeights(buckets);
  const titleId = useId();
  return (
    <section
      data-dispatch-dashboard-section="schedule"
      aria-labelledby={titleId}
      className={cn(CARD, 'flex min-w-0 flex-col rounded-2xl p-4 lg:col-span-7')}
    >
      <CardHead
        id={titleId}
        title={
          <>
            <BoardIcon
              d={[...SHIPMENT_PATH.calendar]}
              className="h-4 w-4 text-brand-600 dark:text-brand-400"
            />
            {t('operations.secured.dashboard.schedule.title')}
          </>
        }
        note={t('operations.secured.dashboard.schedule.note')}
      />
      <ul
        className="flex flex-1 items-stretch gap-0.5 border-b border-slate-200 pt-2 sm:gap-1 dark:border-slate-700"
        aria-labelledby={titleId}
      >
        {buckets.map((bucket, index) => {
          const label = labelOf(bucket);
          const full = label.day === null ? label.name : `${label.name} ${label.day}`;
          const words = t('operations.secured.dashboard.schedule.bar', {
            label: full,
            count: formatAmount(bucket.count, locale),
            egp: formatAmount(bucket.egp, locale),
          });
          const share = heights[index] ?? 0;
          return (
            <li
              key={bucket.key}
              data-dispatch-schedule={bucket.key}
              data-count={bucket.count}
              aria-label={words}
              title={words}
              className="relative h-40 min-w-0 flex-1 sm:h-44"
            >
              {bucket.count > 0 && (
                <>
                  <span
                    aria-hidden
                    dir="ltr"
                    className={cn(
                      'absolute inset-x-0 text-center text-[11px] font-bold text-slate-700 sm:text-xs dark:text-slate-200',
                      NUM,
                    )}
                    style={{ bottom: `calc((100% - 1.25rem) * ${share} + 0.25rem)` }}
                  >
                    {formatAmount(bucket.count, locale)}
                  </span>
                  <span
                    aria-hidden
                    className="absolute bottom-0 left-1/2 w-[calc(100%-4px)] max-w-[24px] -translate-x-1/2 rounded-t-[4px] bg-brand-600 dark:bg-brand-500"
                    style={{ height: `calc((100% - 1.25rem) * ${share})` }}
                  />
                </>
              )}
            </li>
          );
        })}
      </ul>
      {/* The axis: each column's name under it — the day's name and its month-day from a tablet
          up; on a phone (32px a column, where «11-21» broke over two lines) the day of the month
          alone, the days reading one after another. */}
      <div aria-hidden className="flex gap-0.5 pt-1.5 sm:gap-1">
        {buckets.map((bucket) => {
          const label = labelOf(bucket);
          return (
            <span
              key={bucket.key}
              className="flex min-w-0 flex-1 flex-col items-center text-center leading-tight"
            >
              <span
                className={cn(
                  'w-full text-[10px] font-bold text-slate-600 sm:text-[11px] dark:text-slate-300',
                  label.day !== null && bucket.kind === 'day' && 'max-sm:hidden',
                )}
              >
                {label.name}
              </span>
              {label.day !== null && (
                <span
                  dir="ltr"
                  className={cn(
                    'whitespace-nowrap text-[10px] text-slate-400 dark:text-slate-500',
                    NUM,
                  )}
                >
                  <span className="max-sm:hidden">{label.day}</span>
                  <span className="sm:hidden">{label.day.slice(3)}</span>
                </span>
              )}
            </span>
          );
        })}
      </div>
      <p className={cn(NOTE, 'mt-3')} data-dispatch-schedule-undated={undated.count}>
        {t('operations.secured.dashboard.schedule.undated', {
          count: formatAmount(undated.count, locale),
        })}
      </p>
    </section>
  );
};

// ── (d) «مدة البقاء في الخزينة» ───────────────────────────────────────────────────────────────

const VaultAging = ({
  aging,
  unknown,
}: {
  aging: Record<AgingBucket, DashboardFigure>;
  unknown: number;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const titleId = useId();
  const total = AGING_BUCKETS.reduce((sum, bucket) => sum + aging[bucket].count, 0);
  return (
    <section
      data-dispatch-dashboard-section="aging"
      aria-labelledby={titleId}
      className={cn(CARD, 'flex min-w-0 flex-col rounded-2xl p-4 lg:col-span-5')}
    >
      <CardHead
        id={titleId}
        title={
          <>
            <BoardIcon
              d={[...SHIPMENT_PATH.history]}
              className="h-4 w-4 text-brand-600 dark:text-brand-400"
            />
            {t('operations.secured.dashboard.aging.title')}
          </>
        }
        note={t('operations.secured.dashboard.aging.note')}
      />
      <ul className="flex flex-1 flex-col justify-around gap-3">
        {AGING_BUCKETS.map((bucket) => {
          const figure = aging[bucket];
          const share = total === 0 ? 0 : figure.count / total;
          const none = figure.count === 0;
          return (
            <li key={bucket} data-dispatch-aging={bucket} className="space-y-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                  {t(`operations.secured.dashboard.aging.${bucket}`)}
                </span>
                <span className="flex items-baseline gap-x-2 text-xs">
                  <span className="flex items-baseline gap-x-1">
                    <span
                      dir="ltr"
                      data-dispatch-aging-count={bucket}
                      className={cn(
                        'text-sm font-black',
                        none
                          ? 'text-slate-400 dark:text-slate-500'
                          : 'text-slate-900 dark:text-white',
                        NUM,
                      )}
                    >
                      {formatAmount(figure.count, locale)}
                    </span>
                    <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                      {t('operations.secured.dashboard.unit')}
                    </span>
                  </span>
                  <span aria-hidden className="text-slate-300 dark:text-slate-600">
                    ·
                  </span>
                  <span className="flex items-baseline gap-x-1">
                    <span
                      dir="ltr"
                      data-dispatch-aging-egp={bucket}
                      className={cn(
                        'font-bold',
                        none
                          ? 'text-slate-400 dark:text-slate-500'
                          : 'text-slate-700 dark:text-slate-200',
                        NUM,
                      )}
                    >
                      {formatAmount(figure.egp, locale)}
                    </span>
                    <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500">
                      EGP
                    </span>
                  </span>
                </span>
              </div>
              {/* Its share of the محصنات shown — the same hue as the schedule, on the card's track. */}
              <div
                aria-hidden
                className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
              >
                <div
                  className="h-full rounded-full bg-brand-600 dark:bg-brand-500"
                  style={{ width: `${Math.round(share * 1000) / 10}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {unknown > 0 && (
        <p className={cn(NOTE, 'mt-3')} data-dispatch-aging-unknown={unknown}>
          {t('operations.secured.dashboard.aging.unknown', {
            count: formatAmount(unknown, locale),
          })}
        </p>
      )}
    </section>
  );
};

// ── The window ────────────────────────────────────────────────────────────────────────────────

/** The dashboard while it is up — mounted only then, so the custody's packages are read only then. */
const DispatchDashboardModal = ({
  onClose,
  pending = false,
  onClearFilters,
  onShowDay,
  ...live
}: DashboardProps): JSX.Element => {
  const t = useT();
  const titleId = useId();
  // While the board re-reads its list (`pending`), the window stays up over the last rows it read,
  // dimmed — the frame's `dimmed`, as «تقرير الخزينة» holds its last answer — and the filters line
  // with them, so what is dimmed is one picture. Closing and opening again by itself instead lost
  // the focus to the page's <body>, and with it the way back to «لوحة تحكم» on Escape.
  const last = useRef(live);
  if (!pending) last.current = live;
  const { rows, today, filters, date } = last.current;
  // The board's own queries (the same parameters), so the catalogs are one cache across them.
  const banks = useOperationsBanks({
    page: 1,
    pageSize: MAX_PAGE_SIZE,
    sortBy: 'code',
    sortDir: 'asc',
  });
  const currencies = useOperationsCurrencies({ page: 1, pageSize: MAX_PAGE_SIZE });
  const packaging = useVaultPackaging(true);
  const dash = securedDispatchDashboard({
    rows,
    today,
    catalog: currencies.data?.items ?? [],
    banks: banks.data?.items ?? [],
    packaging: packaging.data,
  });
  const packages =
    packaging.data !== undefined ? 'ready' : packaging.isError ? 'missing' : 'loading';
  const words = useFilterWords(filters, date);
  // The files carry the packages too: until the custody's counts are in, there is nothing whole
  // to carry.
  const lines = packages === 'ready' ? reportTableLines(dash.bankRows, dash.grandTotal) : [];

  return (
    <ReportModalFrame
      mark="dispatch-dashboard"
      titleId={titleId}
      onClose={onClose}
      // The rows are the board's: dimmed only while the board itself re-reads them.
      dimmed={pending}
      // Every section at its own height: the window scrolls, the bank table's rows inside it.
      bodyClassName="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-5 lg:px-8 lg:py-6"
      head={(close) => (
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
            <ReportModalTitle id={titleId}>
              {t('operations.secured.dashboard.title')}
            </ReportModalTitle>
            <div className="flex flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <TodayChip today={today} />
              <ReportExportPair
                title={t('operations.vaultReport.table')}
                keyHeader={t('operations.reports.bank')}
                countHeader={t('operations.vaultReport.securedCount')}
                lines={lines}
                total={dash.grandTotal}
                exportSpec={{
                  name: t('operations.secured.dashboard.title'),
                  // What the files are over: the filters in force, and the day they were judged on.
                  subtitle: `${words.summary} · ${t('operations.secured.dashboard.today', {
                    day: ltrIsolate(today),
                  })}`,
                  withValuePanel: true,
                }}
              />
            </div>
          </div>
          {close}
        </div>
      )}
    >
      <FilterLine chips={words.chips} onClearFilters={onClearFilters} />
      {/* The money is split by the catalog: until it is in, the tiles keep their frames. */}
      {currencies.data === undefined ? (
        <ReportTilesSkeleton mark="dispatch-dashboard" />
      ) : (
        <ReportFigureTiles
          mark="dispatch-dashboard"
          label={t('operations.secured.dashboard.figures')}
          tiles={dash.tiles}
          packages={packages}
        />
      )}
      <DispatchAlerts alerts={dash.alerts} today={today} onShowDay={onShowDay} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <DeliverySchedule buckets={dash.schedule} undated={dash.undated} />
        <VaultAging aging={dash.aging} unknown={dash.agingUnknown} />
      </div>
      {/* «بيان الشحنات لكل بنك» and «إجمالي قيمة الشحنات» as «تقرير الخزينة» lays them out: side by
          side on a computer, as tall as the taller of the two up to a cap, past which the banks
          scroll between the head and «الإجمالي»; stacked and capped on a phone. */}
      <div
        className="flex flex-col gap-4 lg:max-h-[34rem] lg:flex-row lg:items-stretch"
        data-dispatch-dashboard-section="banks"
      >
        <ReportTable
          title={t('operations.vaultReport.table')}
          titleIcon={SHIPMENT_PATH.bank}
          keyHeader={t('operations.reports.bank')}
          countHeader={t('operations.vaultReport.securedCount')}
          rows={dash.bankRows}
          total={dash.grandTotal}
          // The packages are the custody's, read apart: the table waits for them rather than
          // print a bag count of 0 it has not read.
          loading={packages === 'loading' || banks.data === undefined}
          error={packaging.isError && packaging.data === undefined ? packaging.error : null}
          onRetry={() => void packaging.refetch()}
          empty={t(
            words.chips.length === 0
              ? 'operations.secured.dispatch.emptyAll'
              : 'operations.secured.dashboard.banksEmpty',
          )}
          className="max-lg:max-h-[70vh] lg:min-h-0 lg:flex-1"
        />
        <VaultValuePanel
          grandTotal={dash.grandTotal}
          loading={false}
          className="max-lg:max-h-[60vh] lg:w-80 lg:shrink-0 xl:w-[22rem]"
        />
      </div>
    </ReportModalFrame>
  );
};

/**
 * «لوحة تحكم» over the whole screen, in a portal: Escape or × closes it, Tab stays inside (the
 * «عملات أخرى» breakdown over it included), the page behind does not scroll, and the focus goes
 * back to the button on the way out. Nothing is mounted — and nothing read — while it is closed.
 */
export const SecuredDispatchDashboard = ({
  open,
  ...props
}: DashboardProps & { open: boolean }): JSX.Element | null =>
  open ? createPortal(<DispatchDashboardModal {...props} />, document.body) : null;
