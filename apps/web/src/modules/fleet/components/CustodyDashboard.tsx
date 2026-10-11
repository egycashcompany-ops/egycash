// «عاوز جمب الاحصائيات داش بورد تفتح ف الشاشه كلها زى موديل كل حاجة بالتفصيل» — the custody
// board's dashboard: a modal over the whole screen with everything about the fund's spend, over
// the board's OWN filters (the same `filters` object the figures read).
//
// Every number is the server's (`GET /fleet/custody/dashboard`), folded from the very movements
// `/summary` folds, so the dashboard and «الإحصائيات» never disagree. The browser only sorts, cuts
// to the ten highest and draws; a share is a ratio of two server numbers, a bar's length too.
//
// The charts are drawn the way Fleet draws its bars — Tailwind boxes, no chart library: they theme
// with `dark:`, mirror nothing they should not, and the node specs can render them. Each kind wears
// its colour from `CustodyKinds.tsx`, never its rank; every chart has a legend, a title, its values
// written out (a readout, a label, a table) and a «جدول» view, so colour is never the only key.
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  type FleetCustodyDashboardDto,
  type FleetCustodySource,
  type FleetCustodyTimeBucketDto,
  type FleetCustodyVehicleRowDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { cn } from '../../../shared/lib/cn';
import { formatMoneyParts } from '../../../shared/lib/format';
import { CloseIcon } from '../../../shared/ui/icons';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { useCustodyDashboard } from '../api/fleet-queries';
import { CustodyFigures } from './CustodyFigures';
import { CUSTODY_KIND, CUSTODY_KINDS, CUSTODY_TOTAL_TILE, CustodyKindSwatch } from './CustodyKinds';
import { FILTER_ICON } from './FilterWithIcon';
import { FigureChip } from './FleetFigures';
import { NUM, PATH, ymd } from './FuelCardBoard';

/** The board's filters, as `CustodyPage` builds them — the dashboard asks the same question. */
export interface CustodyDashboardFilters {
  from?: string | undefined;
  to?: string | undefined;
  vehicleCodes?: readonly string[] | undefined;
  source?: readonly string[] | undefined;
  driver?: string | undefined;
}

// Latin digits grouped with a comma, as the boards write a figure — `formatNumber` would give
// Arabic-Indic in Arabic, and «١٬٢٣٤» beside «1,234.00» reads as two different numbers.
const COUNT = new Intl.NumberFormat('en-US');
const LITRES = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** How many cars and drivers the bar charts rank; the tables below them hold every one. */
const TOP = 10;

/** «44%» — under one per cent but not nothing, «<1%»; of nothing, a dash. */
export const custodyShare = (part: number, whole: number): string => {
  if (whole <= 0) return '—';
  const pct = (part / whole) * 100;
  if (part > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
};

/** «2026/10» or «2026/10/04» — the board's own year-first writing of a period. */
export const custodyPeriod = (key: string): string => key.replace(/-/gu, '/');

/**
 * The value axis of «المصروف عبر الزمن»: round steps (1, 2, 2.5 or 5 of a power of ten), four or
 * so of them, the top one at or over the dearest stretch.
 */
export const custodyTicks = (max: number): number[] => {
  if (max <= 0) return [0];
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((nice) => nice * power).find((nice) => nice >= raw) ?? 10 * power;
  const ticks: number[] = [];
  for (let at = 0; at < max + step; at += step) {
    ticks.push(Math.round(at * 100) / 100);
    if (at >= max) break;
  }
  return ticks;
};

/** Which face the modal wears — a function, so the node specs can reach every branch. */
export type CustodyDashboardView = 'loading' | 'error' | 'empty' | 'ready';
export const custodyDashboardView = (query: {
  isPending: boolean;
  isError: boolean;
  data: FleetCustodyDashboardDto | undefined;
}): CustodyDashboardView => {
  if (query.data !== undefined) return query.data.count === 0 ? 'empty' : 'ready';
  if (query.isError) return 'error';
  return 'loading';
};

/** Is any of the board's filters set? */
export const custodyFiltered = (filters: CustodyDashboardFilters): boolean =>
  [filters.from, filters.to, filters.driver].some((value) => value !== undefined && value !== '') ||
  (filters.vehicleCodes ?? []).length > 0 ||
  (filters.source ?? []).length > 0;

/** The filters the dashboard was opened over, written as words for its header. */
export const custodyFilterChips = (
  filters: CustodyDashboardFilters,
  t: (key: string, params?: Record<string, string | number>) => string,
  locale: Locale,
): string[] => {
  const join = (parts: readonly string[]): string => parts.join(locale === 'ar' ? '، ' : ', ');
  const chips: string[] = [];
  if (filters.from !== undefined && filters.from !== '') {
    chips.push(t('fleet.custody.dashboard.filters.from', { date: ymd(filters.from) }));
  }
  if (filters.to !== undefined && filters.to !== '') {
    chips.push(t('fleet.custody.dashboard.filters.to', { date: ymd(filters.to) }));
  }
  const codes = filters.vehicleCodes ?? [];
  if (codes.length > 0) {
    chips.push(
      codes.length <= 6
        ? t('fleet.custody.dashboard.filters.cars', { codes: join(codes) })
        : t('fleet.custody.dashboard.filters.carCount', { count: COUNT.format(codes.length) }),
    );
  }
  const kinds = filters.source ?? [];
  if (kinds.length > 0) {
    chips.push(
      t('fleet.custody.dashboard.filters.kinds', {
        kinds: join(kinds.map((kind) => t(`fleet.custody.source.${kind}`))),
      }),
    );
  }
  if (filters.driver !== undefined && filters.driver !== '') {
    chips.push(t('fleet.custody.dashboard.filters.driver', { name: filters.driver }));
  }
  return chips.length === 0 ? [t('fleet.custody.dashboard.filters.none')] : chips;
};

// ── Small pieces ─────────────────────────────────────────────────────────────────────────────

/** «1,037.10» and «ج.م.» apart, as the board writes money. */
const Money = ({ value, strong = false }: { value: number; strong?: boolean }): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { figure, currency } = formatMoneyParts(value, 'EGP', locale);
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span
        className={cn(
          NUM,
          strong
            ? 'font-bold text-slate-900 dark:text-white'
            : 'text-slate-700 dark:text-slate-200',
        )}
      >
        {figure}
      </span>
      <span className="text-xs text-slate-500 dark:text-slate-400">{currency}</span>
    </span>
  );
};

