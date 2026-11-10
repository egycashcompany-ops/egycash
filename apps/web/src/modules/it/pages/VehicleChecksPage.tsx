// `/it/vehicle-checks` — «فحص أجهزة السيارات», the dashboard of the reports the phone form files
// (docs/12-planning/it-vehicle-checks-design.md §9, «Next delivery: the dashboard»).
//
// «الـ Dashboard مش هتكون عند الحركة .. هتبقي عند الـ IT» · «فين الـ DashBoard؟ اللى بيظهر فيه التقرير
// والبيانات اللى الناس بتدخلها» — a sample was shown, and the owner answered «تمام نفذا الـ Dashboard
// بتاعت الفحص» (2026-11-10). This is that sample, in the app's own components and in its order: the
// title with the files and «تقرير جديد»; the filter bar; the six tiles; «الأعطال حسب الجهاز» beside
// the cars not checked for a week; every car's devices in its latest report; the latest reports.
//
// EVERY NUMBER IS THE SERVER'S, under the reader's data scope — the branch each report was filed
// under. The tiles, the bars and the overdue list follow the period and the branch; the matrix also
// follows the car, «بها عطل» and the device (rows of the same answer, narrowed here); the reports
// list sends them all — save the period for a car pinned by «كل تقارير هذه السيارة», whose every
// report it lists (`lib/vehicle-check-dashboard.ts`).
//
// No sentence under the title, though the sample had one: a page header carries no subtitle, by the
// owner's standing decision (`page-header-has-no-subtitle.spec.ts`).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  IT_VEHICLE_CHECK_ITEMS,
  IT_VEHICLE_CHECK_OVERDUE_DAYS,
  type ItVehicleCheckDashboardDto,
  type ItVehicleCheckDto,
  type ItVehicleCheckItem,
  type ItVehicleCheckLatestDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { useAppSelector } from '../../../store';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { StatCard } from '../../../shared/ui/StatCard';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { Badge } from '../../../shared/ui/Badge';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { FilterBar, filterResetTone } from '../../../shared/ui/FilterBar';
import { FilterField } from '../../../shared/ui/FilterField';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Pagination } from '../../../shared/ui/Pagination';
import { Checkbox, Select } from '../../../shared/ui/form';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import {
  AlertIcon,
  CheckIcon,
  ClipboardIcon,
  CloseIcon,
  ImageIcon,
  MinusIcon,
  PlusIcon,
  TruckIcon,
  UsersIcon,
  WrenchIcon,
} from '../../../shared/ui/icons';
import { cn } from '../../../shared/lib/cn';
import { formatDate, formatNumber, localized } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { saveSheet } from '../../fleet/lib/fleet-sheet';
import * as api from '../api/it-api';
import {
  useItBranchOptions,
  useItVehicleCheckDashboard,
  useItVehicleChecks,
} from '../api/it-queries';
import { RegisterExportButtons } from '../components/RegisterExportButtons';
import { STATE_CHIP, VehicleCheckReport } from '../components/VehicleCheckReport';
import { gatherRegister, printItRegister } from '../lib/register-export';
import {
  VEHICLE_CHECK_PERIODS,
  cairoToday,
  carPinned,
  carReportsPatch,
  carText,
  counted,
  dashboardQuery,
  deviceLabel,
  deviceShortLabel,
  deviceState,
  failedDevices,
  faultBars,
  formatYmd,
  hasVehicleCheckFilters,
  matrixRows,
  overdueEmptyWords,
  overdueWords,
  patchedSearch,
  photoWords,
  readDevice,
  readPeriod,
  reportsPageBeyondEnd,
  reportsQuery,
  reportsWindow,
  sentWhen,
  stateWord,
  statusWords,
  toggleDevice,
  type DeviceState,
  type VehicleCheckFilters,
} from '../lib/vehicle-check-dashboard';
import {
  vehicleCheckRegisterFilters,
  vehicleCheckRegisterHeader,
  vehicleCheckRegisterReport,
  vehicleCheckRegisterSubtitle,
  vehicleCheckSheetLine,
} from '../lib/vehicle-check-export';

