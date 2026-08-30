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
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { Dialog } from '../../../shared/ui/Dialog';
import { Field, Select, Textarea } from '../../../shared/ui/form';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { toast } from '../../../shared/ui/toast/toast-store';
import { EditIcon, TrashIcon } from '../../../shared/ui/icons';
import { formatNumber, localized } from '../../../shared/lib/format';
import { errorMessage } from '../../../shared/lib/errors';
import { cn } from '../../../shared/lib/cn';
import { vehicleColour } from '../lib/vehicle-colour';
import { useFixedRoster, useSaveFixedRoster, useFleetCatalog } from '../api/fleet-queries';
import { useEmployeeName, useEmployeeRecords } from '../components/EmployeeName';
import { CatalogSelect } from '../components/CatalogSelect';
import { DriverChip } from '../components/DriverChip';
import { InWorkshopBadge } from '../components/VehicleStatusBadge';
import { filterDrivers, type DriverSearchRecord } from '../lib/driver-search';
import {
  CREW_SLOTS,
  applyEdit,
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

/** One driver as a <option>. A component, because resolving the name is a hook. */
const DriverOption = ({ employeeId }: { employeeId: string }): JSX.Element => {
  const { name, code } = useEmployeeName(employeeId);
  return (
    <option value={employeeId}>
      {name === null ? employeeId.slice(-8) : `${name}${code === null ? '' : ` · ${code}`}`}
    </option>
  );
};

/**
 * One driver slot as a labelled select — module level for the same reason `CrewSlotCell` is.
 *
 * Written inside the dialog it was a fresh element type on every keystroke, so React threw the
 * `<select>` away and built another one each time the draft changed. Out here the element
 * survives, which is what a native control needs to stay the one the reader is interacting with.
 */
const DriverSelect = ({
  value,
  onChange,
  label,
  exclude,
  candidates,
  disabled,
  hint,
  t,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  label: string;
  exclude: string | null;
  candidates: string[];
  /** Slot 2 while slot 1 is empty: a pair the record may not hold, so it is not offerable. */
  disabled?: boolean;
  hint?: string | undefined;
  t: (key: string) => string;
}): JSX.Element => (
  <Field label={label}>
    <Select
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{t('fleet.fixedRoster.noDriver')}</option>
      {candidates
        .filter((id) => id !== exclude || id === value)
        .map((id) => (
          <DriverOption key={id} employeeId={id} />
        ))}
    </Select>
    {hint !== undefined && (
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
    )}
  </Field>
);

/**
 * Edit one vehicle's four editable facts together — «تعديل».
 *
 * The dialog holds its OWN draft and hands it back only on save, which is what makes «إلغاء»
 * mean cancel: nothing outside this component changes until `onSave` runs, so a closed dialog
 * leaves the board draft — and therefore the pool, the dirty banner and the server — untouched.
 *
 * It does NOT re-implement the driver rules. The options it offers are the derived pool plus
 * this vehicle's own two drivers (who are absent from the pool precisely because they are
 * seated here), and the chosen values go back through `applyEdit`, which routes each one
 * through `assignDriver`. So seating somebody who is fixed to another car releases that car,
 * exactly as dragging them would — one rule, reached two ways.
 */
const EditCrewDialog = ({
  row,
  pool,
  missionTypes,
  onClose,
  onSave,
}: {
  row: FleetFixedCrewRowDto;
  pool: { employeeId: string }[];
  missionTypes: ReturnType<typeof useFleetCatalog>;
  onClose: () => void;
  onSave: (edit: {
    missionTypeId: string | null;
    driver1EmployeeId: string | null;
    driver2EmployeeId: string | null;
    notes: string | null;
  }) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [missionTypeId, setMissionTypeId] = useState<string | null>(row.missionTypeId);
  const [driver1, setDriver1] = useState<string | null>(row.driver1EmployeeId);
  const [driver2, setDriver2] = useState<string | null>(row.driver2EmployeeId);
  const [notes, setNotes] = useState<string>(row.notes ?? '');

  // Everyone the board leaves unseated, PLUS this car's own crew — they are missing from the
  // pool because they sit here, and a dialog that could not re-select them would look broken.
  const candidates = useMemo(() => {
    const ids = pool.map((d) => d.employeeId);
    for (const own of [row.driver1EmployeeId, row.driver2EmployeeId])
      if (own !== null && !ids.includes(own)) ids.push(own);
    return ids;
  }, [pool, row.driver1EmployeeId, row.driver2EmployeeId]);

  // The one rule the dialog enforces itself, because it is the one a two-select form can break
  // that a drag cannot: the same person chosen in both slots. `applyEdit` would silently
  // displace the first with the second, so it is refused here instead, before it is applied.
  const sameTwice = driver1 !== null && driver1 === driver2;

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${t('common.edit')} · ${row.code}`}
      description={t('fleet.fixedRoster.editHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={sameTwice}
            onClick={() =>
              onSave({
                missionTypeId,
                driver1EmployeeId: driver1,
                driver2EmployeeId: driver2,
                // '' is not a note. The contract refuses an empty string, and `null` is how
                // this module spells "nothing" everywhere else.
                notes: notes.trim() === '' ? null : notes.trim(),
              })
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('fleet.roster.fields.mission')}>
          {missionTypes.isError ? (
            <p className="text-sm text-rose-600 dark:text-rose-400">
              {t('fleet.fixedRoster.missionTypesFailed')}
            </p>
          ) : (
            <Select
              value={missionTypeId ?? ''}
              disabled={missionTypes.isPending}
              onChange={(e) => setMissionTypeId(e.target.value || null)}
            >
              <option value="">{t('fleet.fixedRoster.noMissionType')}</option>
              {(missionTypes.data?.items ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {localized(item.name, locale)}
                </option>
              ))}
            </Select>
          )}
          {!missionTypes.isPending &&
            !missionTypes.isError &&
            (missionTypes.data?.items.length ?? 0) === 0 && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {t('fleet.fixedRoster.noMissionTypesYet')}
              </p>
            )}
        </Field>

        <DriverSelect
          label={t('fleet.odometer.fields.driver1')}
          value={driver1}
          // Choosing «بدون سائق» here does not leave a second driver stranded in slot 2 — the
          // remaining driver is PROMOTED, which is what `clearSlot` does for the same gesture on
          // the board. The dialog therefore shows exactly the crew the save will write.
          onChange={(id) => {
            if (id === null && driver2 !== null) {
              setDriver1(driver2);
              setDriver2(null);
              return;
            }
            setDriver1(id);
          }}
          exclude={driver2}
          candidates={candidates}
          t={t}
        />
        <DriverSelect
          label={t('fleet.odometer.fields.driver2')}
          value={driver2}
          onChange={setDriver2}
          exclude={driver1}
          candidates={candidates}
          disabled={driver1 === null}
          hint={driver1 === null ? t('fleet.fixedRoster.needsFirstDriver') : undefined}
          t={t}
        />
        {sameTwice && (
          <p className="text-sm text-rose-600 dark:text-rose-400">
            {t('fleet.fixedRoster.sameDriverTwice')}
          </p>
        )}

        <Field label={t('fleet.attendance.fields.notes')}>
          <Textarea
            rows={3}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
};

/** The id of one drop target. Module level so the cell below can be too. */
const zoneKey = (vehicleId: string, slot: CrewSlot): string => `${vehicleId}:${slot}`;

/**
 * One slot, as a table CELL: a drop target that either holds a driver or asks for one.
 *
 * No label of its own — the column header above it already says which slot this is, and
 * repeating it in every row is the noise a table exists to remove.
 *
 * DECLARED HERE, not inside the page, and that is the fix for a real bug rather than tidiness.
 * A component written inside another component is a NEW function — a new element TYPE — on every
 * render, so React cannot match it against the previous tree: it unmounts the whole cell and
 * mounts a fresh one. `onDragStart` sets the dragging id, that render replaced the very DOM node
 * the browser had just picked up, and the browser cancelled the drag before it could begin. The
 * seated driver was therefore undraggable in one gesture, while the pool — whose rows are inline
 * JSX and keep their nodes across renders — was always fine. Hoisting it keeps the node alive,
 * so mouse-down → drag → drop works in one motion, with no click to "wake" the chip first.
 */
const CrewSlotCell = ({
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
  row: FleetFixedCrewRowDto;
  slot: CrewSlot;
  mayPlan: boolean;
  over: string | null;
  dragging: string | null;
  t: (key: string, params?: Record<string, string | number>) => string;
  setOver: (update: (key: string | null) => string | null) => void;
  onDrop: (vehicleId: string, slot: CrewSlot, employeeId: string) => void;
  onClear: (vehicleId: string, slot: CrewSlot) => void;
  setDragging: (employeeId: string | null) => void;
}): JSX.Element => {
  const employeeId = row[slot];
  const key = zoneKey(row.vehicleId, slot);
  const active = over === key;
  // A second driver needs a first. Slot 2 of a crew whose slot 1 is empty is not a drop target
  // at all: the schema and the service both refuse to store that pair, so offering the drop
  // would be offering a save that comes back 400. The cell says WHY in place of «اسحب هنا»
  // rather than silently ignoring the gesture.
  const needsFirst = slot === 'driver2EmployeeId' && row.driver1EmployeeId === null;
  const droppable = mayPlan && !needsFirst;
  return (
    <div className="min-w-[9rem]">
      <div
        data-drop-zone={key}
        data-drop-disabled={needsFirst ? 'needsFirstDriver' : undefined}
        aria-label={`${row.code} · ${t(SLOT_LABEL[slot])}`}
        onDragOver={(e) => {
          if (!droppable) return;
          // Preventing the default IS what makes an element a drop target.
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setOver(() => key);
        }}
        onDragLeave={() => setOver((k) => (k === key ? null : k))}
        onDrop={(e) => {
          if (!droppable) return;
          e.preventDefault();
          const id = e.dataTransfer.getData(DRAG_TYPE);
          if (id !== '') onDrop(row.vehicleId, slot, id);
        }}
        className={[
          'flex min-h-[2.5rem] items-center gap-2 rounded-lg border border-dashed px-2 py-1.5 transition-colors',
          active
            ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-950'
            : needsFirst
              ? 'border-slate-200 bg-slate-100/70 dark:border-slate-800 dark:bg-slate-800/30'
              : employeeId === null
                ? 'border-slate-300 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40'
                : 'border-transparent bg-slate-50 dark:bg-slate-800/60',
        ].join(' ')}
      >
        {employeeId === null ? (
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {t(needsFirst ? 'fleet.fixedRoster.needsFirstDriver' : 'fleet.fixedRoster.dropHere')}
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
            {mayPlan && (
              <button
                type="button"
                aria-label={t('fleet.fixedRoster.removeDriver')}
                title={t('fleet.fixedRoster.removeDriver')}
                onClick={() => onClear(row.vehicleId, slot)}
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
  /** The vehicle whose edit dialog is open, or null. The dialog holds its own draft. */
  const [editing, setEditing] = useState<string | null>(null);

  // «نوع المهمة» is a reference to the fleet's own vocabulary — the SAME `missionType` catalog
  // the DAILY roster reads (أنواع المهمات), through the same cached hook, so the two boards
  // cannot drift into two lists. The id is what is stored; the name is resolved for display.
  //
  // It pointed at `workType` (أنواع الأعمال) for one release. That is the WORKSHOP's vocabulary —
  // it carries `countsForAlarm` and names maintenance jobs — so the column labelled «نوع المهمة»
  // was offering «صيانة» as a car's standing mission. Corrected here; the rows written under the
  // old name are retired by `npm run fleet:fix-crew-mission`.
  const missionTypes = useFleetCatalog('missionType');
  const missionTypeName = (id: string | null): string | null => {
    if (id === null) return null;
    const item = missionTypes.data?.items.find((entry) => entry.id === id);
    // `undefined` = the catalog has not answered yet, or the item was archived after it was
    // chosen. Either way the id is real and the row is not broken, so the cell shows the dash
    // rather than a raw ObjectId no reader could act on.
    return item === undefined ? null : localized(item.name, locale);
  };

  // The pool is DERIVED, never the server's list rendered raw: everyone the draft already seats
  // leaves it the instant the drop lands, and comes back the instant a slot is cleared. Deriving
  // it is also why a move between vehicles cannot flicker a driver back into the list and why a
  // slot change cannot duplicate a card — membership is computed from the seats, not adjusted.
  const pool = useMemo(
    () => availableDrivers(boardQuery.data?.drivers ?? [], draft),
    [boardQuery.data, draft],
  );

  // ── finding somebody in the pool ──────────────────────────────────────────
  //
  // Panel-local state, not a URL parameter: this filters a side list, it does not select what
  // the page is about. The vehicle search above is `?q=` because it changes which rows the board
  // shows — a thing worth sharing in a link. Which driver you were hunting for is not.
  const [driverSearch, setDriverSearch] = useState('');

  // The records the cards already load, read once here so the whole pool can be searched. Same
  // query keys, so this subscribes to the existing entries rather than fetching a second time.
  const records = useEmployeeRecords(useMemo(() => pool.map((d) => d.employeeId), [pool]));
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

  const shownDrivers = useMemo(
    () => filterDrivers(pool, searchIndex, driverSearch),
    [pool, searchIndex, driverSearch],
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

  // Everything the (module-level) slot cell needs from this page, gathered once. Spread rather
  // than threaded one by one so the two columns below stay readable.
  const slotProps = {
    mayPlan,
    over,
    dragging,
    t,
    setOver,
    onDrop: drop,
    onClear: (vehicleId: string, slot: CrewSlot): void =>
      setDraft((rows) => clearSlot(rows, vehicleId, slot)),
    setDragging,
  };

  /**
   * Change one vehicle's mission type from the CELL.
   *
   * Routed through `applyEdit` — the very function the dialog's save calls — rather than writing
   * the row here, so one place knows what an edit means and the cell cannot drift from the
   * dialog. The drivers and the note are handed back unchanged; `applyEdit` runs them through
   * `assignDriver`, where re-seating the driver already in the slot is a no-op.
   *
   * It edits the DRAFT, exactly as a drag does. «حفظ» is still the only thing that writes, so a
   * mistaken pick is undone by «إلغاء» like any other change on this board.
   */
  const setMission = (row: FleetFixedCrewRowDto, missionTypeId: string | null): void =>
    setDraft((rows) =>
      applyEdit(rows, row.vehicleId, {
        missionTypeId,
        driver1EmployeeId: row.driver1EmployeeId,
        driver2EmployeeId: row.driver2EmployeeId,
        notes: row.notes,
      }),
    );

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
      // The CODE alone. The plate sat under it as a second line and cost every row the height of
      // a line to say a thing this board never asks: a fixed crew belongs to the vehicle, and the
      // vehicle is identified here by its code. The plate is still on the vehicle record, still
      // shown on the screens that are ABOUT the vehicle, and still findable — the search below
      // reads it, so a reader holding a plate number can still reach the row.
      //
      // The code carries the VEHICLE'S OWN COLOUR — see `vehicleColour`. A hundred rows of
      // three-digit numbers that differ by one glyph are hard to keep your place in; a tint
      // attached to the car gives the eye something to land on before it reads the digits. The
      // colour is hashed from the vehicle's id, so it is the same on every render and survives
      // filtering, sorting and the arrival of new vehicles — it says WHICH car, never how the
      // car is doing.
      render: (row) => (
        <span
          data-vehicle-colour={row.vehicleId}
          className={cn(
            'inline-block rounded-md px-2 py-0.5 font-mono text-xs',
            vehicleColour(row.vehicleId),
          )}
          dir="ltr"
        >
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
      // Editable IN THE CELL, not only behind «تعديل». This is the fact on the board a
      // dispatcher changes most often after the crew itself, and reaching it through a dialog
      // cost four interactions to answer a one-word question.
      //
      // `CatalogSelect` is the app's own catalog select, given the SAME `missionType` kind the
      // daily board uses. It reads the same cached hook, so N rows still cost ONE request, and
      // it keeps an archived current value visible rather than silently dropping a historical
      // reference. A reader without `fleetRoster.plan` sees the name as text, as before.
      render: (row) =>
        !mayPlan ? (
          (missionTypeName(row.missionTypeId) ?? dash)
        ) : (
          // The click stops here. This row's other cells are drag sources and drop targets, and
          // `DataTable` isolates its own selection cell the same way — a control inside a row
          // must not hand its interaction to the row.
          // `min-w-[11rem]`: the shared `Select` reserves `pe-9` (36px) for its chevron plus a
          // 12px start gutter, so a 9rem box left 94px of text — and «نقل أموال (يومي)», the
          // commonest mission there is, needs 104px. Measured, not guessed: a select clips its
          // label internally and reports no overflow, so nothing but comparing the rendered text
          // against the inner width catches it.
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
              onChange={(id) => setMission(row, id === '' ? null : id)}
            />
          </div>
        ),
    },
    {
      key: 'driver1',
      header: t('fleet.odometer.fields.driver1'),
      render: (row) => <CrewSlotCell {...slotProps} row={row} slot="driver1EmployeeId" />,
    },
    {
      key: 'driver2',
      header: t('fleet.odometer.fields.driver2'),
      render: (row) => <CrewSlotCell {...slotProps} row={row} slot="driver2EmployeeId" />,
    },
    {
      key: 'notes',
      header: t('fleet.attendance.fields.notes'),
      render: (row) =>
        row.notes === null ? (
          dash
        ) : (
          // Long notes are truncated rather than allowed to set the column's width — the note is
          // context here, and the dialog is where it is read and written in full. The ceiling is
          // wider than it was: the width the driver panel gave up is spent HERE, which is the
          // column that was actually running out of room.
          <span className="block max-w-[22rem] truncate text-sm" title={row.notes}>
            {row.notes}
          </span>
        ),
    },
    {
      key: 'actions',
      header: t('fleet.vehicles.columns.actions'),
      align: 'end',
      render: (row) =>
        mayPlan ? (
          <span className="flex items-center justify-end gap-1">
            {/* Edit is offered on EVERY row, crewed or not: a car with no crew is exactly the
                one that needs a work type or a note set on it. */}
            <button
              type="button"
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              aria-label={t('common.edit')}
              title={t('common.edit')}
              data-edit-row={row.vehicleId}
              onClick={() => setEditing(row.vehicleId)}
            >
              <EditIcon className="h-4 w-4" />
            </button>
            {row.driver1EmployeeId !== null || row.driver2EmployeeId !== null ? (
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
            ) : null}
          </span>
        ) : (
          dash
        ),
    },
  ];

  const editingRow = draft.find((row) => row.vehicleId === editing) ?? null;

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

      <div className="grid gap-6 xl:grid-cols-5">
        {/* `min-w-0`: a grid item's default `min-width: auto` refuses to shrink below its
            content, so without it the table's own `overflow-x-auto` never engages — the wrapper
            just grows and takes the PAGE sideways with it. With it, a narrow screen scrolls
            inside the table, which is where the scrolling belongs. */}
        <div className="min-w-0 space-y-4 xl:col-span-4">
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

        <div className="min-w-0 space-y-6">
          {/* Tinted like the reference: the pool is a CONTROL surface, not another data panel,
              and the green ties it to the chips it holds — so the eye reads list-and-chips as one
              thing beside the board rather than a second table competing with it.

              A plain surface rather than `<Card>`, because a Card cannot be re-tinted: `cn` joins
              class names without resolving Tailwind conflicts (see `CardBody`'s own note), so the
              base `bg-white border-slate-200` and an incoming `bg-green-50 border-green-200` both
              land on the element and the winner is stylesheet order — which put white on top and
              left the tint silently doing nothing. Every other tinted surface in this app is built
              exactly like this one, from the same three tokens. */}
          <div className="rounded-lg border border-green-200 bg-green-50 shadow-card dark:border-green-900 dark:bg-green-950/30">
            {/* Compact header: the count belongs beside the title, and the search directly under
                it, so the panel spends its height on drivers rather than on chrome. */}
            <div className="space-y-2 px-3 pb-2 pt-3">
              <h2 className="text-center text-sm font-semibold text-green-900 dark:text-green-200">
                {t('fleet.fixedRoster.driversTitle')}
                <span className="ms-1 font-normal text-green-700 dark:text-green-400">
                  ({formatNumber(pool.length, locale)})
                </span>
              </h2>
              <SearchInput
                value={driverSearch}
                onChange={setDriverSearch}
                placeholder={t('fleet.fixedRoster.driverSearchPlaceholder')}
                className="w-full"
              />
            </div>
            {pool.length === 0 ? (
              <EmptyState title={t('fleet.roster.availableEmpty')} />
            ) : shownDrivers.length === 0 ? (
              // Searched and found nobody — distinct from "the pool is empty", which means every
              // driver is already crewed and is a fact about the board rather than about the term.
              <p className="px-3 pb-3 text-center text-sm text-green-800 dark:text-green-300">
                {t('fleet.fixedRoster.driverSearchEmpty')}
              </p>
            ) : (
              <ul className="max-h-[26rem] space-y-1 overflow-y-auto px-2 pb-2">
                {shownDrivers.map((driver) => {
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
                          // The chip IS the row now, so the row itself adds no padding of its
                          // own — the old `px-3 py-1.5` sat around a content-width pill and is
                          // exactly the space the reference gives back to the board.
                          'flex items-center gap-1.5',
                          mayPlan ? 'cursor-grab active:cursor-grabbing' : '',
                          dragging === driver.employeeId ? 'opacity-50' : '',
                        ].join(' ')}
                      >
                        <DriverChip
                          employeeId={driver.employeeId}
                          className={
                            mayPlan ? 'min-w-0 flex-1 hover:bg-green-800' : 'min-w-0 flex-1'
                          }
                        />
                        {/* Only the exception is badged now. "Free" is what every other row in
                            this list already means, so saying it on each one spends the width
                            the name needs without telling the reader anything. */}
                        {heldElsewhere && (
                          <Badge tone="warning" size="sm" className="shrink-0">
                            {t('fleet.roster.otherVehicle')}
                          </Badge>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {editingRow !== null && (
        <EditCrewDialog
          row={editingRow}
          pool={pool}
          missionTypes={missionTypes}
          onClose={() => setEditing(null)}
          onSave={(edit) => {
            setDraft((rows) => applyEdit(rows, editingRow.vehicleId, edit));
            setEditing(null);
          }}
        />
      )}
    </PageContainer>
  );
};
