// Fleet dashboard (FW-2) — the module's landing surface at /fleet.
//
// The layout is the owner's: a fleet MATRIX (type × branch) beside a branch readout, then the
// distance strip — kilometres by branch, the five highest and the five lowest — beside the
// licences coming due, then the day's accidents and the day's workshop visits with their monthly
// tallies. Every figure is a server aggregate from `GET /fleet/dashboard`; nothing on this screen
// is counted in the browser, and nothing is a placeholder.
//
// PERMISSIONS ARE THE PAYLOAD. A section the caller may not read arrives `null`, so each block
// below renders `data.x !== null` and asks no second question. That is why there is no `can()`
// ladder here any more: one condition, on the server's own answer.
import { useMemo, useState } from 'react';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Card, CardHeader } from '../../../shared/ui/Card';
import { Select } from '../../../shared/ui/form';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { AlertIcon, WrenchIcon } from '../../../shared/ui/icons';
import { formatDate, formatNumber, localized } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { useFleetDashboard } from '../api/fleet-queries';
import { type FleetDashboardDto } from '@ecms/contracts';

/**
 * Which of the three faces the screen wears — as a function, not a chain of early returns only.
 *
 * The node test suite has no DOM and no fetch: React Query's server snapshot reports a data-less
 * query as PENDING whatever the cache holds, so the error branch cannot be reached by rendering
 * there. The decision itself can be, and is — the rendering of it is proven in Chromium against a
 * server that really refuses.
 */
export type DashboardView = 'loading' | 'error' | 'ready';
export const dashboardView = (query: {
  isPending: boolean;
  isError: boolean;
  data: unknown;
}): DashboardView =>
  query.isPending ? 'loading' : query.isError || query.data === undefined ? 'error' : 'ready';

const PanelSkeleton = (): JSX.Element => (
  <div className="space-y-3 p-5">
    {[0, 1, 2, 3].map((i) => (
      <Skeleton key={i} className="h-5 w-full" />
    ))}
  </div>
);

/** The six figures «إحصائيات الفرع» reads out, in the owner's own order and colours. */
const STAT_TILES = [
  { key: 'vehicles', label: 'fleet.dashboard.stat.vehicles', tone: 'sky' },
  { key: 'drivers', label: 'fleet.dashboard.stat.drivers', tone: 'amber' },
  { key: 'cashVehicles', label: 'fleet.dashboard.stat.cashVehicles', tone: 'emerald' },
  { key: 'cashDrivers', label: 'fleet.dashboard.stat.cashDrivers', tone: 'teal' },
  { key: 'atmVehicles', label: 'fleet.dashboard.stat.atmVehicles', tone: 'violet' },
  { key: 'atmDrivers', label: 'fleet.dashboard.stat.atmDrivers', tone: 'indigo' },
] as const;

const TILE_TONE: Record<string, string> = {
  sky: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100',
  amber:
    'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100',
  emerald:
    'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100',
  teal: 'border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-100',
  violet:
    'border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-100',
  indigo:
    'border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100',
};

/** A ranked row: the position, the car, the distance. Green for the busiest, amber for the idlest. */
const RankRow = ({
  place,
  code,
  km,
  tone,
  locale,
}: {
  place: number;
  code: string;
  km: number;
  tone: 'top' | 'bottom';
  locale: 'ar' | 'en';
}): JSX.Element => (
  <li
    data-rank-row={`${tone}-${place}`}
    className={cn(
      'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm',
      tone === 'top'
        ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100'
        : 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100',
    )}
  >
    <span
      className={cn(
        'grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white',
        tone === 'top' ? 'bg-emerald-500' : 'bg-amber-500',
      )}
    >
      {formatNumber(place, locale)}
    </span>
    <span className="font-mono text-xs" dir="ltr">
      {code}
    </span>
    <span className="ms-auto tabular-nums">{formatNumber(km, locale)}</span>
  </li>
);

