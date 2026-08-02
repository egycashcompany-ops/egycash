// Daily duty roster (FW-7, legacy roster board): the §4.5 planning screen over FL-5, where the
// SERVER is the only planner — vehicles, the day's assignments, the driver pool split by the
// availability seam (with each refusal's named reason), and the FR-5/6/7 verdicts all arrive
// derived; the page renders them and submits desired state, recomputing nothing. URL-synced
// date + client-side code/plate search over the one live board; assign, edit, clear and
// vehicle-to-vehicle transfer are all the same plan call (only the touched rows travel).
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type FleetRosterRowDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Card, CardHeader } from '../../../shared/ui/Card';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { Dialog } from '../../../shared/ui/Dialog';
import { Input } from '../../../shared/ui/form';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { toast } from '../../../shared/ui/toast/toast-store';
import { ChevronEndIcon, ChevronStartIcon, EditIcon, TrashIcon } from '../../../shared/ui/icons';
import { formatNumber, localized } from '../../../shared/lib/format';
import { useFleetCatalog, usePlanRoster, useRosterDay } from '../api/fleet-queries';
import { EmployeeName } from '../components/EmployeeName';
import { InWorkshopBadge } from '../components/VehicleStatusBadge';
import { RosterAssignDialog } from '../components/RosterAssignDialog';

const today = (): string => new Date().toISOString().slice(0, 10);

