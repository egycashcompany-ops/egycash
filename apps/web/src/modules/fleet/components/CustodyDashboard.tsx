// «عاوز جمب الاحصائيات داش بورد تفتح ف الشاشه كلها زى موديل كل حاجة بالتفصيل» — the custody
// board's dashboard: a modal over the whole screen with everything about the fund's spend, over
// the board's OWN filters (the same `filters` object the figures read).
//
// «عاوز دى تكون فى شاشه العهد لما ادوس على لوحة التحكم فى اللايت سيم والدارك سيم»: it is the
// owner's design, section by section and in its order — the board's filters (read only), the
// alerts, five figures and three tiles, the time chart beside the rings of kind and source, the
// cars, the drivers and the fuel — in its dark theme and in the light map that came with it, as
// `dark:` variants over the `dark` class the app stamps on <html>. Since «عاوز ازود اجمالى العهده
// فى الاحصايات و تكون فى الداس بورد», the fund («إجمالي العهدة») is on it too — and since the memos
// and the fund's own operations, it heads a section of its own, «العهدة الآن» (`CustodyDashboardFund`):
// the fund over its whole history, whatever the filters — the formula as five tiles, the money
// waiting for «استعاضة العهدة» and for «تسوية العهدة», the fund after every operation and the
// newest of them — with its own lines in the alerts. Under it, «مصروفات العهدة حسب الفلاتر»: the
// five spend figures (each with its memos' state), the tiles and the charts, as before.
//
// «عاوزك تشيل من الداش بورد الجدول اللى فى العربيات والسجل يكون برا زى ما هو … وسجل كل الحركات
// برضو»: the design's last two tables — «ملخص لكل سيارة» and «سجل كل الحركات» — are not drawn here.
// The board under the dashboard already holds both («هما اساسا كدا كدا برا»), and a car's «السجل»
// opens from the board's own «ملخص لكل سيارة».
//
// Every number is the server's (`GET /fleet/custody/dashboard`), folded from the very movements
// `/summary` folds, so the dashboard and «الإحصائيات» never disagree. What the design shows and
// the data does not hold is not drawn («شيلهم»): no station panel, no kind of wash, no «تكلفة
// معلقة» — a dealership bill is not custody money («التوكيل … ملهاش علاقة ب حاجة»), so none waits
// on the fund. The owner's choices on it are in `CustodyKinds.tsx` (the colours) and in
// `custody-dashboard-parts.tsx` (the surfaces, the type, the counted words).
//
// «عاوز الداش بورد بكل حاجة تكون ظاهره حتى لو لسه مفيش اى اكشن او حركه او خصم او زياده فاهم يعنى
// على الاقل الاشكال موجودة»: there is no empty face. With no movement in the set, every section is
// still drawn — the figures and tiles at zero, the time chart's frame, the grey rings, the table at
// zero, the cars, the drivers and both companies of the fuel — each card saying why in one line.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  type FleetCustodyAlertsDto,
  type FleetCustodyDashboardDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { cn } from '../../../shared/lib/cn';
import { CloseIcon } from '../../../shared/ui/icons';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { useCustodyDashboard } from '../api/fleet-queries';
import { CustodyShare, CUSTODY_KIND_LABEL } from './CustodyFigures';
import { CUSTODY_KIND, CUSTODY_KINDS, CUSTODY_TOTAL_TILE, FLASK } from './CustodyKinds';
import {
  CustodyByKindSource,
  custodyCompanies,
  CustodyFuelBreakdown,
  CustodyTimeline,
  CustodyTopCars,
  CustodyTopDrivers,
} from './CustodyDashboardCharts';
import { BoardIcon, NUM, PATH, ymd } from './FuelCardBoard';
import {
  CAIRO,
  CARD,
  CARD_BORDER,
  CARD_SURFACE,
  COMPANY,
  COUNT,
  custodyFilterChips,
  custodyFiltered,
  custodyTrapFocus,
  LITRES,
  RATE,
  SCROLLBAR,
  useCount,
  useMoney,
  WHOLE,
  type CustodyDashboardFilters,
} from './custody-dashboard-parts';
import {
  CUSTODY_FUND_ROW,
  CustodyFundAlertLines,
  CustodyFundNow,
  CustodyFundSteps,
  CustodyMemoStateBar,
  CustodyRecentOps,
  CustodySectionHeading,
  CustodySettleCard,
  CustodyWaitingCard,
  useCustodyFundAlerts,
  type CustodyFundSectionActions,
} from './CustodyDashboardFund';
import { custodyMemoStateParts, type CustodyFundAlert } from '../lib/custody-dashboard-fund';

