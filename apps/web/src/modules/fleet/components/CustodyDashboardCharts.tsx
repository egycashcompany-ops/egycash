// The drawings of «لوحة تحكم», as the owner's design draws them: «المصروف عبر الزمن» in clustered
// columns, «حسب النوع والمصدر» as two concentric rings, «أعلى السيارات صرفًا» as full-width bars
// split by each car's own kinds, «أعلى السائقين صرفًا» as rings, and «تفصيل استهلاك الوقود».
//
// Every number is the server's (`GET /fleet/custody/dashboard`); the browser only sorts, cuts and
// draws, and a share is a ratio of two server numbers. Nothing the data does not hold is drawn:
// «شيلهم» — the design's «توزيع محطات التزويد» panel is gone (no station is ever recorded), and so
// are the station words in the two titles; the company split («شل أوت / وطنية») is the receipts'
// own optional «الشركة», with the receipts that name none on a line of their own, never folded in.
//
// The charts stay Tailwind boxes and plain SVG, no chart library: they theme with `dark:`, and the
// node specs can render them. Colour is never the only key — every chart has its legend, its
// values written out, and the time chart a «جدول» view and a label per column for a screen reader.
import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  FLEET_FUEL_CARD_COMPANIES,
  type FleetCustodyDashboardDto,
  type FleetCustodyDriverRowDto,
  type FleetCustodyFuelCompanyRowDto,
  type FleetCustodyFuelTypeShareDto,
  type FleetCustodySource,
  type FleetCustodyTimeBucketDto,
  type FleetCustodyVehicleRowDto,
  type FleetFuelCardCompany,
  type FleetFuelType,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { CustodyShare, custodyShare, custodySharePct } from './CustodyFigures';
import { BOLT, CUSTODY_KIND, CUSTODY_KINDS } from './CustodyKinds';
import { BoardIcon, NUM } from './FuelCardBoard';
import {
  CAIRO,
  CARD,
  CardHead,
  COMPACT,
  COMPANY,
  COMPANY_ORDER,
  COUNT,
  custodyArcs,
  custodyPeriod,
  custodyTicks,
  LITRES,
  NOTE,
  SCROLLBAR,
  TITLE,
  TITLE_CHIP,
  useCount,
  useMoney,
  useMoneyText,
  useSeparator,
  WHOLE,
} from './custody-dashboard-parts';

/** The design ranks ten cars and seven drivers. */
const TOP_CARS = 10;
const TOP_DRIVERS = 7;

/** The mini tables of the donut card and the time chart's «جدول». */
const MINI_FRAME =
  'max-w-full overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800/80';
const MINI_THEAD =
  'border-b border-slate-200 bg-slate-100 text-[11px] text-slate-600 dark:border-transparent dark:bg-[#0b101c] dark:text-slate-400';
const MINI_TBODY =
  'divide-y divide-slate-100 bg-white dark:divide-slate-800/70 dark:bg-[#0e1524]/60';
const MINI_ROW = 'transition hover:bg-slate-50 dark:hover:bg-slate-800/40';

const kindName = (t: ReturnType<typeof useT>, kind: FleetCustodySource): string =>
  t(`fleet.custody.source.${kind}`);
const companyName = (t: ReturnType<typeof useT>, company: FleetFuelCardCompany): string =>
  t(`fleet.fuelCards.company.${company}`);

/**
 * The fund's fuel by company — both companies, in the design's order unless told another (the fuel
 * card's split names وطنية first), a missing one as zeros with no types.
 */
export const custodyCompanies = (
  data: FleetCustodyDashboardDto,
  order: readonly FleetFuelCardCompany[] = COMPANY_ORDER,
): FleetCustodyFuelCompanyRowDto[] =>
  order.map(
    (company) =>
      data.fuelByCompany.companies.find((row) => row.company === company) ?? {
        company,
        amount: 0,
        count: 0,
        litres: 0,
        types: [],
      },
  );

// ── «المصروف عبر الزمن» ──────────────────────────────────────────────────────────────────────

/** The pressed half of «رسم بياني / جدول»: emerald on the dark card, a white pill on the light. */
const VIEW_PRESSED =
  'bg-white font-bold text-slate-900 shadow-sm dark:bg-emerald-600 dark:font-semibold dark:text-white dark:shadow';
const VIEW_IDLE =
  'font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white';

/**
 * The narrowest a period may be before the plot scrolls inside its card: four bars of at least 2px
 * with a pixel between them, then the gap to the next period — a day, or a month with a little
 * more room. So a whole month of days (482px) and a whole year of months (504px) fit beside the
 * rings from a 1,024px screen up (about 510px inside the card), as the design shows its columns
 * filling the card; a phone, or a longer stretch, scrolls inside the card, opening on the latest.
 */
const DAY_MIN = 14;
const MONTH_MIN = 38;
/** The value axis on the left and the plot's right edge (`pl-10 pr-2`). */
const PLOT_EDGES = 48;
export const custodyPlotMinWidth = (periods: number, day: boolean): number =>
  periods * (day ? DAY_MIN : MONTH_MIN) + PLOT_EDGES;

/** The tallest single bar of a period — the clustered columns' axis runs to the tallest of all. */
const tallestBar = (bucket: FleetCustodyTimeBucketDto): number =>
  CUSTODY_KINDS.reduce((top, kind) => Math.max(top, bucket[kind]), 0);

/**
 * (3) The spend over time — four thin bars a period (التوكيل، وقود، كاوتش، غسيل), not stacked;
 * a kind with nothing that period is a 2px stub. The dearest period carries its total over its
 * bars in amber; the period read out (under the pointer or the focus, the latest until then) in
 * emerald. Time runs left to right whatever the page's direction; ←/→/Home/End walk the columns.
 */