/** The same, as words — for a label read aloud. */
const useMoneyText = (): ((value: number) => string) => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (value) => {
    const { figure, currency } = formatMoneyParts(value, 'EGP', locale);
    return `${figure} ${currency}`;
  };
};

/** The list separator a label read aloud uses — «، » in Arabic. */
const useSeparator = (): string =>
  useAppSelector((state): Locale => state.locale.locale) === 'ar' ? '، ' : ', ';

/** A chart's card: the title is the figure's caption; a control may sit beside it. */
const Panel = ({
  id,
  title,
  note,
  action,
  className,
  children,
}: {
  id: string;
  title: string;
  note?: string | undefined;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}): JSX.Element => (
  <figure
    data-custody-dashboard-section={id}
    className={cn(
      'm-0 min-w-0 rounded-xl border border-slate-200 bg-white p-3 sm:p-4 dark:border-slate-800 dark:bg-[#111827]',
      className,
    )}
  >
    <figcaption className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <span className="min-w-0">
        <span className="block text-sm font-bold text-slate-800 dark:text-slate-100">{title}</span>
        {note !== undefined && (
          <span className="block text-xs text-slate-500 dark:text-slate-400">{note}</span>
        )}
      </span>
      {action}
    </figcaption>
    {children}
  </figure>
);

/** The legend every chart with more than one kind carries — swatch, then the name in text ink. */
const KindLegend = ({ kinds }: { kinds: readonly FleetCustodySource[] }): JSX.Element => {
  const t = useT();
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" data-custody-legend="true">
      {kinds.map((kind) => (
        <li key={kind} className="inline-flex items-center gap-1.5">
          <CustodyKindSwatch kind={kind} />
          <span className="text-slate-600 dark:text-slate-300">
            {t(`fleet.custody.source.${kind}`)}
          </span>
        </li>
      ))}
    </ul>
  );
};

/** «جدول» / «رسم» — pressed, it wears the brand, as every picked control does. */
const ViewToggle = ({
  table,
  onToggle,
  name,
}: {
  table: boolean;
  onToggle: () => void;
  name: string;
}): JSX.Element => {
  const t = useT();
  return (
    <button
      type="button"
      aria-pressed={table}
      data-custody-view-toggle={name}
      onClick={onToggle}
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-bold transition active:scale-95',
        table
          ? 'border-brand-500/50 bg-brand-500/15 text-brand-700 dark:text-brand-200'
          : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
      )}
    >
      {table ? t('fleet.custody.dashboard.showChart') : t('fleet.custody.dashboard.showTable')}
    </button>
  );
};

/** A tooltip row: a short stroke of the kind's colour, the value first, the name after it. */
const TipRow = ({ kind, value }: { kind: FleetCustodySource; value: number }): JSX.Element => {
  const t = useT();
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className={cn('h-0.5 w-3 rounded-full', CUSTODY_KIND[kind].fill)} />
      <Money value={value} strong />
      <span className="text-slate-500 dark:text-slate-400">
        {t(`fleet.custody.source.${kind}`)}
      </span>
    </span>
  );
};

/** The hover / focus card of a bar — every kind of it, never the only place a value is written. */
const Tip = ({ children }: { children: ReactNode }): JSX.Element => (
  <span
    aria-hidden="true"
    className="pointer-events-none absolute start-0 top-full z-20 mt-1 hidden min-w-max flex-col gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg group-hover:flex group-focus-visible:flex dark:border-slate-700 dark:bg-slate-900"
  >
    {children}
  </span>
);

/**
 * One horizontal bar stacked by kind: 2px of surface between the parts, the far end rounded, the
 * start square on the baseline. `scale` is the longest bar's total, so bars compare.
 */
const StackedBar = ({
  parts,
  total,
  scale,
}: {
  parts: readonly { kind: FleetCustodySource; value: number }[];
  total: number;
  scale: number;
}): JSX.Element => (
  <span className="flex h-4 min-w-0 flex-1 items-center">
    <span
      className="flex h-full gap-0.5 overflow-hidden rounded-e-[4px]"
      style={{ width: `${scale <= 0 ? 0 : (total / scale) * 100}%` }}
    >
      {parts
        .filter((part) => part.value > 0)
        .map((part) => (
          <span
            key={part.kind}
            data-custody-mark={part.kind}
            className={cn('h-full min-w-[2px]', CUSTODY_KIND[part.kind].fill)}
            style={{ flexGrow: part.value, flexBasis: 0 }}
          />
        ))}
    </span>
  </span>
);

