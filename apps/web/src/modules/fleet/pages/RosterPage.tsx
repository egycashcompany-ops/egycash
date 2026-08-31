// Daily duty roster (FW-7, legacy roster board): the §4.5 planning screen over FL-5.
//
// THE DAY IS A DRAFT. The board arrives derived — the server merges the vehicles, the day's
// stored assignments, the fixed crew where no assignment exists, and the availability seam's
// verdicts — and from then until «حفظ» every drag, mission change and clear edits a LOCAL copy.
// Nothing reaches `fleet_duty_assignments` in between, and nothing reaches `fleet_fixed_crews`
// ever: this screen has no write path to the standing crew at all.
//
// That is a change from the board that saved on every drop. Planning a day is a sequence of
// related decisions — this car takes that crew, so this other one needs a different pair — and
// persisting each keystroke made every half-finished thought a fact, gave «إلغاء» nothing to
// undo, and turned one plan into a dozen audit entries. The fixed board already worked this way;
// the two now behave the same, which is the point.
//
// WHERE THE DAY COMES FROM is the server's decision, not this page's, and it turns on one fact:
// does a `fleet_duty_assignment` exist for (vehicle, date)? If it does, that stored day IS the
// baseline, verbatim, even when its crew is empty — a day somebody deliberately emptied must not
// have the standing crew put back on reload. If it does not, the fixed crew is where the day
// starts, cut down by that day's workshop visits (FR-5) and driver availability (FR-6/7).
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type FleetRosterRowDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { Dialog } from '../../../shared/ui/Dialog';
import { Input } from '../../../shared/ui/form';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { toast } from '../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../shared/lib/errors';
import {
  ChevronEndIcon,
  ChevronStartIcon,
  CloseIcon,
  EditIcon,
  ResetIcon,
} from '../../../shared/ui/icons';
import { formatNumber, localized } from '../../../shared/lib/format';
import { useFleetCatalog, usePlanRoster, useRosterDay } from '../api/fleet-queries';
import { EmployeeName, useEmployeeRecords } from '../components/EmployeeName';
import { InWorkshopBadge } from '../components/VehicleStatusBadge';
import { RosterAssignDialog } from '../components/RosterAssignDialog';
import { CatalogSelect } from '../components/CatalogSelect';
import { DriverChip } from '../components/DriverChip';
import {
  applyEdit,
  assignDriver,
  availableDrivers,
  clearSlot,
  type DutySlot,
  hasEdits,
  rowsToSave,
  setMission,
} from '../lib/daily-roster-board';
import { filterDrivers, type DriverSearchRecord } from '../lib/driver-search';
import { rosterDraftKey, ROSTER_EDITABLE_FIELDS } from '../lib/draft-storage';
import {
  COUNTER_TONES,
  carriesPlan,
  missionTone,
  readView,
  visibleRows,
  type RosterView,
} from '../lib/roster-view';
import { useDraftBoard } from '../lib/useDraftBoard';

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
 * A drop edits the DRAFT. Nothing is sent until «حفظ».
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
  onClear,
  setDragging,
}: {
  row: FleetRosterRowDto;
  slot: DutySlot;
  mayPlan: boolean;
  over: string | null;
  dragging: string | null;
  t: (key: string, params?: Record<string, string | number>) => string;
  setOver: (update: (key: string | null) => string | null) => void;
  onDrop: (row: FleetRosterRowDto, slot: DutySlot, employeeId: string) => void;
  onClear: (row: FleetRosterRowDto, slot: DutySlot) => void;
  setDragging: (employeeId: string | null) => void;
}): JSX.Element => {
  const employeeId = row[slot];
  const key = `${row.vehicleId}:${slot}`;
  // A car in the workshop is not a drop target at all (FR-5). The server refuses the write too;
  // this is what stops the reader trying.
  //
  // Nor is slot 2 of a vehicle with no first driver: the schema and the service both refuse that
  // pair, so offering the drop would be offering a save that comes back 400.
  const needsFirst = slot === 'driver2EmployeeId' && row.driver1EmployeeId === null;
  const droppable = mayPlan && !row.inMaintenance && !needsFirst;
  const active = over === key;
  return (
    <div className="min-w-[9rem]">
      <div
        data-drop-zone={key}
        data-drop-disabled={
          row.inMaintenance ? 'maintenance' : needsFirst ? 'needsFirstDriver' : undefined
        }
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
            : row.inMaintenance || needsFirst
              ? 'border-slate-200 bg-slate-100/70 dark:border-slate-800 dark:bg-slate-800/30'
              : employeeId === null
                ? 'border-slate-300 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40'
                : 'border-transparent bg-slate-50 dark:bg-slate-800/60',
        ].join(' ')}
      >
        {employeeId === null ? (
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {t(
              row.inMaintenance
                ? 'fleet.roster.inWorkshopNoDrop'
                : needsFirst
                  ? 'fleet.fixedRoster.needsFirstDriver'
                  : 'fleet.fixedRoster.dropHere',
            )}
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
                'min-w-0 flex-1',
                mayPlan ? 'cursor-grab active:cursor-grabbing' : '',
                dragging === employeeId ? 'opacity-50' : '',
              ].join(' ')}
            >
              <DriverChip employeeId={employeeId} className="w-full" />
            </span>
            {/* Taking somebody OFF the day, without a dialog. The driver returns to the pool
                immediately because the pool is derived from the draft — and, like every other
                edit here, nothing is written until «حفظ». */}
            {mayPlan && (
              <button
                type="button"
                data-clear-slot={key}
                aria-label={t('fleet.roster.clearSlot')}
                title={t('fleet.roster.clearSlot')}
                onClick={() => onClear(row, slot)}
                className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-700 dark:hover:text-slate-100"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            )}
          </>
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
  const mission = sp.get('mission') ?? '';
  /**
   * Which STATE the board is narrowed to, if any — «صيانة» or «تشغيل».
   *
   * Read through `readView`, so a hand-typed `?view=nonsense` shows the whole day rather than an
   * empty board nobody can explain. A mission is NOT a view: the mission chips write the `mission`
   * parameter the dropdown beside them already owns, which is what keeps the two in step and
   * stops a second copy of mission filtering existing at all.
   */
  const view: RosterView | null = readView(sp.get('view'));

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
  /**
   * The board, ONLY if it is this day's board.
   *
   * The response carries the day it describes, so the page can check rather than trust. The
   * query is keyed by date and no longer serves the previous key's data, which is the actual
   * fix — this is the invariant stated where it is relied upon, so that a caching option added
   * to `useRosterDay` later cannot quietly put another day's crew on the screen and into the
   * save payload again. Everything below reads `board`, so one check covers the table, the
   * counters, the pool, the draft and what «حفظ» sends.
   */
  const board = boardQuery.data?.date.slice(0, 10) === date ? boardQuery.data : undefined;
  // The BASELINE: the day exactly as the server derived it. On an unplanned day that is the
  // standing crew; on a planned day it is the stored assignment. Either way it is what «إلغاء»
  // returns to and what the save measures against — so an untouched board saves NOTHING and a
  // derived day stays unplanned until somebody actually plans it.
  const saved = useMemo(() => board?.rows ?? [], [board]);

  // The draft — the same render-time rule as before, now with a memory across a reload. See
  // `useDraftBoard`.
  //
  // THE KEY CARRIES THE DATE, and that is the whole of the cross-day guarantee. A crew typed
  // for the 1st is about the 1st; keyed without the date it would greet the 2nd as that day's
  // pending work — the same class of bug as serving one date's board for another, which this
  // screen already fixed once in the query layer. `useDraftBoard` reads through a memo on the
  // key, so moving to another day re-reads storage and moving back finds that day's own draft.
  const {
    draft,
    setDraft,
    discard,
    accept: acceptDraft,
  } = useDraftBoard(rosterDraftKey(date), saved, ROSTER_EDITABLE_FIELDS);

  // What a save would WRITE — edits, plus any operation still only projected from the standing
  // crew. The second half is what carries an unchanged operation through to Operations.
  const pending = useMemo(() => rowsToSave(saved, draft), [saved, draft]);
  const dirty = pending.length > 0;
  // What «إلغاء» would throw away. Distinct from `dirty`: a day can be saveable (it holds an
  // unmaterialised operation) while there is nothing of the dispatcher's own to discard.
  const edited = useMemo(() => hasEdits(saved, draft), [saved, draft]);

  const plan = usePlanRoster();

  const missionTypes = useFleetCatalog('missionType');
  const missionName = (id: string | null): string => {
    if (id === null) return '—';
    const item = missionTypes.data?.items.find((entry) => entry.id === id);
    return item === undefined ? '—' : localized(item.name, locale);
  };

  /**
   * What the table SHOWS. Read off the DRAFT, so an edit is visible the moment it is made.
   *
   * All three filters narrow together — code search AND mission AND state — and none replaces
   * another: «صيانة» plus a mission shows the workshop's cars of that mission, which is the only
   * reading of two active filters that is not a lie about one of them.
   *
   * DISPLAY ONLY. `draft`, the counters, the pool and the save payload below all read the whole
   * day and never this — see the counters' own note.
   */
  const rows = useMemo(
    () => visibleRows(draft, { term: search, mission, view }),
    [draft, search, mission, view],
  );

  const filtered = search !== '' || mission !== '' || view !== null;
  /**
   * «إعادة ضبط» — every filter off in ONE update, and the day left alone.
   *
   * `date` is deliberately not cleared. It is not a filter: it is what the screen is ABOUT, and a
   * reset that jumped the dispatcher back to today would throw away the day they navigated to.
   */
  const resetFilters = (): void => patch({ q: null, mission: null, view: null });

  /**
   * The header's tally, counted off the DRAFT — never a hardcoded vocabulary, and never the
   * server's last answer once the dispatcher has started editing.
   *
   * «إجمالي» is every vehicle on the day, «صيانة» the ones the workshop holds, «تشغيل» the ones
   * carrying a plan. After those comes one counter per ACTIVE mission type, named by the catalog,
   * so a mission somebody adds in `/fleet/catalogs` appears here without a code change and one
   * they archive stops appearing. The search narrows the table; these count the whole day.
   */
  const counters = useMemo(() => {
    const byMission = new Map<string, number>();
    for (const row of draft) {
      if (row.missionTypeId === null) continue;
      byMission.set(row.missionTypeId, (byMission.get(row.missionTypeId) ?? 0) + 1);
    }
    return [
      {
        key: 'total',
        label: t('fleet.roster.counter.total'),
        value: draft.length,
        tone: COUNTER_TONES.total,
        // «إجمالي» is the absence of a filter, so applying it CLEARS both keys rather than
        // setting a third value that would then have to mean "no filter".
        apply: { mission: null, view: null },
        active: mission === '' && view === null,
      },
      {
        key: 'workshop',
        label: t('fleet.roster.counter.workshop'),
        value: draft.filter((row) => row.inMaintenance).length,
        tone: COUNTER_TONES.workshop,
        apply: { view: 'workshop' },
        active: view === 'workshop',
      },
      {
        key: 'assigned',
        label: t('fleet.roster.counter.assigned'),
        value: draft.filter(carriesPlan).length,
        tone: COUNTER_TONES.assigned,
        apply: { view: 'assigned' },
        active: view === 'assigned',
      },
      ...(missionTypes.data?.items ?? [])
        .filter((item) => item.isActive)
        .map((item) => ({
          key: item.id,
          label: localized(item.name, locale),
          value: byMission.get(item.id) ?? 0,
          tone: missionTone(item.id),
          // The chip drives the DROPDOWN's parameter, not one of its own: one axis, one filter,
          // and the select beside it visibly follows.
          apply: { mission: item.id },
          active: mission === item.id,
        })),
    ];
  }, [draft, missionTypes.data, locale, t, mission, view]);

  // The pool is DERIVED from the draft, never the server's list rendered raw: everyone the draft
  // seats leaves it the instant the drop lands, and comes back the instant a slot is cleared —
  // with no round trip in between. Deriving it is also why a move between vehicles cannot flicker
  // a driver back into the list and why a slot change cannot duplicate a card.
  const pool = useMemo(
    () => availableDrivers(board?.availableDrivers ?? [], draft),
    [board, draft],
  );

  // ── finding a driver, in EACH list ────────────────────────────────────────
  //
  // A box INSIDE each panel, each searching its own list — the same shape as the Fixed Roster's
  // driver panel, which is where this pattern comes from. Two independent terms rather than one
  // shared one: the panels answer different questions ("who can I put on a car" and "who is out
  // today, and why"), and a reader filtering one of them is rarely asking about the other. A
  // shared term also meant every search visibly emptied whichever panel the person was not in.
  //
  // Panel-local state, not a URL parameter, matching the Fixed Roster: this filters side lists,
  // it does not change what the page is about. The `?q=` above is different — it changes which
  // VEHICLES the board shows, which is worth putting in a link.
  const [availableSearch, setAvailableSearch] = useState('');
  const [unavailableSearch, setUnavailableSearch] = useState('');

  const unavailable = useMemo(() => board?.unavailableDrivers ?? [], [board]);
  // Both halves indexed together, so one term reaches both. The cards already load these
  // records to render each name; same query keys, so this subscribes to the existing entries
  // rather than fetching anything new.
  const records = useEmployeeRecords(
    useMemo(
      () => [...pool.map((d) => d.employeeId), ...unavailable.map((d) => d.employeeId)],
      [pool, unavailable],
    ),
  );
  const searchIndex = useMemo(() => {
    const index = new Map<string, DriverSearchRecord>();
    for (const [employeeId, employee] of records) {
      index.set(employeeId, {
        employeeId,
        nameAr: employee.personal.fullNameAr,
        nameEn: employee.personal.fullNameEn,
        code: employee.code,
        employeeNumber: employee.employeeNumber,
      });
    }
    return index;
  }, [records]);

  // FILTERING FOR DISPLAY ONLY. Neither list feeds the draft or the save payload: `pool` is
  // what the drag rules and the counters read, and `unavailable` is the server's verdict. These
  // two are what the panels RENDER, so clearing the box brings everybody back with no round
  // trip and no state to put right.
  const shownAvailable = useMemo(
    () => filterDrivers(pool, searchIndex, availableSearch),
    [pool, searchIndex, availableSearch],
  );
  const shownUnavailable = useMemo(
    () => filterDrivers(unavailable, searchIndex, unavailableSearch),
    [unavailable, searchIndex, unavailableSearch],
  );

  const [editing, setEditing] = useState<string | null>(null);
  const [clearing, setClearing] = useState<FleetRosterRowDto | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const editingRow = draft.find((row) => row.vehicleId === editing) ?? null;

  const dropDriver = (row: FleetRosterRowDto, slot: DutySlot, employeeId: string): void => {
    setOver(null);
    setDragging(null);
    // Every drop lands in the draft: onto another car a move, onto this car's other slot a swap,
    // onto the slot already held a no-op. `assignDriver` is what keeps all three legal, and it
    // refuses a car the workshop holds.
    setDraft(() => assignDriver(draft, row.vehicleId, slot, employeeId));
  };

  const commit = async (): Promise<void> => {
    if (!dirty) return;
    try {
      await plan.mutateAsync({ dateKey: date, body: { date: new Date(date), rows: pending } });
      // Saved: what was persisted for THIS DAY is now the server's board and stops being a
      // draft. Only this day's key is dropped — another day's unsaved work is not this save's
      // to throw away.
      acceptDraft();
      toast.success(t('fleet.roster.saved'));
    } catch (error) {
      // The hook defines its own `onError` so a failed save re-reads the day — and defining one
      // opts the mutation OUT of the global error toast. Without this the refusal would be
      // silent: the button would stop spinning, the refetch would drop the edits, and the reader
      // would be left guessing. The commonest refusal here is a driver another row still holds.
      toast.error(errorMessage(error, locale));
    }
  };

  const confirmClear = (): void => {
    if (clearing === null) return;
    setDraft(() =>
      applyEdit(draft, clearing.vehicleId, {
        missionTypeId: null,
        driver1EmployeeId: null,
        driver2EmployeeId: null,
        notes: null,
      }),
    );
    setClearing(null);
  };

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const slotProps = {
    mayPlan,
    over,
    dragging,
    t,
    setOver,
    onDrop: dropDriver,
    onClear: (row: FleetRosterRowDto, slot: DutySlot) =>
      setDraft(() => clearSlot(draft, row.vehicleId, slot)),
    setDragging,
  };

  const columns: Column<FleetRosterRowDto>[] = [
    {
      key: 'vehicle',
      header: t('fleet.odometer.columns.vehicle'),
      // The CODE alone. The plate was a second identifier under every row of a column the eye
      // scans for one, and the code is the one this fleet dispatches by — the plate is still
      // searchable above, which is where a plate number is actually used.
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {row.code}
        </span>
      ),
    },
    {
      key: 'state',
      header: t('fleet.vehicles.columns.status'),
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          <InWorkshopBadge inWorkshop={row.inMaintenance} />
          {carriesPlan(row) ? (
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
      // Editable IN THE CELL, not only behind «تعديل». This is the fact a dispatcher changes
      // most often after the crew itself, and reaching it through a dialog cost four
      // interactions to answer a one-word question.
      //
      // `CatalogSelect` is the app's own catalog select on the SAME `missionType` kind the fixed
      // board uses — one cached request for N rows, an archived current value kept visible rather
      // than silently dropped, and never `workType`, which is the workshop's vocabulary. A reader
      // without `fleetRoster.plan` sees the name as text.
      render: (row) =>
        !mayPlan ? (
          missionName(row.missionTypeId)
        ) : (
          // The click stops here: this row's other cells are drag sources and drop targets, and a
          // control inside a row must not hand its interaction to the row.
          // `min-w-[11rem]`: the shared `Select` reserves `pe-9` (36px) for its chevron plus a
          // 12px start gutter, so a 9rem box leaves 94px of text — and «نقل أموال (يومي)», the
          // commonest mission there is, needs 104px. Measured, not guessed: a select clips its
          // label internally and reports no overflow.
          <div
            className="min-w-[11rem]"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <CatalogSelect
              kind="missionType"
              value={row.missionTypeId ?? ''}
              ariaLabel={`${row.code} · ${t('fleet.roster.fields.mission')}`}
              allLabel={t('fleet.fixedRoster.noMissionType')}
              onChange={(id) =>
                setDraft(() => setMission(draft, row.vehicleId, id === '' ? null : id))
              }
            />
          </div>
        ),
    },
    {
      key: 'driver1',
      header: t('fleet.odometer.fields.driver1'),
      render: (row) => <RosterSlotCell {...slotProps} row={row} slot="driver1EmployeeId" />,
    },
    {
      key: 'driver2',
      header: t('fleet.odometer.fields.driver2'),
      render: (row) => <RosterSlotCell {...slotProps} row={row} slot="driver2EmployeeId" />,
    },
    {
      key: 'notes',
      header: t('fleet.attendance.fields.notes'),
      render: (row) => <span className="block max-w-[16rem] truncate">{row.notes ?? '—'}</span>,
    },
    ...(mayPlan
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
                    onClick={() => setEditing(row.vehicleId)}
                  >
                    <EditIcon className="h-4 w-4" />
                  </button>
                )}
                {carriesPlan(row) && (
                  <button
                    type="button"
                    className={actionButton}
                    aria-label={t('fleet.roster.clearAssignment')}
                    title={t('fleet.roster.clearAssignment')}
                    onClick={() => setClearing(row)}
                  >
                    <CloseIcon className="h-4 w-4" />
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
          // The day itself, as ONE control: a stepper with the picker between its two arrows.
          // Grouped in a single bordered shell so the three read as one thing rather than three
          // loose buttons, and given `whitespace-nowrap` + `shrink-0` so the picker cannot be
          // squeezed into a second line beside the page title on a narrow header.
          <div className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <Button
              size="sm"
              variant="ghost"
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
              // `w-auto` alone let the native picker set its own width and sit a pixel or two
              // off the arrows' baseline; a fixed width and no border of its own keep the three
              // aligned inside the shell.
              className="w-[10.5rem] border-0 bg-transparent text-center text-sm font-medium tabular-nums shadow-none focus:ring-0 dark:bg-transparent"
            />
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('fleet.roster.nextDay')}
              title={t('fleet.roster.nextDay')}
              onClick={() => patch({ date: shiftDay(date, 1) })}
            >
              <ChevronEndIcon className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      {/* ONE top strip: what narrows the board and what the board adds up to, together.
          The counters used to sit in their own block under the controls, which pushed the table
          down a row for information that is read at a glance and never interacted with. Here the
          code search and the mission filter sit beside the day's tally, and the whole thing wraps
          rather than scrolling — which is what keeps it honest at 390px. */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <SearchInput
          value={search}
          onChange={(value) => patch({ q: value || null })}
          placeholder={t('fleet.roster.searchPlaceholder')}
          className="w-56"
        />
        <div className="w-44">
          <CatalogSelect
            kind="missionType"
            value={mission}
            onChange={(id) => patch({ mission: id || null })}
            allLabel={t('fleet.roster.allMissions')}
            ariaLabel={t('fleet.roster.fields.mission')}
          />
        </div>
        {/*
          Each counter is a real <button>: it narrows the board, so it must be reachable by
          keyboard and announce its state, which a tinted <span> with an onClick never does.
          `aria-pressed` is the announcement — this is a view being applied, not a navigation.

          The colour belongs to the CATEGORY and stays put whether or not the chip is the one
          being applied; the active state is a ring drawn on top. Recolouring the active chip
          would trade the one thing the colour is for — telling the six apart at a glance — for a
          state the ring already carries.
        */}
        {counters.map((counter) => (
          <button
            key={counter.key}
            type="button"
            data-counter={counter.key}
            data-active={counter.active ? 'true' : undefined}
            aria-pressed={counter.active}
            onClick={() => patch(counter.apply)}
            className={[
              'flex min-w-[3.5rem] flex-col items-center rounded-md px-2 py-1 text-xs font-medium transition-shadow',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
              counter.tone,
              counter.active ? 'ring-2 ring-offset-1 dark:ring-offset-slate-900' : 'ring-0',
            ].join(' ')}
          >
            <span className="truncate">{counter.label}</span>
            <span className="text-sm font-bold">{formatNumber(counter.value, locale)}</span>
          </button>
        ))}

        {/* Offered only when there is something to undo — a reset beside no filters is one more
            control to read and nothing to press. Clears the three view filters together; the day
            is not one of them. */}
        {filtered && (
          <button
            type="button"
            data-reset-filters="true"
            onClick={resetFilters}
            aria-label={t('common.filters.clear')}
            title={t('common.filters.clear')}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
          >
            <ResetIcon className="h-3.5 w-3.5" />
            {t('common.filters.clear')}
          </button>
        )}

        {/* «حفظ» lives at the END of the filter row, not under the table and not in a footer of
            its own. It belongs to the strip that says what the day currently IS, and `ms-auto`
            pins it to the far edge so it is in the same place whatever the counters add up to. */}
        {mayPlan && (
          <div className="ms-auto flex items-center gap-2">
            {dirty && (
              <span data-unsaved="true" className="text-xs text-amber-700 dark:text-amber-300">
                {t('fleet.roster.unsaved')}
              </span>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={!edited || plan.isPending}
              onClick={discard}
            >
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              data-save-roster="true"
              disabled={!dirty}
              loading={plan.isPending}
              onClick={() => void commit()}
            >
              {t('common.save')}
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* `min-w-0`: a grid item's default `min-width: auto` refuses to shrink below its
            content, so without it the table's own `overflow-x-auto` never engages — the column
            grows to the table's `min-w-[40rem]` and takes the PAGE sideways at 390px. */}
        <div className="min-w-0 space-y-4 xl:col-span-2">
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.vehicleId}
            /*
              A car the workshop holds on THIS DATE, tinted whole.

              `inMaintenance` and nothing else: it is the server's own FR-5 verdict for the day on
              screen, the same fact that already refuses the drop above and the save behind it.
              The registry's `inWorkshop` would be wrong here — that is where the car is right
              now, and this board is often planning a day that has not happened yet.

              This is a VISUAL indication and changes nothing: the row keeps its data, keeps its
              place in the table, and the rule that stops it being assigned still lives in
              `roster.service` where a client cannot reach it. The badge in the code cell stays,
              so the state is never carried by colour alone.
            */
            rowClassName={(row) =>
              row.inMaintenance
                ? 'bg-rose-50 text-rose-950 hover:bg-rose-100/70 dark:bg-rose-950/40 dark:text-rose-50 dark:hover:bg-rose-950/60'
                : undefined
            }
            // `board === undefined` while the query reports success means the answer on hand is
            // for another date — still waiting for this one, so the table says so rather than
            // rendering an empty day that looks like a fleet with nothing on it.
            loading={boardQuery.isPending || (board === undefined && !boardQuery.isError)}
            error={boardQuery.isError ? boardQuery.error : undefined}
            onRetry={() => void boardQuery.refetch()}
          />
        </div>

        {/* The two lists SIDE BY SIDE, each its own column. Stacked, the unavailable list pushed
            the available one off the fold on a real fleet, and the board lost the height to a
            section nobody drags from. */}
        <div className="grid min-w-0 grid-cols-2 gap-3">
          <div className="min-w-0 rounded-lg border border-emerald-200 bg-emerald-50 shadow-card dark:border-emerald-900 dark:bg-emerald-950/30">
            {/* Compact header: the count beside the title and the search directly under it, so
                the panel spends its height on drivers rather than on chrome — the same block the
                Fixed Roster's driver panel uses. */}
            <div className="space-y-2 px-3 pb-2 pt-3">
              <h2 className="text-center text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                {t('fleet.roster.availableTitle')}
                <span className="ms-1 font-normal text-emerald-700 dark:text-emerald-400">
                  ({formatNumber(pool.length, locale)})
                </span>
              </h2>
              <SearchInput
                value={availableSearch}
                onChange={setAvailableSearch}
                placeholder={t('fleet.fixedRoster.driverSearchPlaceholder')}
                className="w-full"
              />
            </div>
            {pool.length === 0 ? (
              <EmptyState title={t('fleet.roster.availableEmpty')} />
            ) : shownAvailable.length === 0 ? (
              // Searched and found nobody HERE — distinct from "the list is empty", which is a
              // fact about the day rather than about the term.
              <p className="px-3 pb-3 text-center text-sm text-emerald-800 dark:text-emerald-300">
                {t('fleet.fixedRoster.driverSearchEmpty')}
              </p>
            ) : (
              <ul className="max-h-[26rem] space-y-1 overflow-y-auto px-2 pb-2">
                {shownAvailable.map((driver) => (
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
            <div className="space-y-2 px-3 pb-2 pt-3">
              <h2 className="text-center text-sm font-semibold text-slate-700 dark:text-slate-200">
                {t('fleet.roster.unavailableTitle')}
                <span className="ms-1 font-normal text-slate-500 dark:text-slate-400">
                  ({formatNumber(board?.unavailableDrivers.length ?? 0, locale)})
                </span>
              </h2>
              <SearchInput
                value={unavailableSearch}
                onChange={setUnavailableSearch}
                placeholder={t('fleet.fixedRoster.driverSearchPlaceholder')}
                className="w-full"
              />
            </div>
            {board === undefined || unavailable.length === 0 ? (
              <EmptyState title={t('fleet.roster.unavailableEmpty')} />
            ) : shownUnavailable.length === 0 ? (
              <p className="px-3 pb-3 text-center text-sm text-slate-600 dark:text-slate-300">
                {t('fleet.fixedRoster.driverSearchEmpty')}
              </p>
            ) : (
              <ul className="max-h-[26rem] space-y-1 overflow-y-auto px-2 pb-2">
                {shownUnavailable.map((driver) => (
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
          open={editingRow !== null}
          onClose={() => setEditing(null)}
          onSave={(values) =>
            editingRow !== null && setDraft(() => applyEdit(draft, editingRow.vehicleId, values))
          }
          row={editingRow}
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
            <Button variant="danger" onClick={confirmClear}>
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