export const CustodyTimeline = ({
  data,
  initialTable = false,
}: {
  data: FleetCustodyDashboardDto;
  /** For the node specs, which cannot click «جدول». */
  initialTable?: boolean;
}): JSX.Element => {
  const t = useT();
  const money = useMoney();
  const moneyText = useMoneyText();
  const sep = useSeparator();
  const { count } = useCount();
  const titleId = useId();
  const { buckets, granularity } = data.timeline;
  const [table, setTable] = useState(initialTable);
  // The readout shows the column under the pointer or the focus — the latest one until then.
  const [picked, setActive] = useState(Number.POSITIVE_INFINITY);
  // A new answer may hold fewer stretches: the pick never points past the last one.
  const active = Math.max(0, Math.min(picked, buckets.length - 1));
  const plotRef = useRef<HTMLDivElement>(null);
  // On a phone the plot is wider than its card: it opens on the latest stretch, the right end.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el !== null) el.scrollLeft = el.scrollWidth;
  }, [buckets.length, table]);
  const shown: FleetCustodyTimeBucketDto | undefined = buckets[active];
  const ticks = custodyTicks(buckets.reduce((top, bucket) => Math.max(top, tallestBar(bucket)), 0));
  const top = ticks[ticks.length - 1] ?? 0;
  const height = (value: number): number => (top === 0 ? 0 : (value / top) * 100);
  const dearest = buckets.reduce((most, bucket) => Math.max(most, bucket.total), 0);
  const peak = dearest > 0 ? buckets.findIndex((bucket) => bucket.total === dearest) : -1;
  const day = granularity === 'day';
  // Under the columns: the day or the month, and the month or the year where it turns.
  const firstLine = (key: string): string => (day ? key.slice(8, 10) : key.slice(5, 7));
  const secondLine = (key: string, i: number): string | null => {
    if (day) return i === 0 || key.slice(8, 10) === '01' ? custodyPeriod(key.slice(0, 7)) : null;
    return i === 0 || key.slice(5, 7) === '01' ? key.slice(0, 4) : null;
  };
  const every = Math.max(1, Math.ceil(buckets.length / (day ? 16 : 24)));

  // Arrow keys walk the columns — one stop on the Tab path, as a chart is one thing.
  const onPlotKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? buckets.length - 1 : active + step;
    if ((step === 0 && e.key !== 'Home' && e.key !== 'End') || to < 0 || to >= buckets.length)
      return;
    e.preventDefault();
    setActive(to);
    plotRef.current?.querySelector<HTMLElement>(`[data-custody-column="${to}"]`)?.focus();
  };

  return (
    <section
      data-custody-dashboard-section="timeline"
      aria-labelledby={titleId}
      className={cn(CARD, 'flex min-w-0 flex-col rounded-2xl p-5 lg:col-span-7')}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className={cn(TITLE, 'flex items-center gap-2')}>
            <span>{t('fleet.custody.dashboard.timeline')}</span>
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full bg-emerald-500 dark:bg-emerald-400"
            />
          </h2>
          <p className={NOTE}>{t('fleet.custody.dashboard.timelineNote')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label={t('fleet.custody.dashboard.viewLabel')}
            className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-[#1e2a3f] dark:bg-[#080d16]"
          >
            {([false, true] as const).map((asTable) => (
              <button
                key={String(asTable)}
                type="button"
                aria-pressed={table === asTable}
                data-custody-view={asTable ? 'table' : 'chart'}
                onClick={() => setTable(asTable)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs transition',
                  table === asTable ? VIEW_PRESSED : VIEW_IDLE,
                )}
              >
                {asTable
                  ? t('fleet.custody.dashboard.showTable')
                  : t('fleet.custody.dashboard.showChart')}
              </button>
            ))}
          </div>
          <span
            data-custody-granularity={granularity}
            className="rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs text-slate-700 dark:border-[#22324e] dark:bg-[#121c2e] dark:text-slate-300"
          >
            {day ? t('fleet.custody.dashboard.byDay') : t('fleet.custody.dashboard.byMonth')}
          </span>
        </div>
      </div>

      {table ? (
        <div className={cn(MINI_FRAME, SCROLLBAR)}>
          <table aria-labelledby={titleId} className="w-full text-start text-xs">
            <thead className={MINI_THEAD}>
              <tr>
                <th scope="col" className="p-2.5 text-start">
                  {t('fleet.custody.dashboard.columns.period')}
                </th>
                {CUSTODY_KINDS.map((kind) => (
                  <th key={kind} scope="col" className="whitespace-nowrap p-2.5 text-start">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className={cn('h-2.5 w-2.5 rounded', CUSTODY_KIND[kind].fill)}
                      />
                      {kindName(t, kind)}
                    </span>
                  </th>
                ))}
                <th scope="col" className="p-2.5 text-start">
                  {t('fleet.custody.dashboard.columns.total')}
                </th>
                <th scope="col" className="p-2.5 text-center">
                  {t('fleet.custody.dashboard.columns.count')}
                </th>
              </tr>
            </thead>
            <tbody className={MINI_TBODY}>
              {buckets.map((bucket) => (
                <tr key={bucket.key} data-custody-period-row={bucket.key} className={MINI_ROW}>
                  <td className={cn('p-2.5 font-semibold text-slate-900 dark:text-white', NUM)}>
                    <span dir="ltr">{custodyPeriod(bucket.key)}</span>
                  </td>
                  {CUSTODY_KINDS.map((kind) => (
                    <td
                      key={kind}
                      className={cn(
                        'whitespace-nowrap p-2.5',
                        NUM,
                        bucket[kind] > 0 ? CUSTODY_KIND[kind].text : 'text-slate-400',
                      )}
                    >
                      {bucket[kind] > 0 ? money(bucket[kind]).figure : '—'}
                    </td>
                  ))}
                  <td
                    className={cn(
                      'whitespace-nowrap p-2.5 font-bold text-slate-900 dark:text-white',
                      NUM,
                    )}
                  >
                    {bucket.total > 0 ? moneyText(bucket.total) : '—'}
                  </td>
                  <td className={cn('p-2.5 text-center text-slate-600 dark:text-slate-400', NUM)}>
                    {COUNT.format(bucket.count)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          {/* The readout: one period, each kind's sum and its share of the period. */}
          {shown !== undefined && (
            <div
              aria-live="polite"
              data-custody-readout="true"
              className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 shadow-inner dark:border-emerald-500/30 dark:bg-[#0c1322]/90 dark:text-slate-300"
            >
              <div className="flex items-center gap-2">
                <span
                  dir="ltr"
                  data-custody-readout-period="true"
                  className={cn(
                    'rounded border border-emerald-300 bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-950/70 dark:text-emerald-400',
                    NUM,
                  )}
                >
                  {custodyPeriod(shown.key)}
                </span>
                <span>
                  {t('fleet.custody.dashboard.readoutTotal')}{' '}
                  <strong
                    className={cn(
                      'whitespace-nowrap text-sm text-slate-900 dark:text-xs dark:text-white',
                      NUM,
                    )}
                  >
                    {moneyText(shown.total)}
                  </strong>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px]">
                {CUSTODY_KINDS.filter((kind) => shown[kind] > 0).map((kind) => (
                  <span
                    key={kind}
                    data-custody-tip-row={kind}
                    className={cn('flex items-center gap-1', CUSTODY_KIND[kind].soft)}
                  >
                    <span
                      aria-hidden="true"
                      className={cn('h-2 w-2 rounded-full', CUSTODY_KIND[kind].fill)}
                    />
                    <span>
                      {kindName(t, kind)}: <span className={NUM}>{money(shown[kind]).figure}</span>{' '}
                      (<CustodyShare part={shown[kind]} whole={shown.total} />)
                    </span>
                  </span>
                ))}
                <span className={cn('whitespace-nowrap text-slate-500 dark:text-slate-400', NUM)}>
                  | {count('movement', shown.count)}
                </span>
              </div>
            </div>
          )}

          {/* Time runs left to right; on a phone the plot scrolls inside its card rather than
              squeezing a month of days into it. */}
          {/* The design's 16rem plot, grown to fill the card when the rings beside it are taller. */}
          <div
            ref={scrollRef}
            className={cn('flex min-h-[16rem] flex-1 flex-col overflow-x-auto', SCROLLBAR)}
            dir="ltr"
          >
            <div
              className="relative min-h-[16rem] flex-1 border-b border-l border-slate-200 pb-3 pl-10 pr-2 pt-6 dark:border-slate-800/80"
              style={{ minWidth: `${custodyPlotMinWidth(buckets.length, day)}px` }}
            >
              {/* The value axis: hairlines with their round, compact values, over exactly the
                  height the bars are measured in. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-9 top-6"
              >
                {ticks.map((tick) => (
                  <div
                    key={tick}
                    className={cn(
                      'absolute inset-x-0 pl-1.5 text-[10px] leading-3 text-slate-400 dark:text-slate-500',
                      NUM,
                      tick > 0 && 'border-b border-slate-100 dark:border-slate-800/50',
                    )}
                    style={{ bottom: `${height(tick)}%` }}
                  >
                    {COMPACT.format(tick)}
                  </div>
                ))}
              </div>
              <div
                ref={plotRef}
                role="group"
                aria-label={t('fleet.custody.dashboard.timeline')}
                onKeyDown={onPlotKey}
                className={cn('relative z-10 flex h-full items-end', day ? 'gap-0.5' : 'gap-2')}
              >
                {buckets.map((bucket, i) => {
                  const current = i === active;
                  const isPeak = i === peak && !current;
                  const kinds = CUSTODY_KINDS.filter((kind) => bucket[kind] > 0);
                  const labelled = i % every === 0 || i === buckets.length - 1 || current;
                  const second = secondLine(bucket.key, i);
                  return (
                    <div
                      key={bucket.key}
                      data-custody-column={i}
                      tabIndex={current ? 0 : -1}
                      aria-label={`${custodyPeriod(bucket.key)}: ${moneyText(bucket.total)}${kinds
                        .map(
                          (kind) =>
                            `${sep}${kindName(t, kind)} ${moneyText(bucket[kind])} (${custodyShare(bucket[kind], bucket.total)})`,
                        )
                        .join('')}`}
                      onMouseEnter={() => setActive(i)}
                      onFocus={() => setActive(i)}
                      className={cn(
                        'group flex h-full min-w-0 flex-1 cursor-default flex-col items-center justify-end outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60',
                        !day && 'px-0.5',
                      )}
                    >
                      <div
                        className={cn(
                          'relative flex w-full flex-1 items-end justify-center rounded-t',
                          day ? 'gap-px' : 'gap-0.5 sm:gap-1',
                          current &&
                            'bg-emerald-50 ring-1 ring-emerald-400 dark:bg-emerald-950/30 dark:ring-emerald-400/50',
                          isPeak &&
                            'bg-amber-50/60 ring-1 ring-amber-300 dark:bg-emerald-950/20 dark:ring-emerald-500/30',
                        )}
                      >
                        {(current || isPeak) && bucket.total > 0 && (
                          <span
                            {...(current
                              ? { 'data-custody-current': 'true' }
                              : { 'data-custody-peak': 'true' })}
                            // A day's column is narrower than its figure: the figure stays over
                            // the next column's box, never under it.
                            className={cn(
                              'absolute z-10 whitespace-nowrap text-[10px] font-bold',
                              NUM,
                              current
                                ? 'text-emerald-700 dark:text-emerald-300'
                                : 'text-amber-700 dark:text-amber-300',
                            )}
                            style={{ bottom: `calc(${height(tallestBar(bucket))}% + 4px)` }}
                          >
                            {WHOLE.format(bucket.total)}
                          </span>
                        )}
                        {CUSTODY_KINDS.map((kind) =>
                          bucket[kind] > 0 ? (
                            <span
                              key={kind}
                              data-custody-mark={kind}
                              title={`${kindName(t, kind)}: ${moneyText(bucket[kind])}`}
                              className={cn(
                                'min-h-[2px] min-w-0 max-w-[0.625rem] flex-1 rounded-t shadow-[0_1px_2px_0_rgba(0,0,0,.05)] transition-all hover:opacity-80 sm:max-w-[0.75rem] dark:shadow-none dark:hover:opacity-100 dark:hover:brightness-125',
                                CUSTODY_KIND[kind].fill,
                              )}
                              style={{ height: `${height(bucket[kind])}%` }}
                            />
                          ) : (
                            <span
                              key={kind}
                              aria-hidden="true"
                              data-custody-stub={kind}
                              className={cn(
                                'h-0.5 min-w-0 max-w-[0.625rem] flex-1 rounded-t sm:max-w-[0.75rem]',
                                CUSTODY_KIND[kind].stub,
                              )}
                            />
                          ),
                        )}
                      </div>
                      <span
                        aria-hidden="true"
                        className={cn(
                          'relative mt-2 block h-4 text-center text-[11px] leading-4',
                          NUM,
                          current
                            ? 'font-bold text-emerald-800 dark:text-emerald-400'
                            : i === peak
                              ? 'font-bold text-slate-900 dark:text-emerald-400'
                              : 'font-medium text-slate-500 group-hover:text-emerald-700 dark:font-normal dark:text-slate-400 dark:group-hover:text-emerald-400',
                        )}
                      >
                        {labelled ? firstLine(bucket.key) : ''}
                        {second !== null && (
                          <span className="absolute inset-x-0 top-full whitespace-nowrap text-[9px] font-normal leading-3 text-slate-400 dark:text-slate-500">
                            {second}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div
            data-custody-legend="true"
            className="mt-2 flex flex-wrap items-center justify-center gap-4 border-t border-slate-100 pt-3 text-xs font-medium text-slate-600 dark:border-slate-800/80 dark:font-normal dark:text-slate-300"
          >
            {CUSTODY_KINDS.map((kind) => (
              <div key={kind} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  data-custody-swatch={kind}
                  className={cn('h-3 w-3 rounded shadow-sm', CUSTODY_KIND[kind].fill)}
                />
                <span>{kindName(t, kind)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
};

// ── «حسب النوع والمصدر» ─────────────────────────────────────────────────────────────────────

const OUTER_R = 64;
const INNER_R = 44;
const OUTER_C = 2 * Math.PI * OUTER_R;
const INNER_C = 2 * Math.PI * INNER_R;
const SOURCES = ['receipt', 'dealershipInvoice'] as const;
/** The inner ring: the receipts screen emerald, the dealership's bills blue. */
const SOURCE_LOOK = {
  receipt: {
    stroke: 'stroke-[#059669] dark:stroke-[#10b981]',
    dot: 'bg-emerald-600 dark:bg-emerald-500',
    text: 'text-emerald-800 dark:text-emerald-400',
    label: 'fleet.custody.dashboard.donut.receipts',
  },
  dealershipInvoice: {
    stroke: 'stroke-[#2563eb] dark:stroke-[#3b82f6]',
    dot: 'bg-blue-600 dark:bg-blue-500',
    text: 'text-blue-700 dark:text-blue-400',
    label: 'fleet.custody.dashboard.donut.dealership',
  },
} as const;

/**
 * (4) «حسب النوع والمصدر» — the kinds on the outer ring, the two sources (the receipts screen,
 * the dealership's bills) on the inner one, the total in the middle; the legend, a small table of
 * the kinds, and the fuel's suppliers under it. «عرض حركات التوكيل» sets the board's own «المصدر»
 * to التوكيل and closes the dashboard.
 */
export const CustodyByKindSource = ({
  data,
  onShowDealership,
}: {
  data: FleetCustodyDashboardDto;
  onShowDealership?: (() => void) | undefined;
}): JSX.Element => {
  const t = useT();
  const money = useMoney();
  const moneyText = useMoneyText();
  const sep = useSeparator();
  const { count } = useCount();
  const titleId = useId();
  const kinds = custodyArcs(
    CUSTODY_KINDS.map((kind) => data[kind]),
    OUTER_C,
    4,
  );
  const lines = SOURCES.map(
    (ref) => data.bySource.find((line) => line.ref === ref) ?? { ref, count: 0, amount: 0 },
  );
  const sources = custodyArcs(
    lines.map((line) => line.amount),
    INNER_C,
    2.5,
  );
  const companies = custodyCompanies(data);
  const none = data.fuelByCompany.none;
  const fuelTitle = `${kindName(t, 'fuel')} (${COMPANY_ORDER.map((company) => companyName(t, company)).join(' / ')})`;
  const amountOnly = (value: number): string => `${WHOLE.format(value)} ${money(value).currency}`;
  return (
    <section
      data-custody-dashboard-section="byKindSource"
      aria-labelledby={titleId}
      className={cn(CARD, 'flex min-w-0 flex-col justify-between rounded-2xl p-5 lg:col-span-5')}
    >
      <CardHead
        id={titleId}
        level={2}
        title={t('fleet.custody.dashboard.byKindSource')}
        end={
          <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800 dark:border-emerald-700/30 dark:bg-emerald-950/40 dark:text-emerald-400/90">
            {t('fleet.custody.dashboard.donut.chip')}
          </span>
        }
      />
      <div className="my-3 flex flex-col items-center justify-center gap-6 rounded-2xl border border-slate-200/90 bg-slate-50/80 p-3 sm:flex-row dark:border-slate-800/80 dark:bg-[#090e18]/80">
        <div
          role="img"
          data-custody-donut="true"
          aria-label={[
            ...CUSTODY_KINDS.map(
              (kind) =>
                `${kindName(t, kind)}: ${moneyText(data[kind])} (${custodyShare(data[kind], data.total)})`,
            ),
            ...lines.map(
              (line) =>
                `${t(SOURCE_LOOK[line.ref].label)}: ${moneyText(line.amount)} (${custodyShare(line.amount, data.total)})`,
            ),
          ].join(sep)}
          className="relative flex h-44 w-44 shrink-0 items-center justify-center"
        >
          <svg className="h-full w-full -rotate-90" viewBox="0 0 160 160" aria-hidden="true">
            <circle
              cx="80"
              cy="80"
              r={OUTER_R}
              fill="transparent"
              strokeWidth={14}
              className="stroke-[#e2e8f0] dark:stroke-[#162032]"
            />
            {CUSTODY_KINDS.map((kind, i) => {
              const arc = kinds[i];
              return arc === undefined || arc.value <= 0 ? null : (
                <circle
                  key={kind}
                  data-custody-arc={kind}
                  cx="80"
                  cy="80"
                  r={OUTER_R}
                  fill="transparent"
                  strokeWidth={14}
                  strokeLinecap="round"
                  strokeDasharray={`${arc.length} ${OUTER_C.toFixed(2)}`}
                  strokeDashoffset={arc.offset}
                  className={CUSTODY_KIND[kind].stroke}
                >
                  <title>{`${kindName(t, kind)}: ${moneyText(data[kind])}`}</title>
                </circle>
              );
            })}
            <circle
              cx="80"
              cy="80"
              r={INNER_R}
              fill="transparent"
              strokeWidth={8}
              className="stroke-[#f1f5f9] dark:stroke-[#131b29]"
            />
            {lines.map((line, i) => {
              const arc = sources[i];
              return arc === undefined || arc.value <= 0 ? null : (
                <circle
                  key={line.ref}
                  data-custody-arc={line.ref}
                  cx="80"
                  cy="80"
                  r={INNER_R}
                  fill="transparent"
                  strokeWidth={8}
                  strokeDasharray={`${arc.length} ${INNER_C.toFixed(2)}`}
                  strokeDashoffset={arc.offset}
                  className={SOURCE_LOOK[line.ref].stroke}
                >
                  <title>{`${t(SOURCE_LOOK[line.ref].label)}: ${moneyText(line.amount)}`}</title>
                </circle>
              );
            })}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[10px] text-slate-500 dark:text-slate-400">
              {t('fleet.custody.dashboard.donut.centre')}
            </span>
            <span
              className={cn(
                'text-base font-black text-slate-900 dark:text-sm dark:font-bold dark:text-white',
                CAIRO,
              )}
            >
              {WHOLE.format(data.total)}
            </span>
            <CustodyShare
              part={data.total}
              whole={data.total}
              className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400"
            />
          </div>
        </div>

        <div className="w-full space-y-1.5 text-xs" data-custody-donut-legend="true">
          <div className="flex justify-between gap-2 border-b border-slate-200 pb-1 text-[11px] font-bold text-slate-600 dark:border-slate-800 dark:font-semibold dark:text-slate-400">
            <span>{t('fleet.custody.dashboard.donut.outer')}</span>
            <span className={cn('shrink-0 text-slate-500', NUM)}>
              {t('fleet.custody.dashboard.donut.outerCount')}
            </span>
          </div>
          {CUSTODY_KINDS.map((kind) =>
            kind === 'fuel' ? (
              <div
                key={kind}
                data-custody-legend-kind={kind}
                className="flex flex-col rounded-lg border border-amber-200 bg-amber-50/70 p-1.5 text-[11px] dark:border-amber-500/20 dark:bg-[#121c2e]/60"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-bold text-amber-950 dark:font-semibold dark:text-slate-200">
                    <span
                      aria-hidden="true"
                      className={cn('h-2.5 w-2.5 shrink-0 rounded-full', CUSTODY_KIND.fuel.fill)}
                    />
                    {fuelTitle}
                  </span>
                  <span className={cn('whitespace-nowrap font-bold', CUSTODY_KIND.fuel.deep, NUM)}>
                    <CustodyShare part={data.fuel} whole={data.total} />{' '}
                    <span className="font-normal text-slate-500 dark:text-slate-400">
                      ({amountOnly(data.fuel)})
                    </span>
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 border-t border-amber-200 pt-1 text-[10px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  {companies.map((row) => (
                    <span
                      key={row.company}
                      data-custody-legend-company={row.company}
                      className={cn(COMPANY[row.company].line, NUM)}
                    >
                      <span aria-hidden="true">⛽ </span>
                      {companyName(t, row.company)}: {WHOLE.format(row.amount)} (
                      <CustodyShare part={row.amount} whole={data.fuel} />)
                    </span>
                  ))}
                  {none.amount > 0 && (
                    <span
                      data-custody-legend-company="none"
                      className={cn('text-slate-600 dark:text-slate-400', NUM)}
                    >
                      {t('fleet.receipts.fields.companyNone')}: {WHOLE.format(none.amount)} (
                      <CustodyShare part={none.amount} whole={data.fuel} />)
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div
                key={kind}
                data-custody-legend-kind={kind}
                className="flex items-center justify-between gap-2 text-[11px]"
              >
                <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                  <span
                    aria-hidden="true"
                    className={cn('h-2.5 w-2.5 shrink-0 rounded-full', CUSTODY_KIND[kind].fill)}
                  />
                  {kindName(t, kind)}
                </span>
                <span className={cn('whitespace-nowrap font-bold', CUSTODY_KIND[kind].deep, NUM)}>
                  <CustodyShare part={data[kind]} whole={data.total} />{' '}
                  <span className="font-normal text-slate-500 dark:text-slate-400">
                    ({amountOnly(data[kind])})
                  </span>
                </span>
              </div>
            ),
          )}
          <div className="flex justify-between gap-2 border-b border-slate-200 pb-1 pt-2 text-[11px] font-bold text-slate-600 dark:border-slate-800 dark:font-semibold dark:text-slate-400">
            <span>{t('fleet.custody.dashboard.donut.inner')}</span>
            <span className="shrink-0 text-slate-500">
              {t('fleet.custody.dashboard.donut.innerCount')}
            </span>
          </div>
          {lines.map((line) => (
            <div
              key={line.ref}
              data-custody-source-row={line.ref}
              className="flex items-center justify-between gap-2 text-[11px]"
            >
              <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <span
                  aria-hidden="true"
                  className={cn('h-2 w-2 shrink-0 rounded', SOURCE_LOOK[line.ref].dot)}
                />
                {t(SOURCE_LOOK[line.ref].label)}
              </span>
              <span className={cn('whitespace-nowrap', SOURCE_LOOK[line.ref].text, NUM)}>
                <CustodyShare part={line.amount} whole={data.total} /> (
                {count('movement', line.count)})
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className={cn(MINI_FRAME, 'mb-2')}>
        <table
          aria-label={t('fleet.custody.dashboard.byKindSource')}
          className="w-full min-w-[20rem] text-start text-xs"
        >
          <thead className={MINI_THEAD}>
            <tr>
              <th scope="col" className="p-2.5 text-start">
                {t('fleet.custody.dashboard.columns.kind')}
              </th>
              <th scope="col" className="p-2.5 text-start">
                {t('fleet.custody.dashboard.columns.amount')}
              </th>
              <th scope="col" className="p-2.5 text-center">
                {t('fleet.custody.dashboard.columns.share')}
              </th>
              <th scope="col" className="p-2.5 text-center">
                {t('fleet.custody.dashboard.columns.count')}
              </th>
            </tr>
          </thead>
          <tbody className={MINI_TBODY}>
            {CUSTODY_KINDS.map((kind) => (
              <tr key={kind} data-custody-kind-row={kind} className={MINI_ROW}>
                <td className="min-w-[9rem] p-2.5 font-semibold text-slate-900 dark:font-medium dark:text-white">
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className={cn('h-2.5 w-2.5 shrink-0 rounded', CUSTODY_KIND[kind].fill)}
                    />
                    {kind === 'fuel' ? fuelTitle : kindName(t, kind)}
                  </span>
                  {kind === 'fuel' && data.fuel > 0 && (
                    <span
                      data-custody-kind-row-companies="true"
                      className={cn(
                        'mt-0.5 block ps-4 text-[10px] font-normal text-slate-500 dark:text-slate-400',
                        NUM,
                      )}
                    >
                      {[
                        ...companies.map(
                          (row) => `${companyName(t, row.company)}: ${amountOnly(row.amount)}`,
                        ),
                        ...(none.amount > 0
                          ? [
                              `${t('fleet.receipts.fields.companyNone')}: ${amountOnly(none.amount)}`,
                            ]
                          : []),
                      ].join(' | ')}
                    </span>
                  )}
                </td>
                <td
                  className={cn('whitespace-nowrap p-2.5 text-slate-800 dark:text-slate-200', NUM)}
                >
                  {moneyText(data[kind])}
                </td>
                <td className="p-2.5 text-center">
                  <CustodyShare
                    part={data[kind]}
                    whole={data.total}
                    className={cn('font-bold', CUSTODY_KIND[kind].text)}
                  />
                </td>
                <td className={cn('p-2.5 text-center text-slate-600 dark:text-slate-400', NUM)}>
                  {COUNT.format(data.counts[kind])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 text-[11px] text-slate-500 dark:border-slate-800/80 dark:text-slate-400">
        <span data-custody-suppliers="true">
          {data.fuel > 0 && (
            <>
              {t('fleet.custody.dashboard.donut.suppliers')}{' '}
              {[
                ...companies.map((row) => ({ key: row.company, amount: row.amount })),
                ...(none.amount > 0 ? [{ key: 'none' as const, amount: none.amount }] : []),
              ].map((part, i) => (
                <Fragment key={part.key}>
                  {i > 0 && ' • '}
                  {part.key === 'none'
                    ? t('fleet.receipts.fields.companyNone')
                    : companyName(t, part.key)}{' '}
                  (<CustodyShare part={part.amount} whole={data.fuel} />)
                </Fragment>
              ))}
            </>
          )}
        </span>
        {onShowDealership !== undefined && (
          <button
            type="button"
            data-custody-show-dealership="true"
            onClick={onShowDealership}
            className="font-bold text-emerald-700 transition hover:underline dark:font-medium dark:text-emerald-400 dark:hover:text-emerald-300"
          >
            {t('fleet.custody.dashboard.donut.showDealership')}
          </button>
        )}
      </div>
    </section>
  );
};

// ── «أعلى السيارات صرفًا» ──────────────────────────────────────────────────────────────────────

/** The legend's short names — the design writes «توكيل» there, the kind's name elsewhere. */
const shortName = (t: ReturnType<typeof useT>, kind: FleetCustodySource): string =>
  kind === 'dealership' ? t('fleet.custody.dashboard.short.dealership') : kindName(t, kind);

/**
 * (5) The ten dearest cars: each bar the FULL width, split by that car's own kinds; beside the
 * code its total and its share of everything the fund paid. «والسجل يكون برا»: a car's «السجل» is
 * on the board's «ملخص لكل سيارة», not here.
 */
export const CustodyTopCars = ({ data }: { data: FleetCustodyDashboardDto }): JSX.Element => {
  const t = useT();
  const moneyText = useMoneyText();
  const sep = useSeparator();
  const { count } = useCount();
  const titleId = useId();
  const ranked: FleetCustodyVehicleRowDto[] = [...data.vehicles]
    .sort((a, b) => b.total - a.total)
    .slice(0, TOP_CARS);
  return (
    <section
      data-custody-dashboard-section="topCars"
      aria-labelledby={titleId}
      className={cn(CARD, 'min-w-0 rounded-2xl p-5')}
    >
      <CardHead
        id={titleId}
        title={t('fleet.custody.dashboard.topCars')}
        note={t('fleet.custody.dashboard.topCarsNote', { cars: count('car', ranked.length) })}
        end={<span className={cn(TITLE_CHIP, NUM)}>{count('car', ranked.length)}</span>}
      />
      <div
        data-custody-legend="true"
        className="mb-2 flex flex-wrap items-center justify-end gap-2 text-[10px] text-slate-600 dark:text-slate-400"
      >
        {CUSTODY_KINDS.map((kind) => (
          <span key={kind} className="flex items-center gap-1">
            <span
              aria-hidden="true"
              data-custody-swatch={kind}
              className={cn('h-2 w-2 rounded', CUSTODY_KIND[kind].fill)}
            />
            {shortName(t, kind)}
          </span>
        ))}
      </div>
      <ol className="space-y-3" data-custody-top-cars="true">
        {ranked.map((car) => {
          const present = CUSTODY_KINDS.filter((kind) => car[kind] > 0);
          return (
            <li
              key={car.vehicleId ?? `code:${car.vehicleCode ?? ''}`}
              tabIndex={0}
              data-custody-car={car.vehicleCode ?? ''}
              aria-label={`${car.vehicleCode ?? '—'}: ${moneyText(car.total)} (${custodyShare(car.total, data.total)})${present
                .map(
                  (kind) =>
                    `${sep}${kindName(t, kind)} ${moneyText(car[kind])} (${custodyShare(car[kind], car.total)})`,
                )
                .join('')}`}
              className="rounded-xl border border-slate-200 bg-slate-50/80 p-2.5 outline-none transition hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-emerald-500/60 dark:border-slate-800/60 dark:bg-[#0c1322]/80 dark:p-2 dark:hover:border-emerald-500/40 dark:hover:bg-slate-800/40"
            >
              <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                <span
                  dir="ltr"
                  className={cn(
                    'rounded border border-blue-200 bg-blue-100 px-2 py-0.5 font-bold text-blue-900 dark:border-blue-800/50 dark:bg-blue-950/60 dark:text-white',
                    NUM,
                  )}
                >
                  {car.vehicleCode ?? '—'}
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'whitespace-nowrap font-bold text-slate-800 dark:font-normal dark:text-slate-300',
                      NUM,
                    )}
                  >
                    {moneyText(car.total)}
                  </span>
                  <CustodyShare
                    part={car.total}
                    whole={data.total}
                    className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400"
                  />
                </div>
              </div>
              <div className="flex h-3 w-full overflow-hidden rounded-md bg-slate-200 shadow-inner dark:rounded dark:bg-slate-800 dark:shadow-none">
                {present.map((kind) => (
                  <div
                    key={kind}
                    data-custody-mark={kind}
                    title={`${kindName(t, kind)}: ${moneyText(car[kind])}`}
                    className={CUSTODY_KIND[kind].fill}
                    style={{ width: `${custodySharePct(car[kind], car.total)}%` }}
                  />
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
};

// ── «أعلى السائقين صرفًا» ─────────────────────────────────────────────────────────────────────

/** The kinds a driver is named on — the receipts'; a dealership bill names no driver. */
const DRIVER_KINDS = ['fuel', 'tyres', 'wash'] as const;

/**
 * What the receipts came to (fuel, tyres, washing) — the whole a driver's share is of, never the
 * whole fund: a dealership bill names no driver, so against the whole every driver would look
 * smaller by the dealership's part.
 */
export const custodyReceipts = (data: FleetCustodyDashboardDto): number =>
  DRIVER_KINDS.reduce((sum, kind) => sum + data[kind], 0);

/** «وقود 65% • كاوتش 25%» — a driver's two biggest kinds, dearest first. */
export const custodyTopKinds = (
  driver: FleetCustodyDriverRowDto,
): (typeof DRIVER_KINDS)[number][] =>
  DRIVER_KINDS.filter((kind) => driver[kind] > 0)
    .sort((a, b) => driver[b] - driver[a])
    .slice(0, 2);

/** The rings by rank, as the design cycles them: emerald, amber, blue, cyan. */
export const CUSTODY_RINGS = [
  {
    ring: 'text-emerald-600 dark:text-emerald-400',
    label: 'text-emerald-800 dark:text-emerald-300',
  },
  { ring: 'text-amber-500 dark:text-amber-400', label: 'text-amber-800 dark:text-amber-300' },
  { ring: 'text-blue-600 dark:text-blue-400', label: 'text-blue-800 dark:text-blue-300' },
  { ring: 'text-cyan-600 dark:text-cyan-400', label: 'text-cyan-800 dark:text-cyan-300' },
] as const;
const RING_PATH = 'M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831';

/**
 * (6) The receipts' drivers (a bill names none) — each a ring of his share of the receipts, his
 * two biggest kinds under his name, his total at the end; then the receipts that name no driver.
 */
export const CustodyTopDrivers = ({ data }: { data: FleetCustodyDashboardDto }): JSX.Element => {
  const t = useT();
  const money = useMoney();
  const moneyText = useMoneyText();
  const sep = useSeparator();
  const titleId = useId();
  const ranked = data.drivers.slice(0, TOP_DRIVERS);
  const receipts = custodyReceipts(data);
  return (
    <section
      data-custody-dashboard-section="topDrivers"
      aria-labelledby={titleId}
      className={cn(CARD, 'min-w-0 rounded-2xl p-5')}
    >
      <CardHead
        id={titleId}
        title={t('fleet.custody.dashboard.topDrivers')}
        note={t('fleet.custody.dashboard.topDriversNote')}
        end={
          ranked.length > 0 ? (
            <span className={cn(TITLE_CHIP, NUM)}>
              {t('fleet.custody.dashboard.topCount', { count: COUNT.format(ranked.length) })}
            </span>
          ) : undefined
        }
      />
      <div className="space-y-3">
        {ranked.length === 0 ? (
          // A dealership bill names no driver, and a receipt may name none: nothing to rank.
          <p
            data-custody-no-drivers="true"
            className="py-4 text-center text-xs text-slate-500 dark:text-slate-400"
          >
            {t('fleet.custody.dashboard.noDrivers')}
          </p>
        ) : (
          <ol className="space-y-3" data-custody-top-drivers="true">
            {ranked.map((driver, i) => {
              const tone = CUSTODY_RINGS[i % CUSTODY_RINGS.length] ?? CUSTODY_RINGS[0];
              const pct = Math.min(100, custodySharePct(driver.total, receipts));
              const split = custodyTopKinds(driver);
              const { figure, currency } = money(driver.total);
              return (
                <li
                  key={driver.driverEmployeeId ?? `name:${driver.driverName}`}
                  tabIndex={0}
                  data-custody-driver={i}
                  aria-label={`${driver.driverName}: ${moneyText(driver.total)} (${custodyShare(driver.total, receipts)})${split
                    .map(
                      (kind) =>
                        `${sep}${kindName(t, kind)} ${custodyShare(driver[kind], driver.total)}`,
                    )
                    .join('')}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-2.5 outline-none transition hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-emerald-500/60 dark:border-slate-800/60 dark:bg-[#0c1322]/80 dark:hover:bg-slate-800/40"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="relative flex h-11 w-11 shrink-0 items-center justify-center">
                      <svg
                        className="h-full w-full -rotate-90"
                        viewBox="0 0 36 36"
                        aria-hidden="true"
                      >
                        <path
                          className="text-slate-200 dark:text-slate-800"
                          d={RING_PATH}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={3.5}
                        />
                        {pct > 0 && (
                          <path
                            data-custody-ring={i}
                            className={tone.ring}
                            d={RING_PATH}
                            fill="none"
                            stroke="currentColor"
                            strokeDasharray={`${Math.round(pct * 100) / 100}, 100`}
                            strokeLinecap="round"
                            strokeWidth={3.5}
                          />
                        )}
                      </svg>
                      <CustodyShare
                        part={driver.total}
                        whole={receipts}
                        className={cn('absolute text-[10px] font-bold', tone.label)}
                      />
                    </div>
                    <div className="min-w-0">
                      <p
                        title={driver.driverName}
                        className="truncate text-xs font-bold text-slate-900 dark:text-white"
                      >
                        {driver.driverName}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                        {split.map((kind, k) => (
                          <Fragment key={kind}>
                            {k > 0 && <span aria-hidden="true">•</span>}
                            <span
                              data-custody-driver-kind={kind}
                              className={
                                kind === 'wash' ? CUSTODY_KIND[kind].deep : CUSTODY_KIND[kind].text
                              }
                            >
                              {kindName(t, kind)}{' '}
                              <CustodyShare part={driver[kind]} whole={driver.total} />
                            </span>
                          </Fragment>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className={cn('shrink-0 text-end', NUM)}>
                    <span className="block text-xs font-bold text-slate-900 dark:text-white">
                      {figure}
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">
                      {currency}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {data.noDriver.count > 0 && (
          <div
            data-custody-no-driver="true"
            className="flex items-center justify-between gap-2 border-t border-slate-200 pt-2 text-[11px] text-slate-600 dark:border-slate-800 dark:text-slate-400"
          >
            <span>
              {t('fleet.custody.dashboard.noDriver')}{' '}
              <span className={NUM}>({COUNT.format(data.noDriver.count)})</span>
            </span>
            <span
              className={cn(
                'whitespace-nowrap font-bold text-slate-800 dark:font-semibold dark:text-slate-300',
                NUM,
              )}
            >
              {moneyText(data.noDriver.amount)}
            </span>
          </div>
        )}
      </div>
    </section>
  );
};

// ── «تفصيل استهلاك الوقود» ─────────────────────────────────────────────────────────────────────

/**
 * «تفاصيل استهلاك الوقود يتقسم اتنين وطنيه لوخدها وشيل اوت لوحدها»: the card's two companies in the
 * order the owner named them — وطنية, then شل أوت, as the design's own company boxes stood — and
 * both ALWAYS drawn, a company that sold nothing with its zeros.
 */
export const CUSTODY_FUEL_SPLIT: readonly FleetFuelCardCompany[] = FLEET_FUEL_CARD_COMPANIES;

/** Under a company: diesel first and lifted out, then بنزين 92, 95 and 80, no type last. */
const TYPE_ORDER: readonly (FleetFuelType | null)[] = [
  'diesel',
  'petrol92',
  'petrol95',
  'petrol80',
  null,
];
export const custodyFuelRows = <T extends { fuelType: FleetFuelType | null }>(
  types: readonly T[],
): T[] =>
  [...types].sort((a, b) => TYPE_ORDER.indexOf(a.fuelType) - TYPE_ORDER.indexOf(b.fuelType));

/**
 * (7) The fund's fuel split by «الشركة» — «وطنية» on its own and «شل أوت» on its own, each with its
 * money, litres, receipts and share of the fuel, and under it the types that company sold: diesel
 * first and lifted out («⭐ سولار (الأولوية الأولى)»), each with its share of THAT company. The
 * receipts that name no company («ومش عاوز اى داتا اجبارى») are a small box of their own, only
 * when they hold money — never folded into either company.
 */
export const CustodyFuelBreakdown = ({ data }: { data: FleetCustodyDashboardDto }): JSX.Element => {
  const t = useT();
  const moneyText = useMoneyText();
  const { count } = useCount();
  const titleId = useId();
  const none = data.fuelByCompany.none;
  const anyFuel = data.fuelTypes.length > 0;
  const litres = (value: number): string =>
    value > 0 ? `${LITRES.format(value)} ${t('fleet.custody.dashboard.litresUnit')}` : '—';
  const typeName = (type: FleetFuelType | null): string =>
    type === null ? t('fleet.custody.dashboard.noFuelType') : t(`fleet.receipts.fuelType.${type}`);

  /** A fuel type's row under its company — the card's own row, its share of that company. */
  const typeRow = (line: FleetCustodyFuelTypeShareDto, whole: number): JSX.Element => {
    const first = line.fuelType === 'diesel';
    const ninetyFive = line.fuelType === 'petrol95';
    return (
      <div
        key={line.fuelType ?? 'none'}
        data-custody-fuel-type={line.fuelType ?? 'none'}
        className={cn(
          'rounded-xl p-2.5',
          first
            ? 'border-2 border-amber-400 bg-amber-50/70 ring-2 ring-amber-200/50 dark:border dark:border-emerald-500/40 dark:bg-[#0c1322] dark:ring-1 dark:ring-emerald-500/20'
            : 'border border-slate-200 bg-white dark:border-amber-900/40 dark:bg-[#0c1322]',
        )}
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <span
            className={cn(
              'flex min-w-0 items-center gap-1 text-xs',
              first
                ? 'font-black text-amber-950 dark:font-bold dark:text-yellow-400'
                : cn(
                    'font-bold text-slate-900',
                    ninetyFive ? 'dark:text-orange-400' : 'dark:text-amber-300',
                  ),
            )}
          >
            {first ? (
              <>
                <span aria-hidden="true">⭐</span>
                <span>
                  {t('fleet.receipts.fuelType.diesel')} (
                  {t('fleet.custody.dashboard.firstPriority')})
                </span>
              </>
            ) : (
              typeName(line.fuelType)
            )}
          </span>
          <span
            className={cn(
              'whitespace-nowrap text-xs font-bold text-slate-900 dark:text-white',
              NUM,
            )}
          >
            {moneyText(line.amount)}
          </span>
        </div>
        <div className="flex flex-wrap justify-between gap-x-2 text-[11px] text-slate-600 dark:text-slate-400">
          <span>
            {t('fleet.custody.dashboard.quantity')}{' '}
            <strong className={cn('text-slate-900 dark:text-slate-200', NUM)}>
              {litres(line.litres)}
            </strong>
          </span>
          <span
            className={cn(
              'font-semibold',
              NUM,
              first
                ? 'text-amber-800 dark:text-yellow-400'
                : cn('text-amber-800', ninetyFive ? 'dark:text-orange-400' : 'dark:text-amber-400'),
            )}
          >
            {count('movement', line.count)} (<CustodyShare part={line.amount} whole={whole} />)
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800">
          <div
            className={cn(
              'h-full rounded-full',
              first
                ? 'bg-amber-500 dark:bg-yellow-400'
                : ninetyFive
                  ? 'bg-amber-600 dark:bg-orange-400'
                  : 'bg-amber-500 dark:bg-amber-400',
            )}
            style={{ width: `${Math.min(100, custodySharePct(line.amount, whole))}%` }}
          />
        </div>
      </div>
    );
  };

  /** «بلا نوع محدد» under a company — a line of its own, as the card has always written it. */
  const untypedLine = (line: FleetCustodyFuelTypeShareDto): JSX.Element => (
    <div
      key="untyped"
      data-custody-fuel-type="none"
      className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-2 text-[11px] dark:border-slate-800/80 dark:bg-[#0c1322]"
    >
      <span className="text-slate-600 dark:text-slate-400">{typeName(null)}</span>
      <span className={cn('whitespace-nowrap text-slate-800 dark:text-slate-300', NUM)}>
        {moneyText(line.amount)} ({count('movement', line.count)})
      </span>
    </div>
  );

  return (
    <section
      data-custody-dashboard-section="fuel"
      aria-labelledby={titleId}
      className={cn(CARD, 'min-w-0 rounded-2xl p-5')}
    >
      <CardHead
        id={titleId}
        title={t('fleet.custody.dashboard.fuelTitle')}
        note={t('fleet.custody.dashboard.fuelNote')}
        end={
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-600 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400">
            <BoardIcon d={BOLT} className="h-5 w-5" />
          </div>
        }
      />
      <div className="space-y-3">
        {custodyCompanies(data, CUSTODY_FUEL_SPLIT).map((group) => {
          const look = COMPANY[group.company];
          const headId = `${titleId}-${group.company}`;
          const rows = custodyFuelRows(group.types);
          return (
            <div
              key={group.company}
              role="group"
              aria-labelledby={headId}
              data-custody-fuel-company={group.company}
              className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-[#233552] dark:bg-[#090e18]"
            >
              <div
                data-custody-fuel-company-head={group.company}
                className={cn('rounded-lg border p-2.5', look.head)}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <h4
                    id={headId}
                    className={cn('flex items-center gap-1.5 text-xs font-bold', look.heading)}
                  >
                    <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', look.dot)} />
                    {companyName(t, group.company)}
                  </h4>
                  <span
                    data-custody-fuel-company-share={group.company}
                    className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold', look.pct)}
                  >
                    <CustodyShare part={group.amount} whole={data.fuel} />
                  </span>
                </div>
                <div
                  className={cn(
                    'text-sm font-black text-slate-900 dark:font-bold dark:text-white',
                    NUM,
                  )}
                >
                  {moneyText(group.amount)}
                </div>
                <div className="mt-1 flex flex-wrap justify-between gap-x-2 text-[11px] text-slate-600 dark:text-slate-400">
                  <span>
                    {t('fleet.custody.dashboard.quantity')}{' '}
                    <strong className={cn('text-slate-900 dark:text-slate-200', NUM)}>
                      {litres(group.litres)}
                    </strong>
                  </span>
                  <span className={NUM}>{count('movement', group.count)}</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className={cn('h-full rounded-full', look.bar)}
                    style={{ width: `${Math.min(100, custodySharePct(group.amount, data.fuel))}%` }}
                  />
                </div>
              </div>
              {rows.length > 0 ? (
                <div className="mt-2.5 space-y-2">
                  {rows.map((line) =>
                    line.fuelType === null ? untypedLine(line) : typeRow(line, group.amount),
                  )}
                </div>
              ) : (
                // Nothing from this company — said, not hidden: the owner wants both in view.
                anyFuel && (
                  <p
                    data-custody-fuel-company-empty={group.company}
                    className="pt-2.5 text-center text-[11px] text-slate-500 dark:text-slate-400"
                  >
                    {t('fleet.custody.dashboard.fuelCompanyEmpty')}
                  </p>
                )
              )}
            </div>
          );
        })}
        {/* «بدون شركة»: the receipts that name no company — only when they hold money, and
            never put on either company. */}
        {none.amount > 0 && (
          <div
            data-custody-fuel-company="none"
            className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-2.5 text-[11px] dark:border-slate-700 dark:bg-[#0c1322]"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                {t('fleet.receipts.fields.companyNone')}
              </span>
              <span
                className={cn(
                  'whitespace-nowrap font-bold text-slate-800 dark:text-slate-200',
                  NUM,
                )}
              >
                {moneyText(none.amount)}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap justify-between gap-x-2 text-slate-600 dark:text-slate-400">
              <span>
                {t('fleet.custody.dashboard.quantity')}{' '}
                <strong className={cn('text-slate-800 dark:text-slate-300', NUM)}>
                  {litres(none.litres)}
                </strong>
              </span>
              <span className={NUM}>
                {count('movement', none.count)} (
                <CustodyShare part={none.amount} whole={data.fuel} />)
              </span>
            </div>
            {none.types.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 border-t border-slate-200 pt-1.5 dark:border-slate-800">
                {custodyFuelRows(none.types).map((line) => (
                  <li
                    key={line.fuelType ?? 'none'}
                    data-custody-fuel-none-type={line.fuelType ?? 'none'}
                    className="flex justify-between gap-2 text-slate-600 dark:text-slate-400"
                  >
                    <span>{typeName(line.fuelType)}</span>
                    <span className={cn('whitespace-nowrap', NUM)}>
                      {moneyText(line.amount)} ({count('movement', line.count)})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {!anyFuel && (
          <p
            data-custody-no-fuel="true"
            className="py-2 text-center text-xs text-slate-500 dark:text-slate-400"
          >
            {t('fleet.custody.dashboard.noFuel')}
          </p>
        )}
      </div>
    </section>
  );
};
