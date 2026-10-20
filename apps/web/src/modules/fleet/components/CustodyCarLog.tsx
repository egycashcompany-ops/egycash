// «عاوز اضيف علامه السجل لكل عربيه لما ادوس عليها يجيب كل اللى العربيه صرفته ك سجل للعربيه» — one
// car's log, opened from «السجل» on its line of the custody board's «ملخص لكل سيارة», under the
// board's own filters.
//
// «عاوزك تشيل من الداش بورد الجدول اللى فى العربيات والسجل يكون برا زى ما هو»: the log lives on
// the board. «لوحة تحكم» draws neither the cars' table nor any «السجل»; this drawer opens over the
// board alone, its own modal — the page beneath `inert` and held still. Escape and × close it; the
// focus goes back to the «السجل» that opened it.
//
// Everything in it is the server's and over the board's OWN filters: the car's totals are its line
// of «ملخص لكل سيارة» — the very figures `/fleet/custody/summary` folded — and its movements are the
// board's `/fleet/custody/movements` with the same filters and that one car (its registry id, or the
// old book's code kept whole), so the rows below add up to the totals above. Newest first, paged
// 25 / 50 / 100. Nothing estimated: a kind the car has none of is «—».
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  type FleetCustodyMovementDto,
  type FleetCustodyVehicleRowDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { cn } from '../../../shared/lib/cn';
import { ChevronEndIcon, ChevronStartIcon, CloseIcon } from '../../../shared/ui/icons';
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
  CARD_BORDER,
  CARD_SURFACE,
  COMPANY,
  COUNT,
  custodyFilterChips,
  custodyShare1,
  custodyTrapFocus,
  SCROLLBAR,
  STRIP,
  TABLE_CARD,
  TITLE,
  useCount,
  useMoneyText,
  type CustodyDashboardFilters,
} from './custody-dashboard-parts';

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
/** The key a car's line is known by — the same car on every read of the summary. */
export const custodyCarKey = (
  car: Pick<FleetCustodyVehicleRowDto, 'vehicleId' | 'vehicleCode'>,
): string => car.vehicleId ?? `code:${car.vehicleCode ?? ''}`;

/** Opens a car's log — the button handed in, so the focus goes back to it when the log closes. */
export type CustodyOpenLog = (car: FleetCustodyVehicleRowDto, opener: HTMLElement) => void;

/**
 * «السجل» on a car's line: the page icon and the word. Its name says which car, starting with the
 * word on it.
 */
