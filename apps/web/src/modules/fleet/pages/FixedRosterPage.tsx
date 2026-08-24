// The fixed crew (الطقم الثابت) — who a car's standing crew IS, dragged into place.
//
// A sibling of the daily roster board (§4.5) and deliberately not a copy of it. The roster
// answers "who was planned on this car on day D", so it has a date picker, an availability
// verdict per driver and an unassignable-in-workshop rule — all facts ABOUT A DAY. This screen
// has no day: it answers "who is this car's crew", which stays true until somebody changes it.
// So there is no date anywhere, and the pool has no unavailable half — the same active driver
// profiles the roster draws from, undivided, because "free next Tuesday" is not a question here.
//
// The interaction is a real drag, not buttons that mimic one: HTML5 dragstart/dragover/drop, no
// library. What a drop MEANS lives in `lib/fixed-roster-board` as pure functions, so the two
// rules the server enforces — one person cannot hold both slots of a car, one driver belongs to
// one crew — are the same rules the UI proposes, and they are testable without a DOM.
//
// Saving is explicit. A drag edits a DRAFT; the banner and the button read the difference
// between draft and saved board, and only «حفظ» writes. A reload before saving therefore keeps
// the saved crews, exactly as an unsaved form does everywhere else in the app.
//
// The board is the daily roster's own `DataTable`, not a grid of cards, so the two assignment
// screens read as one family — same columns in the same order, same badges, same empty states,
// and the table's own `overflow-x-auto` keeps a narrow screen scrolling inside the table rather
// than shoving the page sideways. The DRIVER CELLS are the drop targets.
//
// «نوع المهمة» and «ملاحظات» are present for that likeness and are always «—»: a standing crew
// stores neither — see §2.7b, which is deliberately the two driver slots and nothing else.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type FleetFixedCrewRowDto, type Locale } from '@ecms/contracts';
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
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { toast } from '../../../shared/ui/toast/toast-store';
import { TrashIcon } from '../../../shared/ui/icons';
import { formatNumber } from '../../../shared/lib/format';
import { errorMessage } from '../../../shared/lib/errors';
import { useFixedRoster, useSaveFixedRoster } from '../api/fleet-queries';
import { EmployeeName } from '../components/EmployeeName';
import { InWorkshopBadge } from '../components/VehicleStatusBadge';
import {
  CREW_SLOTS,
  assignDriver,
  availableDrivers,
  changedRows,
  clearSlot,
  type CrewSlot,
} from '../lib/fixed-roster-board';

/** The one thing a drag carries. Read on drop; nothing else is inferred from the event. */
const DRAG_TYPE = 'application/x-ecms-driver';

const SLOT_LABEL: Record<CrewSlot, string> = {
  driver1EmployeeId: 'fleet.odometer.fields.driver1',
  driver2EmployeeId: 'fleet.odometer.fields.driver2',
};