const thClass =
  'whitespace-nowrap px-2 py-2 text-center text-xs font-bold text-slate-600 dark:text-slate-300';
const tdClass = 'whitespace-nowrap px-2 py-1.5 text-center';
const DASH = <span className="text-slate-400">—</span>;
const moneyOrDash = (value: number): JSX.Element => (value === 0 ? DASH : <Money value={value} />);

/** A kind's column head: its swatch beside its name. */
const KindHead = ({ kind }: { kind: FleetCustodySource }): JSX.Element => {
  const t = useT();
  return (
    <th scope="col" className={thClass}>
      <span className="inline-flex items-center gap-1.5">
        <CustodyKindSwatch kind={kind} />
        {t(`fleet.custody.source.${kind}`)}
      </span>
    </th>
  );
};

const TableFrame = ({ children, label }: { children: ReactNode; label: string }): JSX.Element => (
  <div className="max-w-full overflow-x-auto rounded-lg border border-slate-100 dark:border-slate-800">
    <table aria-label={label} className="w-full border-collapse text-sm">
      {children}
    </table>
  </div>
);

// ── The sections ────────────────────────────────────────────────────────────────────────────

/** (1) The figures — the board's five, then how many movements, cars and litres. */
const Headline = ({ data }: { data: FleetCustodyDashboardDto }): JSX.Element => {
  const t = useT();
  return (
    <div className="flex flex-col gap-3" data-custody-dashboard-section="figures">
      <CustodyFigures totals={data} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FigureChip
          icon={PATH.trend}
          iconClass={CUSTODY_TOTAL_TILE}
          label={t('fleet.custody.dashboard.kpi.movements')}
          value={COUNT.format(data.count)}
          unit={t('fleet.custody.dashboard.kpi.movementsUnit')}
        />
        <FigureChip
          icon={FILTER_ICON.plate}
          iconClass={CUSTODY_TOTAL_TILE}
          label={t('fleet.custody.dashboard.kpi.cars')}
          value={COUNT.format(data.vehicleCount)}
          unit={t('fleet.custody.dashboard.kpi.carsUnit')}
        />
        <FigureChip
          icon={CUSTODY_KIND.fuel.icon}
          iconClass={CUSTODY_TOTAL_TILE}
          label={t('fleet.custody.dashboard.kpi.litres')}
          value={LITRES.format(data.litres)}
          unit={t('fleet.custody.dashboard.litresUnit')}
          {...(data.litresMissing > 0
            ? {
                note: t('fleet.custody.dashboard.litresMissing', {
                  count: COUNT.format(data.litresMissing),
                }),
              }
            : {})}
        />
      </div>
    </div>
  );
};

