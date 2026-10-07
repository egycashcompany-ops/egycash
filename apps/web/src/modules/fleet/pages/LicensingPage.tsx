// The licensing board (التراخيص) — the paperwork half of a licence renewal.
//
// Two papers, each handed in and then collected back: «تأمينات» with its تسليم/استلام, and
// «ضرائب» with its own. That is the whole screen; there is no money on it and no dates, because
// the thing being tracked is a clerk walking documents to an office and bringing them back.
//
// WHICH CARS ARE HERE IS NOT A FILTER ANYBODY SETS. A vehicle is on this board because its
// licence class is one whose name ends «ت» — «برقاش ت», «العجوزة ت» — and it leaves the moment an
// admin makes that class «برقاش م». «لما العربيه تبقى اخرها م زى برقاش م تتشال من الجدول خالص ...
// اخرها ت تتحط ت من جديد». The server decides it on every read, so this screen has no membership
// rule of its own to fall out of step.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  compareFleetVehicleCodes,
  type FleetLicensingMark,
  type FleetLicensingRowDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { Input } from '../../../shared/ui/form';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { DARK_FILTER_BAR } from '../components/dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from '../components/FilterWithIcon';
import { FigureChip } from '../components/FleetFigures';
import { BoardIcon, PATH, expiryState } from '../components/FuelCardBoard';
import { saveSheet } from '../lib/fleet-sheet';
import { boardVehicleOptions } from '../lib/board-vehicle-options';
import { licenceMonthOptions } from '../lib/licence-months';
import { readList, writeList } from '../../../shared/lib/list-param';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { toast } from '../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../shared/lib/errors';
import { useAppSelector } from '../../../store';
import { type Locale } from '@ecms/contracts';
import { cn } from '../../../shared/lib/cn';
import { formatDate, formatNumber } from '../../../shared/lib/format';
import { CheckIcon, ChevronIcon } from '../../../shared/ui/icons';
import { useLicensingBoard, useSetLicensingMark } from '../api/fleet-queries';

/**
 * The two papers, each naming the pair of squares it owns.
 *
 * Declared as data rather than written out twice in the markup: the head, the body and the
 * colouring all walk the same list, so «ضرائب» cannot end up with the head of «تأمينات» or be
 * coloured by the other one's ticks — which is exactly the mistake a hand-copied second column
 * invites.
 */
const PAPERS = [
  {
    key: 'insurance',
    label: 'fleet.licensing.columns.insurance',
    handover: 'insuranceHandover',
    receipt: 'insuranceReceipt',
  },
  {
    key: 'tax',
    label: 'fleet.licensing.columns.tax',
    handover: 'taxHandover',
    receipt: 'taxReceipt',
  },
] as const;

type Paper = (typeof PAPERS)[number];

/**
 * The filters this screen keeps, and their names in the address bar.
 *
 * Remembered across visits like every other Fleet list's: a clerk works one office's cars for an
 * afternoon, and retyping the same narrowing after every trip to another screen is the complaint
 * `useRememberedFilters` exists to answer. No `page` — this board has none.
 */
const REMEMBERED_FILTERS = [
  'vehicleCodes',
  'plate',
  'chassis',
  'month',
  'ins',
  'tax',
  'sort',
] as const;

/** A text filter, matched the way the registry's own boxes match: contains, case-insensitively. */
const contains = (haystack: string, needle: string): boolean =>
  needle === '' || haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase());

/**
 * Does this licence expire in that MONTH? «اشيل دا واحط مكانه واحد بس بيجيب الشهر بس».
 *
 * ONE control instead of the two bounds it replaces, because the question this board is actually
 * worked from is «مين بيخلص الشهر ده» — a renewal run is a month's work, and expressing it as a
 * pair of dates asked the clerk to type the first and the last day of it every time.
 *
 * Compared as the ISO month, never as instants: the stored value carries a time, and a comparison
 * that built dates from it would drop a licence expiring on the last day of the month asked for —
 * the commonest thing this filter is asked, and an off-by-one nobody would see until a car was
 * missed.
 */
export const inMonth = (isoDate: string, month: string): boolean =>
  month === '' || isoDate.slice(0, 7) === month;

/**
 * Does this row satisfy a paper's chosen squares?
 *
 * ANY of them, not all — «مالتى تشوز تسليم او استلام». Picking «تسليم» asks for the cars whose
 * تسليم is done; picking both asks for the cars that have EITHER, which is the same reading every
 * other multi-select in this application has. Picking neither asks nothing at all.
 */
