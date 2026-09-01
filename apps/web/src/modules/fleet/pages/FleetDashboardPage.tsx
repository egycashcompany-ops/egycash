// Fleet dashboard (FW-2) — the module's landing surface at /fleet. Every number and row is a
// SERVER fact fetched through the fleet query hooks: vehicle counts from the registry, the
// alarm board from the derived FR-3 projection, expiring licenses straight from the license
// filter the backend already exposes. Cards gate their own §7 permission — a query never fires
// for a card the user cannot see, and a user with no fleet permissions gets one honest empty
// state instead of a wall of errors.
import { useMemo } from 'react';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Badge } from '../../../shared/ui/Badge';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { FleetKpi } from '../components/FleetKpi';
import { AlarmBadge } from '../components/AlarmBadge';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { AlertIcon, GaugeIcon, TruckIcon, WrenchIcon } from '../../../shared/ui/icons';
import { formatDate, formatNumber } from '../../../shared/lib/format';
import {
  useAccidents,
  useCanReadAlarms,
  useMaintenanceAlarms,
  useMaintenanceVisits,
  useVehicles,
} from '../api/fleet-queries';

const PanelSkeleton = (): JSX.Element => (
  <div className="space-y-3 p-5">
    {[0, 1, 2, 3].map((i) => (
      <Skeleton key={i} className="h-5 w-full" />
    ))}
  </div>
);