/**
 * Remembered across visits: the period, the branch, the car (as typed, and by id when picked from a
 * report), «بها عطل» and the device. `page` is derived, never kept.
 */
const REMEMBERED_FILTERS = ['branch', 'car', 'device', 'faults', 'period', 'vehicle'] as const;

/** A dashboard panel: a card with its question as the title. */
const Panel = ({
  title,
  hint,
  action,
  className,
  children,
}: {
  title: string;
  hint?: string;
  action?: JSX.Element;
  className?: string;
  children: JSX.Element;
}): JSX.Element => (
  <Card className={cn('flex min-w-0 flex-col', className)}>
    <CardHeader
      title={title}
      {...(hint === undefined ? {} : { description: hint })}
      {...(action === undefined ? {} : { actions: action })}
    />
    <CardBody className="min-w-0 flex-1">{children}</CardBody>
  </Card>
);

/** Rows on their way: the panel keeps its shape rather than collapsing and jumping back. */
const PendingRows = ({ rows = 4 }: { rows?: number }): JSX.Element => (
  <div className="space-y-3">
    {Array.from({ length: rows }, (_, i) => (
      <Skeleton key={i} className="h-9 w-full" />
    ))}
  </div>
);

/** The panel's body by the state of the dashboard read: waiting, failed (with a retry), or rows. */
const byState = (
  query: {
    data: ItVehicleCheckDashboardDto | undefined;
    isError: boolean;
    error: unknown;
    refetch: () => unknown;
  },
  rows: (data: ItVehicleCheckDashboardDto) => JSX.Element,
): JSX.Element => {
  if (query.isError && query.data === undefined) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (query.data === undefined) return <PendingRows />;
  return rows(query.data);
};

/** The cell of one device: ✓ on emerald, ✕ on red, – on slate — and its words for a reader. */
const CELL_ICON: Record<DeviceState, typeof CheckIcon> = {
  works: CheckIcon,
  notWorking: CloseIcon,
  unanswered: MinusIcon,
};

const StateMark = ({
  state,
  label,
  size = 'md',
}: {
  state: DeviceState;
  /** The cell's whole meaning, «كاميرا ٧ — داخل الخزينة 1: لا يعمل» — the mark alone is a picture. */
  label?: string;
  size?: 'sm' | 'md';
}): JSX.Element => {
  const Icon = CELL_ICON[state];
  return (
    <span
      {...(label === undefined
        ? { 'aria-hidden': true }
        : { role: 'img', 'aria-label': label, title: label })}
      data-state={state}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md',
        size === 'md' ? 'h-7 w-7' : 'h-5 w-5',
        STATE_CHIP[state],
      )}
    >
      <Icon className={size === 'md' ? 'h-4 w-4' : 'h-3 w-3'} aria-hidden="true" />
    </span>
  );
};

/** «عرض التقرير» — the sample's indigo outline, on every row and every card. */
const OPEN_REPORT =
  'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-lg border border-brand-200 bg-brand-50 px-3 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:border-brand-800 dark:bg-brand-950/50 dark:text-brand-300 dark:hover:bg-brand-900/50';

// ── The filters ──────────────────────────────────────────────────────────────