export const FixedRosterPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  const mayPlan = can('fleetRoster.plan');

  const search = sp.get('q') ?? '';
  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    setSp(next);
  };

  const boardQuery = useFixedRoster();
  const save = useSaveFixedRoster();
  const saved = useMemo(() => boardQuery.data?.rows ?? [], [boardQuery.data]);

  // The draft the drags edit, derived from the saved board DURING render rather than by an
  // effect. The difference is not stylistic: an effect runs after the first paint, so the board
  // would flash empty on arrival — and never runs at all under `renderToStaticMarkup`, which is
  // how this screen is tested. Holding the base the draft was taken from lets the draft reset
  // itself the moment the server answers with a different board, and stay put in between, so a
  // background refetch of the same board cannot undo a drag.
  const [edit, setEdit] = useState<{ base: FleetFixedCrewRowDto[]; rows: FleetFixedCrewRowDto[] }>({
    base: [],
    rows: [],
  });
  const draft = edit.base === saved ? edit.rows : saved;
  const setDraft = (next: (rows: FleetFixedCrewRowDto[]) => FleetFixedCrewRowDto[]): void =>
    setEdit({ base: saved, rows: next(draft) });
  const discard = (): void => setEdit({ base: saved, rows: saved });

  const pending = useMemo(() => changedRows(saved, draft), [saved, draft]);
  const dirty = pending.length > 0;

  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  // The pool is DERIVED, never the server's list rendered raw: everyone the draft already seats
  // leaves it the instant the drop lands, and comes back the instant a slot is cleared. Deriving
  // it is also why a move between vehicles cannot flicker a driver back into the list and why a
  // slot change cannot duplicate a card — membership is computed from the seats, not adjusted.
  const pool = useMemo(
    () => availableDrivers(boardQuery.data?.drivers ?? [], draft),
    [boardQuery.data, draft],
  );

  const term = search.trim().toLowerCase();
  const rows = draft.filter(
    (row) =>
      term === '' ||
      row.code.toLowerCase().includes(term) ||
      row.plateNumber.toLowerCase().includes(term),
  );

  const drop = (vehicleId: string, slot: CrewSlot, employeeId: string): void => {
    setOver(null);
    setDragging(null);
    // Every drop lands: onto another car it is a move, onto this car's other slot it is a swap,
    // onto the slot already held it is a no-op. `assignDriver` is what keeps all three legal.
    setDraft(() => assignDriver(draft, vehicleId, slot, employeeId));
  };

  const commit = async (): Promise<void> => {
    if (!dirty) return;
    try {
      await save.mutateAsync({ rows: pending });
      toast.success(t('fleet.fixedRoster.saved'));
    } catch (error) {
      // The hook defines its own `onError` so a failed save re-reads the board — and defining one
      // opts the mutation OUT of the global error toast. Without this the refusal would be
      // silent: the button would stop spinning, the refetch would drop the drags, and the reader
      // would be left guessing. The commonest refusal here is a driver another row still holds.
      toast.error(errorMessage(error, locale));
    }
  };

  const dash = <span className="text-slate-400">—</span>;
  const zoneKey = (vehicleId: string, slot: CrewSlot): string => `${vehicleId}:${slot}`;

  /**
   * One slot, as a table CELL: a drop target that either holds a driver or asks for one.
   *
   * No label of its own — the column header above it already says which slot this is, and
   * repeating it in every row is the noise a table exists to remove.
   */
  const Slot = ({ row, slot }: { row: FleetFixedCrewRowDto; slot: CrewSlot }): JSX.Element => {
    const employeeId = row[slot];
    const key = zoneKey(row.vehicleId, slot);
    const active = over === key;
    return (
      <div className="min-w-[9rem]">
        <div
          data-drop-zone={key}
          aria-label={`${row.code} · ${t(SLOT_LABEL[slot])}`}
          onDragOver={(e) => {
            if (!mayPlan) return;
            // Preventing the default IS what makes an element a drop target.
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setOver(key);
          }}
          onDragLeave={() => setOver((k) => (k === key ? null : k))}
          onDrop={(e) => {
            if (!mayPlan) return;
            e.preventDefault();
            const id = e.dataTransfer.getData(DRAG_TYPE);
            if (id !== '') drop(row.vehicleId, slot, id);
          }}
          className={[
            'flex min-h-[2.5rem] items-center gap-2 rounded-lg border border-dashed px-2 py-1.5 transition-colors',
            active
              ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-950'
              : employeeId === null
                ? 'border-slate-300 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40'
                : 'border-transparent bg-slate-50 dark:bg-slate-800/60',
          ].join(' ')}
        >
          {employeeId === null ? (
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {t('fleet.fixedRoster.dropHere')}
            </span>
          ) : (
            <>
              <span
                draggable={mayPlan}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, employeeId);
                  e.dataTransfer.effectAllowed = 'move';
                  setDragging(employeeId);
                }}
                onDragEnd={() => setDragging(null)}
                className={[
                  'min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-slate-100',
                  mayPlan ? 'cursor-grab active:cursor-grabbing' : '',
                  dragging === employeeId ? 'opacity-50' : '',
                ].join(' ')}
              >
                <EmployeeName employeeId={employeeId} />
              </span>
              {mayPlan && (
                <button
                  type="button"
                  aria-label={t('fleet.fixedRoster.removeDriver')}
                  title={t('fleet.fixedRoster.removeDriver')}
                  onClick={() => setDraft((c) => clearSlot(c, row.vehicleId, slot))}
                  className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  /**
   * The seven columns, in the daily roster's own order and idiom (§4.5's board, minus its date).
   *
   * «نوع المهمة» and «ملاحظات» are here for that likeness and are always «—»: a standing crew is
   * §2.7b's two driver slots and nothing else, and inventing a value for a fact the row does not
   * hold would be worse than an honest dash.
   */
  const columns: Column<FleetFixedCrewRowDto>[] = [
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
          {row.driver1EmployeeId !== null || row.driver2EmployeeId !== null ? (
            <Badge tone="success">{t('fleet.roster.assigned')}</Badge>
          ) : (
            <Badge tone="neutral">{t('fleet.fixedRoster.unassigned')}</Badge>
          )}
        </span>
      ),
    },
    {
      key: 'mission',
      header: t('fleet.roster.fields.mission'),
      render: () => dash,
    },
    {
      key: 'driver1',
      header: t('fleet.odometer.fields.driver1'),
      render: (row) => <Slot row={row} slot="driver1EmployeeId" />,
    },
    {
      key: 'driver2',
      header: t('fleet.odometer.fields.driver2'),
      render: (row) => <Slot row={row} slot="driver2EmployeeId" />,
    },
    {
      key: 'notes',
      header: t('fleet.attendance.fields.notes'),
      render: () => dash,
    },
    {
      key: 'actions',
      header: t('fleet.vehicles.columns.actions'),
      align: 'end',
      render: (row) =>
        mayPlan && (row.driver1EmployeeId !== null || row.driver2EmployeeId !== null) ? (
          <button
            type="button"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label={t('fleet.fixedRoster.clearCrew')}
            title={t('fleet.fixedRoster.clearCrew')}
            onClick={() =>
              setDraft((c) =>
                CREW_SLOTS.reduce((rows, slot) => clearSlot(rows, row.vehicleId, slot), c),
              )
            }
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        ) : (
          dash
        ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('fleet.nav.fixedRoster')}
        description={t('fleet.fixedRoster.subtitle')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.fixedRoster') },
        ]}
        actions={
          mayPlan ? (
            <div className="flex items-center gap-2">
              {dirty && (
                <span className="text-sm text-amber-700 dark:text-amber-300">
                  {t('fleet.fixedRoster.unsaved')}
                </span>
              )}
              <Button
                size="sm"
                variant="secondary"
                disabled={!dirty || save.isPending}
                onClick={discard}
              >
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                disabled={!dirty}
                loading={save.isPending}
                onClick={() => void commit()}
              >
                {t('common.save')}
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        {/* `min-w-0`: a grid item's default `min-width: auto` refuses to shrink below its
            content, so without it the table's own `overflow-x-auto` never engages — the wrapper
            just grows and takes the PAGE sideways with it. With it, a narrow screen scrolls
            inside the table, which is where the scrolling belongs. */}
        <div className="min-w-0 space-y-4 xl:col-span-2">
          <FilterBar hasActiveFilters={search !== ''} onClear={() => patch({ q: null })}>
            <SearchInput
              value={search}
              onChange={(value) => patch({ q: value || null })}
              placeholder={t('fleet.roster.searchPlaceholder')}
              className="w-56"
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {t('fleet.fixedRoster.summary', {
                total: formatNumber(draft.length, locale),
                crewed: formatNumber(
                  draft.filter((r) => r.driver1EmployeeId !== null || r.driver2EmployeeId !== null)
                    .length,
                  locale,
                ),
              })}
            </span>
          </FilterBar>

          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.vehicleId}
            loading={boardQuery.isPending}
            error={boardQuery.isError ? boardQuery.error : undefined}
            onRetry={() => void boardQuery.refetch()}
            empty={<EmptyState title={t('fleet.fixedRoster.noVehicles')} />}
          />
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title={`${t('fleet.fixedRoster.driversTitle')} · ${formatNumber(pool.length, locale)}`}
              description={t('fleet.fixedRoster.driversHint')}
            />
            {pool.length === 0 ? (
              <EmptyState title={t('fleet.roster.availableEmpty')} />
            ) : (
              <ul className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                {pool.map((driver) => {
                  // Everyone here is unseated ON THIS BOARD — that is what the pool now means.
                  // But the board carries only the vehicles this reader may see, so a driver
                  // fixed to a car outside that scope is not free either: calling them free
                  // would be false, and would invite a drag the server then refuses, because
                  // the row that has to release them is one this client cannot send.
                  const heldElsewhere =
                    driver.assignedVehicleId !== null &&
                    !draft.some((row) => row.vehicleId === driver.assignedVehicleId);
                  return (
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
                          'flex items-center justify-between gap-2 px-5 py-2.5 text-sm',
                          mayPlan
                            ? 'cursor-grab active:cursor-grabbing hover:bg-slate-50 dark:hover:bg-slate-800/60'
                            : '',
                          dragging === driver.employeeId ? 'opacity-50' : '',
                        ].join(' ')}
                      >
                        <span className="min-w-0 truncate">
                          <EmployeeName employeeId={driver.employeeId} />
                        </span>
                        {heldElsewhere ? (
                          <Badge tone="warning">{t('fleet.roster.otherVehicle')}</Badge>
                        ) : (
                          <Badge tone="neutral">{t('fleet.fixedRoster.unassigned')}</Badge>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </PageContainer>
  );
};