export const matchesPaper = (
  row: FleetLicensingRowDto,
  paper: Paper,
  chosen: readonly string[],
): boolean => {
  if (chosen.length === 0) return true;
  return chosen.some((step) => (step === 'handover' ? row[paper.handover] : row[paper.receipt]));
};

/**
 * HOW FAR THIS PAPER HAS GOT, which is the only thing the colour says.
 *
 * «لما اعمل صح على تسليم فى التأمينات يبقى العمودين بتوع تسليم واستلام بتوع التأمينات يتعمله الصف
 * اصفر ولما صح على تسليم واستلام الصف يبقى اخضر». Amber is «gone out and not back» — a paper
 * somebody is still holding — and green is «done». Both squares empty is not a state worth
 * colouring: it is the ordinary condition of most of the board.
 *
 * Exported so the tint is testable without a browser, and so nothing else in this file can invent
 * a fourth answer.
 */
export const paperStage = (row: FleetLicensingRowDto, paper: Paper): 'none' | 'open' | 'done' => {
  const out = row[paper.handover];
  const back = row[paper.receipt];
  if (out && back) return 'done';
  // «استلام» without «تسليم» should not happen and is still HALF DONE rather than nothing: a
  // square that is ticked must never sit on an uncoloured cell, or the reader is looking at a
  // tick the board is pretending it cannot see.
  return out || back ? 'open' : 'none';
};

const STAGE_TINT: Record<'none' | 'open' | 'done', string> = {
  none: '',
  open: 'bg-amber-50 dark:bg-amber-950/40',
  done: 'bg-emerald-50 dark:bg-emerald-950/40',
};

/** `2026-01-20…` → `2026/01/20`, the way the Fleet boards write a day. */
const day = (iso: string): string => iso.slice(0, 10).replace(/-/gu, '/');
const BRAND_BUTTON =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-brand-500/50 bg-brand-500/15 px-2 py-1.5 text-[11px] font-bold text-brand-700 transition hover:bg-brand-500/25 active:scale-95 sm:gap-1.5 sm:px-3 sm:py-2 sm:text-xs dark:text-brand-200';
/** The licence's state as the vehicles board words it — ساري / ينتهي قريبًا / منتهي. */
const EXPIRY_TAG: Record<'valid' | 'soon' | 'expired', string> = {
  valid:
    'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 [&>i]:bg-emerald-400',
  soon: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 [&>i]:bg-amber-400',
  expired: 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400 [&>i]:bg-red-500',
};
const EXPIRY_TEXT: Record<'valid' | 'soon' | 'expired', string> = {
  valid: 'text-slate-900 dark:text-slate-100',
  soon: 'text-amber-600 dark:text-amber-400',
  expired: 'text-red-600 dark:text-red-400',
};