const VehicleCheckFilterBar = ({
  filters,
  branches,
  onPatch,
  onClear,
}: {
  filters: VehicleCheckFilters;
  branches: { id: string; name: string }[];
  onPatch: (updates: Record<string, string | null>) => void;
  onClear: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  // A branch the link or the remembered view names that the options do not hold (closed, or not
  // loaded yet) stays visible as «فرع محدد» — the box must not read «كل الفروع» while it narrows.
  const unlisted = filters.branchId !== '' && !branches.some((b) => b.id === filters.branchId);
  return (
    <FilterBar>
      <FilterField label={t('it.vehicleChecks.filters.period')} className="w-full sm:w-auto">
        <div
          role="group"
          aria-label={t('it.vehicleChecks.filters.period')}
          className="flex h-9 overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700"
          data-period=""
        >
          {VEHICLE_CHECK_PERIODS.map((period) => {
            const on = filters.period === period;
            return (
              <button
                key={period}
                type="button"
                aria-pressed={on}
                data-period-option={period}
                // The default stays off the URL, so a bare arrival still means «آخر ٧ أيام».
                onClick={() => onPatch({ period: period === '7' ? null : period })}
                className={cn(
                  'flex-1 whitespace-nowrap px-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40 sm:flex-none',
                  on
                    ? 'bg-brand-600 text-white'
                    : 'bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
                )}
              >
                {t(`it.vehicleChecks.period.${period}`)}
              </button>
            );
          })}
        </div>
      </FilterField>
      <FilterField
        label={t('it.assets.columns.branch')}
        active={filters.branchId !== ''}
        className="w-full sm:w-48"
      >
        <Select
          aria-label={t('it.assets.columns.branch')}
          value={filters.branchId}
          onChange={(e) => onPatch({ branch: e.target.value || null })}
        >
          <option value="">{t('it.assets.allBranches')}</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
          {unlisted && <option value={filters.branchId}>{t('it.export.oneBranch')}</option>}
        </Select>
      </FilterField>
      <FilterField
        label={t('it.vehicleChecks.columns.car')}
        active={carText(filters.car) !== '' || filters.vehicleId !== ''}
        className="w-full sm:w-52"
      >
        {/* Typing drops a car picked by its id: what the box says is then the filter. The text is
            kept as typed, as on every IT register: mapped to nothing, «   » never reached the
            URL, and the box, still differing from it, wrote again every 300 ms. */}
        <SearchInput
          value={filters.car}
          placeholder={t('it.vehicleCheck.vehiclePlaceholder')}
          onChange={(value) => onPatch({ car: value || null, vehicle: null })}
        />
      </FilterField>
      <div className="flex h-9 items-center self-end rounded-lg border border-slate-200 px-3 dark:border-slate-700">
        <Checkbox
          label={t('it.vehicleChecks.filters.faultsOnly')}
          checked={filters.faults}
          data-faults-only=""
          onChange={(e) => onPatch({ faults: e.target.checked ? 'true' : null })}
        />
      </div>
      {filters.device !== null && (
        <span
          data-device-chip={filters.device}
          className="inline-flex h-9 items-center gap-1.5 self-end rounded-full bg-red-100 pe-1.5 ps-3 text-sm font-medium text-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {t('it.vehicleChecks.filters.deviceIs', {
            device: deviceLabel(t, locale, filters.device),
          })}
          <button
            type="button"
            onClick={() => onPatch({ device: null })}
            aria-label={t('it.vehicleChecks.filters.clearDevice')}
            title={t('it.vehicleChecks.filters.clearDevice')}
            className="grid h-6 w-6 place-items-center rounded-full hover:bg-red-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:hover:bg-red-900"
          >
            <CloseIcon className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </span>
      )}
      {hasVehicleCheckFilters(filters) && (
        <button
          type="button"
          onClick={onClear}
          data-clear-filters=""
          className={cn(
            'inline-flex h-9 shrink-0 items-center self-end rounded-lg border px-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2',
            filterResetTone('red'),
          )}
        >
          {t('it.dashboard.clearFilters')}
        </button>
      )}
    </FilterBar>
  );
};

// ── The tiles ────────────────────────────────────────────────────────────────

