// التمامات (FW-5, legacy /fleet_attendance): the fleet's operational unavailability overlay —
// official leave stays in HR and is consulted by the availability seam server-side. URL-synced
// covers-date filter + pagination + sortable date columns; record picks the driver through the
// directory; edit/cancel are version-aware and behind `fleetAvailability.edit`.
//
// «حسن الui زى شاشة السيارات و السواقيين»: the drivers board's look — no page title, a bar with
// the count and the add button, the dark filter bar with an icon on its filter, and the vehicles
// table without lines between its columns.
//
// «تحسين شكل البيانات فى جداول … التمامات»: the drivers board's table — every value and header
// centred, a date year first with slashes in Latin digits («2026/10/25»), each driver drawn as
// the drivers board draws one (badge, name, code under it), an empty cell a grey dash.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type FleetDriverUnavailabilityDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../components/board-scroll';
import { FleetPager } from '../components/FleetPager';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { Input } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { EditIcon, TrashIcon } from '../../../shared/ui/icons';
import { cn } from '../../../shared/lib/cn';
import { formatNumber } from '../../../shared/lib/format';
import { useCancelUnavailability, useUnavailability } from '../api/fleet-queries';
import { DARK_FILTER_BAR } from '../components/dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from '../components/FilterWithIcon';
import { BoardIcon, NUM, PATH, ymd } from '../components/FuelCardBoard';
import { DARK_TABLE } from './VehiclesListPage';
import { DriverCell } from '../components/DriverPerson';
import { UnavailabilityDialog } from '../components/UnavailabilityDialog';
import { clickSort, readSorts, sortQuery, writeSorts } from '../lib/table-sort';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'size',
  'sort',
] as const;

const DEFAULT_PAGE_SIZE = 25;

/**
 * The order this screen opens in, before the reader has asked for one.
 *
 * Named, because it is used twice and the two must agree: the table is DRAWN in it, and a
 * first click REPLACES it rather than joining it — see `clickSort`.
 */
const DEFAULT_SORT = 'from:desc';

/** The filter is `density="tight"`, as on the vehicles board. */
const TIGHT = 'tight' as const;

/** The vehicles board's add button: the site's purple, as a gradient. */
/** An empty cell, as the boards draw one. */
const DASH = <span className="text-slate-400">—</span>;

/**
 * «2026/10/25»: a day as the vehicles and drivers boards write one — year first, slashes, Latin
 * digits, in the boards' tabular monospace, left to right and never broken over two lines.
 */
const Day = ({ iso }: { iso: string }): JSX.Element => (
  <span dir="ltr" className={cn('whitespace-nowrap', NUM)}>
    {ymd(iso)}
  </span>
);

/** A free text on the row, wrapped and centred in its cell. */
const PROSE = 'mx-auto block max-w-xs whitespace-normal break-words';

const ADD_BUTTON =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-gradient-to-r from-brand-700 to-brand-500 px-2 py-1.5 text-[11px] font-black text-white shadow-md shadow-brand-700/30 transition hover:from-brand-600 hover:to-brand-400 sm:gap-1.5 sm:px-3.5 sm:py-2 sm:text-xs active:scale-95';

