// The two tables that close «لوحة تحكم», as the owner's design draws them.
//
// «ملخص لكل سيارة»: every car, each kind, its total and its share with one decimal; a search by
// the car's code and a funnel that keeps only the cars with a chosen kind — both in the browser,
// over the server's whole list — and the head and «الإجمالي الختامي» held at the top and the foot
// of its own scroller. «عاوز اضيف علامه السجل لكل عربيه لما ادوس عليها يجيب كل اللى العربيه صرفته
// ك سجل للعربيه»: every car's line carries «السجل», which opens that car's own log over the
// dashboard (`CustodyCarLog.tsx`).
//
// «سجل كل الحركات»: the board's movements (`/fleet/custody/movements`) over the board's filters,
// with a page and a page size of its own (25 / 50 / 100). Each kind wears its badge, a fuel
// receipt its fuel type and the company it names; «شيلهم» — a wash is only «غسيل», with no kind
// of wash the receipt never recorded; a dealership bill its own work label. «تصفية متقدمة» closes
// the dashboard and hands the focus to the board's filter bar — the dashboard builds no filters.
import { useEffect, useId, useRef, useState } from 'react';
import {
  type FleetCustodyDashboardDto,
  type FleetCustodyMovementDto,
  type FleetCustodySource,
  type FleetCustodyVehicleRowDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { ChevronEndIcon, ChevronStartIcon } from '../../../shared/ui/icons';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { useCustodyLog } from '../api/fleet-queries';
import { CustodyShare } from './CustodyFigures';
import { CUSTODY_KIND, CUSTODY_KINDS } from './CustodyKinds';
import { pagerPages } from './FleetPager';
import { BoardIcon, NUM, ymd } from './FuelCardBoard';
import {
  CAIRO,
  COMPANY,
  COUNT,
  custodyShare1,
  SCROLLBAR,
  STRIP,
  TABLE_CARD,
  TITLE,
  useCount,
  useMoneyText,
  useSeparator,
  type CustodyDashboardFilters,
} from './custody-dashboard-parts';

/** The design's funnel. */
const FUNNEL = [
  'M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z',
];
/** «السجل» — a page with its lines, the design's stroke. */
export const LOG_ICON = [
  'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
];

/**
 * The car one line of «ملخص لكل سيارة» names, as `/fleet/custody/movements` asks for it: the
 * registry's car by its id; a line kept from the old book (no registry car) by its code, whole —
 * `vehicleCodes` would split a code with a space in it, and would also find a registry car that
 * carries the same code. A line with neither is no car, and has no log.
 */
export type CustodyCarRef = { vehicleId: string } | { bookCode: string };
export const custodyCarOf = (
  car: Pick<FleetCustodyVehicleRowDto, 'vehicleId' | 'vehicleCode'>,
): CustodyCarRef | null => {
  if (car.vehicleId !== null) return { vehicleId: car.vehicleId };
  if (car.vehicleCode !== null && car.vehicleCode.trim() !== '') {
    return { bookCode: car.vehicleCode };
  }
  return null;
};
/** The key «ملخص لكل سيارة» keys its lines by — the same car on every read of the dashboard. */
export const custodyCarKey = (
  car: Pick<FleetCustodyVehicleRowDto, 'vehicleId' | 'vehicleCode'>,
): string => car.vehicleId ?? `code:${car.vehicleCode ?? ''}`;

/** Opens a car's log — the button handed in, so the focus goes back to it when the log closes. */
export type CustodyOpenLog = (car: FleetCustodyVehicleRowDto, opener: HTMLElement) => void;

/**
 * «السجل» on a car's line: the page icon and the word, or the icon alone where a row has no room
 * (`compact`, with the word as its tooltip). Its name says which car, starting with the word on it.
 */
export const CustodyCarLogButton = ({
  car,
  onOpen,
  compact = false,
}: {
  car: FleetCustodyVehicleRowDto;
  onOpen: CustodyOpenLog;
  compact?: boolean;
}): JSX.Element | null => {
  const t = useT();
  if (custodyCarOf(car) === null) return null;
  const label = t('fleet.custody.dashboard.carLog.open', { code: car.vehicleCode ?? '—' });
  return (
    <button
      type="button"
      aria-label={label}
      title={compact ? label : undefined}
      data-custody-car-log-open={car.vehicleCode ?? ''}
      onClick={(e) => onOpen(car, e.currentTarget)}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-white font-sans text-[11px] font-semibold text-slate-700 transition hover:border-emerald-500 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 dark:border-[#243552] dark:bg-[#142135] dark:font-medium dark:text-slate-300 dark:hover:border-emerald-500/50 dark:hover:text-white',
        compact ? 'p-1' : 'px-2 py-1',
      )}
    >
      <BoardIcon d={LOG_ICON} className="h-3.5 w-3.5" />
      {!compact && <span>{t('fleet.custody.dashboard.carLog.button')}</span>}
    </button>
  );
};