/** (2) «حسب النوع» — one bar of the whole, its legend as a table; then «حسب المصدر». */
const ByKind = ({ data }: { data: FleetCustodyDashboardDto }): JSX.Element => {
  const t = useT();
  const moneyText = useMoneyText();
  const sep = useSeparator();
  const present = CUSTODY_KINDS.filter((kind) => data[kind] > 0);
  const receipts = data.bySource.find((line) => line.ref === 'receipt');
  const bills = data.bySource.find((line) => line.ref === 'dealershipInvoice');
  return (
    <Panel id="byKind" title={t('fleet.custody.dashboard.byKind')}>
      {/* The whole as one bar, 24px tall, the kinds in their fixed order. */}
      <div
        role="img"
        aria-label={present
          .map(
            (kind) =>
              `${t(`fleet.custody.source.${kind}`)}: ${moneyText(data[kind])} (${custodyShare(data[kind], data.total)})`,
          )
          .join(sep)}
        className="mb-3 flex h-6 gap-0.5"
        data-custody-kind-bar="true"
      >
        {present.map((kind, i) => (
          <span
            key={kind}
            data-custody-mark={kind}
            className={cn(
              'h-full min-w-[2px]',
              CUSTODY_KIND[kind].fill,
              i === 0 && 'rounded-s-[4px]',
              i === present.length - 1 && 'rounded-e-[4px]',
            )}
            style={{ flexGrow: data[kind], flexBasis: 0 }}
          />
        ))}
      </div>
      <TableFrame label={t('fleet.custody.dashboard.byKind')}>
        <thead className="bg-slate-50 dark:bg-[#0c121e]">
          <tr>
            <th scope="col" className={thClass}>
              {t('fleet.custody.dashboard.columns.kind')}
            </th>
            <th scope="col" className={thClass}>
              {t('fleet.custody.dashboard.columns.amount')}
            </th>
            <th scope="col" className={thClass}>
              {t('fleet.custody.dashboard.columns.share')}
            </th>
            <th scope="col" className={thClass}>
              {t('fleet.custody.dashboard.columns.count')}
            </th>
          </tr>
        </thead>
        <tbody>
          {CUSTODY_KINDS.map((kind) => (
            <tr
              key={kind}
              data-custody-kind-row={kind}
              className="border-t border-slate-100 dark:border-slate-800"
            >
              <td className={tdClass}>
                <span className="inline-flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200">
                  <CustodyKindSwatch kind={kind} />
                  {t(`fleet.custody.source.${kind}`)}
                </span>
              </td>
              <td className={tdClass}>{moneyOrDash(data[kind])}</td>
              <td className={cn(tdClass, NUM)}>{custodyShare(data[kind], data.total)}</td>
              <td className={cn(tdClass, NUM)}>{COUNT.format(data.counts[kind])}</td>
            </tr>
          ))}
        </tbody>
      </TableFrame>

      {/* «حسب المصدر»: the receipts screen (its three kinds) beside the dealership's bills. */}
      <div className="mt-4" data-custody-by-source="true">
        <div className="mb-2 text-xs font-bold text-slate-700 dark:text-slate-200">
          {t('fleet.custody.dashboard.bySource')}
        </div>
        <ul className="flex flex-col gap-2">
          {[
            {
              ref: 'receipt' as const,
              line: receipts,
              parts: (['fuel', 'tyres', 'wash'] as const).map((kind) => ({
                kind,
                value: data[kind],
              })),
            },
            {
              ref: 'dealershipInvoice' as const,
              line: bills,
              parts: [{ kind: 'dealership' as const, value: data.dealership }],
            },
          ].map(({ ref, line, parts }) => (
            <li
              key={ref}
              data-custody-source-row={ref}
              className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-xs sm:grid-cols-[14rem_1fr_auto]"
            >
              <span className="col-span-2 font-semibold text-slate-700 sm:col-span-1 dark:text-slate-200">
                {t(`fleet.custody.from.${ref}`)}
                <span className={cn('ms-1 font-normal text-slate-500 dark:text-slate-400', NUM)}>
                  ({COUNT.format(line?.count ?? 0)})
                </span>
              </span>
              <StackedBar parts={parts} total={line?.amount ?? 0} scale={data.total} />
              <Money value={line?.amount ?? 0} strong />
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
};

/** (3) «المصروف عبر الزمن» — a column a stretch, stacked by kind, oldest on the left. */
const Timeline = ({ data }: { data: FleetCustodyDashboardDto }): JSX.Element => {
  const t = useT();
  const moneyText = useMoneyText();
  const sep = useSeparator();
  const { buckets, granularity } = data.timeline;
  const [table, setTable] = useState(false);
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
  const max = buckets.reduce((top, bucket) => Math.max(top, bucket.total), 0);
  const ticks = custodyTicks(max);
  const top = ticks[ticks.length - 1] ?? 0;
  const peak = buckets.findIndex((bucket) => bucket.total === max && max > 0);
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
    <Panel
      id="timeline"
      title={t('fleet.custody.dashboard.timeline')}
      note={day ? t('fleet.custody.dashboard.byDay') : t('fleet.custody.dashboard.byMonth')}
      action={<ViewToggle name="timeline" table={table} onToggle={() => setTable((on) => !on)} />}
    >
      <KindLegend kinds={CUSTODY_KINDS} />
      {table ? (
        <TableFrame label={t('fleet.custody.dashboard.timeline')}>
          <thead className="bg-slate-50 dark:bg-[#0c121e]">
            <tr>
              <th scope="col" className={thClass}>
                {t('fleet.custody.dashboard.columns.period')}
              </th>
              {CUSTODY_KINDS.map((kind) => (
                <KindHead key={kind} kind={kind} />
              ))}
              <th scope="col" className={thClass}>
                {t('fleet.custody.dashboard.columns.total')}
              </th>
              <th scope="col" className={thClass}>
                {t('fleet.custody.dashboard.columns.count')}
              </th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <tr key={bucket.key} className="border-t border-slate-100 dark:border-slate-800">
                <td className={cn(tdClass, NUM)} dir="ltr">
                  {custodyPeriod(bucket.key)}
                </td>
                {CUSTODY_KINDS.map((kind) => (
                  <td key={kind} className={tdClass}>
                    {moneyOrDash(bucket[kind])}
                  </td>
                ))}
                <td className={tdClass}>
                  {bucket.total === 0 ? DASH : <Money value={bucket.total} strong />}
                </td>
                <td className={cn(tdClass, NUM)}>{COUNT.format(bucket.count)}</td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      ) : (
        <>
          {/* The readout: one stretch, every kind of it, the value before the name. */}
          {shown !== undefined && (
            <div
              aria-live="polite"
              data-custody-readout="true"
              className="mb-2 flex min-h-[2.5rem] flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-1.5 text-xs dark:bg-[#0c121e]"
            >
              <span className={cn('font-bold text-slate-800 dark:text-slate-100', NUM)} dir="ltr">
                {custodyPeriod(shown.key)}
              </span>
              <Money value={shown.total} strong />
              {CUSTODY_KINDS.filter((kind) => shown[kind] > 0).map((kind) => (
                <TipRow key={kind} kind={kind} value={shown[kind]} />
              ))}
              <span className={cn('text-slate-500 dark:text-slate-400', NUM)}>
                {COUNT.format(shown.count)} {t('fleet.custody.dashboard.kpi.movementsUnit')}
              </span>
            </div>
          )}
          {/* Time runs left to right whatever the page's direction; the plot scrolls inside its
              card on a phone rather than squeezing a month of days into it. */}
          <div ref={scrollRef} className="overflow-x-auto pb-1" dir="ltr">
            <div
              className="flex"
              style={{ minWidth: `${buckets.length * (day ? 18 : 30) + 40}px` }}
            >
              {/* The value axis: round, compact, recessive. */}
              <div className="relative me-1 h-[200px] w-9 shrink-0 mt-5" aria-hidden="true">
                {ticks.map((tick) => (
                  <span
                    key={tick}
                    className={cn(
                      'absolute end-0 translate-y-1/2 text-[10px] text-slate-400 dark:text-slate-500',
                      NUM,
                    )}
                    style={{ bottom: `${top === 0 ? 0 : (tick / top) * 100}%` }}
                  >
                    {COMPACT.format(tick)}
                  </span>
                ))}
              </div>
              <div className="min-w-0 flex-1">
                <div className="relative mt-5 h-[200px]">
                  {/* Hairline grid, solid, one step off the surface. */}
                  {ticks.map((tick) => (
                    <span
                      key={tick}
                      aria-hidden="true"
                      className={cn(
                        'absolute inset-x-0 h-px',
                        tick === 0
                          ? 'bg-slate-300 dark:bg-slate-600'
                          : 'bg-slate-100 dark:bg-slate-800',
                      )}
                      style={{ bottom: `${top === 0 ? 0 : (tick / top) * 100}%` }}
                    />
                  ))}
                  <div
                    ref={plotRef}
                    role="group"
                    aria-label={t('fleet.custody.dashboard.timeline')}
                    onKeyDown={onPlotKey}
                    className="absolute inset-0 flex items-end"
                  >
                    {buckets.map((bucket, i) => {
                      const kinds = CUSTODY_KINDS.filter((kind) => bucket[kind] > 0);
                      return (
                        <div
                          key={bucket.key}
                          data-custody-column={i}
                          tabIndex={i === active ? 0 : -1}
                          aria-label={`${custodyPeriod(bucket.key)}: ${moneyText(bucket.total)}${kinds
                            .map(
                              (kind) =>
                                `${sep}${t(`fleet.custody.source.${kind}`)} ${moneyText(bucket[kind])}`,
                            )
                            .join('')}`}
                          onMouseEnter={() => setActive(i)}
                          onFocus={() => setActive(i)}
                          className={cn(
                            'group relative flex h-full flex-1 cursor-default flex-col items-center justify-end rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60',
                            i === active && 'bg-slate-500/5',
                          )}
                        >
                          {/* The dearest stretch carries its total on its cap. */}
                          {i === peak && (
                            <span
                              className={cn(
                                'absolute whitespace-nowrap text-[10px] font-bold text-slate-700 dark:text-slate-200',
                                NUM,
                              )}
                              style={{ bottom: `calc(${(bucket.total / top) * 100}% + 2px)` }}
                              data-custody-peak="true"
                            >
                              {WHOLE.format(bucket.total)}
                            </span>
                          )}
                          <div
                            className="flex w-full max-w-[24px] flex-col-reverse gap-0.5 transition-opacity group-hover:opacity-90"
                            style={{ height: `${top === 0 ? 0 : (bucket.total / top) * 100}%` }}
                          >
                            {kinds.map((kind, k) => (
                              <span
                                key={kind}
                                data-custody-mark={kind}
                                className={cn(
                                  'w-full',
                                  CUSTODY_KIND[kind].fill,
                                  k === kinds.length - 1 && 'rounded-t-[4px]',
                                )}
                                style={{ flexGrow: bucket[kind], flexBasis: 0 }}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {/* The period under each column, sparing on a long run. */}
                <div className="flex" aria-hidden="true">
                  {buckets.map((bucket, i) => {
                    const label = i % every === 0 || i === buckets.length - 1;
                    const second = secondLine(bucket.key, i);
                    return (
                      <span
                        key={bucket.key}
                        className={cn(
                          'flex-1 pt-1 text-center text-[10px] leading-tight text-slate-500 dark:text-slate-400',
                          NUM,
                        )}
                      >
                        {label ? firstLine(bucket.key) : ''}
                        {second !== null && (
                          <span className="block whitespace-nowrap text-slate-400 dark:text-slate-500">
                            {second}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
};

/** One ranked line — a car or a driver — with its bar stacked by kind and its total at the end. */
const RankRow = ({
  name,
  label,
  parts,
  total,
  scale,
  count,
  wide,
}: {
  name: ReactNode;
  /** Whose line it is, as words — the row is read aloud by its label, so the name leads it. */
  label: string;
  parts: readonly { kind: FleetCustodySource; value: number }[];
  total: number;
  scale: number;
  count?: number;
  wide: boolean;
}): JSX.Element => {
  const moneyText = useMoneyText();
  const sep = useSeparator();
  const t = useT();
  const present = parts.filter((part) => part.value > 0);
  return (
    <li
      tabIndex={0}
      aria-label={`${label}: ${moneyText(total)}${present
        .map((part) => `${sep}${t(`fleet.custody.source.${part.kind}`)} ${moneyText(part.value)}`)
        .join('')}`}
      className={cn(
        'group relative grid items-center gap-x-3 gap-y-1 rounded-md px-1 py-1 text-xs outline-none hover:bg-slate-500/5 focus-visible:ring-2 focus-visible:ring-brand-500/60',
        wide ? 'grid-cols-[1fr_auto] sm:grid-cols-[12rem_1fr_auto]' : 'grid-cols-[4.5rem_1fr_auto]',
      )}
    >
      <span className={cn('min-w-0', wide && 'col-span-2 sm:col-span-1')}>{name}</span>
      <StackedBar parts={parts} total={total} scale={scale} />
      <Money value={total} strong />
      <Tip>
        {present.map((part) => (
          <TipRow key={part.kind} kind={part.kind} value={part.value} />
        ))}
        {count !== undefined && (
          <span className={cn('text-slate-500 dark:text-slate-400', NUM)}>
            {COUNT.format(count)} {t('fleet.custody.dashboard.kpi.movementsUnit')}
          </span>
        )}
      </Tip>
    </li>
  );
};

/** The car's code as the board writes it — bold, left to right. */
const Code = ({ code }: { code: string | null }): JSX.Element =>
  code === null ? (
    DASH
  ) : (
    <span dir="ltr" className={cn('text-sm font-bold text-slate-900 dark:text-white', NUM)}>
      {code}
    </span>
  );

/** (4) «أعلى السيارات صرفًا» — the ten dearest of the per-car lines, stacked by kind. */
const TopCars = ({ data }: { data: FleetCustodyDashboardDto }): JSX.Element => {
  const t = useT();
  const ranked = [...data.vehicles].sort((a, b) => b.total - a.total).slice(0, TOP);
  const scale = ranked[0]?.total ?? 0;
  return (
    <Panel
      id="topCars"
      title={t('fleet.custody.dashboard.topCars')}
      note={t('fleet.custody.dashboard.topCount', { count: COUNT.format(ranked.length) })}
    >
      <KindLegend kinds={CUSTODY_KINDS} />
      <ol className="flex flex-col gap-1" data-custody-top-cars="true">
        {ranked.map((car) => (
          <RankRow
            key={car.vehicleId ?? `code:${car.vehicleCode ?? ''}`}
            name={<Code code={car.vehicleCode} />}
            label={car.vehicleCode ?? '—'}
            parts={CUSTODY_KINDS.map((kind) => ({ kind, value: car[kind] }))}
            total={car.total}
            scale={scale}
            wide={false}
          />
        ))}
      </ol>
    </Panel>
  );
};

/** (5) «أعلى السائقين صرفًا» — the receipts' drivers (a bill names none), whole names. */
const TopDrivers = ({ data }: { data: FleetCustodyDashboardDto }): JSX.Element => {
  const t = useT();
  const [table, setTable] = useState(false);
  const kinds = ['fuel', 'tyres', 'wash'] as const;
  const ranked = data.drivers.slice(0, TOP);
  const scale = ranked[0]?.total ?? 0;
  return (
    <Panel
      id="topDrivers"
      title={t('fleet.custody.dashboard.topDrivers')}
      note={
        table || ranked.length === 0
          ? undefined
          : t('fleet.custody.dashboard.topCount', { count: COUNT.format(ranked.length) })
      }
      action={
        data.drivers.length > 0 ? (
          <ViewToggle name="drivers" table={table} onToggle={() => setTable((on) => !on)} />
        ) : undefined
      }
    >
      {ranked.length === 0 ? (
        // A dealership bill names no driver, and a receipt may name none: nothing to rank.
        <p
          data-custody-no-drivers="true"
          className="py-4 text-center text-xs text-slate-500 dark:text-slate-400"
        >
          {t('fleet.custody.dashboard.noDrivers')}
        </p>
      ) : table ? (
        <TableFrame label={t('fleet.custody.dashboard.topDrivers')}>
          <thead className="bg-slate-50 dark:bg-[#0c121e]">
            <tr>
              <th scope="col" className={thClass}>
                {t('fleet.custody.dashboard.columns.driver')}
              </th>
              {kinds.map((kind) => (
                <KindHead key={kind} kind={kind} />
              ))}
              <th scope="col" className={thClass}>
                {t('fleet.custody.dashboard.columns.total')}
              </th>
              <th scope="col" className={thClass}>
                {t('fleet.custody.dashboard.columns.count')}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.drivers.map((driver) => (
              <tr
                key={driver.driverEmployeeId ?? `name:${driver.driverName}`}
                className="border-t border-slate-100 dark:border-slate-800"
              >
                <td
                  className={cn(
                    tdClass,
                    'whitespace-normal font-semibold text-slate-800 dark:text-slate-100',
                  )}
                >
                  {driver.driverName}
                </td>
                {kinds.map((kind) => (
                  <td key={kind} className={tdClass}>
                    {moneyOrDash(driver[kind])}
                  </td>
                ))}
                <td className={tdClass}>
                  <Money value={driver.total} strong />
                </td>
                <td className={cn(tdClass, NUM)}>{COUNT.format(driver.count)}</td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      ) : (
        <>
          <KindLegend kinds={kinds} />
          <ol className="flex flex-col gap-1" data-custody-top-drivers="true">
            {ranked.map((driver) => (
              <RankRow
                key={driver.driverEmployeeId ?? `name:${driver.driverName}`}
                name={
                  <span className="font-semibold text-slate-800 dark:text-slate-100">
                    {driver.driverName}
                  </span>
                }
                label={driver.driverName}
                parts={kinds.map((kind) => ({ kind, value: driver[kind] }))}
                total={driver.total}
                scale={scale}
                count={driver.count}
                wide
              />
            ))}
          </ol>
        </>
      )}
      {data.noDriver.count > 0 && (
        <div
          data-custody-no-driver="true"
          className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs dark:border-slate-800"
        >
          <span className="text-slate-600 dark:text-slate-300">
            {t('fleet.custody.dashboard.noDriver')}
            <span className={cn('ms-1 text-slate-500 dark:text-slate-400', NUM)}>
              ({COUNT.format(data.noDriver.count)})
            </span>
          </span>
          <Money value={data.noDriver.amount} strong />
        </div>
      )}
    </Panel>
  );
};

/** (6) «الوقود» — the litres, and each fuel type's receipts, sum and litres. */
const Fuel = ({ data }: { data: FleetCustodyDashboardDto }): JSX.Element => {
  const t = useT();
  const scale = data.fuelTypes.reduce((top, line) => Math.max(top, line.amount), 0);
  return (
    <Panel
      id="fuel"
      title={t('fleet.custody.dashboard.fuel')}
      note={
        data.litresMissing > 0
          ? t('fleet.custody.dashboard.litresMissing', { count: COUNT.format(data.litresMissing) })
          : undefined
      }
    >
      <div className="mb-3 flex items-baseline gap-1.5">
        <span className={cn('text-2xl font-black text-slate-900 dark:text-white', NUM)}>
          {LITRES.format(data.litres)}
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {t('fleet.custody.dashboard.litresUnit')}
        </span>
      </div>
      <TableFrame label={t('fleet.custody.dashboard.fuel')}>
        <thead className="bg-slate-50 dark:bg-[#0c121e]">
          <tr>
            <th scope="col" className={thClass}>
              {t('fleet.custody.dashboard.columns.fuelType')}
            </th>
            <th scope="col" className={thClass}>
              {t('fleet.custody.dashboard.columns.amount')}
            </th>
            <th scope="col" className={thClass}>
              {t('fleet.custody.dashboard.columns.litres')}
            </th>
            <th scope="col" className={thClass}>
              {t('fleet.custody.dashboard.columns.count')}
            </th>
          </tr>
        </thead>
        <tbody>
          {data.fuelTypes.map((line) => (
            <tr
              key={line.fuelType ?? 'none'}
              data-custody-fuel-type={line.fuelType ?? 'none'}
              className="border-t border-slate-100 dark:border-slate-800"
            >
              <td className={cn(tdClass, 'font-semibold text-slate-700 dark:text-slate-200')}>
                {line.fuelType === null
                  ? t('fleet.custody.dashboard.noFuelType')
                  : t(`fleet.receipts.fuelType.${line.fuelType}`)}
              </td>
              <td className={tdClass}>
                {/* One kind, one colour: the fuel's own, as a meter of the dearest type. */}
                <span className="flex items-center justify-center gap-2">
                  <span className="hidden h-2 w-16 sm:inline-flex" aria-hidden="true">
                    <span
                      className={cn('h-full rounded-e-[4px]', CUSTODY_KIND.fuel.fill)}
                      style={{ width: `${scale <= 0 ? 0 : (line.amount / scale) * 100}%` }}
                    />
                  </span>
                  <Money value={line.amount} />
                </span>
              </td>
              <td className={cn(tdClass, NUM)}>{LITRES.format(line.litres)}</td>
              <td className={cn(tdClass, NUM)}>{COUNT.format(line.count)}</td>
            </tr>
          ))}
          {data.fuelTypes.length === 0 && (
            <tr>
              <td colSpan={4} className={cn(tdClass, 'text-slate-400')}>
                —
              </td>
            </tr>
          )}
        </tbody>
      </TableFrame>
    </Panel>
  );
};

/** (7) «ملخص لكل سيارة» — every car, every kind, its total and its share; the grand total last. */
const PerCar = ({ data }: { data: FleetCustodyDashboardDto }): JSX.Element => {
  const t = useT();
  const rows: FleetCustodyVehicleRowDto[] = [...data.vehicles].sort((a, b) => b.total - a.total);
  return (
    <Panel id="perVehicle" title={t('fleet.custody.perVehicle')}>
      <TableFrame label={t('fleet.custody.perVehicle')}>
        <thead className="sticky top-0 bg-slate-50 dark:bg-[#0c121e]">
          <tr>
            <th scope="col" className={thClass}>
              {t('fleet.custody.dashboard.columns.car')}
            </th>
            {CUSTODY_KINDS.map((kind) => (
              <KindHead key={kind} kind={kind} />
            ))}
            <th scope="col" className={thClass}>
              {t('fleet.custody.dashboard.columns.total')}
            </th>
            <th scope="col" className={thClass}>
              {t('fleet.custody.dashboard.columns.share')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((car) => (
            <tr
              key={car.vehicleId ?? `code:${car.vehicleCode ?? ''}`}
              className="border-t border-slate-100 dark:border-slate-800"
            >
              <td className={tdClass}>
                <Code code={car.vehicleCode} />
              </td>
              {CUSTODY_KINDS.map((kind) => (
                <td key={kind} className={tdClass}>
                  {moneyOrDash(car[kind])}
                </td>
              ))}
              <td className={tdClass}>
                <Money value={car.total} strong />
              </td>
              <td className={cn(tdClass, NUM)}>{custodyShare(car.total, data.total)}</td>
            </tr>
          ))}
          <tr
            data-custody-dashboard-grand-total="true"
            className="border-t border-slate-200 bg-slate-100 font-bold dark:border-slate-700 dark:bg-[#0c121e]"
          >
            <td className={cn(tdClass, 'text-slate-800 dark:text-slate-100')}>
              {t('fleet.custody.grandTotal')}
            </td>
            {CUSTODY_KINDS.map((kind) => (
              <td key={kind} className={tdClass}>
                <Money value={data[kind]} strong />
              </td>
            ))}
            <td className={tdClass}>
              <Money value={data.total} strong />
            </td>
            <td className={cn(tdClass, NUM)}>{custodyShare(data.total, data.total)}</td>
          </tr>
        </tbody>
      </TableFrame>
    </Panel>
  );
};

/** Everything the dashboard shows of a READY answer — pure, so the node specs can render it. */
export const CustodyDashboardBody = ({ data }: { data: FleetCustodyDashboardDto }): JSX.Element => (
  <div className="flex flex-col gap-3 sm:gap-4" data-custody-dashboard-body="true">
    <Headline data={data} />
    <div className="grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <ByKind data={data} />
      <Timeline data={data} />
    </div>
    <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
      <TopCars data={data} />
      <TopDrivers data={data} />
    </div>
    <div className="grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <Fuel data={data} />
      <PerCar data={data} />
    </div>
  </div>
);

/** Loading: the frame of the body, shimmering — no layout jump when the answer lands. */
const BodySkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-4" data-custody-dashboard-loading="true">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton
          key={i}
          className={cn('h-[68px] rounded-xl', i === 0 && 'col-span-2 lg:col-span-1')}
        />
      ))}
    </div>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_3fr]">
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-72 rounded-xl" />
    </div>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  </div>
);

/** What fills the modal for each face of the query. */
export const CustodyDashboardContent = ({
  view,
  data,
  error,
  onRetry,
  filtered = false,
}: {
  view: CustodyDashboardView;
  data: FleetCustodyDashboardDto | undefined;
  error: unknown;
  onRetry: () => void;
  /** Opened over a filter: nothing matching it is not «nothing taken from the fund yet». */
  filtered?: boolean;
}): JSX.Element => {
  const t = useT();
  if (view === 'loading') return <BodySkeleton />;
  if (view === 'empty') {
    return (
      <EmptyState
        title={filtered ? t('fleet.violations.report.empty') : t('fleet.custody.empty')}
      />
    );
  }
  if (view === 'error' || data === undefined) return <ErrorState error={error} onRetry={onRetry} />;
  return <CustodyDashboardBody data={data} />;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Where the focus goes so it never leaves the modal — `null` lets Tab move it as usual. On the
 * first stop Shift+Tab rounds to the last, on the last Tab rounds to the first; and focus that
 * reached the page behind anyway (a click on plain text sets Tab's starting point there, past the
 * last stop or before the first) comes back in at the end Tab was heading for.
 */
export const custodyTrapFocus = <T,>(move: {
  back: boolean;
  active: T | null;
  first: T;
  last: T;
  inside: boolean;
}): T | null => {
  if (!move.inside) return move.back ? move.last : move.first;
  if (move.back && move.active === move.first) return move.last;
  if (!move.back && move.active === move.last) return move.first;
  return null;
};

/**
 * The modal itself: over the whole screen, in a portal; Escape or × closes it, Tab stays inside,
 * the page behind does not scroll, and the focus goes back to «لوحة تحكم» on the way out. Read only
 * while open.
 */
export const CustodyDashboard = ({
  open,
  onClose,
  filters,
}: {
  open: boolean;
  onClose: () => void;
  filters: CustodyDashboardFilters;
}): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
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
      if (e.key === 'Escape') {
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
  const chips = custodyFilterChips(filters, t, locale);
  return createPortal(
    <div className="fixed inset-0 z-[90]" data-custody-dashboard="true">
      <div className="absolute inset-0 animate-fade-in bg-slate-900/50" aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full w-full animate-pop-in flex-col bg-slate-50 dark:bg-[#0b1120]"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 dark:border-slate-800 dark:bg-[#111827]">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-base font-bold text-slate-900 sm:text-lg dark:text-white"
            >
              {t('fleet.custody.dashboard.title')}
            </h2>
            {/* The board's filters, read-only — change them on the board, the dashboard follows. */}
            <ul className="mt-1.5 flex flex-wrap gap-1.5" data-custody-dashboard-filters="true">
              {chips.map((chip) => (
                <li
                  key={chip}
                  className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
                >
                  {chip}
                </li>
              ))}
            </ul>
          </div>
          <button
            ref={closeButton}
            type="button"
            onClick={() => close.current()}
            aria-label={t('common.close')}
            title={t('common.close')}
            data-custody-dashboard-close="true"
            className="-me-1 shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <CloseIcon />
          </button>
        </header>
        {/* The modal scrolls inside itself; a refetch holds the last answer, dimmed. */}
        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6',
            query.isFetching && view === 'ready' && 'opacity-60 transition-opacity',
          )}
        >
          <CustodyDashboardContent
            view={view}
            data={query.data}
            error={query.error}
            onRetry={() => void query.refetch()}
            filtered={custodyFiltered(filters)}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
};