export {
  custodyFilterChips,
  custodyFiltered,
  custodyTrapFocus,
  type CustodyDashboardFilters,
} from './custody-dashboard-parts';

/** What the dashboard can ask of the board behind it — each optional, the dashboard draws without. */
export interface CustodyDashboardActions extends CustodyFundSectionActions {
  /** «إعادة ضبط الفلاتر»: clears the board's own filters; the dashboard follows them. */
  onClearFilters?: (() => void) | undefined;
  /** «عرض حركات الصيانة»: the board's «المصدر» set to «صيانة», the dashboard closed. */
  onShowMaintenance?: (() => void) | undefined;
}

/**
 * Which face the modal wears — a function, so the node specs can reach every branch. An answer of
 * no movement is still an answer: the whole dashboard, at zero («على الاقل الاشكال موجودة»).
 */
export type CustodyDashboardView = 'loading' | 'error' | 'ready';
export const custodyDashboardView = (query: {
  isPending: boolean;
  isError: boolean;
  data: FleetCustodyDashboardDto | undefined;
}): CustodyDashboardView => {
  if (query.data !== undefined) return 'ready';
  if (query.isError) return 'error';
  return 'loading';
};

// ── (0) The board's filters, read only ───────────────────────────────────────────────────────

/**
 * The owner chose the board's filters only: the design's filter inputs are not built here. The
 * chips say what the dashboard was opened over, and «إعادة ضبط الفلاتر» clears the board's own
 * filters. The design's note on the driver filter (a dealership bill named no driver, so the
 * server left the bills out) is gone with the bills: every movement now is a receipt.
 */
