// Maintenance alarms (FW-6, legacy /cars_alarm): the FR-3 projection exactly as the server
// derives it per request — remaining = interval − (latest reading − counter at last counting
// service) — nothing recomputed here. The whole board arrives in one call, so level filter and
// code search are client-side over live data; triage order is red first, most-overdue first.
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type FleetMaintenanceAlarmDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { Select } from '../../../shared/ui/form';
import { formatDate, formatNumber } from '../../../shared/lib/format';
import { useMaintenanceAlarms } from '../api/fleet-queries';

const LEVEL_ORDER = { red: 0, yellow: 1, none: 2 } as const;

export const MaintenanceAlarmsPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();

  const level = sp.get('level') ?? '';
  const search = sp.get('q') ?? '';

  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    setSp(next);
  };

  const alarmsQuery = useMaintenanceAlarms();
  const rows = useMemo(() => {
    const all = alarmsQuery.data ?? [];
    const term = search.trim().toLowerCase();
    return all
      .filter((alarm) => (level === '' ? true : alarm.level === level))
      .filter((alarm) => (term === '' ? true : alarm.code.toLowerCase().includes(term)))
      .sort((a, b) =>
        a.level === b.level
          ? (a.remainingKm ?? Number.POSITIVE_INFINITY) -
            (b.remainingKm ?? Number.POSITIVE_INFINITY)
          : LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level],
      );
  }, [alarmsQuery.data, level, search]);

  const columns: Column<FleetMaintenanceAlarmDto>[] = [
    {
      key: 'code',
      header: t('fleet.odometer.columns.vehicle'),
      render: (alarm) => (
        <span className="font-mono text-xs" dir="ltr">
          {alarm.code}
        </span>
      ),
    },
    {
      key: 'level',
      header: t('fleet.alarms.columns.level'),
      render: (alarm) =>
        alarm.level === 'none' ? (
          <Badge tone="neutral">{t('fleet.vehicle.alarmNone')}</Badge>
        ) : (
          <Badge tone={alarm.level === 'red' ? 'danger' : 'warning'}>
            {t(`fleet.dashboard.level.${alarm.level}`)}
          </Badge>
        ),
    },
    {
      key: 'sinceServiceKm',
      header: t('fleet.alarms.columns.sinceService'),
      align: 'end',
      render: (alarm) =>
        alarm.sinceServiceKm === null ? '—' : formatNumber(alarm.sinceServiceKm, locale),
    },
    {
      key: 'remainingKm',
      header: t('fleet.alarms.columns.remaining'),
      align: 'end',
      render: (alarm) =>
        alarm.remainingKm === null ? (
          '—'
        ) : alarm.remainingKm < 0 ? (
          <span className="font-medium text-red-600 dark:text-red-400">
            {t('fleet.dashboard.overdueKm', {
              km: formatNumber(Math.abs(alarm.remainingKm), locale),
            })}
          </span>
        ) : (
          formatNumber(alarm.remainingKm, locale)
        ),
    },
    {
      key: 'lastServiceAt',
      header: t('fleet.vehicle.lastService'),
      render: (alarm) =>
        alarm.lastServiceAt === null ? (
          t('fleet.alarms.noBaseline')
        ) : (
          <span className="tabular-nums">{formatDate(alarm.lastServiceAt, locale)}</span>
        ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('fleet.nav.maintenanceAlarms')}
        description={t('fleet.alarms.subtitle')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.maintenanceAlarms') },
        ]}
        actions={
          <Button
            size="sm"
            variant="secondary"
            loading={alarmsQuery.isFetching}
            onClick={() => void alarmsQuery.refetch()}
          >
            {t('fleet.alarms.refresh')}
          </Button>
        }
      />

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={level !== '' || search !== ''}
          onClear={() => patch({ level: null, q: null })}
        >
          <SearchInput
            value={search}
            onChange={(value) => patch({ q: value || null })}
            placeholder={t('fleet.alarms.searchPlaceholder')}
            className="w-56"
          />
          <Select
            aria-label={t('fleet.alarms.columns.level')}
            value={level}
            onChange={(e) => patch({ level: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('fleet.alarms.allLevels')}</option>
            <option value="red">{t('fleet.dashboard.level.red')}</option>
            <option value="yellow">{t('fleet.dashboard.level.yellow')}</option>
            <option value="none">{t('fleet.vehicle.alarmNone')}</option>
          </Select>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(alarm) => alarm.vehicleId}
          loading={alarmsQuery.isPending}
          error={alarmsQuery.isError ? alarmsQuery.error : undefined}
          onRetry={() => void alarmsQuery.refetch()}
        />
      </div>
    </PageContainer>
  );
};
