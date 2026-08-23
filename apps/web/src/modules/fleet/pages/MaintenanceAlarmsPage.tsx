// Maintenance alarms (FW-6, legacy /cars_alarm): the FR-3 projection exactly as the server
// derives it per request — remaining = interval − (latest reading − counter at last counting
// service) — nothing recomputed here. `GET /fleet/odometer/alarms` takes no query at all and
// answers with the WHOLE board, so both filters are client-side over live data; triage order is
// red first, most-overdue first.
//
// Both filters take more than one answer, because both questions usually have more than one:
// "which cars am I chasing?" is a shortlist, and "which alarms?" is «أحمر وأصفر, not the quiet
// ones». Within a filter the answers are OR'd; the two filters AND together.
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type FleetMaintenanceAlarmDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { MultiSelect, type MultiSelectOption } from '../../../shared/ui/MultiSelect';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { formatDate, formatNumber } from '../../../shared/lib/format';
import { useMaintenanceAlarms } from '../api/fleet-queries';
import { alarmVehicleOptions } from '../lib/alarm-vehicle-options';

const LEVEL_ORDER = { red: 0, yellow: 1, none: 2 } as const;

/** A csv URL parameter as the list it stands for; an absent one is an empty list, never `['']`. */
const csv = (raw: string | null): string[] => (raw ?? '').split(',').filter((v) => v !== '');

export const MaintenanceAlarmsPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();

  // `level` keeps its name and now reads as a LIST, so a bookmarked `?level=red` still means
  // exactly what it used to.
  const levels = csv(sp.get('level'));
  const vehicleCodes = csv(sp.get('vehicleCodes'));

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
    // An empty filter is not a filter: it asks nothing and keeps every row. A non-empty one keeps
    // the rows matching ANY of its answers, and the two run in sequence, which is the AND.
    return all
      .filter((alarm) => levels.length === 0 || levels.includes(alarm.level))
      .filter((alarm) => vehicleCodes.length === 0 || vehicleCodes.includes(alarm.code))
      .sort((a, b) =>
        a.level === b.level
          ? (a.remainingKm ?? Number.POSITIVE_INFINITY) -
            (b.remainingKm ?? Number.POSITIVE_INFINITY)
          : LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level],
      );
  }, [alarmsQuery.data, levels.join(','), vehicleCodes.join(',')]);

  // The cars the board is reporting on, as the picker's options — from the BOARD, never from a
  // second call to the registry: this screen already holds every active vehicle. The rule for
  // keeping a selected-but-unreported code lives beside its own test, because a closed dropdown
  // renders no options and an inline version could not be asserted.
  const vehicleOptions = useMemo(
    () => alarmVehicleOptions(alarmsQuery.data ?? [], vehicleCodes),
    [alarmsQuery.data, vehicleCodes.join(',')],
  );

  // The alarm vocabulary, in TRIAGE order — the same three the board reports and the same order
  // the table sorts by. Nothing is added here: FR-3 derives these and only these.
  const levelOptions: MultiSelectOption[] = [
    { value: 'red', label: t('fleet.dashboard.level.red') },
    { value: 'yellow', label: t('fleet.dashboard.level.yellow') },
    { value: 'none', label: t('fleet.vehicle.alarmNone') },
  ];

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
          hasActiveFilters={levels.length > 0 || vehicleCodes.length > 0}
          onClear={() => patch({ level: null, vehicleCodes: null })}
        >
          <MultiSelect
            className="shrink-0"
            // The chosen codes are NAMED in the trigger rather than counted: a board runs to
            // hundreds of cars, and "3" says nothing about which three are being chased.
            showSelectedValues
            label={t('fleet.odometer.columns.vehicle')}
            options={vehicleOptions}
            value={vehicleCodes}
            onChange={(next) => patch({ vehicleCodes: next.length === 0 ? null : next.join(',') })}
          />
          <MultiSelect
            className="shrink-0"
            label={t('fleet.alarms.allAlarms')}
            options={levelOptions}
            value={levels}
            onChange={(next) => patch({ level: next.length === 0 ? null : next.join(',') })}
          />
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