export const CustodyDashboardFilterBar = ({
  filters,
  onClearFilters,
}: {
  filters: CustodyDashboardFilters;
  onClearFilters?: (() => void) | undefined;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const chips = custodyFilterChips(filters, t, locale);
  const reset = custodyFiltered(filters) && onClearFilters !== undefined;
  return (
    <section
      data-custody-dashboard-section="filters"
      aria-label={t('fleet.custody.dashboard.filters.label')}
      className={cn(CARD, 'rounded-2xl p-4')}
    >
      <ul className="flex flex-wrap gap-2" data-custody-dashboard-filters="true">
        {chips.map((chip) => (
          <li
            key={chip}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-[#223048] dark:bg-[#0a0e17] dark:text-white"
          >
            {chip}
          </li>
        ))}
      </ul>
      {reset && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500 dark:border-[#1a2538] dark:text-slate-400">
          <span />
          <button
            type="button"
            data-custody-reset-filters="true"
            onClick={onClearFilters}
            className="font-bold text-emerald-700 transition hover:underline dark:font-medium dark:text-emerald-400 dark:hover:text-emerald-300"
          >
            {t('fleet.custody.dashboard.filters.reset')}
          </button>
        </div>
      )}
    </section>
  );
};

// ── (1) The alerts ────────────────────────────────────────────────────────────────────────────

/** Is there anything to warn about? With nothing, the banner is not drawn at all. */
export const custodyHasAlerts = (alerts: FleetCustodyAlertsDto): boolean =>
  alerts.doubleFuel.length > 0 || alerts.receiptsWithoutPhoto > 0 || alerts.duplicateReceipts > 0;

/** How many of the double fuellings the banner names before «+N». */
const DOUBLE_FUEL_SHOWN = 3;

/** «سيارة 150 …» with the code in bold — a sentence with one part set apart. */
const Emphasised = ({
  text,
  token,
  strong,
}: {
  text: string;
  token: string;
  strong: string;
}): JSX.Element => {
  const at = text.indexOf(token);
  if (at === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <strong className={cn('font-bold text-slate-900 dark:text-white', NUM)}>{strong}</strong>
      {text.slice(at + token.length)}
    </>
  );
};

/**
 * The amber banner — every line a count read from the rows, nothing estimated: a car fuelled from
 * the fund twice in a day (up to three named, then «+N»); the receipts with no photo and the
 * duplicated ones. A dealership bill is not custody money, so none waits here. Under them, the
 * fund's own lines (`fundLines`, a–e): the fund below zero, receipts in no memo for more than 30
 * days, a memo not replenished or a licensing memo not settled for as long, and settlements waiting
 * past what the fund holds — each with the way to deal with it. Drawn when either has a line.
 */
export const CustodyAlerts = ({
  alerts,
  fundLines = [],
  onFundAction,
}: {
  alerts: FleetCustodyAlertsDto;
  fundLines?: readonly CustodyFundAlert[];
  onFundAction?: CustodyFundSectionActions['onFundAction'];
}): JSX.Element | null => {
  const t = useT();
  const { phrase } = useCount();
  const titleId = useId();
  const rowAlerts = custodyHasAlerts(alerts);
  if (!rowAlerts && fundLines.length === 0) return null;
  const doubles = alerts.doubleFuel.slice(0, DOUBLE_FUEL_SHOWN);
  const more = alerts.doubleFuel.length - doubles.length;
  const TOKEN = '⁣';
  const items: ReactNode[] = [
    ...doubles.map((line) => (
      <span
        key={`${line.vehicleId ?? line.vehicleCode ?? ''}:${line.date}`}
        data-custody-alert="doubleFuel"
        className="flex items-center gap-1"
      >
        <span aria-hidden="true" className="text-amber-600 dark:text-amber-400">
          ⚠️
        </span>
        <span>
          <Emphasised
            text={t(
              line.count > 2
                ? 'fleet.custody.dashboard.alerts.multiFuel'
                : 'fleet.custody.dashboard.alerts.doubleFuel',
              { code: TOKEN, date: ymd(line.date), count: COUNT.format(line.count) },
            )}
            token={TOKEN}
            strong={line.vehicleCode ?? '—'}
          />
        </span>
      </span>
    )),
    ...(more > 0
      ? [
          <span
            key="more"
            data-custody-alert="doubleFuelMore"
            className={cn('font-bold text-amber-700 dark:text-amber-300', NUM)}
          >
            {t('fleet.custody.dashboard.alerts.more', { count: COUNT.format(more) })}
          </span>,
        ]
      : []),
  ];
  return (
    <section
      data-custody-dashboard-section="alerts"
      aria-labelledby={titleId}
      className="rounded-2xl border border-amber-200/90 bg-amber-50/80 p-3.5 shadow-sm dark:border-amber-500/40 dark:bg-amber-950/20 dark:bg-[linear-gradient(180deg,rgba(19,26,43,.82)_0%,rgba(13,18,30,.92)_100%)] dark:shadow-[0_8px_24px_-4px_rgba(0,0,0,.5),inset_0_1px_0_0_rgba(255,255,255,.04)] dark:backdrop-blur-[12px]"
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 shrink-0 rounded-lg bg-amber-100 p-1.5 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
          <BoardIcon d={PATH.warn} className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700 dark:text-slate-300">
            <span
              id={titleId}
              className="font-bold text-amber-900 dark:font-semibold dark:text-amber-200"
            >
              {t('fleet.custody.dashboard.alerts.title')}
            </span>
            {items.map((item, i) => (
              <span key={i} className="flex items-center gap-x-4">
                {i > 0 && (
                  <span aria-hidden="true" className="text-slate-400">
                    •
                  </span>
                )}
                {item}
              </span>
            ))}
          </div>
          {rowAlerts && (
            <p
              data-custody-alert="audit"
              className="text-[11px] font-medium text-slate-500 dark:font-normal dark:text-slate-400"
            >
              <span aria-hidden="true">🔍 </span>
              {phrase('fleet.custody.dashboard.alerts.noPhoto', alerts.receiptsWithoutPhoto)} |{' '}
              {phrase('fleet.custody.dashboard.alerts.duplicates', alerts.duplicateReceipts)}
            </p>
          )}
          <CustodyFundAlertLines lines={fundLines} ruled={rowAlerts} onFundAction={onFundAction} />
        </div>
      </div>
    </section>
  );
};

// ── (2) The figures ───────────────────────────────────────────────────────────────────────────

/**
 * A figure's sum: Cairo, black, tight — a size down from 1,536px, where the five share one row (a
 * fifth of the modal's 1,600px at most); below that they are three to a row and need no shrinking.
 */
const FIGURE = cn(
  'text-2xl font-black tracking-tight text-slate-900 [overflow-wrap:anywhere] 2xl:text-xl dark:text-white',
  CAIRO,
);
/**
 * Five figures — the spend and its four kinds; «إجمالي العهدة» moved up to «العهدة الآن», where the
 * fund is over its whole history and the filters never reach it. One to a row on a phone, two from
 * `sm`, three from `lg`, all five in one row of the design from `2xl`.
 */
const KPI_GRID = 'grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5';
const FOOT =
  'flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs dark:border-[#1c273b]';
const TILE = cn(CARD, 'flex flex-wrap items-center justify-between gap-2 rounded-xl p-3.5');
const TILE_ICON = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border';

/**
 * Five figures — the total in emerald, then each kind with its share of the total and its count;
 * fuel splits into «شل أوت» and «وطنية» by the company each receipt names, and the receipts that
 * name none are a small line of their own under the two. Each wears its spend's memos' state as a
 * thin bar — replenished, waiting in a memo, in no memo yet — the total with its legend, a kind
 * with «لم تُستعَض: X» when any of it waits. Then the movements, the cars and the litres.
 */
export const CustodyKpis = ({ data }: { data: FleetCustodyDashboardDto }): JSX.Element => {
  const t = useT();
  const money = useMoney();
  const { count, noun } = useCount();
  const total = money(data.total);
  const none = data.fuelByCompany.none;
  const totalStates = custodyMemoStateParts(data.memoStates);
  return (
    <section data-custody-dashboard-section="kpis" className="space-y-3.5">
      <div className={KPI_GRID}>
        <div
          data-custody-kpi="total"
          className={cn(
            CARD_SURFACE,
            'group relative flex min-w-0 flex-col justify-between overflow-hidden rounded-2xl border-emerald-300 bg-gradient-to-br from-emerald-50/70 via-white to-white p-4 dark:border-emerald-500/40',
          )}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-12 -top-12 hidden h-28 w-28 rounded-full bg-emerald-500/10 blur-2xl dark:block"
          />
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="text-xs font-bold text-emerald-800 dark:font-semibold dark:text-emerald-300">
                {t('fleet.custody.totals.total')}
              </span>
              <div className="mt-1 flex flex-wrap items-baseline gap-1">
                <span className={FIGURE}>{total.figure}</span>
                <span className="text-xs font-bold text-emerald-700 dark:font-semibold dark:text-emerald-400">
                  {total.currency}
                </span>
              </div>
            </div>
            <div
              className={cn(
                'shrink-0 rounded-xl p-2.5 transition group-hover:scale-105',
                CUSTODY_TOTAL_TILE,
              )}
            >
              <BoardIcon d={PATH.box} className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-auto">
            {totalStates !== null && (
              <CustodyMemoStateBar parts={totalStates} legend name="total" />
            )}
            <div className={cn(FOOT, 'mt-3 text-slate-600 dark:text-slate-400')}>
              <span className="text-slate-600 dark:text-slate-300">
                <CustodyShare part={data.total} whole={data.total} />{' '}
                {t('fleet.custody.dashboard.kpi.ofAll')}
              </span>
              {data.periodDays > 0 && (
                <span
                  data-custody-period-days="true"
                  className={cn(
                    'shrink-0 whitespace-nowrap rounded border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:border-emerald-700/30 dark:bg-emerald-950/40 dark:text-xs dark:text-emerald-400',
                    NUM,
                  )}
                >
                  {count('day', data.periodDays)}
                </span>
              )}
            </div>
          </div>
        </div>

        {CUSTODY_KINDS.map((kind) => {
          const look = CUSTODY_KIND[kind];
          const sum = money(data[kind]);
          const states = custodyMemoStateParts(data.memoStates, kind);
          return (
            <div
              key={kind}
              data-custody-kpi={kind}
              className={cn(
                CARD_SURFACE,
                CARD_BORDER,
                'group flex min-w-0 flex-col justify-between rounded-2xl p-4',
                look.accent,
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className={cn('text-xs', look.label)}>{t(CUSTODY_KIND_LABEL[kind])}</span>
                  <div className="mt-1 flex flex-wrap items-baseline gap-1">
                    <span className={FIGURE}>{sum.figure}</span>
                    <span className="text-xs font-semibold text-slate-500 dark:font-medium dark:text-slate-400">
                      {sum.currency}
                    </span>
                  </div>
                </div>
                <div
                  className={cn(
                    'shrink-0 rounded-xl p-2.5 transition group-hover:scale-105',
                    look.tile,
                  )}
                >
                  <BoardIcon d={look.icon} className="h-5 w-5" />
                </div>
              </div>
              {kind === 'fuel' && (
                <>
                  <div
                    data-custody-fuel-companies-kpi="true"
                    className="mt-2.5 grid grid-cols-2 gap-1.5 border-t border-slate-100 pt-2 dark:border-[#1c273b]"
                  >
                    {custodyCompanies(data).map((row) => (
                      <div
                        key={row.company}
                        data-custody-company={row.company}
                        className={cn(
                          'rounded-lg border p-1.5 text-center',
                          COMPANY[row.company].box,
                        )}
                      >
                        <div
                          className={cn(
                            'flex items-center justify-center gap-1 text-[10px] font-semibold',
                            COMPANY[row.company].title,
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cn('h-1.5 w-1.5 rounded-full', COMPANY[row.company].dot)}
                          />
                          {t(`fleet.fuelCards.company.${row.company}`)}
                        </div>
                        <div
                          className={cn(
                            'text-xs font-black text-slate-900 dark:font-bold dark:text-white',
                            NUM,
                          )}
                        >
                          {WHOLE.format(row.amount)}{' '}
                          <span className="text-[9px] font-normal text-slate-500 dark:text-slate-400">
                            {sum.currency}
                          </span>
                        </div>
                        <div className={cn('text-[10px] text-slate-600 dark:text-slate-400', NUM)}>
                          <CustodyShare part={row.amount} whole={data.fuel} /> •{' '}
                          {count('movement', row.count)}
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* «ومش عاوز اى داتا اجبارى»: the company is optional, so a receipt may name
                      none — its money is shown here, never put on either company. */}
                  {none.amount > 0 && (
                    <div
                      data-custody-company="none"
                      className={cn(
                        'mt-1.5 text-center text-[10px] text-slate-600 dark:text-slate-400',
                        NUM,
                      )}
                    >
                      {t('fleet.receipts.fields.companyNone')}: {WHOLE.format(none.amount)}{' '}
                      {sum.currency} ({COUNT.format(none.count)})
                    </div>
                  )}
                </>
              )}
              <div className="mt-auto">
                {states !== null && (
                  <CustodyMemoStateBar parts={states} legend={false} name={kind} />
                )}
                <div className={cn(FOOT, kind === 'fuel' ? 'mt-2' : 'mt-3')}>
                  <span className="text-slate-600 dark:text-slate-400">
                    <CustodyShare part={data[kind]} whole={data.total} />{' '}
                    {t('fleet.custody.totals.ofTotal')}
                  </span>
                  <span
                    data-custody-kpi-count={kind}
                    className={cn('shrink-0 whitespace-nowrap', look.chip, NUM)}
                  >
                    {kind === 'fuel'
                      ? t('fleet.custody.dashboard.kpi.fuelCount', {
                          movements: count('movement', data.counts.fuel),
                        })
                      : count('movement', data.counts[kind])}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
        <div data-custody-tile="movements" className={TILE}>
          <div className="flex items-center gap-3">
            <div
              className={cn(
                TILE_ICON,
                'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400',
              )}
            >
              <BoardIcon d={PATH.trend} className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {t('fleet.custody.dashboard.kpi.movements')}
              </div>
              <div className={cn('text-lg font-bold text-slate-900 dark:text-white', NUM)}>
                {COUNT.format(data.count)}{' '}
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                  {noun('movement', data.count)}
                </span>
              </div>
            </div>
          </div>
          {data.periodDays > 0 && (
            <span
              data-custody-rate="true"
              className={cn(
                'whitespace-nowrap rounded border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300',
                NUM,
              )}
            >
              {t('fleet.custody.dashboard.kpi.rate', {
                rate: RATE.format(data.count / data.periodDays),
              })}
            </span>
          )}
        </div>
        <div data-custody-tile="cars" className={TILE}>
          <div className="flex items-center gap-3">
            <div
              className={cn(
                TILE_ICON,
                'border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-400',
              )}
            >
              <BoardIcon d={PATH.truck} className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {t('fleet.custody.dashboard.kpi.carsServed')}
              </div>
              <div className={cn('text-lg font-bold text-slate-900 dark:text-white', NUM)}>
                {COUNT.format(data.vehicleCount)}{' '}
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                  {noun('car', data.vehicleCount)}
                </span>
              </div>
            </div>
          </div>
          {data.vehicleCount > 0 && (
            <span
              data-custody-per-car="true"
              className={cn(
                'whitespace-nowrap rounded border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700 dark:border-slate-700/50 dark:bg-slate-800/90 dark:text-slate-300',
                NUM,
              )}
            >
              {t('fleet.custody.dashboard.kpi.perCar', {
                amount: WHOLE.format(data.total / data.vehicleCount),
              })}
            </span>
          )}
        </div>
        <div data-custody-tile="litres" className={TILE}>
          <div className="flex items-center gap-3">
            <div
              className={cn(
                TILE_ICON,
                'border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400',
              )}
            >
              <BoardIcon d={FLASK} className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {t('fleet.custody.dashboard.kpi.litresTotal')}
              </div>
              <div className={cn('text-lg font-bold text-amber-800 dark:text-amber-300', NUM)}>
                {LITRES.format(data.litres)}{' '}
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                  {t('fleet.custody.dashboard.litresUnit')}
                </span>
              </div>
            </div>
          </div>
          {data.litresMissing > 0 && (
            <span
              data-custody-litres-missing="true"
              className={cn(
                'whitespace-nowrap rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300',
                NUM,
              )}
            >
              {t('fleet.custody.dashboard.litresMissing', {
                count: COUNT.format(data.litresMissing),
              })}
            </span>
          )}
        </div>
      </div>
    </section>
  );
};

// ── The body ──────────────────────────────────────────────────────────────────────────────────

/**
 * Everything the dashboard shows of an answer, in the design's order — up to the fuel: the cars'
 * table and the log are the board's own. Two scopes, kept visibly apart: «العهدة الآن» — the fund
 * over its whole history, whatever the filters (its heading says so) — then «مصروفات العهدة حسب
 * الفلاتر», every section of it filtered as it always was. Every section, whatever the answer
 * holds: with no movement, each at zero with its line (`CustodyNoMovements`), the banner by its own
 * rules; each of the fund's cards loads and fails on its own, and nothing else waits for it.
 */
export const CustodyDashboardBody = ({
  data,
  filters = {},
  onShowMaintenance,
  onFundAction,
  onShowPeriod,
  now,
}: {
  data: FleetCustodyDashboardDto;
  /** The board's filters — the time chart's frame and the words of the line, with no movement. */
  filters?: CustodyDashboardFilters;
  /** Today, for the time chart's frame and the fund's ages — fixed by the specs. */
  now?: number;
} & CustodyDashboardActions): JSX.Element => {
  const t = useT();
  const today = now === undefined ? {} : { now };
  const fundLines = useCustodyFundAlerts(data.fundTotal, now);
  return (
    <div className="space-y-6" data-custody-dashboard-body="true">
      <CustodyAlerts alerts={data.alerts} fundLines={fundLines} onFundAction={onFundAction} />
      <CustodyFundNow data={data} />
      <div className={CUSTODY_FUND_ROW}>
        <CustodyWaitingCard onFundAction={onFundAction} {...today} />
        <CustodySettleCard onFundAction={onFundAction} {...today} />
      </div>
      <div className={CUSTODY_FUND_ROW}>
        <CustodyFundSteps onShowPeriod={onShowPeriod} />
        <CustodyRecentOps onShowPeriod={onShowPeriod} />
      </div>
      <div className="space-y-4 pt-2">
        <CustodySectionHeading name="spend" title={t('fleet.custody.dashboard.spend.heading')} />
        <CustodyKpis data={data} />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <CustodyTimeline data={data} filters={filters} {...today} />
        <CustodyByKindSource data={data} onShowMaintenance={onShowMaintenance} filters={filters} />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <CustodyTopCars data={data} filters={filters} />
        <CustodyTopDrivers data={data} filters={filters} />
        <CustodyFuelBreakdown data={data} filters={filters} />
      </div>
    </div>
  );
};

/** Loading: the frame of the body, shimmering — no layout jump when the answer lands. */
const BodySkeleton = (): JSX.Element => (
  <div className="space-y-6" data-custody-dashboard-loading="true">
    <Skeleton className="h-[130px] rounded-2xl" />
    <div className={CUSTODY_FUND_ROW}>
      <Skeleton className="h-[380px] rounded-2xl lg:col-span-7" />
      <Skeleton className="h-[380px] rounded-2xl lg:col-span-5" />
    </div>
    <div className={CUSTODY_FUND_ROW}>
      <Skeleton className="h-[430px] rounded-2xl lg:col-span-7" />
      <Skeleton className="h-[430px] rounded-2xl lg:col-span-5" />
    </div>
    <div className={KPI_GRID}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-[120px] rounded-2xl" />
      ))}
    </div>
    <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-[68px] rounded-xl" />
      ))}
    </div>
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <Skeleton className="h-[420px] rounded-2xl lg:col-span-7" />
      <Skeleton className="h-[420px] rounded-2xl lg:col-span-5" />
    </div>
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-80 rounded-2xl" />
      ))}
    </div>
  </div>
);

/** What fills the modal for each face of the query. */
export const CustodyDashboardContent = ({
  view,
  data,
  error,
  onRetry,
  filters = {},
  onShowMaintenance,
  onFundAction,
  onShowPeriod,
  now,
}: {
  view: CustodyDashboardView;
  data: FleetCustodyDashboardDto | undefined;
  error: unknown;
  onRetry: () => void;
  /**
   * The board's filters: over one, no movement is «لا توجد حركات مطابقة للفلاتر.», never «لا توجد
   * حركات بعد.» — and the time chart frames the months they name.
   */
  filters?: CustodyDashboardFilters;
  /** Today, for the time chart's frame — fixed by the specs. */
  now?: number;
} & CustodyDashboardActions): JSX.Element => {
  if (view === 'loading') return <BodySkeleton />;
  if (view === 'error' || data === undefined) {
    return (
      <div className={cn(CARD, 'rounded-2xl')}>
        <ErrorState error={error} onRetry={onRetry} />
      </div>
    );
  }
  return (
    <CustodyDashboardBody
      data={data}
      filters={filters}
      onShowMaintenance={onShowMaintenance}
      onFundAction={onFundAction}
      onShowPeriod={onShowPeriod}
      {...(now === undefined ? {} : { now })}
    />
  );
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The modal itself: over the whole screen, in a portal; Escape or × closes it, Tab stays inside,
 * the page behind does not scroll, and the focus goes back to «لوحة تحكم» on the way out. Read only
 * while open.
 */
export const CustodyDashboard = ({
  open,
  onClose,
  filters,
  onClearFilters,
  onShowMaintenance,
  onFundAction,
  onShowPeriod,
}: {
  open: boolean;
  onClose: () => void;
  filters: CustodyDashboardFilters;
} & CustodyDashboardActions): JSX.Element | null => {
  const t = useT();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  // The latest `onClose` without re-running the effect: a new arrow each render must not re-take
  // the focus or forget who opened the modal.
  const close = useRef(onClose);
  close.current = onClose;
  const query = useCustodyDashboard({ ...filters }, open);

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const stops = (): HTMLElement[] =>
      Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
    // Which way Tab was last pressed — where focus that slipped out comes back in.
    let back = false;
    const trap = (active: Element | null, preventDefault?: () => void): void => {
      const list = stops();
      const first = list[0];
      const last = list[list.length - 1];
      if (first === undefined || last === undefined) return;
      const inside = active !== null && panelRef.current?.contains(active) === true;
      const target = custodyTrapFocus<Element>({ back, active, first, last, inside });
      if (!(target instanceof HTMLElement)) return;
      preventDefault?.();
      target.focus();
    };
    // On the document, not the panel: after a click on plain text the focus sits on <body>, and a
    // key pressed there never reaches the panel's own handler.
    const onKey = (e: KeyboardEvent): void => {
      // A control inside that takes its own Escape first (and says so) keeps the dashboard open.
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      back = e.shiftKey;
      // On <body> the browser moves from where the click landed; `focusin` catches it if it leaves.
      if (document.activeElement === document.body) return;
      trap(document.activeElement, () => e.preventDefault());
    };
    // Nothing behind the modal takes the focus while it is up — it comes straight back in.
    const onFocusIn = (e: FocusEvent): void => {
      if (e.target instanceof Node && panelRef.current?.contains(e.target) === false) {
        trap(e.target instanceof Element ? e.target : null);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
      document.body.style.overflow = previous;
      opener?.focus();
    };
  }, [open]);

  if (!open) return null;
  const view = custodyDashboardView(query);
  return createPortal(
    <div className="fixed inset-0 z-[90]" data-custody-dashboard="true">
      <div className="absolute inset-0 animate-fade-in bg-slate-900/50" aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full w-full animate-pop-in flex-col bg-[#f8fafc] text-slate-800 antialiased selection:bg-emerald-600 selection:text-white dark:bg-[#0b0f19] dark:text-slate-200"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3.5 backdrop-blur-md lg:px-8 dark:border-[#1c263b] dark:bg-[#0c111e]/95">
          <h2
            id={titleId}
            className={cn(
              'flex items-center gap-2 text-base font-bold text-slate-900 sm:text-lg dark:text-white',
              CAIRO,
            )}
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full bg-emerald-500 dark:bg-emerald-400"
            />
            {t('fleet.custody.dashboard.title')}
          </h2>
          <button
            ref={closeButton}
            type="button"
            onClick={() => close.current()}
            aria-label={t('common.close')}
            title={t('common.close')}
            data-custody-dashboard-close="true"
            className="-me-1 shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <CloseIcon />
          </button>
        </header>
        {/* The modal scrolls inside itself; a refetch holds the last answer, dimmed. */}
        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto overscroll-contain',
            SCROLLBAR,
            query.isFetching && view === 'ready' && 'opacity-60 transition-opacity',
          )}
        >
          <div className="mx-auto mt-6 max-w-[1600px] space-y-6 px-4 pb-12 lg:px-8">
            <CustodyDashboardFilterBar filters={filters} onClearFilters={onClearFilters} />
            <CustodyDashboardContent
              view={view}
              data={query.data}
              error={query.error}
              onRetry={() => void query.refetch()}
              filters={filters}
              onShowMaintenance={onShowMaintenance}
              onFundAction={onFundAction}
              onShowPeriod={onShowPeriod}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