export const CustodyCarLogButton = ({
  car,
  onOpen,
}: {
  car: FleetCustodyVehicleRowDto;
  onOpen: CustodyOpenLog;
}): JSX.Element | null => {
  const t = useT();
  if (custodyCarOf(car) === null) return null;
  return (
    <button
      type="button"
      aria-label={t('fleet.custody.dashboard.carLog.open', { code: car.vehicleCode ?? '—' })}
      data-custody-car-log-open={car.vehicleCode ?? ''}
      onClick={(e) => onOpen(car, e.currentTarget)}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 font-sans text-[11px] font-semibold text-slate-700 transition hover:border-emerald-500 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 dark:border-[#243552] dark:bg-[#142135] dark:font-medium dark:text-slate-300 dark:hover:border-emerald-500/50 dark:hover:text-white"
    >
      <BoardIcon d={LOG_ICON} className="h-3.5 w-3.5" />
      <span>{t('fleet.custody.dashboard.carLog.button')}</span>
    </button>
  );
};

/** «وقود (بنزين 92)», «صيانة», «غسيل» — the kind and what the row itself recorded. */
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

const PAGE_SIZES = [25, 50, 100] as const;
const PAGE_IDLE =
  'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-transparent dark:bg-[#142135] dark:text-slate-300 dark:hover:bg-slate-700';

/**
 * The foot of a car's log: its rows a page (25, 50 or 100), «عرض X - Y من أصل N حركة» once the count
 * is known, and its pages, the current one emerald.
 */
const CustodyLogFooter = ({
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

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * What a car's log asks `/fleet/custody/movements`: the board's filters, untouched, and the car —
 * `null` for a line that names no car (it has no log).
 */
export const custodyCarLogQuery = (
  filters: CustodyDashboardFilters,
  car: Pick<FleetCustodyVehicleRowDto, 'vehicleId' | 'vehicleCode'>,
): (CustodyDashboardFilters & { vehicleId?: string; bookCode?: string }) | null => {
  const ref = custodyCarOf(car);
  return ref === null ? null : { ...filters, ...ref };
};

/** The car whose «السجل» is open, and the button that opened it. */
export interface CustodyOpenCarLog {
  key: string;
  car: FleetCustodyVehicleRowDto;
  opener: HTMLElement | null;
}

/**
 * The car's line as the answer holds it NOW — a refetch keeps its log's totals the server's. Gone
 * from the answer (the filters no longer reach it), its kinds are nothing, never the old sums. With
 * no answer at all yet, the line as it was opened.
 */
export const custodyCurrentCar = (
  vehicles: readonly FleetCustodyVehicleRowDto[] | undefined,
  open: CustodyOpenCarLog,
): FleetCustodyVehicleRowDto => {
  if (vehicles === undefined) return open.car;
  return (
    vehicles.find((car) => custodyCarKey(car) === open.key) ?? {
      ...open.car,
      maintenance: 0,
      fuel: 0,
      tyres: 0,
      wash: 0,
      total: 0,
    }
  );
};

/**
 * The figures at the top of a car's log — each kind with its share of the car, the total with its
 * share of everything the fund paid over the same filters («إجمالي مصروفات العهدة», `spendTotal`).
 * Not of the fund itself: «إجمالي العهدة» is what «شحن العهدة» charges into it (`fundTotal` of the
 * summary), and a share of it here would say something else under the same words.
 */
const CarTotals = ({
  car,
  spendTotal,
}: {
  car: FleetCustodyVehicleRowDto;
  spendTotal: number;
}): JSX.Element => {
  const t = useT();
  const moneyText = useMoneyText();
  return (
    <section
      aria-label={t('fleet.custody.dashboard.carLog.totals')}
      data-custody-car-log-totals="true"
      className="grid grid-cols-2 gap-3 sm:grid-cols-5"
    >
      {CUSTODY_KINDS.map((kind) => {
        const look = CUSTODY_KIND[kind];
        const amount = car[kind];
        return (
          <div
            key={kind}
            data-custody-car-log-kind={kind}
            className={cn(CARD_SURFACE, CARD_BORDER, 'min-w-0 rounded-xl p-3', look.accent)}
          >
            <div className={cn('text-xs', look.label)}>{t(`fleet.custody.source.${kind}`)}</div>
            <div
              className={cn(
                'mt-1 text-sm font-black [overflow-wrap:anywhere] dark:font-bold',
                amount > 0
                  ? 'text-slate-900 dark:text-white'
                  : 'text-slate-400 dark:text-slate-500',
                NUM,
              )}
            >
              {amount > 0 ? moneyText(amount) : '—'}
            </div>
            {amount > 0 && (
              <div className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">
                <CustodyShare
                  part={amount}
                  whole={car.total}
                  className={cn('font-bold', look.text)}
                />{' '}
                {t('fleet.custody.dashboard.carLog.ofCar')}
              </div>
            )}
          </div>
        );
      })}
      <div
        data-custody-car-log-kind="total"
        className={cn(
          CARD_SURFACE,
          'col-span-2 min-w-0 rounded-xl border-emerald-300 bg-gradient-to-br from-emerald-50/70 via-white to-white p-3 sm:col-span-1 dark:border-emerald-500/40',
        )}
      >
        <div className="text-xs font-bold text-emerald-800 dark:font-semibold dark:text-emerald-300">
          {t('fleet.custody.dashboard.columns.total')}
        </div>
        <div
          className={cn(
            'mt-1 text-sm font-black text-slate-900 [overflow-wrap:anywhere] dark:font-bold dark:text-white',
            NUM,
          )}
        >
          {moneyText(car.total)}
        </div>
        <div className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">
          {/* «8.7%» — a car's share of all the custody spent, with one decimal, as the owner's design
              writes it. */}
          <span
            dir="ltr"
            data-custody-pct1="true"
            className={cn('font-bold text-emerald-700 dark:text-emerald-400', NUM)}
          >
            {custodyShare1(car.total, spendTotal)}
          </span>{' '}
          {t('fleet.custody.dashboard.carLog.ofSpend')}
        </div>
      </div>
    </section>
  );
};

/**
 * Everything inside a car's log — a function of its props and its own page, so the node specs can
 * draw it without the drawer: the board's filters read only, the car's totals, and its movements.
 */
export const CustodyCarLogBody = ({
  car,
  spendTotal,
  filters,
  initialPage = 1,
  initialPageSize = PAGE_SIZES[0],
}: {
  car: FleetCustodyVehicleRowDto;
  /**
   * What the whole fund paid over the same filters (`total` of the summary) — the car's share is of
   * it. Not the fund (`fundTotal`), which no filter changes.
   */
  spendTotal: number;
  filters: CustodyDashboardFilters;
  /** For the node specs, which cannot click a page. */
  initialPage?: number;
  initialPageSize?: number;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const moneyText = useMoneyText();
  const { count } = useCount();
  const titleId = useId();
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState<number>(initialPageSize);
  const ask = custodyCarLogQuery(filters, car);
  // A line that names no car never opens a log; asked anyway, it asks for nothing.
  const query = useCustodyLog({ ...(ask ?? filters) }, page, pageSize, ask !== null);
  const items = query.data?.items ?? [];
  const meta = query.data?.meta;
  const total = meta?.totalItems ?? 0;
  const pages = Math.max(1, meta?.totalPages ?? 1);

  return (
    <div className="space-y-5" data-custody-car-log-body="true">
      <div className="space-y-2">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('fleet.custody.dashboard.carLog.note')}
        </p>
        <ul
          aria-label={t('fleet.custody.dashboard.filters.label')}
          data-custody-car-log-filters="true"
          className="flex flex-wrap gap-2"
        >
          {custodyFilterChips(filters, t, locale).map((chip) => (
            <li
              key={chip}
              className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 [overflow-wrap:anywhere] dark:border-[#223048] dark:bg-[#0a0e17] dark:text-white"
            >
              {chip}
            </li>
          ))}
        </ul>
      </div>

      <CarTotals car={car} spendTotal={spendTotal} />

      <section
        aria-labelledby={titleId}
        data-custody-car-log-movements="true"
        className={TABLE_CARD}
      >
        <div className={cn(STRIP, 'rounded-t-2xl')}>
          <h3 id={titleId} className={TITLE}>
            {t('fleet.custody.dashboard.carLog.movements')}
          </h3>
          {meta !== undefined && (
            <span
              data-custody-car-log-count="true"
              className={cn(
                'whitespace-nowrap rounded border border-transparent bg-slate-200/80 px-2 py-0.5 text-xs font-bold text-slate-700 dark:border-slate-700/60 dark:bg-[#142135] dark:font-normal dark:text-slate-300',
                NUM,
              )}
            >
              {count('movement', total)}
            </span>
          )}
        </div>

        {query.data === undefined ? (
          query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : (
            <div className="space-y-2 p-4" data-custody-car-log-loading="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          )
        ) : total === 0 ? (
          <div data-custody-car-log-empty="true">
            <EmptyState title={t('fleet.custody.dashboard.carLog.empty')} />
          </div>
        ) : (
          <div
            className={cn(
              'overflow-x-auto',
              SCROLLBAR,
              query.isFetching && 'opacity-60 transition-opacity',
            )}
          >
            <table aria-labelledby={titleId} className="w-full min-w-[40rem] text-start text-xs">
              <thead className="border-b border-slate-200 bg-slate-100 font-bold text-slate-700 dark:border-slate-800 dark:bg-[#0b101c] dark:font-normal dark:text-slate-400">
                <tr>
                  <th scope="col" className="whitespace-nowrap p-3 text-start">
                    {t('fleet.custody.dashboard.columns.date')}
                  </th>
                  <th scope="col" className="p-3 text-start">
                    {t('fleet.custody.dashboard.columns.kind')}
                  </th>
                  <th scope="col" className="p-3 text-start">
                    {t('fleet.custody.dashboard.columns.company')}
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
                    data-custody-car-log-row={row.id}
                    className="transition hover:bg-slate-50 dark:hover:bg-slate-800/30"
                  >
                    <td
                      className={cn(
                        'whitespace-nowrap p-3 text-slate-500 dark:text-slate-400',
                        NUM,
                      )}
                    >
                      <span dir="ltr">{ymd(row.date)}</span>
                    </td>
                    <td className="p-3">
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
                    </td>
                    <td className="p-3">
                      {row.source !== 'fuel' ? (
                        <span className="text-slate-400 dark:text-slate-500">—</span>
                      ) : row.company === null ? (
                        // «بدون شركة»: the receipt named none — said, never guessed.
                        <span
                          data-custody-car-log-company="none"
                          className="whitespace-nowrap text-slate-500 dark:text-slate-400"
                        >
                          {t('fleet.receipts.fields.companyNone')}
                        </span>
                      ) : (
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
                    <td className="p-3 text-slate-500 dark:text-slate-400">
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
    </div>
  );
};

/**
 * The drawer, over the board: its own modal. Escape and × close it — the key is taken on its way
 * DOWN to the page (the capture phase), so nothing on the board beneath hears it; Tab stays in the
 * log; the page beneath is `inert` and held still while it is up; the focus goes back to the
 * button that opened it.
 */
export const CustodyCarLog = ({
  car,
  spendTotal,
  filters,
  opener,
  onClose,
}: {
  car: FleetCustodyVehicleRowDto;
  /** What the whole fund paid over the board's filters — see `CustodyCarLogBody`. */
  spendTotal: number;
  filters: CustodyDashboardFilters;
  /** The «السجل» pressed — the focus goes back to it. */
  opener: HTMLElement | null;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  // The latest `onClose`, and the opener as it was: a new arrow each render must not re-run the
  // effect, which would take the focus again.
  const close = useRef(onClose);
  close.current = onClose;
  const returnTo = useRef(opener);

  useEffect(() => {
    closeButton.current?.focus();
    // The board stays beneath, out of reach: neither Tab nor a screen reader lands there.
    const root = rootRef.current;
    const muted = Array.from(root?.parentElement?.children ?? []).filter(
      (el): el is HTMLElement => el !== root && el instanceof HTMLElement && !el.inert,
    );
    for (const el of muted) el.inert = true;
    // …and the page under the log stays still.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const stops = (): HTMLElement[] =>
      Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
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
    const onKey = (e: KeyboardEvent): void => {
      // Escape closes the log, and the log alone: stopped here, nothing beneath hears it.
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      // The log keeps its own Tab — nothing beneath may move it too.
      e.stopPropagation();
      back = e.shiftKey;
      if (document.activeElement === document.body) return;
      trap(document.activeElement, () => e.preventDefault());
    };
    const onFocusIn = (e: FocusEvent): void => {
      if (e.target instanceof Node && panelRef.current?.contains(e.target) === false) {
        e.stopPropagation();
        trap(e.target instanceof Element ? e.target : null);
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn, true);
      for (const el of muted) el.inert = false;
      document.body.style.overflow = overflow;
      returnTo.current?.focus();
    };
  }, []);

  const code = car.vehicleCode ?? '—';
  return createPortal(
    <div
      ref={rootRef}
      className="fixed inset-0 z-[95] flex justify-end"
      data-custody-car-log="true"
    >
      <div
        aria-hidden="true"
        data-custody-car-log-backdrop="true"
        onClick={() => close.current()}
        className="absolute inset-0 animate-fade-in bg-slate-900/50 dark:bg-black/60"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full w-full max-w-4xl animate-pop-in flex-col border-s border-slate-200 bg-[#f8fafc] text-slate-800 shadow-elevated dark:border-[#1c263b] dark:bg-[#0b0f19] dark:text-slate-200"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3.5 sm:px-6 dark:border-[#1c263b] dark:bg-[#0c111e]/95">
          <h2
            id={titleId}
            className={cn(
              'flex min-w-0 items-center gap-2 text-base font-bold text-slate-900 sm:text-lg dark:text-white',
              CAIRO,
            )}
          >
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
            >
              <BoardIcon d={LOG_ICON} className="h-4 w-4" />
            </span>
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {t('fleet.custody.dashboard.carLog.title', { code })}
            </span>
          </h2>
          <button
            ref={closeButton}
            type="button"
            onClick={() => close.current()}
            aria-label={t('common.close')}
            title={t('common.close')}
            data-custody-car-log-close="true"
            className="-me-1 shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <CloseIcon />
          </button>
        </header>
        <div
          data-custody-car-log-scroll="true"
          className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6', SCROLLBAR)}
        >
          <CustodyCarLogBody car={car} spendTotal={spendTotal} filters={filters} />
        </div>
      </div>
    </div>,
    document.body,
  );
};
