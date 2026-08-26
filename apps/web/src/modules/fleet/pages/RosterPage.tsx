// Daily duty roster (FW-7, legacy roster board): the §4.5 planning screen over FL-5, where the
// SERVER is the only planner — vehicles, the day's assignments, the driver pool split by the
// availability seam (with each refusal's named reason), and the FR-5/6/7 verdicts all arrive
// derived; the page renders them and submits desired state, recomputing nothing. URL-synced
// date + client-side code/plate search over the one live board; assign, edit, clear and
// vehicle-to-vehicle transfer are all the same plan call (only the touched rows travel).
import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type FleetRosterRowDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
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
import { CatalogSelect } from '../components/CatalogSelect';
import { DriverChip } from '../components/DriverChip';

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

/**
 * The earliest day a roster may be planned for.
 *
 * A roster is a PLAN, and the past is not plannable — the day is spent. The floor is TODAY, not
 * tomorrow: the current day's plan is the one operations is living in and is edited all morning.
 * This is the same `utcDay` boundary the server enforces (`PAST_DATE`), read off the same
 * `toISOString().slice(0, 10)` the whole screen already uses — one date interpretation, not two.
 */
const earliestPlannableDay = (): string => new Date().toISOString().slice(0, 10);

/** The one thing a drag carries, exactly as the fixed board spells it. */
const DRAG_TYPE = 'application/x-ecms-driver';

/**
 * One driver slot on the daily board: a drop target that holds a driver or asks for one.
 *
 * DECLARED AT MODULE LEVEL. A component written inside another component is a new element TYPE
 * on every render, so React unmounts the cell instead of updating it — which destroys the node a
 * drag in flight belongs to and makes the browser cancel it. That bug was real on the fixed board
 * and is not repeated here.
 *
 * It is a sibling of the fixed board's cell rather than a shared component: making one component
 * serve both would mean editing `FixedRosterPage`, which is out of bounds for this change. The
 * two therefore share the drag CONTRACT (`DRAG_TYPE`, `DriverChip`) and nothing else.
 */
const RosterSlotCell = ({
  row,
  slot,
  mayPlan,
  over,
  dragging,
  t,
  setOver,
  onDrop,
  setDragging,
}: {
  row: FleetRosterRowDto;
  slot: 'driver1EmployeeId' | 'driver2EmployeeId';
  mayPlan: boolean;
  over: string | null;
  dragging: string | null;
  t: (key: string, params?: Record<string, string | number>) => string;
  setOver: (update: (key: string | null) => string | null) => void;
  onDrop: (
    row: FleetRosterRowDto,
    slot: 'driver1EmployeeId' | 'driver2EmployeeId',
    employeeId: string,
  ) => void;
  setDragging: (employeeId: string | null) => void;
}): JSX.Element => {
  const employeeId = row[slot];
  const key = `${row.vehicleId}:${slot}`;
  // A car in the workshop is not a drop target at all (FR-5). The server refuses the write too;
  // this is what stops the reader trying.
  const droppable = mayPlan && !row.inMaintenance;
  const active = over === key;
  return (
    <div className="min-w-[9rem]">
      <div
        data-drop-zone={key}
        data-drop-disabled={row.inMaintenance ? 'maintenance' : undefined}
        aria-label={`${row.code} · ${t(slot === 'driver1EmployeeId' ? 'fleet.odometer.fields.driver1' : 'fleet.odometer.fields.driver2')}`}
        onDragOver={(e) => {
          if (!droppable) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setOver(() => key);
        }}
        onDragLeave={() => setOver((k) => (k === key ? null : k))}
        onDrop={(e) => {
          if (!droppable) return;
          e.preventDefault();
          const id = e.dataTransfer.getData(DRAG_TYPE);
          if (id !== '') onDrop(row, slot, id);
        }}
        className={[
          'flex min-h-[2.5rem] items-center gap-2 rounded-lg border border-dashed px-2 py-1.5 transition-colors',
          active
            ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-950'
            : row.inMaintenance
              ? 'border-slate-200 bg-slate-100/70 dark:border-slate-800 dark:bg-slate-800/30'
              : employeeId === null
                ? 'border-slate-300 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40'
                : 'border-transparent bg-slate-50 dark:bg-slate-800/60',
        ].join(' ')}
      >
        {employeeId === null ? (
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {t(row.inMaintenance ? 'fleet.roster.inWorkshopNoDrop' : 'fleet.fixedRoster.dropHere')}
          </span>
        ) : (
          <span
            draggable={mayPlan}
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_TYPE, employeeId);
              e.dataTransfer.effectAllowed = 'move';
              setDragging(employeeId);
            }}
            onDragEnd={() => setDragging(null)}
            className={[
              'min-w-0 flex-1',
              mayPlan ? 'cursor-grab active:cursor-grabbing' : '',
              dragging === employeeId ? 'opacity-50' : '',
            ].join(' ')}
          >
            <DriverChip employeeId={employeeId} className="w-full" />
          </span>
        )}
      </div>
    </div>
  );
};