export const FleetDashboardPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state) => state.locale.locale);

  const canVehicles = can('fleetVehicle.view');
  const canMaintenance = can('fleetMaintenance.view');
  // Whoever may read the alarm projection — either door. Same condition the hook gates on.
  const canAlarms = useCanReadAlarms();
  const canAccidents = can('fleetAccident.view');
  const anyCard = canVehicles || canMaintenance || canAlarms || canAccidents;

  // KPI sources — pageSize 1: only the pagination meta (total) is needed.
  const activeVehicles = useVehicles({ status: 'active', pageSize: 1 }, canVehicles);
  const openVisits = useMaintenanceVisits({ open: true, pageSize: 1 }, canMaintenance);
  const alarmsQuery = useMaintenanceAlarms();
  const openAccidents = useAccidents({ status: 'open', pageSize: 1 }, canAccidents);

  // Panel sources.
  const expiryHorizon = useMemo(() => new Date(Date.now() + 60 * 86_400_000).toISOString(), []);
  const expiringLicenses = useVehicles(
    {
      status: 'active',
      licenseExpiresBefore: expiryHorizon,
      pageSize: 8,
      sortBy: 'licenseExpiresAt',
      sortDir: 'asc',
    },
    canVehicles,
  );

  const alarms = useMemo(() => {
    const flagged = (alarmsQuery.data ?? []).filter((a) => a.level !== 'none');
    // Red first, most-overdue first inside each level — triage order.
    return flagged.sort((a, b) =>
      a.level === b.level
        ? (a.remainingKm ?? 0) - (b.remainingKm ?? 0)
        : a.level === 'red'
          ? -1
          : 1,
    );
  }, [alarmsQuery.data]);
  const redCount = alarms.filter((a) => a.level === 'red').length;

  const total = (query: {
    data?: { meta: { totalItems: number } } | undefined;
  }): string | undefined =>
    query.data === undefined ? undefined : formatNumber(query.data.meta.totalItems, locale);

  return (
    <PageContainer>
      <PageHeader title={t('fleet.overview.title')} description={t('fleet.overview.subtitle')} />

      {!anyCard ? (
        <Card>
          <CardBody>
            <EmptyState
              title={t('fleet.overview.noAccessTitle')}
              description={t('fleet.overview.noAccessBody')}
            />
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {canVehicles && (
              <FleetKpi
                label={t('fleet.dashboard.activeVehicles')}
                icon={TruckIcon}
                value={total(activeVehicles)}
                caption={t('fleet.dashboard.activeVehiclesHint')}
              />
            )}
            {canMaintenance && (
              <FleetKpi
                label={t('fleet.dashboard.inWorkshop')}
                icon={WrenchIcon}
                value={total(openVisits)}
                caption={t('fleet.dashboard.inWorkshopHint')}
              />
            )}
            {canAlarms && (
              <FleetKpi
                label={t('fleet.dashboard.alarms')}
                icon={GaugeIcon}
                value={
                  alarmsQuery.data === undefined ? undefined : formatNumber(alarms.length, locale)
                }
                caption={
                  alarmsQuery.data === undefined
                    ? undefined
                    : t('fleet.dashboard.alarmsRed', { count: formatNumber(redCount, locale) })
                }
              />
            )}
            {canAccidents && (
              <FleetKpi
                label={t('fleet.dashboard.openAccidents')}
                icon={AlertIcon}
                value={total(openAccidents)}
                caption={t('fleet.dashboard.openAccidentsHint')}
              />
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {canAlarms && (
              <Card>
                <CardHeader
                  title={t('fleet.dashboard.alarmsTitle')}
                  description={t('fleet.dashboard.alarmsSubtitle')}
                />
                {alarmsQuery.isPending ? (
                  <PanelSkeleton />
                ) : alarmsQuery.isError ? (
                  <ErrorState
                    error={alarmsQuery.error}
                    onRetry={() => void alarmsQuery.refetch()}
                  />
                ) : alarms.length === 0 ? (
                  <EmptyState
                    title={t('fleet.dashboard.alarmsEmpty')}
                    description={t('fleet.dashboard.alarmsEmptyHint')}
                  />
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {alarms.slice(0, 8).map((alarm) => (
                      <li key={alarm.vehicleId} className="flex items-center gap-3 px-5 py-3">
                        <AlarmBadge level={alarm.level} noAlarmReason={alarm.noAlarmReason} />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                          {alarm.code}
                        </span>
                        <span className="shrink-0 text-sm tabular-nums text-slate-500 dark:text-slate-400">
                          {alarm.remainingKm !== null && alarm.remainingKm < 0
                            ? t('fleet.dashboard.overdueKm', {
                                km: formatNumber(Math.abs(alarm.remainingKm), locale),
                              })
                            : t('fleet.dashboard.remainingKm', {
                                km: formatNumber(alarm.remainingKm ?? 0, locale),
                              })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}

            {canVehicles && (
              <Card>
                <CardHeader
                  title={t('fleet.dashboard.licensesTitle')}
                  description={t('fleet.dashboard.licensesSubtitle')}
                />
                {expiringLicenses.isPending ? (
                  <PanelSkeleton />
                ) : expiringLicenses.isError ? (
                  <ErrorState
                    error={expiringLicenses.error}
                    onRetry={() => void expiringLicenses.refetch()}
                  />
                ) : (expiringLicenses.data?.items.length ?? 0) === 0 ? (
                  <EmptyState
                    title={t('fleet.dashboard.licensesEmpty')}
                    description={t('fleet.dashboard.licensesEmptyHint')}
                  />
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(expiringLicenses.data?.items ?? []).map((vehicle) => {
                      const expired = new Date(vehicle.licenseExpiresAt).getTime() < Date.now();
                      return (
                        <li key={vehicle.id} className="flex items-center gap-3 px-5 py-3">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                            {vehicle.code}
                            <span className="ms-2 text-xs font-normal text-slate-400 dark:text-slate-500">
                              {vehicle.plateNumber}
                            </span>
                          </span>
                          <Badge tone={expired ? 'danger' : 'warning'}>
                            {expired
                              ? t('fleet.dashboard.licenseExpired')
                              : t('fleet.dashboard.licenseExpires', {
                                  date: formatDate(vehicle.licenseExpiresAt, locale),
                                })}
                          </Badge>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            )}
          </div>
        </div>
      )}
    </PageContainer>
  );
};