export const LicensingPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const board = useLicensingBoard();
  const mark = useSetLicensingMark();
  const mayMark = can('fleetLicensing.mark');
  const [statsOpen, setStatsOpen] = useState(false);
  // TEMPORARY — the two samples: «زى شاشة السيارات» and «شبه التوكيل».
  const look = sp.get('look') === 'deal' ? 'deal' : 'veh';
  const veh = look === 'veh';
  const head = cn(
    'px-3 py-2.5 text-center text-[13px] font-bold text-slate-500 dark:text-slate-400',
    veh && 'border-s border-slate-200/70 first:border-s-0 dark:border-slate-700/40',
  );
  const cell = cn(
    'px-3 py-2.5 text-sm font-bold text-slate-800 dark:text-slate-200',
    veh &&
      "border-s border-slate-200/70 first:border-s-0 dark:border-slate-700/40 [font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Cairo',monospace]",
  );

  const vehicleCodes = readList(sp, 'vehicleCodes');
  const plate = sp.get('plate') ?? '';
  const chassis = sp.get('chassis') ?? '';
  const insurance = readList(sp, 'ins');
  const tax = readList(sp, 'tax');
  // The months the licences run out in — «زى شاشه السيارات»: several at once, each with its count
  // of cars, picked from a list. A link from before carries one month; it reads as a list of one.
  const months = readList(sp, 'month');
  /**
   * WHICH WAY THE EXPIRY RUNS — «عاوز اعمل سهم هنا عشان اقدر اتحكم فى التاريخ تصاعديا و تنازليا».
   *
   * One column and two directions, so one parameter holds it. `asc` is the default because the
   * board is worked from the deadline nearest first; a reader who wants the far end clicks once.
   */
  const expiryDir = sp.get('sort') === 'desc' ? 'desc' : 'asc';

  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    setSp(next);
  };
  // ONE update, every key. Clearing them one call at a time would build each next URL from the
  // params THIS render was given, so the last write would put the others back — the defect the
  // violations screen's own `onClear` carries a comment about.
  const clearFilters = (): void =>
    patch({
      vehicleCodes: null,
      plate: null,
      chassis: null,
      month: null,
      ins: null,
      tax: null,
    });
  const hasFilters =
    vehicleCodes.length > 0 ||
    plate !== '' ||
    chassis !== '' ||
    months.length > 0 ||
    insurance.length > 0 ||
    tax.length > 0;

  const all = board.data ?? [];
  /**
   * NARROWED IN HAND, not by the server.
   *
   * The board arrives WHOLE — it is unpaginated by design, because which cars are on it is the
   * registry's answer rather than the reader's — so a server-side filter would be asking the
   * server to answer again what it has just answered. It also keeps the filter honest: what a
   * reader sees narrowed is exactly the rows they were already looking at.
   */
  const rows = useMemo(
    () =>
      all.filter(
        (row) =>
          (vehicleCodes.length === 0 || vehicleCodes.includes(row.code)) &&
          contains(row.plateNumber, plate) &&
          contains(row.chassisNumber, chassis) &&
          (months.length === 0 || months.some((m) => inMonth(row.licenseExpiresAt, m))) &&
          matchesPaper(row, PAPERS[0], insurance) &&
          matchesPaper(row, PAPERS[1], tax),
      ),
    [
      all,
      vehicleCodes.join(','),
      plate,
      chassis,
      months.join(','),
      insurance.join(','),
      tax.join(','),
    ],
  );

  /**
   * The cars the picker offers — THIS BOARD's, not the registry's.
   *
   * «عاوز ينزل العربيات زى شاشة المخالفات»: the same dropdown the violations screen uses, fed from
   * the rows already in hand the way the alarms board feeds it. Offering the whole registry here
   * would list every «برقاش م» car in the fleet — cars this screen can never show — so picking one
   * would empty the board with nothing to say why.
   */
  const monthOptions = useMemo(() => licenceMonthOptions(all, locale), [all, locale]);
  const carOptions = useMemo(() => boardVehicleOptions(all, vehicleCodes), [all, vehicleCodes.join(',')]);

  /**
   * The board, in the reader's order.
   *
   * Sorted AFTER the filters and on the rows themselves: this board arrives whole, so ordering it
   * here is the honest answer rather than a shortcut — there is no second page for an arrow to be
   * wrong about. The car code closes every tie, so two licences expiring on one day keep a stable
   * order instead of shuffling under a reader who changed nothing.
   */
  const ordered = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const verdict = a.licenseExpiresAt.localeCompare(b.licenseExpiresAt);
        if (verdict !== 0) return expiryDir === 'asc' ? verdict : -verdict;
        return compareFleetVehicleCodes(a.code, b.code);
      }),
    [rows, expiryDir],
  );

  // «الإحصائيات» — over what the filters left, as every board counts.
  const figures = useMemo(() => {
    const thisMonth = new Date().toISOString().slice(0, 7);
    return {
      cars: rows.length,
      thisMonth: rows.filter((row) => inMonth(row.licenseExpiresAt, thisMonth)).length,
      expired: rows.filter((row) => expiryState(row.licenseExpiresAt, 30) === 'expired').length,
      insuranceOut: rows.filter((row) => paperStage(row, PAPERS[0]) === 'open').length,
      taxOut: rows.filter((row) => paperStage(row, PAPERS[1]) === 'open').length,
    };
  }, [rows]);

  const stepOptions = [
    { value: 'handover', label: t('fleet.licensing.columns.handover') },
    { value: 'receipt', label: t('fleet.licensing.columns.receipt') },
  ];

  /**
   * «شاشه fleet/licensing اعملى اكسيل» — what the FILTER left, in the order it is on screen.
   *
   * No round trip: this board is unpaginated, so the rows in hand ARE the answer — unlike the
   * paged registers, whose export has to walk every page before it can be honest. No signatures
   * either, for the reason the other seven list sheets have none: «ومفيش امضاءات» — these are
   * working lists, not the company's forms.
   *
   * A square is written as a WORD rather than a tick: «تم» reads in a spreadsheet, filters and
   * sorts, and survives being opened by something that has never heard of this application. An
   * empty cell is the honest opposite — not «لا», which would claim somebody decided against it.
   */
  const exportSheet = async (): Promise<void> => {
    const done = (on: boolean): string => (on ? t('fleet.licensing.done') : '');
    saveSheet({
      name: t('fleet.nav.licensing'),
      serialHeader: t('fleet.violations.report.serial'),
      header: [
        t('fleet.licensing.columns.vehicle'),
        t('fleet.licensing.columns.plate'),
        t('fleet.licensing.columns.chassis'),
        t('fleet.licensing.columns.licenseClass'),
        t('fleet.vehicles.fields.licenseExpiresAt'),
        `${t('fleet.licensing.columns.insurance')} — ${t('fleet.licensing.columns.handover')}`,
        `${t('fleet.licensing.columns.insurance')} — ${t('fleet.licensing.columns.receipt')}`,
        `${t('fleet.licensing.columns.tax')} — ${t('fleet.licensing.columns.handover')}`,
        `${t('fleet.licensing.columns.tax')} — ${t('fleet.licensing.columns.receipt')}`,
      ],
      rows: ordered.map((row) => [
        row.code,
        row.plateNumber,
        row.chassisNumber,
        row.licenseClass ?? '',
        formatDate(row.licenseExpiresAt, locale),
        done(row.insuranceHandover),
        done(row.insuranceReceipt),
        done(row.taxHandover),
        done(row.taxReceipt),
      ]),
    });
  };

  const toggle = async (
    row: FleetLicensingRowDto,
    field: FleetLicensingMark,
  ): Promise<void> => {
    if (!mayMark) return;
    try {
      await mark.mutateAsync({ vehicleId: row.vehicleId, mark: field, value: !row[field] });
    } catch (error) {
      // No optimistic paint: the square turns when the SERVER says it has, so a refused write —
      // a car that left the board while this tab was open — leaves the screen telling the truth.
      toast.error(errorMessage(error, locale));
    }
  };

  const square = (row: FleetLicensingRowDto, field: FleetLicensingMark, paper: Paper, step: string) => (
    <button
      type="button"
      data-licensing-mark={`${row.code}:${field}`}
      data-licensing-on={row[field] ? 'true' : undefined}
      aria-pressed={row[field]}
      disabled={!mayMark || mark.isPending}
      aria-label={t('fleet.licensing.mark', {
        paper: t(paper.label),
        step: t(step),
        code: row.code,
      })}
      title={t('fleet.licensing.mark', { paper: t(paper.label), step: t(step), code: row.code })}
      onClick={() => void toggle(row, field)}
      className={cn(
        'rounded-md p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:cursor-not-allowed',
        row[field]
          ? 'text-emerald-600 hover:bg-emerald-100 dark:text-emerald-400'
          : 'text-slate-400 hover:bg-slate-100 hover:text-emerald-600 dark:hover:bg-slate-800',
      )}
    >
      <CheckIcon className="h-4 w-4" />
    </button>
  );

  const expiryCell = (iso: string): JSX.Element => {
    const state = expiryState(iso, 30);
    const known = state === 'unknown' ? 'valid' : state;
    return veh ? (
      <span className="inline-flex items-center gap-1.5">
        <span dir="ltr" className={cn('tabular-nums', EXPIRY_TEXT[known])}>
          {day(iso)}
        </span>
        <span
          className={cn(
            'whitespace-nowrap rounded border px-1 text-[10px] font-medium leading-4',
            EXPIRY_TAG[known],
          )}
        >
          {t(`fleet.fuelCards.expiry.${known}`)}
        </span>
      </span>
    ) : (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-bold tabular-nums',
          EXPIRY_TAG[known],
        )}
      >
        <i className="h-1.5 w-1.5 rounded-full" />
        <span dir="ltr">{day(iso)}</span>
      </span>
    );
  };

  return (
    <PageContainer fullHeight>
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex items-center justify-between gap-2" data-licensing-toolbar="true">
          <span data-licensing-count className="text-sm font-bold text-slate-600 dark:text-slate-300">
            {t('fleet.licensing.count', { count: formatNumber(rows.length, locale) })}
          </span>
          <span className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              data-licensing-stats-toggle="true"
              aria-expanded={statsOpen}
              onClick={() => setStatsOpen((open) => !open)}
              className={BRAND_BUTTON}
            >
              {statsOpen ? t('fleet.vehicles.board.breakdownHide') : t('fleet.vehicles.board.breakdown')}
            </button>
            {!board.isError && (
              <button
                type="button"
                data-export="licensing"
                onClick={() => void exportSheet()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-800 transition hover:bg-emerald-50 hover:text-emerald-700 active:scale-95 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-emerald-950/60 dark:hover:text-emerald-300"
              >
                <BoardIcon d={PATH.excel} className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                {t('fleet.fuelCards.board.excel')}
              </button>
            )}
          </span>
        </div>

        {statsOpen && (
          <section className="grid animate-drop-in grid-cols-2 gap-3 lg:grid-cols-5">
            <FigureChip
              icon={PATH.truck}
              iconClass="bg-slate-500/10 text-slate-600 dark:text-slate-300"
              label={t('fleet.licensing.stats.cars')}
              value={figures.cars}
              unit={t('fleet.vehicles.board.totalUnit')}
            />
            <FigureChip
              icon={PATH.calendar}
              iconClass="bg-amber-500/10 text-amber-600 dark:text-amber-400"
              label={t('fleet.licensing.stats.thisMonth')}
              value={figures.thisMonth}
              unit={t('fleet.vehicles.board.totalUnit')}
            />
            <FigureChip
              icon={PATH.warn}
              iconClass="bg-red-500/10 text-red-600 dark:text-red-400"
              label={t('fleet.licensing.stats.expired')}
              value={figures.expired}
              unit={t('fleet.vehicles.board.totalUnit')}
            />
            <FigureChip
              icon={PATH.card}
              iconClass="bg-sky-500/10 text-sky-600 dark:text-sky-400"
              label={t('fleet.licensing.stats.insuranceOut')}
              value={figures.insuranceOut}
              unit={t('fleet.vehicles.board.totalUnit')}
            />
            <FigureChip
              icon={PATH.card}
              iconClass="bg-violet-500/10 text-violet-600 dark:text-violet-300"
              label={t('fleet.licensing.stats.taxOut')}
              value={figures.taxOut}
              unit={t('fleet.vehicles.board.totalUnit')}
            />
          </section>
        )}

        <div className={cn(DARK_FILTER_BAR, '[&_[role=listbox]]:animate-menu-in')}>
          <FilterBar hasActiveFilters={hasFilters} onClear={clearFilters}>
            <FilterWithIcon icon={FILTER_ICON.car} tone="text-emerald-600 dark:text-emerald-400">
              <VehicleCodeFilter
                options={carOptions}
                value={vehicleCodes}
                onChange={(next) => patch({ vehicleCodes: writeList(next) })}
                placeholder={t('fleet.licensing.columns.vehicle')}
                density="tight"
                fullWidth
                className="w-full"
              />
            </FilterWithIcon>
            <FilterWithIcon icon={FILTER_ICON.plate} tone="text-sky-600 dark:text-sky-400">
              <Input
                aria-label={t('fleet.licensing.columns.plate')}
                placeholder={t('fleet.licensing.columns.plate')}
                value={plate}
                onChange={(e) => patch({ plate: e.target.value || null })}
                rule="plate"
              />
            </FilterWithIcon>
            <FilterWithIcon icon={FILTER_ICON.chassis} tone="text-slate-500 dark:text-slate-400">
              <Input
                aria-label={t('fleet.licensing.columns.chassis')}
                placeholder={t('fleet.licensing.columns.chassis')}
                value={chassis}
                onChange={(e) => patch({ chassis: e.target.value || null })}
                rule="english"
              />
            </FilterWithIcon>
            <FilterWithIcon icon={FILTER_ICON.calendar} tone="text-cyan-600 dark:text-cyan-400">
              <MultiSelect
                clearable
                fullWidth
                density="tight"
                showSelectedValues
                searchThreshold={0}
                panelWidth="w-60"
                label={t('fleet.vehicles.filters.short.licenseMonth')}
                options={monthOptions}
                value={months}
                onChange={(next) => patch({ month: writeList(next) })}
              />
            </FilterWithIcon>
            {/* Each paper picks among its OWN two squares — «تسليم» means a different column in
                each, so one list of four would ask the reader to tell two of them apart by place. */}
            <FilterWithIcon icon={FILTER_ICON.insurance} tone="text-sky-600 dark:text-sky-400">
              <MultiSelect
                clearable
                label={t('fleet.licensing.columns.insurance')}
                options={stepOptions}
                value={insurance}
                onChange={(next) => patch({ ins: writeList(next) })}
                density="tight"
                fullWidth
              />
            </FilterWithIcon>
            <FilterWithIcon icon={FILTER_ICON.licence} tone="text-violet-600 dark:text-violet-300">
              <MultiSelect
                clearable
                label={t('fleet.licensing.columns.tax')}
                options={stepOptions}
                value={tax}
                onChange={(next) => patch({ tax: writeList(next) })}
                density="tight"
                fullWidth
              />
            </FilterWithIcon>
          </FilterBar>
        </div>

        {board.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : board.isError ? (
          <ErrorState error={board.error} onRetry={() => void board.refetch()} />
        ) : rows.length === 0 ? (
          // TWO EMPTIES, and they are not the same answer: a board with no «… ت» car needs the rule
          // explained; a board whose FILTERS matched nothing needs the opposite.
          <EmptyState
            title={hasFilters ? t('fleet.licensing.noMatches') : t('fleet.licensing.empty')}
            {...(hasFilters ? {} : { description: t('fleet.licensing.emptyHint') })}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
            <table data-licensing-table className="w-full border-collapse">
              {/* A sticky head over scrolling rows has to be OPAQUE, or the rows show through it. */}
              <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-[#0c121e]">
                <tr>
                  <th rowSpan={2} className={head}>
                    {t('fleet.licensing.columns.vehicle')}
                  </th>
                  <th rowSpan={2} className={head}>
                    {t('fleet.licensing.columns.plate')}
                  </th>
                  <th rowSpan={2} className={head}>
                    {t('fleet.licensing.columns.chassis')}
                  </th>
                  <th rowSpan={2} className={head}>
                    {/* The ONE column this board is ordered by, and the arrow that turns it round. */}
                    <button
                      type="button"
                      data-licensing-sort={expiryDir}
                      onClick={() => patch({ sort: expiryDir === 'asc' ? 'desc' : null })}
                      aria-label={t('fleet.vehicles.fields.licenseExpiresAt')}
                      className="mx-auto inline-flex items-center gap-1 rounded hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 dark:hover:text-slate-200"
                    >
                      {t('fleet.vehicles.fields.licenseExpiresAt')}
                      <ChevronIcon
                        className={cn('h-3.5 w-3.5 transition-transform', expiryDir === 'asc' && 'rotate-180')}
                      />
                    </button>
                  </th>
                  {PAPERS.map((paper) => (
                    <th key={paper.key} colSpan={2} className={head}>
                      {t(paper.label)}
                    </th>
                  ))}
                </tr>
                <tr>
                  {PAPERS.map((paper) => [
                    <th key={`${paper.key}-out`} className={head}>
                      {t('fleet.licensing.columns.handover')}
                    </th>,
                    <th key={`${paper.key}-back`} className={head}>
                      {t('fleet.licensing.columns.receipt')}
                    </th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {ordered.map((row) => (
                  <tr
                    key={row.vehicleId}
                    data-licensing-row={row.code}
                    className="border-t border-slate-200 transition hover:bg-slate-100 dark:border-slate-800 dark:hover:bg-[#16203a]"
                  >
                    <td className={`${cell} text-center`} dir="ltr">
                      {row.code}
                    </td>
                    <td className={`${cell} text-center`} dir="ltr">
                      {row.plateNumber}
                    </td>
                    <td className={`${cell} text-center font-mono text-xs`} dir="ltr">
                      {row.chassisNumber}
                    </td>
                    <td className={`${cell} whitespace-nowrap text-center`}>
                      {expiryCell(row.licenseExpiresAt)}
                    </td>
                    {PAPERS.map((paper) => {
                      // ONE READING PER PAPER, used by both its squares — the pair is one errand.
                      const tint = STAGE_TINT[paperStage(row, paper)];
                      return [
                        <td
                          key={`${paper.key}-out`}
                          data-licensing-cell={`${row.code}:${paper.key}:handover`}
                          className={cn(cell, 'text-center', tint)}
                        >
                          {square(row, paper.handover, paper, 'fleet.licensing.columns.handover')}
                        </td>,
                        <td
                          key={`${paper.key}-back`}
                          data-licensing-cell={`${row.code}:${paper.key}:receipt`}
                          className={cn(cell, 'text-center', tint)}
                        >
                          {square(row, paper.receipt, paper, 'fleet.licensing.columns.receipt')}
                        </td>,
                      ];
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageContainer>
  );
};
