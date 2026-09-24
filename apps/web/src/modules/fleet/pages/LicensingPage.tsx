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
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  compareFleetVehicleCodes,
  type FleetLicensingMark,
  type FleetLicensingRowDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { Input } from '../../../shared/ui/form';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { ExportSheetButton } from '../components/ExportSheetButton';
import { saveSheet } from '../lib/fleet-sheet';
import { boardVehicleOptions } from '../lib/board-vehicle-options';
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

const head =
  'px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';
const cell = 'px-3 py-2 text-sm text-slate-700 dark:text-slate-200';

export const LicensingPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const board = useLicensingBoard();
  const mark = useSetLicensingMark();
  const mayMark = can('fleetLicensing.mark');

  const vehicleCodes = readList(sp, 'vehicleCodes');
  const plate = sp.get('plate') ?? '';
  const chassis = sp.get('chassis') ?? '';
  const insurance = readList(sp, 'ins');
  const tax = readList(sp, 'tax');
  // The licence-expiry WINDOW — «وفى الفلاتر الفتره». Two open-ended bounds rather than one
  // preset («هذا الشهر»): a renewal run is planned over whatever stretch the office is working,
  // and either end alone is an ordinary question — «كل اللى خلص قبل اليوم».
  // `YYYY-MM`, exactly what `<input type="month">` reads and writes.
  const month = sp.get('month') ?? '';
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
    month !== '' ||
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
          inMonth(row.licenseExpiresAt, month) &&
          matchesPaper(row, PAPERS[0], insurance) &&
          matchesPaper(row, PAPERS[1], tax),
      ),
    [all, vehicleCodes.join(','), plate, chassis, month, insurance.join(','), tax.join(',')],
  );

  /**
   * The cars the picker offers — THIS BOARD's, not the registry's.
   *
   * «عاوز ينزل العربيات زى شاشة المخالفات»: the same dropdown the violations screen uses, fed from
   * the rows already in hand the way the alarms board feeds it. Offering the whole registry here
   * would list every «برقاش م» car in the fleet — cars this screen can never show — so picking one
   * would empty the board with nothing to say why.
   */
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

  return (
    <PageContainer fullHeight>
      <PageHeader
        title={t('fleet.nav.licensing')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.licensing') },
        ]}
        // Not offered when the board itself failed to load: the file behind it would be empty,
        // and an empty sheet reads as «مفيش بيانات» rather than as a fetch that did not happen.
        actions={!board.isError && <ExportSheetButton name="licensing" onExport={exportSheet} />}
      />

      {/* The module's own filter strip. `singleRow` because five controls fit one line at the width
          this screen is read at, and a bar that wrapped would push the board itself below the
          fold on the very screen whose point is seeing the whole list at once. */}
      <FilterBar
        singleRow
        hasActiveFilters={hasFilters}
        onClear={clearFilters}
        // ONE NUMBER, in the registry's own words and the registry's own place — «خليهم رقم بس
        // يكون زى اللى فى باقى شاشات الحركه زى شاشه السيارات». The pair of named figures this
        // replaces was a shape no other Fleet screen has, and a rail of screens is read by
        // recognition: the count on this bar has to be the same object as the count on that one.
        //
        // It is HOW MANY THE FILTER MATCHED, which is what the vehicles screen's own number is —
        // there it is the server's `totalItems` for the filtered query, and here it is the rows
        // the same filters left. Same question, same answer, whichever screen asked it.
        trailing={
          <span
            data-licensing-count
            className="whitespace-nowrap text-xs font-medium text-slate-500 dark:text-slate-400"
          >
            {t('fleet.licensing.count', { count: formatNumber(rows.length, locale) })}
          </span>
        }
      >
        {/* PICKED, not typed — the control every other Fleet screen asks «which cars?» with. It
            also takes codes pasted out of a message («150 - 151»), which the box it replaces could
            not: that one matched a substring, so `15` quietly meant 150 AND 151 AND 215. */}
        <div className="w-44 shrink-0">
          <VehicleCodeFilter
            options={carOptions}
            value={vehicleCodes}
            onChange={(next) => patch({ vehicleCodes: writeList(next) })}
            placeholder={t('fleet.licensing.columns.vehicle')}
            density="tight"
            fullWidth
            className="w-full"
          />
        </div>
        <div className="min-w-[8rem] flex-1">
          <Input
            aria-label={t('fleet.licensing.columns.plate')}
            placeholder={t('fleet.licensing.columns.plate')}
            value={plate}
            onChange={(e) => patch({ plate: e.target.value || null })}
            textScale="comfortable"
          />
        </div>
        <div className="min-w-[8rem] flex-1">
          <Input
            aria-label={t('fleet.licensing.columns.chassis')}
            placeholder={t('fleet.licensing.columns.chassis')}
            value={chassis}
            onChange={(e) => patch({ chassis: e.target.value || null })}
            textScale="comfortable"
          />
        </div>
        {/* ONE MONTH, not a pair of dates — «واحد بس بيجيب الشهر بس». A renewal run is a month's
            work, and the two bounds it replaces asked the clerk to type that month's first and
            last day every time they wanted the obvious question. */}
        <div className="w-44 shrink-0">
          <Input
            type="month"
            aria-label={t('fleet.vehicles.fields.licenseExpiresAt')}
            value={month}
            onChange={(e) => patch({ month: e.target.value || null })}
            textScale="comfortable"
          />
        </div>
        {/* Each paper picks among its OWN two squares. Two controls rather than one list of four,
            because «تسليم» means a different column in each — one list would ask the reader to
            tell two identically-named entries apart by their position. */}
        <div className="w-40 shrink-0">
          <MultiSelect
            label={t('fleet.licensing.columns.insurance')}
            options={stepOptions}
            value={insurance}
            onChange={(next) => patch({ ins: writeList(next) })}
            density="tight"
            fullWidth
          />
        </div>
        <div className="w-40 shrink-0">
          <MultiSelect
            label={t('fleet.licensing.columns.tax')}
            options={stepOptions}
            value={tax}
            onChange={(next) => patch({ tax: writeList(next) })}
            density="tight"
            fullWidth
          />
        </div>
      </FilterBar>

      {board.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : board.isError ? (
        <ErrorState error={board.error} onRetry={() => void board.refetch()} />
      ) : rows.length === 0 ? (
        // TWO EMPTIES, and they are not the same answer. A board with no «… ت» car on it needs the
        // rule explained — the hint is the whole of why a fleet of two hundred cars can show an
        // empty screen. A board whose FILTERS matched nothing needs the opposite: saying «اخرها ت»
        // there would send the reader to the catalogs screen to fix a filter.
        <EmptyState
          title={hasFilters ? t('fleet.licensing.noMatches') : t('fleet.licensing.empty')}
          {...(hasFilters ? {} : { description: t('fleet.licensing.emptyHint') })}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table data-licensing-table className="w-full border-collapse">
            {/* A sticky head over scrolling rows has to be OPAQUE, or the rows show through it. */}
            <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800">
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
                  {/* The ONE column this board is ordered by, and the arrow that turns it round.
                      A button rather than a click handler on the cell: the arrow is a control, and
                      a control a keyboard cannot reach is one half the readers cannot use. */}
                  <button
                    type="button"
                    data-licensing-sort={expiryDir}
                    onClick={() => patch({ sort: expiryDir === 'asc' ? 'desc' : null })}
                    aria-label={t('fleet.vehicles.fields.licenseExpiresAt')}
                    className="mx-auto inline-flex items-center gap-1 rounded hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 dark:hover:text-slate-200"
                  >
                    {t('fleet.vehicles.fields.licenseExpiresAt')}
                    <ChevronIcon
                      className={cn(
                        'h-3.5 w-3.5 transition-transform',
                        expiryDir === 'asc' && 'rotate-180',
                      )}
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
                  className="border-t border-slate-200 dark:border-slate-800"
                >
                  <td className={`${cell} text-center font-mono`} dir="ltr">
                    {row.code}
                  </td>
                  <td className={`${cell} text-center`} dir="ltr">
                    {row.plateNumber}
                  </td>
                  <td className={`${cell} text-center font-mono text-xs`} dir="ltr">
                    {row.chassisNumber}
                  </td>
                  <td className={`${cell} text-center tabular-nums whitespace-nowrap`}>
                    {formatDate(row.licenseExpiresAt, locale)}
                  </td>
                  {PAPERS.map((paper) => {
                    // ONE READING PER PAPER, used by both its squares — the pair is coloured
                    // together because the pair is one errand, and computing it twice is how the
                    // two halves of a cell end up disagreeing.
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
    </PageContainer>
  );
};