const Tiles = ({
  dashboard,
  failed,
}: {
  dashboard: ItVehicleCheckDashboardDto | undefined;
  failed: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const totals = dashboard?.totals;
  /** A tile: loading, failed (said, never a 0), or the figure and its line. */
  const tile = (
    count: number | undefined,
    caption: string,
  ): { value?: string; caption?: string; loading: boolean } => {
    if (failed && totals === undefined) {
      return { caption: t('it.overview.countUnavailable'), loading: false };
    }
    if (count === undefined) return { loading: true };
    return { value: formatNumber(count, locale), caption, loading: false };
  };
  const days = counted(t, locale, 'days', dashboard?.overdueDays ?? IT_VEHICLE_CHECK_OVERDUE_DAYS);
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6" data-tiles="">
      <StatCard
        label={t('it.vehicleChecks.tiles.reports')}
        icon={ClipboardIcon}
        tone="brand"
        {...tile(
          totals?.reports,
          totals === undefined || totals.reports === 0
            ? t('it.vehicleChecks.tiles.noReports')
            : counted(t, locale, 'reporters', totals.reporters),
        )}
      />
      <StatCard
        label={t('it.vehicleChecks.tiles.carsChecked')}
        icon={TruckIcon}
        tone="success"
        {...tile(
          totals?.carsChecked,
          totals === undefined || totals.activeCars === 0
            ? t('it.vehicleChecks.tiles.noActiveCars')
            : counted(t, locale, 'activeCars', totals.activeCars),
        )}
      />
      <StatCard
        label={t('it.vehicleChecks.tiles.carsWithFaults')}
        icon={AlertIcon}
        tone="danger"
        {...tile(totals?.carsWithFaults, t('it.vehicleChecks.tiles.carsWithFaultsHint'))}
      />
      <StatCard
        label={t('it.vehicleChecks.tiles.devicesNotWorking')}
        icon={WrenchIcon}
        tone="danger"
        {...tile(totals?.devicesNotWorking, t('it.vehicleChecks.tiles.devicesNotWorkingHint'))}
      />
      <StatCard
        label={t('it.vehicleChecks.tiles.overdue', { days })}
        icon={UsersIcon}
        tone="warning"
        {...tile(totals?.overdueCars, t('it.vehicleChecks.tiles.overdueHint'))}
      />
      <StatCard
        label={t('it.vehicleChecks.tiles.withoutPhoto')}
        icon={ImageIcon}
        tone="neutral"
        {...tile(totals?.reportsWithoutPhoto, t('it.vehicleChecks.tiles.withoutPhotoHint'))}
      />
    </div>
  );
};

// ── «الأعطال حسب الجهاز» and the overdue cars ────────────────────────────────

const FaultBars = ({
  dashboard,
  device,
  onDevice,
}: {
  dashboard: ItVehicleCheckDashboardDto;
  device: ItVehicleCheckItem | null;
  onDevice: (item: ItVehicleCheckItem) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <div className="space-y-1">
      {faultBars(dashboard.faultsByDevice).map((bar) => {
        const on = device === bar.item;
        return (
          <button
            key={bar.item}
            type="button"
            data-device-bar={bar.item}
            aria-pressed={on}
            onClick={() => onDevice(bar.item)}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-start transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
              on
                ? 'bg-red-50 ring-2 ring-red-300 dark:bg-red-950/40 dark:ring-red-800'
                : 'hover:bg-slate-50 dark:hover:bg-slate-800/60',
              device !== null && !on && 'opacity-60',
            )}
          >
            <span className="w-32 shrink-0 truncate text-sm font-medium text-slate-800 sm:w-44 dark:text-slate-100">
              {deviceLabel(t, locale, bar.item)}
            </span>
            <span
              className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
              aria-hidden="true"
            >
              <span
                className={cn(
                  'block h-full rounded-full',
                  bar.count === 0 ? 'bg-slate-200 dark:bg-slate-700' : 'bg-red-600 dark:bg-red-500',
                )}
                // A width is the one thing a class cannot say: it is the figure itself.
                style={{ width: `${bar.width}%` }}
              />
            </span>
            <span
              className={cn(
                'w-8 shrink-0 text-end text-sm font-semibold tabular-nums',
                bar.count === 0
                  ? 'text-slate-400 dark:text-slate-500'
                  : 'text-red-700 dark:text-red-300',
              )}
            >
              {formatNumber(bar.count, locale)}
            </span>
          </button>
        );
      })}
    </div>
  );
};