const shiftDay = (date: string, delta: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

/** The five seam verdicts (`DriverUnavailableReason`); anything newer shows as sent. */
const KNOWN_REASONS = new Set([
  'noProfile',
  'profileInactive',
  'notEmployed',
  'fleetUnavailability',
  'hrLeave',
]);

const hasFacts = (row: FleetRosterRowDto): boolean =>
  row.missionTypeId !== null || row.driver1EmployeeId !== null || row.driver2EmployeeId !== null;

export const RosterPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();

  const date = sp.get('date') ?? today();
  const search = sp.get('q') ?? '';

  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    setSp(next);
  };

  const boardQuery = useRosterDay(date);
  const board = boardQuery.data;
  const missionTypes = useFleetCatalog('missionType');
  const missionName = (id: string | null): string => {
    if (id === null) return '—';
    const item = missionTypes.data?.items.find((entry) => entry.id === id);
    return item === undefined ? '—' : localized(item.name, locale);
  };

  const term = search.trim().toLowerCase();
  const rows = (board?.rows ?? []).filter(
    (row) =>
      term === '' ||
      row.code.toLowerCase().includes(term) ||
      row.plateNumber.toLowerCase().includes(term),
  );
  const assignedCount = board?.rows.filter(hasFacts).length ?? 0;
  const workshopCount = board?.rows.filter((row) => row.inMaintenance).length ?? 0;

  const [editing, setEditing] = useState<FleetRosterRowDto | null>(null);
  const [clearing, setClearing] = useState<FleetRosterRowDto | null>(null);
  const plan = usePlanRoster();

  const confirmClear = async (): Promise<void> => {
    if (clearing === null) return;
    await plan.mutateAsync({
      dateKey: date,
      body: {
        date: new Date(date),
        rows: [
          {
            vehicleId: clearing.vehicleId,
            missionTypeId: null,
            driver1EmployeeId: null,
            driver2EmployeeId: null,
            notes: null,
          },
        ],
      },
    });
    toast.success(t('fleet.roster.cleared'));
    setClearing(null);
  };

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const columns: Column<FleetRosterRowDto>[] = [
    {
      key: 'vehicle',
      header: t('fleet.odometer.columns.vehicle'),
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-mono text-xs" dir="ltr">
            {row.code}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400" dir="ltr">
            {row.plateNumber}
          </span>
        </span>
      ),
    },
    {
      key: 'state',
      header: t('fleet.vehicles.columns.status'),
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          <InWorkshopBadge inWorkshop={row.inMaintenance} />
          {hasFacts(row) ? (
            <Badge tone="success">{t('fleet.roster.assigned')}</Badge>
          ) : (
            <Badge tone="neutral">{t('fleet.roster.unassigned')}</Badge>
          )}
        </span>
      ),
    },
    {
      key: 'mission',
      header: t('fleet.roster.fields.mission'),
      render: (row) => missionName(row.missionTypeId),
    },
    {
      key: 'driver1',
      header: t('fleet.odometer.fields.driver1'),
      render: (row) =>
        row.driver1EmployeeId === null ? '—' : <EmployeeName employeeId={row.driver1EmployeeId} />,
    },
    {
      key: 'driver2',
      header: t('fleet.odometer.fields.driver2'),
      render: (row) =>
        row.driver2EmployeeId === null ? '—' : <EmployeeName employeeId={row.driver2EmployeeId} />,
    },
    {
      key: 'notes',
      header: t('fleet.attendance.fields.notes'),
      render: (row) => <span className="block max-w-[16rem] truncate">{row.notes ?? '—'}</span>,
    },
    ...(can('fleetRoster.plan')
      ? [
          {
            key: 'actions',
            header: t('fleet.vehicles.columns.actions'),
            align: 'end',
            render: (row: FleetRosterRowDto) => (
              <span className="flex items-center justify-end gap-1">
                {/* FR-5: an in-workshop vehicle cannot be ASSIGNED, but clearing stays legal. */}
                {!row.inMaintenance && (
                  <button
                    type="button"
                    className={actionButton}
                    aria-label={t('fleet.roster.editAssignment')}
                    title={t('fleet.roster.editAssignment')}
                    onClick={() => setEditing(row)}
                  >
                    <EditIcon className="h-4 w-4" />
                  </button>
                )}
                {hasFacts(row) && (
                  <button
                    type="button"
                    className={actionButton}
                    aria-label={t('fleet.roster.clearAssignment')}
                    title={t('fleet.roster.clearAssignment')}
                    onClick={() => setClearing(row)}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                )}
              </span>
            ),
          } satisfies Column<FleetRosterRowDto>,
        ]
      : []),
  ];

  const reasonLabel = (reason: string): string =>
    KNOWN_REASONS.has(reason) ? t(`fleet.roster.reason.${reason}`) : reason;

  return (
    <PageContainer>
      <PageHeader
        title={t('fleet.nav.roster')}
        description={t('fleet.roster.subtitle')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.roster') },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              aria-label={t('fleet.roster.prevDay')}
              title={t('fleet.roster.prevDay')}
              onClick={() => patch({ date: shiftDay(date, -1) })}
            >
              <ChevronStartIcon className="h-4 w-4" />
            </Button>
            <Input
              type="date"
              aria-label={t('fleet.roster.date')}
              value={date}
              onChange={(e) => patch({ date: e.target.value || null })}
              className="w-auto"
            />
            <Button
              size="sm"
              variant="secondary"
              aria-label={t('fleet.roster.nextDay')}
              title={t('fleet.roster.nextDay')}
              onClick={() => patch({ date: shiftDay(date, 1) })}
            >
              <ChevronEndIcon className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <FilterBar hasActiveFilters={search !== ''} onClear={() => patch({ q: null })}>
            <SearchInput
              value={search}
              onChange={(value) => patch({ q: value || null })}
              placeholder={t('fleet.roster.searchPlaceholder')}
              className="w-56"
            />
            {board !== undefined && (
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {t('fleet.roster.summary', {
                  total: formatNumber(board.rows.length, locale),
                  assigned: formatNumber(assignedCount, locale),
                  workshop: formatNumber(workshopCount, locale),
                })}
              </span>
            )}
          </FilterBar>

          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.vehicleId}
            loading={boardQuery.isPending}
            error={boardQuery.isError ? boardQuery.error : undefined}
            onRetry={() => void boardQuery.refetch()}
          />
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title={`${t('fleet.roster.availableTitle')} · ${formatNumber(board?.availableDrivers.length ?? 0, locale)}`}
              description={t('fleet.roster.availableHint')}
            />
            {board === undefined || board.availableDrivers.length === 0 ? (
              <EmptyState title={t('fleet.roster.availableEmpty')} />
            ) : (
              <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                {board.availableDrivers.map((driver) => (
                  <li
                    key={driver.employeeId}
                    className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm"
                  >
                    <EmployeeName employeeId={driver.employeeId} />
                    {driver.assignedVehicleId === null ? (
                      <Badge tone="success">{t('fleet.roster.free')}</Badge>
                    ) : (
                      <Badge tone="info">
                        {board.rows.find((row) => row.vehicleId === driver.assignedVehicleId)
                          ?.code ?? t('fleet.roster.otherVehicle')}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title={`${t('fleet.roster.unavailableTitle')} · ${formatNumber(board?.unavailableDrivers.length ?? 0, locale)}`}
              description={t('fleet.roster.unavailableHint')}
            />
            {board === undefined || board.unavailableDrivers.length === 0 ? (
              <EmptyState title={t('fleet.roster.unavailableEmpty')} />
            ) : (
              <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                {board.unavailableDrivers.map((driver) => (
                  <li
                    key={driver.employeeId}
                    className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm"
                  >
                    <EmployeeName employeeId={driver.employeeId} />
                    <Badge tone="warning">{reasonLabel(driver.reason)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {board !== undefined && (
        <RosterAssignDialog
          open={editing !== null}
          onClose={() => setEditing(null)}
          date={date}
          row={editing}
          board={board}
        />
      )}
      <Dialog
        open={clearing !== null}
        onClose={() => setClearing(null)}
        title={t('fleet.roster.clearTitle', { code: clearing?.code ?? '' })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setClearing(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={plan.isPending} onClick={() => void confirmClear()}>
              {t('fleet.roster.clearAssignment')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('fleet.roster.clearBody')}</p>
      </Dialog>
    </PageContainer>
  );
};