export const AttendancePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const coversDate = sp.get('date') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  /**
   * The columns this table is sorted by, in the order the reader clicked them —
   * «انا عاوز اقدر اعمل الاتنين مع بعض». One parameter carries the whole order; `from:desc`
   * is where the screen starts when the reader has not said otherwise.
   */
  const sortParam = sp.get('sort');
  const sorts = useMemo(() => readSorts(sortParam, DEFAULT_SORT), [sortParam]);
  const paramsKey = sp.toString();

  const patch = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next);
  };
  // Ascending, then descending, then out of the order altogether — and a column the table
  // is NOT sorted by joins the end of it rather than replacing what is there.
  const changeSort = (by: string): void => {
    patch({ sort: writeSorts(clickSort(sortParam, DEFAULT_SORT, by)) }, false);
  };

  const params = useMemo(
    () => ({
      page,
      pageSize,
      ...sortQuery(sorts),
      coversDate: coversDate || undefined,
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useUnavailability(params);
  const rows = data?.items ?? [];

  const [recordOpen, setRecordOpen] = useState(false);
  const [editing, setEditing] = useState<FleetDriverUnavailabilityDto | null>(null);
  const [cancelling, setCancelling] = useState<FleetDriverUnavailabilityDto | null>(null);
  const cancel = useCancelUnavailability();

  const confirmCancel = async (): Promise<void> => {
    if (cancelling === null) return;
    await cancel.mutateAsync(cancelling.id);
    toast.success(t('fleet.attendance.cancelled'));
    setCancelling(null);
  };

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const columns: Column<FleetDriverUnavailabilityDto>[] = [
    // «اعتمد دى»: the person as the drivers board draws one — the badge, the name, the code under it.
    {
      key: 'driver',
      align: 'center',
      header: t('fleet.attendance.fields.driver'),
      render: (r) => <DriverCell employeeId={r.employeeId} />,
    },
    {
      key: 'from',
      align: 'center',
      header: t('fleet.attendance.fields.from'),
      sortable: true,
      render: (r) => <Day iso={r.from} />,
    },
    {
      key: 'to',
      align: 'center',
      header: t('fleet.attendance.fields.to'),
      sortable: true,
      render: (r) => <Day iso={r.to} />,
    },
    // Wrapped, as the other boards' notes are: the dark table keeps its cells on one line, and a
    // reason or a note that could not wrap would widen the row and push its actions away.
    {
      key: 'reason',
      align: 'center',
      header: t('fleet.attendance.fields.reason'),
      render: (r) => <span className={PROSE}>{r.reason}</span>,
    },
    {
      key: 'notes',
      align: 'center',
      header: t('fleet.attendance.fields.notes'),
      render: (r) => (r.notes === null ? DASH : <span className={PROSE}>{r.notes}</span>),
    },
    ...(can('fleetAvailability.edit')
      ? [
          {
            key: 'actions',
            header: t('fleet.vehicles.columns.actions'),
            align: 'end',
            render: (r: FleetDriverUnavailabilityDto) => (
              <span className="flex items-center justify-end gap-1">
                <button
                  type="button"
                  className={actionButton}
                  aria-label={t('fleet.attendance.edit')}
                  title={t('fleet.attendance.edit')}
                  onClick={() => setEditing(r)}
                >
                  <EditIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className={actionButton}
                  aria-label={t('fleet.attendance.cancel')}
                  title={t('fleet.attendance.cancel')}
                  onClick={() => setCancelling(r)}
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </span>
            ),
          } satisfies Column<FleetDriverUnavailabilityDto>,
        ]
      : []),
  ];

  return (
    <PageContainer fullHeight>
      <div className={BOARD_FRAME}>
        <div className="flex items-center justify-between gap-2" data-attendance-toolbar="true">
          {/* How many records the filter matched, over the WHOLE set — `totalItems`, not the
              page's length. Nothing is written while the answer is in flight. */}
          <span
            role="status"
            data-filtered-count
            title={t('fleet.filters.matchedRows')}
            className="text-sm font-bold text-slate-600 dark:text-slate-300"
          >
            {data === undefined
              ? ''
              : t('common.list.count', { count: formatNumber(data.meta.totalItems, locale) })}
          </span>
          <span className="flex shrink-0 items-center gap-1 sm:gap-2">
            <Can permission="fleetAvailability.record">
              <button
                type="button"
                data-attendance-add="true"
                onClick={() => setRecordOpen(true)}
                className={ADD_BUTTON}
              >
                <BoardIcon d={PATH.plus} className="h-3.5 w-3.5" width={2.5} />
                <span className="sm:hidden">{t('fleet.vehicles.board.addShort')}</span>
                <span className="hidden sm:inline">{t('fleet.attendance.record')}</span>
              </button>
            </Can>
          </span>
        </div>

        {/* The vehicles board's dark bar, its one filter with its icon and its name written in
            the box. */}
        <div className={DARK_FILTER_BAR}>
          <FilterBar hasActiveFilters={coversDate !== ''} onClear={() => patch({ date: null })}>
            {/* The bar shares its row among its filters on a computer; with one, the box keeps a
                date's width inside its share rather than stretching across the page. */}
            <div>
              <FilterWithIcon
                icon={FILTER_ICON.calendar}
                tone="text-cyan-600 dark:text-cyan-400"
                className="w-44"
              >
                {/* A date box paints «yyyy-mm-dd» whatever placeholder it is given, so while it is
                    empty and not being typed in, that mask is hidden and the filter's name is
                    drawn over it — the box keeps its `aria-label`, and a click passes through. */}
                <Input
                  id="attendance-covers-date"
                  type="date"
                  dir="ltr"
                  density={TIGHT}
                  aria-label={t('fleet.attendance.coversDate')}
                  title={t('fleet.attendance.coversDate')}
                  value={coversDate}
                  onChange={(e) => patch({ date: e.target.value || null })}
                  className={cn(
                    'dark:[color-scheme:dark]',
                    coversDate === '' && 'peer [&:not(:focus)::-webkit-datetime-edit]:opacity-0',
                  )}
                />
                {coversDate === '' && (
                  <span
                    aria-hidden="true"
                    data-date-caption="date"
                    className="pointer-events-none absolute inset-y-0 left-1.5 right-11 flex items-center justify-center truncate text-sm text-slate-500 peer-focus:hidden lg:max-xl:text-xs dark:text-slate-400"
                  >
                    {t('fleet.attendance.coversDate')}
                  </span>
                )}
              </FilterWithIcon>
            </div>
          </FilterBar>
        </div>

        {/* The vehicles table — «زى السيارات». */}
        <div
          className={cn(
            DARK_TABLE,
            BOARD_TABLE_FILL,
            // No line between the columns, as on the drivers board.
            '[&_td+td]:!border-s-0 [&_th+th]:!border-s-0',
            // Every value heavy, the Arabic in Cairo's own bold.
            "[&_td]:[font-family:'Cairo',ui-sans-serif,sans-serif] [&_td_*]:!font-bold",
          )}
        >
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            loading={isLoading}
            error={isError ? error : undefined}
            onRetry={() => void refetch()}
            sort={sorts}
            onSortChange={changeSort}
            minColumnWidth={4}
            stickyHead
          />
        </div>
        {data !== undefined && data.meta.totalItems > 0 && (
          <FleetPager
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      <UnavailabilityDialog open={recordOpen} onClose={() => setRecordOpen(false)} record={null} />
      <UnavailabilityDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        record={editing}
      />
      <Dialog
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title={t('fleet.attendance.cancelTitle')}
        description={cancelling?.reason ?? ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelling(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={cancel.isPending}
              onClick={() => void confirmCancel()}
            >
              {t('fleet.attendance.cancel')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('fleet.attendance.cancelBody')}
        </p>
      </Dialog>
    </PageContainer>
  );
};
