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
import { type FleetLicensingMark, type FleetLicensingRowDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { Input } from '../../../shared/ui/form';
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
import { formatNumber } from '../../../shared/lib/format';
import { CheckIcon } from '../../../shared/ui/icons';
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
const REMEMBERED_FILTERS = ['code', 'plate', 'chassis', 'ins', 'tax'] as const;

/** A text filter, matched the way the registry's own boxes match: contains, case-insensitively. */
const contains = (haystack: string, needle: string): boolean =>
  needle === '' || haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase());

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

  const code = sp.get('code') ?? '';
  const plate = sp.get('plate') ?? '';
  const chassis = sp.get('chassis') ?? '';
  const insurance = readList(sp, 'ins');
  const tax = readList(sp, 'tax');

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
    patch({ code: null, plate: null, chassis: null, ins: null, tax: null });
  const hasFilters =
    code !== '' || plate !== '' || chassis !== '' || insurance.length > 0 || tax.length > 0;

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
          contains(row.code, code) &&
          contains(row.plateNumber, plate) &&
          contains(row.chassisNumber, chassis) &&
          matchesPaper(row, PAPERS[0], insurance) &&
          matchesPaper(row, PAPERS[1], tax),
      ),
    [all, code, plate, chassis, insurance.join(','), tax.join(',')],
  );

  const stepOptions = [
    { value: 'handover', label: t('fleet.licensing.columns.handover') },
    { value: 'receipt', label: t('fleet.licensing.columns.receipt') },
  ];

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
      />

      {/* The module's own filter strip. `singleRow` because five controls fit one line at the width
          this screen is read at, and a bar that wrapped would push the board itself below the
          fold on the very screen whose point is seeing the whole list at once. */}
      <FilterBar
        singleRow
        hasActiveFilters={hasFilters}
        onClear={clearFilters}
        // HOW MANY ARE SHOWN, AND HOW MANY THERE ARE — «واعمل الاجمالى جمب العداد ... جمب
        // الفلاتر». Two figures, both named and both ALWAYS on the bar: a count that appeared only
        // once a filter was on would be a number the reader has to notice arriving, and the
        // «الإجمالى» beside it is the one that says how much of the board a filter took away.
        //
        // `trailing` rather than a last child, so the pair sits at the end of the row whether or
        // not the reset button is showing and does not jump sideways the moment a filter clears.
        //
        // The total is the WHOLE board, never the narrowed list: derived from `rows` it would read
        // «المعروض ١ · الإجمالى ١» under every filter, which is a number that can never say
        // anything.
        trailing={
          <span className="flex items-center gap-3 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">
            <span data-licensing-count>
              {t('fleet.licensing.shownCount', { count: formatNumber(rows.length, locale) })}
            </span>
            <span data-licensing-total className="font-semibold text-slate-700 dark:text-slate-200">
              {t('fleet.licensing.totalCount', { count: formatNumber(all.length, locale) })}
            </span>
          </span>
        }
      >
        <div className="min-w-[8rem] flex-1">
          <Input
            aria-label={t('fleet.licensing.columns.vehicle')}
            placeholder={t('fleet.licensing.columns.vehicle')}
            value={code}
            onChange={(e) => patch({ code: e.target.value || null })}
            textScale="comfortable"
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
              {rows.map((row) => (
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