const OverdueList = ({
  dashboard,
  branchName,
}: {
  dashboard: ItVehicleCheckDashboardDto;
  branchName: (id: string | null) => string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <div className="flex h-full flex-col gap-3">
      {dashboard.overdue.length === 0 ? (
        <p
          className="py-6 text-center text-sm text-slate-500 dark:text-slate-400"
          data-overdue-empty=""
        >
          {overdueEmptyWords(t, locale, dashboard)}
        </p>
      ) : (
        // A long list scrolls in its own box, so the matrix below stays where it is.
        <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
          {dashboard.overdue.map((car) => (
            <li
              key={car.vehicleId}
              data-overdue={car.vehicleId}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <span className="flex min-w-0 flex-col">
                <span
                  className="truncate text-sm font-bold text-slate-900 dark:text-white"
                  dir="auto"
                >
                  {car.vehicleCode}
                </span>
                <span className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {branchName(car.branchId)}
                </span>
              </span>
              <span
                className={cn(
                  'shrink-0 text-sm font-semibold',
                  car.lastCheckDate === null
                    ? 'text-red-700 dark:text-red-300'
                    : 'text-amber-700 dark:text-amber-300',
                )}
              >
                {overdueWords(t, locale, car)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-auto text-xs text-slate-500 dark:text-slate-400">
        {t('it.vehicleChecks.overdue.note')}
      </p>
    </div>
  );
};

// ── «حالة أجهزة كل سيارة — آخر تقرير» ────────────────────────────────────────

/**
 * The three marks, in words. In the panel's body above the table, never beside the title: there,
 * as a header action that does not shrink, it squeezed the title to a few letters at 360px.
 */
const Legend = (): JSX.Element => {
  const t = useT();
  return (
    <div
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300"
      data-legends=""
    >
      {(['works', 'notWorking', 'unanswered'] as const).map((state) => (
        <span key={state} className="flex items-center gap-1.5" data-legend={state}>
          <StateMark state={state} size="sm" />
          {stateWord(t, state)}
        </span>
      ))}
    </div>
  );
};

const DeviceMatrix = ({
  rows,
  total,
  branchName,
  onOpen,
}: {
  rows: ItVehicleCheckLatestDto[];
  /** How many cars have a latest report at all — «no report yet» is not «nothing matches». */
  total: number;
  branchName: (id: string | null) => string;
  onOpen: (reportId: string) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const head =
    'whitespace-nowrap px-2 py-2.5 text-xs font-semibold text-slate-600 dark:text-slate-300';
  return (
    // The table scrolls in its own box on a phone, never the page.
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="w-full min-w-[68rem] border-collapse text-sm" data-matrix="">
        <thead>
          <tr className="bg-slate-50 dark:bg-slate-800/60">
            <th scope="col" className={cn(head, 'px-3 text-start')}>
              {t('it.vehicleChecks.columns.car')}
            </th>
            <th scope="col" className={cn(head, 'text-start')}>
              {t('it.assets.columns.branch')}
            </th>
            <th scope="col" className={cn(head, 'text-start')}>
              {t('it.vehicleChecks.columns.lastCheck')}
            </th>
            {IT_VEHICLE_CHECK_ITEMS.map((item) => (
              <th
                key={item}
                scope="col"
                title={deviceLabel(t, locale, item)}
                className={cn(head, 'px-1 text-center')}
              >
                {deviceShortLabel(t, locale, item)}
              </th>
            ))}
            <th scope="col" className={cn(head, 'text-center')}>
              {t('it.vehicleCheck.photos')}
            </th>
            <th scope="col" className={cn(head, 'px-3')}>
              <span className="sr-only">{t('it.vehicleChecks.columns.report')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const faults = failedDevices(row.items).length;
            return (
              <tr
                key={row.vehicleId}
                data-matrix-row={row.vehicleId}
                className="border-t border-slate-100 dark:border-slate-800"
              >
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 dark:text-white" dir="auto">
                      {row.vehicleCode}
                    </span>
                    {faults > 0 && (
                      <Badge tone="danger" size="sm">
                        {counted(t, locale, 'faults', faults)}
                      </Badge>
                    )}
                  </span>
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-slate-700 dark:text-slate-300">
                  {branchName(row.branchId)}
                </td>
                <td className="whitespace-nowrap px-2 py-2 tabular-nums text-slate-700 dark:text-slate-300">
                  {formatYmd(row.checkDate, locale)}
                </td>
                {IT_VEHICLE_CHECK_ITEMS.map((item) => {
                  const state = deviceState(row.items[item]);
                  return (
                    <td key={item} className="px-1 py-1.5 text-center" data-cell={item}>
                      <StateMark
                        state={state}
                        label={t('it.vehicleChecks.cell', {
                          device: deviceLabel(t, locale, item),
                          answer: stateWord(t, state),
                        })}
                      />
                    </td>
                  );
                })}
                <td
                  className={cn(
                    'whitespace-nowrap px-2 py-2 text-center tabular-nums',
                    row.photoCount === 0
                      ? 'font-semibold text-amber-700 dark:text-amber-300'
                      : 'text-slate-700 dark:text-slate-300',
                  )}
                >
                  {formatNumber(row.photoCount, locale)}
                </td>
                <td className="px-3 py-2 text-end">
                  <button
                    type="button"
                    className={OPEN_REPORT}
                    data-open-report={row.reportId}
                    aria-label={`${t('it.vehicleChecks.openReport')} — ${row.vehicleCode}`}
                    onClick={() => onOpen(row.reportId)}
                  >
                    {t('it.vehicleChecks.openReport')}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
          {total === 0 ? t('it.vehicleChecks.matrix.none') : t('it.vehicleChecks.matrix.empty')}
        </p>
      )}
    </div>
  );
};

// ── «آخر التقارير» ───────────────────────────────────────────────────────────

const ReportCard = ({
  report,
  onOpen,
}: {
  report: ItVehicleCheckDto;
  onOpen: (reportId: string) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const status = statusWords(t, locale, report.items);
  const failed = failedDevices(report.items);
  return (
    <article
      data-report={report.id}
      className="flex min-w-0 flex-col gap-2.5 rounded-lg border border-slate-200 p-3.5 dark:border-slate-800"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-base font-bold text-slate-900 dark:text-white" dir="auto">
            {report.vehicleCode}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {formatYmd(report.checkDate, locale)} · {sentWhen(t, locale, report)} ·{' '}
            {report.reportedByName}
          </span>
        </span>
        <Badge tone={status.tone} className="shrink-0 whitespace-nowrap">
          {status.text}
        </Badge>
      </div>
      {failed.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('it.vehicleChecks.columns.faults')}>
          {failed.map((item) => (
            <li
              key={item}
              data-failed={item}
              className="rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
            >
              {deviceLabel(t, locale, item)}
            </li>
          ))}
        </ul>
      )}
      {report.notes !== null && (
        <p className="whitespace-pre-line break-words rounded-lg bg-slate-50 px-2.5 py-2 text-sm text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
          {report.notes}
        </p>
      )}
      <div className="mt-auto flex items-center justify-between gap-2">
        <span
          className={cn(
            'flex items-center gap-1.5 text-xs',
            report.photos.length === 0
              ? 'font-semibold text-amber-700 dark:text-amber-300'
              : 'text-slate-500 dark:text-slate-400',
          )}
          data-photo-count={report.photos.length}
        >
          <ImageIcon className="h-4 w-4" aria-hidden="true" />
          {photoWords(t, locale, report.photos.length)}
        </span>
        <button
          type="button"
          className={OPEN_REPORT}
          data-open-report={report.id}
          aria-label={`${t('it.vehicleChecks.openReport')} — ${report.vehicleCode}`}
          onClick={() => onOpen(report.id)}
        >
          {t('it.vehicleChecks.openReport')}
        </button>
      </div>
    </article>
  );
};

// ── The page ─────────────────────────────────────────────────────────────────

export const VehicleChecksPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const [openId, setOpenId] = useState<string | null>(null);

  const paramsKey = sp.toString();
  const filters: VehicleCheckFilters = useMemo(
    () => ({
      period: readPeriod(sp.get('period')),
      branchId: sp.get('branch') ?? '',
      car: sp.get('car') ?? '',
      vehicleId: sp.get('vehicle') ?? '',
      faults: sp.get('faults') === 'true',
      device: readDevice(sp.get('device')),
    }),
    [paramsKey],
  );
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  // Today in Cairo, the day the server reads «اليوم» as.
  const today = cairoToday();

  /** A change of filters — not written at all when the URL would read the same (`patchedSearch`). */
  const patch = (
    updates: Record<string, string | null>,
    resetPage = true,
    replace = false,
  ): void => {
    const next = patchedSearch(sp, updates, resetPage);
    if (next !== null) setSp(next, { replace });
  };

  const dashboard = useItVehicleCheckDashboard(dashboardQuery(filters, today));
  const reportsParams = reportsQuery(filters, today, page);
  const reports = useItVehicleChecks(reportsParams);
  const pinned = carPinned(filters);

  // A page past the last — `?page=2` once its only card was deleted, or an old link — moves to the
  // last page, once the answer for it is in (not the page before standing in for it). It replaces
  // the entry: Back must not land on the empty page again.
  const lastPage =
    reports.data !== undefined && !reports.isPlaceholderData
      ? reportsPageBeyondEnd(page, reports.data.meta)
      : null;
  useEffect(() => {
    if (lastPage !== null) patch({ page: lastPage === 1 ? null : String(lastPage) }, false, true);
  }, [lastPage]);

  const branches = useItBranchOptions();
  const branchOptions = useMemo(
    () =>
      (branches.data ?? []).map((branch) => ({
        id: branch.id,
        name: localized(branch.name, locale),
      })),
    [branches.data, locale],
  );
  const branchNames = useMemo(
    () => new Map(branchOptions.map((branch) => [branch.id, branch.name])),
    [branchOptions],
  );
  // A report filed for a car with no branch says so with a dash; a branch the options do not hold
  // (closed, not loaded yet) is «فرع محدد», never an id.
  const branchName = useCallback(
    (id: string | null): string =>
      id === null ? '—' : (branchNames.get(id) ?? t('it.export.oneBranch')),
    [branchNames, t],
  );

  const matrix = useMemo(
    () => matrixRows(dashboard.data?.latest ?? [], filters),
    [dashboard.data, filters],
  );

  /**
   * «كل تقارير هذه السيارة»: the car by its id, its code in the box, «بها عطل» and the device
   * cleared, and the list — every day of it — brought into view.
   */
  const showCarReports = (car: { vehicleId: string; vehicleCode: string }): void => {
    setOpenId(null);
    patch(carReportsPatch(car));
    document.getElementById('vehicle-check-reports')?.scrollIntoView({ behavior: 'smooth' });
  };

  // ── The reports as a file: Excel and PDF, of everything the filters match ────────────────────
  const exportContext = { t, locale, branchName: branchNames };
  // Every report the filters match, newest first — the list's own params, unpaged.
  const allRows = () => gatherRegister(reportsParams, api.listVehicleChecks);
  const exportSheet = async (): Promise<void> => {
    const rows = await allRows();
    saveSheet({
      name: t('it.vehicleChecks.title'),
      serialHeader: t('it.export.serial'),
      header: vehicleCheckRegisterHeader(t, locale),
      rows: rows.map((row) => vehicleCheckSheetLine(row, exportContext)),
    });
  };
  const exportPdf = (): Promise<boolean> =>
    printItRegister(async () => {
      const rows = await allRows();
      const subtitle = vehicleCheckRegisterSubtitle(t, {
        ...vehicleCheckRegisterFilters({
          t,
          locale,
          filters,
          // The list's own days: every day for a car pinned by its id.
          window: reportsWindow(filters, today),
          branchName: branchNames,
          rows,
        }),
        asOf: formatDate(new Date().toISOString(), locale),
      });
      return vehicleCheckRegisterReport(rows, exportContext, subtitle);
    }, t('it.export.preparing'));

  const overdueTitle = t('it.vehicleChecks.overdue.title', {
    days: counted(t, locale, 'days', dashboard.data?.overdueDays ?? IT_VEHICLE_CHECK_OVERDUE_DAYS),
  });

  return (
    <PageContainer>
      <PageHeader
        title={t('it.vehicleChecks.title')}
        breadcrumbs={[
          { label: t('it.module.title'), to: '/it' },
          { label: t('it.vehicleChecks.title') },
        ]}
        actions={
          <>
            {/* The files first, the form after them — as on every IT register. Not offered while
                the list failed: the file behind them would be empty or short. */}
            {!reports.isError && (
              <RegisterExportButtons
                name="it-vehicle-checks"
                onExcel={exportSheet}
                onPdf={exportPdf}
              />
            )}
            {can('itVehicleCheck.create') && (
              <Link
                to="/it/vehicle-checks/new"
                data-new-report=""
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
              >
                <PlusIcon className="h-4 w-4" aria-hidden="true" />
                {t('it.vehicleChecks.newReport')}
              </Link>
            )}
          </>
        }
      />

      <div className="space-y-6" aria-busy={dashboard.isFetching}>
        <VehicleCheckFilterBar
          filters={filters}
          branches={branchOptions}
          onPatch={patch}
          onClear={() =>
            patch({ branch: null, car: null, vehicle: null, faults: null, device: null })
          }
        />

        <Tiles dashboard={dashboard.data} failed={dashboard.isError} />

        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <Panel
            title={t('it.vehicleChecks.byDevice.title')}
            hint={t('it.vehicleChecks.byDevice.hint')}
          >
            {byState(dashboard, (data) => (
              <FaultBars
                dashboard={data}
                device={filters.device}
                onDevice={(item) => patch({ device: toggleDevice(filters.device, item) })}
              />
            ))}
          </Panel>
          <Panel
            title={overdueTitle}
            {...(dashboard.data === undefined
              ? {}
              : {
                  action: (
                    <Badge tone="warning" className="tabular-nums">
                      {formatNumber(dashboard.data.totals.overdueCars, locale)}
                    </Badge>
                  ),
                })}
          >
            {byState(dashboard, (data) => (
              <OverdueList dashboard={data} branchName={branchName} />
            ))}
          </Panel>
        </div>

        <Panel title={t('it.vehicleChecks.matrix.title')}>
          <div className="space-y-3">
            <Legend />
            {byState(dashboard, (data) => (
              <DeviceMatrix
                rows={matrix}
                total={data.latest.length}
                branchName={branchName}
                onOpen={setOpenId}
              />
            ))}
          </div>
        </Panel>

        <section id="vehicle-check-reports" className="scroll-mt-4">
          {/* A car pinned by its id lists every day of its reports: the header says the period
              does not apply, or the period pressed above would read as the list's. */}
          <Panel
            title={t('it.vehicleChecks.recent.title')}
            hint={t(
              pinned ? 'it.vehicleChecks.recent.allDaysHint' : 'it.vehicleChecks.recent.hint',
            )}
            {...(pinned
              ? {
                  action: (
                    <span data-all-days="">
                      <Badge tone="brand">{t('it.vehicleChecks.recent.allDays')}</Badge>
                    </span>
                  ),
                }
              : {})}
          >
            {reports.isError && reports.data === undefined ? (
              <ErrorState error={reports.error} onRetry={() => void reports.refetch()} />
            ) : reports.data === undefined ? (
              <PendingRows />
            ) : reports.data.items.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                {t('it.vehicleChecks.recent.empty')}
              </p>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-reports="">
                  {reports.data.items.map((report) => (
                    <ReportCard key={report.id} report={report} onOpen={setOpenId} />
                  ))}
                </div>
                {reports.data.meta.totalPages > 1 && (
                  <Pagination
                    meta={reports.data.meta}
                    onPageChange={(next) => patch({ page: String(next) }, false)}
                  />
                )}
              </div>
            )}
          </Panel>
        </section>
      </div>

      <VehicleCheckReport
        reportId={openId}
        onClose={() => setOpenId(null)}
        onCarReports={showCarReports}
        branchName={branchName}
      />
    </PageContainer>
  );
};