export const RosterPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();

  // A roster plans ahead; the past is not plannable. The URL is user-writable, so the floor is
  // applied to what is READ, not only to the picker — `?date=2020-01-01` shows today instead of
  // offering a board whose every save the server would refuse.
  const floor = earliestPlannableDay();
  const requested = sp.get('date') ?? today();
  const date = requested < floor ? floor : requested;
  const search = sp.get('q') ?? '';

  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    setSp(next);
  };

  const mayPlan = can('fleetRoster.plan');

  const boardQuery = useRosterDay(date);
  const board = boardQuery.data;
  const missionTypes = useFleetCatalog('missionType');
  const missionName = (id: string | null): string => {
    if (id === null) return '—';
    const item = missionTypes.data?.items.find((entry) => entry.id === id);
    return item === undefined ? '—' : localized(item.name, locale);
  };

  const mission = sp.get('mission') ?? '';
  const term = search.trim().toLowerCase();
  const rows = (board?.rows ?? []).filter(
    (row) =>
      (term === '' ||
        row.code.toLowerCase().includes(term) ||
        row.plateNumber.toLowerCase().includes(term)) &&
      (mission === '' || row.missionTypeId === mission),
  );
  const assignedCount = board?.rows.filter(hasFacts).length ?? 0;
  const workshopCount = board?.rows.filter((row) => row.inMaintenance).length ?? 0;

  /**
   * The header's tally, counted off the DAY'S OWN PROJECTION — never a hardcoded vocabulary.
   *
   * «إجمالي» is every vehicle on the board, «صيانة» the ones the workshop holds, «تشغيل» the ones
   * carrying a plan. After those comes one counter per ACTIVE mission type, named by the catalog,
   * so a mission somebody adds in `/fleet/catalogs` appears here without a code change and one
   * they archive stops appearing. The search narrows the table; these count the whole day.
   */
  const counters = useMemo(() => {
    const all = board?.rows ?? [];
    const byMission = new Map<string, number>();
    for (const row of all) {
      if (row.missionTypeId === null) continue;
      byMission.set(row.missionTypeId, (byMission.get(row.missionTypeId) ?? 0) + 1);
    }
    return [
      { key: 'total', label: t('fleet.roster.counter.total'), value: all.length, tone: 'brand' },
      {
        key: 'workshop',
        label: t('fleet.roster.counter.workshop'),
        value: workshopCount,
        tone: 'rose',
      },
      {
        key: 'assigned',
        label: t('fleet.roster.counter.assigned'),
        value: assignedCount,
        tone: 'emerald',
      },
      ...(missionTypes.data?.items ?? [])
        .filter((item) => item.isActive)
        .map((item) => ({
          key: item.id,
          label: localized(item.name, locale),
          value: byMission.get(item.id) ?? 0,
          tone: 'slate' as const,
        })),
    ];
  }, [board, missionTypes.data, assignedCount, workshopCount, locale, t]);

  const [editing, setEditing] = useState<FleetRosterRowDto | null>(null);
  const [clearing, setClearing] = useState<FleetRosterRowDto | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const plan = usePlanRoster();

  /**
   * A drop writes the day, immediately — this board has no draft.
   *
   * The WHOLE row goes, as the dialog's save sends it, because the plan endpoint upserts the pair
   * and a partial row would read as "clear the fields I left out". The same person landing in the
   * other slot of the same car swaps them; the server is still the authority (FR-5/6/7) and a
   * refusal surfaces as the mutation's error toast.
   */
  const dropDriver = async (
    row: FleetRosterRowDto,
    slot: 'driver1EmployeeId' | 'driver2EmployeeId',
    employeeId: string,
  ): Promise<void> => {
    setOver(null);
    setDragging(null);
    const other = slot === 'driver1EmployeeId' ? 'driver2EmployeeId' : 'driver1EmployeeId';
    const next = {
      vehicleId: row.vehicleId,
      missionTypeId: row.missionTypeId,
      notes: row.notes,
      [slot]: employeeId,
      // Dropping somebody onto the slot their crewmate holds is a swap, not a duplicate.
      [other]: row[other] === employeeId ? row[slot] : row[other],
    } as {
      vehicleId: string;
      missionTypeId: string | null;
      notes: string | null;
      driver1EmployeeId: string | null;
      driver2EmployeeId: string | null;
    };
    await plan.mutateAsync({ dateKey: date, body: { date: new Date(date), rows: [next] } });
  };

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
      render: (row) => (
        <RosterSlotCell
          row={row}
          slot="driver1EmployeeId"
          mayPlan={mayPlan}
          over={over}
          dragging={dragging}
          t={t}
          setOver={setOver}
          onDrop={(r, sl, id) => void dropDriver(r, sl, id)}
          setDragging={setDragging}
        />
      ),
    },
    {
      key: 'driver2',
      header: t('fleet.odometer.fields.driver2'),
      render: (row) => (
        <RosterSlotCell
          row={row}
          slot="driver2EmployeeId"
          mayPlan={mayPlan}
          over={over}
          dragging={dragging}
          t={t}
          setOver={setOver}
          onDrop={(r, sl, id) => void dropDriver(r, sl, id)}
          setDragging={setDragging}
        />
      ),
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
              // The floor is a real boundary, not a hint: stepping back off today would land on a
              // day the server refuses to plan, so the step is not offered there.
              disabled={date <= floor}
              onClick={() => patch({ date: shiftDay(date, -1) })}
            >
              <ChevronStartIcon className="h-4 w-4" />
            </Button>
            <Input
              type="date"
              aria-label={t('fleet.roster.date')}
              value={date}
              min={floor}
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

      {/* The day's tally beside the day itself: a strip of counters rather than a paragraph
          under the board, so the height it used to take goes to the assignment table. It wraps
          rather than scrolling, which is what keeps it honest at 390px. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="me-1 w-44">
          <CatalogSelect
            kind="missionType"
            value={mission}
            onChange={(id) => patch({ mission: id || null })}
            allLabel={t('fleet.roster.allMissions')}
            ariaLabel={t('fleet.roster.fields.mission')}
          />
        </div>
        {counters.map((counter) => (
          <span
            key={counter.key}
            data-counter={counter.key}
            className={[
              'flex min-w-[3.5rem] flex-col items-center rounded-md px-2 py-1 text-xs font-medium',
              counter.tone === 'brand'
                ? 'bg-brand-600 text-white'
                : counter.tone === 'rose'
                  ? 'bg-rose-600 text-white'
                  : counter.tone === 'emerald'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
            ].join(' ')}
          >
            <span className="truncate">{counter.label}</span>
            <span className="text-sm font-bold">{formatNumber(counter.value, locale)}</span>
          </span>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* `min-w-0`: a grid item's default `min-width: auto` refuses to shrink below its
            content, so without it the table's own `overflow-x-auto` never engages — the column
            grows to the table's `min-w-[40rem]` and takes the PAGE sideways at 390px. The fixed
            board carries the same class for the same reason; this one was missing it. */}
        <div className="min-w-0 space-y-4 xl:col-span-2">
          <FilterBar
            hasActiveFilters={search !== '' || mission !== ''}
            onClear={() => patch({ q: null, mission: null })}
          >
            <SearchInput
              value={search}
              onChange={(value) => patch({ q: value || null })}
              placeholder={t('fleet.roster.searchPlaceholder')}
              className="w-56"
            />
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

        {/* The two lists SIDE BY SIDE, each its own column. Stacked, the unavailable list pushed
            the available one off the fold on a real fleet, and the board lost the height to a
            section nobody drags from. */}
        <div className="grid min-w-0 grid-cols-2 gap-3">
          <div className="min-w-0 rounded-lg border border-emerald-200 bg-emerald-50 shadow-card dark:border-emerald-900 dark:bg-emerald-950/30">
            <h2 className="px-3 pb-2 pt-3 text-center text-sm font-semibold text-emerald-900 dark:text-emerald-200">
              {t('fleet.roster.availableTitle')}
              <span className="ms-1 font-normal text-emerald-700 dark:text-emerald-400">
                ({formatNumber(board?.availableDrivers.length ?? 0, locale)})
              </span>
            </h2>
            {board === undefined || board.availableDrivers.length === 0 ? (
              <EmptyState title={t('fleet.roster.availableEmpty')} />
            ) : (
              <ul className="max-h-[26rem] space-y-1 overflow-y-auto px-2 pb-2">
                {board.availableDrivers.map((driver) => (
                  <li key={driver.employeeId}>
                    <div
                      data-driver-card={driver.employeeId}
                      draggable={mayPlan}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DRAG_TYPE, driver.employeeId);
                        e.dataTransfer.effectAllowed = 'move';
                        setDragging(driver.employeeId);
                      }}
                      onDragEnd={() => setDragging(null)}
                      className={[
                        'flex items-center gap-1.5',
                        mayPlan ? 'cursor-grab active:cursor-grabbing' : '',
                        dragging === driver.employeeId ? 'opacity-50' : '',
                      ].join(' ')}
                    >
                      <DriverChip employeeId={driver.employeeId} className="min-w-0 flex-1" />
                      {driver.assignedVehicleId !== null && (
                        <Badge tone="warning" size="sm" className="shrink-0">
                          {t('fleet.roster.otherVehicle')}
                        </Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Visible for transparency, and NOT draggable: `draggable` is never set here, so the
              browser will not start a drag from one of these rows at all. The server refuses the
              assignment too (FR-6) — this is what stops the reader attempting it. */}
          <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 shadow-card dark:border-slate-800 dark:bg-slate-900/60">
            <h2 className="px-3 pb-2 pt-3 text-center text-sm font-semibold text-slate-700 dark:text-slate-200">
              {t('fleet.roster.unavailableTitle')}
              <span className="ms-1 font-normal text-slate-500 dark:text-slate-400">
                ({formatNumber(board?.unavailableDrivers.length ?? 0, locale)})
              </span>
            </h2>
            {board === undefined || board.unavailableDrivers.length === 0 ? (
              <EmptyState title={t('fleet.roster.unavailableEmpty')} />
            ) : (
              <ul className="max-h-[26rem] space-y-1 overflow-y-auto px-2 pb-2">
                {board.unavailableDrivers.map((driver) => (
                  <li
                    key={driver.employeeId}
                    data-unavailable-driver={driver.employeeId}
                    className="flex items-center justify-between gap-1.5 rounded-md bg-white px-2 py-1 text-xs dark:bg-slate-800/60"
                  >
                    <span className="min-w-0 truncate">
                      <EmployeeName employeeId={driver.employeeId} />
                    </span>
                    {/* The REASON, beside the name — the seam's own verdict, not a guess. */}
                    <Badge tone="warning" size="sm" className="shrink-0">
                      {reasonLabel(driver.reason)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