/**
 * The rules that set the head and «الإجمالي الختامي» apart from the cars scrolling between them,
 * drawn INSIDE their cells. The table collapses its borders, and Chromium paints a collapsed
 * border where its row would sit unstuck, not where `sticky` holds it — so a border on the head or
 * the foot vanishes exactly while it is held in place. A cell's inset shadow moves with the cell.
 * The head: the light map's slate-300 rule and its `shadow-xs`, the design's `#233552` dark.
 */
const HEAD_CELL =
  'shadow-[inset_0_-1px_0_#cbd5e1,0_1px_2px_0_rgba(0,0,0,.05)] dark:shadow-[inset_0_-1px_0_#233552]';
/** The foot: the design's 2px emerald-500 rule over every cell, in both themes. */
const FOOT_CELL = 'shadow-[inset_0_2px_0_#10b981]';
/**
 * The grand total's cell: the same rule, and its own edges — the light map's emerald-200 sides,
 * the design's faint emerald line under the rule on the dark.
 */
const GRAND_CELL =
  'shadow-[inset_0_2px_0_#10b981,inset_1px_0_0_#a7f3d0,inset_-1px_0_0_#a7f3d0] dark:shadow-[inset_0_2px_0_#10b981,inset_0_3px_0_rgba(16,185,129,0.3)]';

/** A code as typed: Arabic-Indic digits read as Latin ones, spaces and case ignored. */
const normalise = (text: string): string =>
  text
    .replace(/[٠-٩]/gu, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/gu, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\s+/gu, '')
    .toLowerCase();

/**
 * The lines of «ملخص لكل سيارة» on screen: the dearest first, only the codes holding what was
 * typed, and — when kinds are chosen in the funnel — only the cars with at least one of them.
 */
export const custodyCarRows = (
  vehicles: readonly FleetCustodyVehicleRowDto[],
  search: string,
  kinds: readonly FleetCustodySource[],
): FleetCustodyVehicleRowDto[] => {
  const needle = normalise(search);
  return vehicles
    .filter((car) => needle === '' || normalise(car.vehicleCode ?? '').includes(needle))
    .filter((car) => kinds.length === 0 || kinds.some((kind) => car[kind] > 0))
    .sort((a, b) => b.total - a.total);
};