export const FleetDashboardPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const query = useFleetDashboard();
  const data = query.data;
  /** «كل الفروع» by default; picking one re-reads the same payload, never a second request. */
  const [branch, setBranch] = useState('');

  const branchName = (id: string | null): string => {
    if (id === null) return '—';
    const found = data?.branches.find((b) => b.id === id);
    return found === undefined ? '—' : localized(found.name, locale);
  };

  /** The readout for whichever branch is selected — the company row when none is. */
  const stats = useMemo(
    () => data?.fleet?.stats.find((s) => (branch === '' ? s.branchId === null : s.branchId === branch)),
    [data, branch],
  );

  const maxKm = useMemo(
    () => Math.max(1, ...(data?.odometer?.byBranch ?? []).map((b) => b.km)),
    [data],
  );

  const view = dashboardView(query);

  if (view === 'loading') {
    return (
      <PageContainer>
        <PageHeader title={t('fleet.overview.title')} />
        <div className="grid gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <PanelSkeleton />
            </Card>
          ))}
        </div>
      </PageContainer>
    );
  }

  if (view === 'error' || data === undefined) {
    return (
      <PageContainer>
        <PageHeader title={t('fleet.overview.title')} />
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      </PageContainer>
    );
  }

  const nothing =
    data.fleet === null &&
    data.odometer === null &&
    data.maintenance === null &&
    data.accidents === null;

  return (
    <PageContainer>
      <PageHeader title={t('fleet.overview.title')} />

      {nothing ? (
        <Card>
          <EmptyState
            title={t('fleet.overview.noAccessTitle')}
            description={t('fleet.overview.noAccessBody')}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {/* ── the fleet, by type and branch, beside the branch readout ───────── */}
          {data.fleet !== null && (
            <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
              <Card className="min-w-0">
                <CardHeader title={t('fleet.dashboard.distributionTitle')} />
                {data.fleet.types.length === 0 ? (
                  <EmptyState title={t('fleet.dashboard.distributionEmpty')} />
                ) : (
                  <div className="max-h-72 overflow-auto">
                    <table data-fleet-matrix="true" className="w-full border-collapse text-sm">
                      <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                        <tr>
                          <th className="px-3 py-2 text-start font-semibold">
                            {t('fleet.vehicles.fields.type')}
                          </th>
                          {data.branches.map((b) => (
                            <th key={b.id} className="px-3 py-2 text-center font-semibold">
                              {localized(b.name, locale)}
                            </th>
                          ))}
                          <th className="px-3 py-2 text-center font-semibold">
                            {t('fleet.dashboard.total')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.fleet.types.map((row) => (
                          <tr
                            key={row.typeId}
                            data-matrix-row={row.typeId}
                            className="border-t border-slate-100 dark:border-slate-800"
                          >
                            <td className="px-3 py-2 text-start font-medium text-slate-700 dark:text-slate-200">
                              {localized(row.name, locale)}
                            </td>
                            {data.branches.map((b) => {
                              const count = row.counts[b.id] ?? 0;
                              return (
                                <td
                                  key={b.id}
                                  className={cn(
                                    'px-3 py-2 text-center tabular-nums',
                                    // The heat is the FIGURE, not decoration: a branch holding a
                                    // large share of one type is the thing this table is read for.
                                    count === 0
                                      ? 'text-slate-300 dark:text-slate-600'
                                      : count >= row.total / 2
                                        ? 'bg-brand-50 font-semibold text-brand-800 dark:bg-brand-950/50 dark:text-brand-200'
                                        : 'text-slate-700 dark:text-slate-200',
                                  )}
                                >
                                  {count === 0 ? '—' : formatNumber(count, locale)}
                                </td>
                              );
                            })}
                            <td className="bg-slate-50 px-3 py-2 text-center font-bold tabular-nums text-slate-800 dark:bg-slate-800/60 dark:text-slate-100">
                              {formatNumber(row.total, locale)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card className="min-w-0">
                <CardHeader title={t('fleet.dashboard.branchStatsTitle')} />
                <div className="space-y-3 p-4">
                  <Select
                    aria-label={t('fleet.vehicles.fields.branch')}
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                  >
                    <option value="">{t('fleet.dashboard.allBranches')}</option>
                    {data.branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {localized(b.name, locale)}
                      </option>
                    ))}
                  </Select>
                  <div className="grid grid-cols-2 gap-2">
                    {STAT_TILES.map((tile) => (
                      <div
                        key={tile.key}
                        data-stat={tile.key}
                        className={cn(
                          'rounded-lg border px-3 py-2 text-center',
                          TILE_TONE[tile.tone],
                        )}
                      >
                        <p className="text-[11px] font-medium leading-tight">{t(tile.label)}</p>
                        <p className="mt-0.5 text-xl font-bold tabular-nums">
                          {formatNumber(stats?.[tile.key] ?? 0, locale)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            </div>
          )}

          {/* ── distance, and what is coming due ───────────────────────────────── */}
          <div className="grid gap-4 lg:grid-cols-4">
            {data.odometer !== null && (
              <>
                <Card className="min-w-0">
                  <CardHeader title={t('fleet.dashboard.kmByBranchTitle')} />
                  <ul className="space-y-2 p-4">
                    {data.odometer.byBranch.map((row) => (
                      <li key={row.branchId} data-km-branch={row.branchId}>
                        <div className="flex items-baseline justify-between text-xs">
                          <span className="truncate text-slate-600 dark:text-slate-300">
                            {branchName(row.branchId)}
                          </span>
                          <span className="tabular-nums font-medium text-brand-700 dark:text-brand-300">
                            {formatNumber(row.km, locale)}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className="h-1.5 rounded-full bg-brand-500"
                            style={{ width: `${Math.round((row.km / maxKm) * 100)}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>

                <Card className="min-w-0">
                  <CardHeader title={t('fleet.dashboard.topVehiclesTitle')} />
                  <ul className="space-y-1.5 p-3">
                    {data.odometer.top.map((row, i) => (
                      <RankRow
                        key={row.vehicleId}
                        place={i + 1}
                        code={row.code}
                        km={row.km}
                        tone="top"
                        locale={locale}
                      />
                    ))}
                  </ul>
                </Card>

                <Card className="min-w-0">
                  <CardHeader title={t('fleet.dashboard.bottomVehiclesTitle')} />
                  <ul className="space-y-1.5 p-3">
                    {data.odometer.bottom.map((row, i) => (
                      <RankRow
                        key={row.vehicleId}
                        place={i + 1}
                        code={row.code}
                        km={row.km}
                        tone="bottom"
                        locale={locale}
                      />
                    ))}
                  </ul>
                </Card>
              </>
            )}

            {data.fleet !== null && (
              <Card className="min-w-0">
                <CardHeader title={t('fleet.dashboard.dueLicensesTitle')} />
                {data.fleet.dueLicenses.length === 0 ? (
                  <EmptyState title={t('fleet.dashboard.licensesEmpty')} />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        <tr>
                          <th className="px-3 py-2 text-start font-semibold">
                            {t('fleet.vehicles.fields.branch')}
                          </th>
                          <th className="px-3 py-2 text-start font-semibold">
                            {t('fleet.vehicles.fields.code')}
                          </th>
                          <th className="px-3 py-2 text-start font-semibold">
                            {t('fleet.vehicles.fields.licenseExpiresAt')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.fleet.dueLicenses.map((row) => (
                          <tr
                            key={row.vehicleId}
                            data-due-license={row.vehicleId}
                            className="border-t border-slate-100 dark:border-slate-800"
                          >
                            <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                              {branchName(row.branchId)}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                              {row.code}
                            </td>
                            <td className="px-3 py-2 tabular-nums text-red-600 dark:text-red-400">
                              {formatDate(row.licenseExpiresAt, locale)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}
          </div>

          {/* ── the day: what happened, and how the month is running ───────────── */}
          <div className="grid gap-4 lg:grid-cols-4">
            {data.accidents !== null && (
              <>
                <Card className="min-w-0">
                  <div className="flex h-full flex-col items-center justify-center gap-1 p-5 text-center">
                    <span className="grid h-11 w-11 place-items-center rounded-lg bg-red-50 text-red-500 dark:bg-red-950/50 dark:text-red-300">
                      <AlertIcon className="h-6 w-6" />
                    </span>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {t('fleet.dashboard.accidentsMonthTitle')}
                    </p>
                    <p
                      data-accidents-month="true"
                      className="text-2xl font-bold tabular-nums text-red-600 dark:text-red-300"
                    >
                      {formatNumber(data.accidents.monthCount, locale)}
                    </p>
                    <p className="text-xs text-slate-400">{t('fleet.dashboard.thisMonth')}</p>
                  </div>
                </Card>

                <Card className="min-w-0 lg:col-span-1">
                  <CardHeader title={t('fleet.dashboard.accidentsTodayTitle')} />
                  {data.accidents.today.length === 0 ? (
                    <p className="p-5 text-center text-sm text-emerald-700 dark:text-emerald-300">
                      {t('fleet.dashboard.accidentsTodayEmpty')}
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                      {data.accidents.today.map((a) => (
                        <li
                          key={a.accidentId}
                          data-accident-today={a.accidentId}
                          className="flex items-center gap-2 px-4 py-2 text-sm"
                        >
                          <span className="font-mono text-xs" dir="ltr">
                            {a.code}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">
                            {a.culprit ?? '—'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </>
            )}

            {data.maintenance !== null && (
              <>
                <Card className="min-w-0">
                  <div className="flex h-full flex-col items-center justify-center gap-1 p-5 text-center">
                    <span className="grid h-11 w-11 place-items-center rounded-lg bg-brand-50 text-brand-500 dark:bg-brand-950/50 dark:text-brand-300">
                      <WrenchIcon className="h-6 w-6" />
                    </span>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {t('fleet.dashboard.visitsMonthTitle')}
                    </p>
                    <p
                      data-visits-month="true"
                      className="text-2xl font-bold tabular-nums text-brand-700 dark:text-brand-300"
                    >
                      {formatNumber(data.maintenance.monthCount, locale)}
                    </p>
                    <p className="text-xs text-slate-400">{t('fleet.dashboard.thisMonth')}</p>
                  </div>
                </Card>

                <Card className="min-w-0">
                  <CardHeader title={t('fleet.dashboard.visitsTodayTitle')} />
                  {data.maintenance.today.length === 0 ? (
                    <EmptyState title={t('common.noData')} />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          <tr>
                            <th className="px-3 py-2 text-start font-semibold">
                              {t('fleet.vehicles.fields.code')}
                            </th>
                            <th className="px-3 py-2 text-start font-semibold">
                              {t('fleet.maintenance.fields.spareParts')}
                            </th>
                            <th className="px-3 py-2 text-start font-semibold">
                              {t('fleet.maintenance.fields.workType')}
                            </th>
                            <th className="px-3 py-2 text-start font-semibold">
                              {t('fleet.maintenance.fields.workshop')}
                            </th>
                            <th className="px-3 py-2 text-start font-semibold">
                              {t('fleet.attendance.fields.notes')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.maintenance.today.map((visit) => (
                            <tr
                              key={visit.visitId}
                              data-visit-today={visit.visitId}
                              className="border-t border-slate-100 dark:border-slate-800"
                            >
                              <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                                {visit.code}
                              </td>
                              <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                                {visit.spareParts.length === 0
                                  ? '—'
                                  : visit.spareParts.map((p) => localized(p, locale)).join('، ')}
                              </td>
                              <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                                {visit.workType === null ? '—' : localized(visit.workType, locale)}
                              </td>
                              <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                                {visit.workshop === null ? '—' : localized(visit.workshop, locale)}
                              </td>
                              <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                                {visit.notes ?? '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </>
            )}
          </div>
        </div>
      )}
    </PageContainer>
  );
};

/** Exported for the tests: the tile order the branch readout renders. */
export const dashboardStatTiles = STAT_TILES;
export type FleetDashboardData = FleetDashboardDto;