/** (8) «ملخص لكل سيارة». */
export const CustodyPerCar = ({
  data,
  onOpenLog,
  initialSearch = '',
  initialKinds = [],
  initialMenu = false,
}: {
  data: FleetCustodyDashboardDto;
  /** «السجل» on every car's line — none without it (the line alone, as before). */
  onOpenLog?: CustodyOpenLog | undefined;
  /** For the node specs, which cannot type or click. */
  initialSearch?: string;
  initialKinds?: FleetCustodySource[];
  initialMenu?: boolean;
}): JSX.Element => {
  const t = useT();
  const moneyText = useMoneyText();
  const sep = useSeparator();
  const { count } = useCount();
  const titleId = useId();
  const menuId = useId();
  const [search, setSearch] = useState(initialSearch);
  const [kinds, setKinds] = useState<FleetCustodySource[]>(initialKinds);
  const [menu, setMenu] = useState(initialMenu);
  const menuRef = useRef<HTMLDivElement>(null);
  const funnelRef = useRef<HTMLButtonElement>(null);
  // A click anywhere else folds the funnel's menu away.
  useEffect(() => {
    if (!menu) return undefined;
    const away = (e: MouseEvent): void => {
      if (e.target instanceof Node && menuRef.current?.contains(e.target) === false) setMenu(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [menu]);
  const rows = custodyCarRows(data.vehicles, search, kinds);
  const toggle = (kind: FleetCustodySource): void =>
    setKinds((now) => (now.includes(kind) ? now.filter((k) => k !== kind) : [...now, kind]));
  // The funnel is a disclosure, not a menu: it says whether its list is open, and its name says
  // which kinds it keeps — a reader hears the filter without a «pressed» state on top.
  const funnelLabel =
    kinds.length === 0
      ? t('fleet.custody.dashboard.perCar.kindsButton')
      : t('fleet.custody.dashboard.perCar.kindsButtonActive', {
          kinds: CUSTODY_KINDS.filter((kind) => kinds.includes(kind))
            .map((kind) => t(`fleet.custody.source.${kind}`))
            .join(sep),
        });

  return (
    <section
      data-custody-dashboard-section="perVehicle"
      aria-labelledby={titleId}
      className={TABLE_CARD}
    >
      <div className={cn(STRIP, 'rounded-t-2xl')}>
        <div className="flex items-center gap-3">
          <h2 id={titleId} className={TITLE}>
            {t('fleet.custody.perVehicle')}
          </h2>
          <span
            data-custody-car-count="true"
            className={cn(
              'whitespace-nowrap rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:font-normal dark:text-emerald-400',
              NUM,
            )}
          >
            {t('fleet.custody.dashboard.perCar.registered', {
              cars: count('car', data.vehicles.length),
            })}
          </span>
        </div>
        {/* Escape folds an open list, not the whole dashboard — caught here, around the funnel
            AND its list: right after the funnel opens it the focus is still on the funnel. */}
        <div
          ref={menuRef}
          data-custody-car-tools="true"
          onKeyDown={(e) => {
            if (!menu || e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            setMenu(false);
            funnelRef.current?.focus();
          }}
          className="relative flex items-center gap-2"
        >
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t('fleet.custody.dashboard.perCar.search')}
            placeholder={t('fleet.custody.dashboard.perCar.search')}
            data-custody-car-search="true"
            className="w-40 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 sm:w-52 dark:border-[#233550] dark:bg-[#0e1626] dark:text-white dark:placeholder-slate-500"
          />
          <button
            ref={funnelRef}
            type="button"
            aria-expanded={menu}
            aria-controls={menu ? menuId : undefined}
            aria-label={funnelLabel}
            title={funnelLabel}
            data-custody-car-kinds="true"
            onClick={() => setMenu((open) => !open)}
            className={cn(
              'rounded-lg border p-1.5 transition',
              kinds.length > 0
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-slate-300 bg-white text-slate-600 hover:text-slate-900 dark:border-[#243552] dark:bg-[#142135] dark:text-slate-400 dark:hover:text-white',
            )}
          >
            <BoardIcon d={FUNNEL} className="h-4 w-4" />
          </button>
          {menu && (
            <div
              id={menuId}
              role="group"
              aria-label={t('fleet.custody.dashboard.perCar.kinds')}
              data-custody-car-menu="true"
              className="absolute end-0 top-full z-30 mt-1 w-52 animate-menu-in rounded-xl border border-slate-200 bg-white p-2 text-xs shadow-lg dark:border-[#243552] dark:bg-[#0e1626]"
            >
              <p className="mb-1 px-1 font-bold text-slate-600 dark:text-slate-400">
                {t('fleet.custody.dashboard.perCar.kinds')}
              </p>
              {CUSTODY_KINDS.map((kind) => (
                <label
                  key={kind}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                >
                  <input
                    type="checkbox"
                    data-custody-car-kind={kind}
                    checked={kinds.includes(kind)}
                    onChange={() => toggle(kind)}
                    className="accent-emerald-600"
                  />
                  <span
                    aria-hidden="true"
                    className={cn('h-2 w-2 rounded-full', CUSTODY_KIND[kind].fill)}
                  />
                  <span className="text-slate-700 dark:text-slate-200">
                    {t(`fleet.custody.source.${kind}`)}
                  </span>
                </label>
              ))}
              <button
                type="button"
                disabled={kinds.length === 0}
                onClick={() => setKinds([])}
                className="mt-1 w-full rounded-md px-1 py-1 text-start font-semibold text-emerald-700 hover:bg-slate-100 disabled:opacity-40 dark:text-emerald-400 dark:hover:bg-slate-800/60"
              >
                {t('fleet.custody.dashboard.perCar.allCars')}
              </button>
            </div>
          )}
        </div>
      </div>
      <div className={cn('relative max-h-[480px] overflow-auto rounded-b-2xl', SCROLLBAR)}>
        <table aria-labelledby={titleId} className="w-full border-collapse text-start text-xs">
          <thead className="sticky top-0 z-20 bg-slate-100 font-bold text-slate-700 dark:bg-[#0c1322] dark:font-semibold dark:text-slate-300">
            <tr>
              <th scope="col" className={cn('whitespace-nowrap p-3.5 ps-5 text-start', HEAD_CELL)}>
                {t('fleet.custody.dashboard.columns.carCode')}
              </th>
              {CUSTODY_KINDS.map((kind) => (
                <th key={kind} scope="col" className={cn('p-3.5 text-start', HEAD_CELL)}>
                  {t(`fleet.custody.source.${kind}`)}
                </th>
              ))}
              <th
                scope="col"
                className={cn(
                  'bg-slate-200/80 p-3.5 text-start font-extrabold text-slate-900 dark:bg-[#131f35] dark:font-bold dark:text-emerald-300',
                  HEAD_CELL,
                )}
              >
                {t('fleet.custody.dashboard.columns.total')}
              </th>
              <th scope="col" className={cn('p-3.5 text-center', HEAD_CELL)}>
                {t('fleet.custody.dashboard.columns.share')}
              </th>
            </tr>
          </thead>
          <tbody
            className={cn(
              'divide-y divide-slate-100 bg-white text-slate-700 dark:divide-slate-800/80 dark:bg-[#0d1424]/85 dark:text-slate-300',
              NUM,
            )}
          >
            {rows.map((car) => (
              <tr
                key={custodyCarKey(car)}
                data-custody-car-row={car.vehicleCode ?? ''}
                className="transition hover:bg-slate-50 dark:hover:bg-slate-800/40"
              >
                <td className="p-3.5 ps-5 font-bold">
                  <div className="flex items-center gap-2">
                    <span
                      dir="ltr"
                      className="inline-flex h-7 min-w-[1.75rem] items-center justify-center whitespace-nowrap rounded border border-blue-200 bg-blue-50 px-1 font-bold text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-400"
                    >
                      {car.vehicleCode ?? '—'}
                    </span>
                    {onOpenLog !== undefined && (
                      <CustodyCarLogButton car={car} onOpen={onOpenLog} />
                    )}
                  </div>
                </td>
                {CUSTODY_KINDS.map((kind) => (
                  <td
                    key={kind}
                    className={cn(
                      'whitespace-nowrap p-3.5',
                      car[kind] > 0
                        ? cn('font-semibold dark:font-normal', CUSTODY_KIND[kind].text)
                        : 'text-slate-400 dark:text-slate-500',
                    )}
                  >
                    {car[kind] > 0 ? moneyText(car[kind]) : '—'}
                  </td>
                ))}
                <td className="whitespace-nowrap bg-slate-50 p-3.5 font-bold text-slate-900 dark:bg-[#131f35]/50 dark:text-white">
                  {moneyText(car.total)}
                </td>
                <td className="p-3.5 text-center font-sans text-slate-600 dark:text-slate-400">
                  <span dir="ltr" data-custody-pct1="true">
                    {custodyShare1(car.total, data.total)}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  data-custody-car-none="true"
                  className="p-6 text-center font-sans text-slate-500 dark:text-slate-400"
                >
                  {t('fleet.custody.dashboard.perCar.noMatch')}
                </td>
              </tr>
            )}
          </tbody>
          {/* «الإجمالي الختامي» is the whole fund's — the search and the funnel only choose which
              cars are on screen above it. */}
          <tfoot
            data-custody-dashboard-grand-total="true"
            className="sticky bottom-0 z-20 bg-slate-100 font-bold text-slate-900 dark:bg-[#090e18] dark:text-white"
          >
            <tr>
              <td
                className={cn(
                  'whitespace-nowrap p-4 ps-5 font-black text-emerald-800 dark:font-bold dark:text-emerald-400',
                  CAIRO,
                  FOOT_CELL,
                )}
              >
                {t('fleet.custody.dashboard.grandTotal')}
              </td>
              {CUSTODY_KINDS.map((kind) => (
                <td
                  key={kind}
                  className={cn(
                    'whitespace-nowrap p-4 font-black dark:font-bold',
                    CUSTODY_KIND[kind].text,
                    NUM,
                    FOOT_CELL,
                  )}
                >
                  {moneyText(data[kind])}
                </td>
              ))}
              <td
                className={cn(
                  'whitespace-nowrap bg-emerald-50 p-4 font-black text-emerald-800 dark:bg-[#122238] dark:text-sm dark:font-bold dark:text-emerald-300',
                  NUM,
                  GRAND_CELL,
                )}
              >
                {moneyText(data.total)}
              </td>
              <td className={cn('p-4 text-center', FOOT_CELL)}>
                <CustodyShare
                  part={data.total}
                  whole={data.total}
                  className="text-emerald-800 dark:text-emerald-400"
                />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
};

/** «وقود (بنزين 92)», «التوكيل (صيانة)», «غسيل» — the kind and what the row itself recorded. */
export const custodyKindText = (
  t: ReturnType<typeof useT>,
  row: FleetCustodyMovementDto,
): string => {
  const name = t(`fleet.custody.source.${row.source}`);
  // «شيلهم»: a wash is only «غسيل» — the receipt records no kind of wash.
  if (row.source === 'wash') return name;
  const spec =
    row.source === 'fuel'
      ? row.fuelType === null
        ? null
        : t(`fleet.receipts.fuelType.${row.fuelType}`)
      : row.detail;
  return spec === null || spec === '' ? name : `${name} (${spec})`;
};

export const PAGE_SIZES = [25, 50, 100] as const;
const PAGE_IDLE =
  'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-transparent dark:bg-[#142135] dark:text-slate-300 dark:hover:bg-slate-700';

/** (9) «سجل كل الحركات». Drawn keyed by the filters, so other filters start it on page one. */
export const CustodyLog = ({
  filters,
  onAdvancedFilter,
  initialPage = 1,
  initialPageSize = PAGE_SIZES[0],
}: {
  filters: CustodyDashboardFilters;
  onAdvancedFilter?: (() => void) | undefined;
  /** For the node specs, which cannot click a page. */
  initialPage?: number;
  initialPageSize?: number;
}): JSX.Element => {
  const t = useT();
  const moneyText = useMoneyText();
  const titleId = useId();
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState<number>(initialPageSize);
  const query = useCustodyLog({ ...filters }, page, pageSize);
  const items = query.data?.items ?? [];
  const meta = query.data?.meta;
  const total = meta?.totalItems ?? 0;
  const pages = Math.max(1, meta?.totalPages ?? 1);

  return (
    <section data-custody-dashboard-section="log" aria-labelledby={titleId} className={TABLE_CARD}>
      <div className={cn(STRIP, 'rounded-t-2xl')}>
        <div className="flex items-center gap-2">
          <h2 id={titleId} className={TITLE}>
            {t('fleet.custody.dashboard.log.title')}
          </h2>
          {meta !== undefined && (
            <span
              data-custody-log-count="true"
              className={cn(
                'whitespace-nowrap rounded border border-transparent bg-slate-200/80 px-2 py-0.5 text-xs font-bold text-slate-700 dark:border-slate-700/60 dark:bg-[#142135] dark:font-normal dark:text-slate-300',
                NUM,
              )}
            >
              {t('fleet.custody.dashboard.log.showing', {
                shown: COUNT.format(items.length),
                total: COUNT.format(total),
              })}
            </span>
          )}
        </div>
        {onAdvancedFilter !== undefined && (
          <button
            type="button"
            data-custody-advanced-filter="true"
            onClick={onAdvancedFilter}
            className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 transition hover:border-emerald-500/40 dark:border-slate-700 dark:bg-[#10192a] dark:text-slate-400 dark:hover:text-white"
          >
            {t('fleet.custody.dashboard.log.advanced')}
          </button>
        )}
      </div>

      {query.data === undefined ? (
        query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <div className="space-y-2 p-4" data-custody-log-loading="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        )
      ) : total === 0 ? (
        <EmptyState title={t('fleet.violations.report.empty')} />
      ) : (
        <div
          className={cn(
            'overflow-x-auto',
            SCROLLBAR,
            query.isFetching && 'opacity-60 transition-opacity',
          )}
        >
          <table aria-labelledby={titleId} className="w-full min-w-[48rem] text-start text-xs">
            <thead className="border-b border-slate-200 bg-slate-100 font-bold text-slate-700 dark:border-slate-800 dark:bg-[#0b101c] dark:font-normal dark:text-slate-400">
              <tr>
                <th scope="col" className="whitespace-nowrap p-3 text-start">
                  {t('fleet.custody.dashboard.columns.date')}
                </th>
                <th scope="col" className="whitespace-nowrap p-3 text-start">
                  {t('fleet.custody.dashboard.columns.carCode')}
                </th>
                <th scope="col" className="p-3 text-start">
                  {t('fleet.custody.dashboard.columns.kindSpec')}
                </th>
                <th scope="col" className="p-3 text-start">
                  {t('fleet.custody.dashboard.columns.driver')}
                </th>
                <th scope="col" className="p-3 text-start">
                  {t('fleet.custody.dashboard.columns.source')}
                </th>
                <th scope="col" className="p-3 pe-5 text-end">
                  {t('fleet.custody.dashboard.columns.amount')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-slate-700 dark:divide-slate-800/80 dark:bg-[#0d1424]/60 dark:text-slate-300">
              {items.map((row) => (
                <tr
                  key={`${row.ref}:${row.id}`}
                  data-custody-log-row={row.id}
                  className="transition hover:bg-slate-50 dark:hover:bg-slate-800/30"
                >
                  <td
                    className={cn('whitespace-nowrap p-3 text-slate-500 dark:text-slate-400', NUM)}
                  >
                    <span dir="ltr">{ymd(row.date)}</span>
                  </td>
                  <td className="p-3">
                    <span
                      dir="ltr"
                      className={cn(
                        'rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-bold text-slate-900 dark:border-transparent dark:bg-transparent dark:px-0 dark:text-white',
                        NUM,
                      )}
                    >
                      {row.vehicleCode ?? '—'}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        data-custody-kind={row.source}
                        className={cn(
                          'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px]',
                          CUSTODY_KIND[row.source].badge,
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn('h-1.5 w-1.5 rounded-full', CUSTODY_KIND[row.source].dot)}
                        />
                        {custodyKindText(t, row)}
                      </span>
                      {row.source === 'fuel' && row.company !== null && (
                        <span
                          data-custody-company-badge={row.company}
                          className={cn(
                            'inline-flex items-center whitespace-nowrap rounded border px-2 py-0.5 text-[10px] font-medium',
                            COMPANY[row.company].badge,
                          )}
                        >
                          {t(`fleet.custody.dashboard.company.${row.company}`)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td
                    className={cn(
                      'p-3',
                      row.driverName === null
                        ? 'text-slate-400 dark:text-slate-500'
                        : 'text-slate-800 dark:text-slate-200',
                    )}
                  >
                    {row.driverName ?? '—'}
                  </td>
                  <td
                    className={cn(
                      'p-3',
                      row.ref === 'dealershipInvoice'
                        ? 'font-bold text-blue-700 dark:font-medium dark:text-blue-300'
                        : 'text-slate-500 dark:text-slate-400',
                    )}
                  >
                    {t(`fleet.custody.from.${row.ref}`)}
                  </td>
                  <td
                    className={cn(
                      'whitespace-nowrap p-3 pe-5 text-end font-bold text-slate-900 dark:text-white',
                      NUM,
                    )}
                  >
                    {moneyText(row.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CustodyLogFooter
        page={page}
        pageSize={pageSize}
        total={total}
        pages={pages}
        counted={meta !== undefined}
        onPage={setPage}
        onPageSize={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </section>
  );
};

/**
 * The foot of a log — the dashboard's «سجل كل الحركات» and a car's «السجل»: its rows a page (25,
 * 50 or 100), «عرض X - Y من أصل N حركة» once the count is known, and its pages, the current one
 * emerald.
 */
export const CustodyLogFooter = ({
  page,
  pageSize,
  total,
  pages,
  counted,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  /** Whether the server has answered with its count yet. */
  counted: boolean;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}): JSX.Element => {
  const t = useT();
  const { count } = useCount();
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-col items-center justify-between gap-3 rounded-b-2xl border-t border-slate-200 bg-slate-50/80 p-3.5 text-xs text-slate-600 sm:flex-row dark:border-slate-800 dark:bg-[#0a101b] dark:text-slate-400">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          {t('fleet.custody.dashboard.log.perPage')}
          <select
            data-custody-log-size="true"
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 dark:border-slate-700 dark:bg-[#10192a] dark:text-white"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {counted && (
          <span data-custody-log-range="true" className={cn('ms-2', NUM)}>
            {t('fleet.custody.dashboard.log.range', {
              from: COUNT.format(from),
              to: COUNT.format(to),
              movements: count('movement', total),
            })}
          </span>
        )}
      </div>
      <nav aria-label={t('fleet.pager.label')} className="flex items-center gap-1">
        <button
          type="button"
          aria-label={t('common.pagination.prev')}
          disabled={page <= 1}
          onClick={() => onPage(Math.max(1, page - 1))}
          className={cn('rounded-lg p-1.5 disabled:opacity-40', PAGE_IDLE)}
        >
          <ChevronStartIcon className="h-3.5 w-3.5 rtl:-scale-x-100" />
        </button>
        {pagerPages(page, pages).map((p, i) =>
          p === null ? (
            <span key={`gap-${i}`} className="px-1 text-slate-400">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              aria-current={p === page ? 'page' : undefined}
              data-custody-log-page={p}
              onClick={() => onPage(p)}
              className={cn(
                'rounded-lg px-2.5 py-1',
                NUM,
                p === page
                  ? 'border border-emerald-600 bg-emerald-600 font-bold text-white'
                  : PAGE_IDLE,
              )}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          aria-label={t('common.pagination.next')}
          disabled={page >= pages}
          onClick={() => onPage(Math.min(pages, page + 1))}
          className={cn('rounded-lg p-1.5 disabled:opacity-40', PAGE_IDLE)}
        >
          <ChevronEndIcon className="h-3.5 w-3.5 rtl:-scale-x-100" />
        </button>
      </nav>
    </div>
  );
};
