// «الطقم الثابت» on a COMPUTER (≥1280px) — «واعمل ديزاين شاشة الطاقم الثابت زى التعيين اليومى»: the
// daily «تعيين السيارات» board (`RosterDeskBoard`) with its own pieces, minus the day.
//
// THE DAILY LOOK, piece for piece: the toolbar row (the car count on the start side, the Excel pill
// on the end side); the dark filter bar («كود السيارة» in its icon box, the counters on one line,
// the red reset); the boards' dark table with the sticky head, the pinned «إجراءات», the rose
// workshop row and the amber unsaved row; the drivers panel beside it; the unsaved bar floating
// at the foot (the edited codes, «تراجع», «إلغاء», «حفظ»), asking first when «إلغاء» would throw
// away more than one car's work.
//
// MINUS THE DAY: a standing crew is a fact about a car, true until somebody changes it — so no
// stepper, no «يوم سابق», no availability word, no absence, no licence block. The page header
// («الطقم الثابت» under «الحركة») is the shell's, on top at every width (owner's answer 2 ج); this
// board draws no title of its own, and the toolbar's Excel pill is the screen's ONE Excel control.
//
// THE FIXED RULES, unchanged: a car the workshop holds keeps an editable standing crew (its mission,
// its seats, the pen, the swap, the bin); «إفراغ الطقم» empties both seats at once and keeps the
// mission and the note, with no question («تراجع» and «إلغاء» are there); the pen opens the four
// facts together (`FixedCrewDialog`). Every edit is the board model's (`lib/fixed-roster-model.ts`),
// on a draft that survives a reload; only «حفظ» writes. Owner's answer 1 (ب): no seat, row or list
// flags a standing member who can no longer drive.
//
// Who may edit is `fleetRoster.plan`: a reader without it gets no «إجراءات», no picker, nothing to
// drag, no bin and no unsaved bar.
import { useState } from 'react';
import { type FleetFixedCrewRowDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { cn } from '../../../../shared/lib/cn';
import { pluralKey } from '../../../../shared/lib/plural';
import { DataTable, type Column } from '../../../../shared/ui/DataTable';
import { FilterBar } from '../../../../shared/ui/FilterBar';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { EmptyState } from '../../../../shared/ui/states/EmptyState';
import { SwapIcon } from '../../../../shared/ui/icons';
import { BOARD_FRAME } from '../board-scroll';
import { DARK_FILTER_BAR } from '../dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from '../FilterWithIcon';
import { VehicleCodeFilter } from '../VehicleCodeFilter';
import { VehicleHoverCode } from '../VehicleHoverCard';
import { CatalogSelect } from '../CatalogSelect';
import { ACTION_GROUP, actionTone } from '../row-actions-look';
import { SquarePenIcon, Trash2Icon } from '../row-action-icons';
import { type CrewSlot } from '../../lib/fixed-roster-board';
import { hasDriver } from '../../lib/roster-view';
import {
  fixedFiltersHiding,
  toSeatRow,
  type FixedDeskBoardProps,
  type FixedEditValues,
} from '../../lib/fixed-roster-model';
import {
  FIGURE,
  LAPTOP_ACTIONS,
  MISSION_BOX,
  PINNED_CELL,
  PINNED_EDGE,
  PINNED_HEAD,
  ROSTER_TABLE,
  TIGHT_CELL,
  useOverflowing,
} from './RosterDeskBoard';
import { DASH, SeatCell } from './roster-desk-cells';
import { DeskCounters, ExcelPill } from './roster-desk-parts';
import { CodeList, EditsBar, num } from './roster-parts';
import {
  FIXED_SEAT_NAME,
  FixedNotesCell,
  FixedStatusCell,
  fixedSeatFacts,
} from './fixed-desk-cells';
import { FixedDriversPanel } from './FixedDriversPanel';
import { FixedCrewDialog } from './FixedCrewDialog';

export const FixedDeskBoard = ({
  m,
  query,
  resetFilters,
  rows,
  sort,
  onSortChange,
}: FixedDeskBoardProps): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { mayPlan, missions, view, patch } = query;

  const [tableBox, overflowing] = useOverflowing();

  // ── what is open ──────────────────────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState<string | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  // The DRAFT's row: the dialog opens on what the board shows now, edits included.
  const editingRow = m.draft.find((row) => row.vehicleId === editing) ?? null;

  // ── the edits (each one a board function on the draft, through the model) ───────────────────
  const dropDriver = (vehicleId: string, slot: CrewSlot, employeeId: string): void => {
    setOver(null);
    setDragging(null);
    m.actions.assign({ vehicleId, slot }, employeeId);
  };
  /**
   * The pen dialog's four facts as ONE edit (one «تراجع» step). A dialog saved with nothing
   * changed adds nothing to undo.
   */
  const applyDialog = (row: FleetFixedCrewRowDto, values: FixedEditValues): void => {
    const same =
      values.driver1EmployeeId === row.driver1EmployeeId &&
      values.driver2EmployeeId === row.driver2EmployeeId &&
      values.missionTypeId === row.missionTypeId &&
      values.notes === row.notes;
    if (!same) m.actions.apply(row.vehicleId, values);
  };

  // «حفظ» — a refusal is toasted by the model in Arabic, and the draft STAYS.
  const save = (): void => {
    if (m.saving || !m.dirty) return;
    void m.actions.save();
  };
  // «إلغاء» drops EVERY edit: more than one car's work is asked about first.
  const discard = (): void => {
    if (m.changed.length > 1) setAskDiscard(true);
    else m.actions.discard();
  };
  /**
   * An edited car's code in the bar → its row, in the middle of the table. A filter that hides it
   * is lifted — only that one: the picked codes, the missions, the counter view, each kept when the
   * row passes it.
   */
  const showCar = (code: string): void => {
    const row = m.draft.find((candidate) => candidate.code === code);
    if (row !== undefined && !rows.some((candidate) => candidate.code === code)) {
      patch(fixedFiltersHiding(row, { search: query.search, missions, view }));
    }
    window.requestAnimationFrame(() =>
      document
        .querySelector(`tr[data-car="${CSS.escape(code)}"]`)
        ?.scrollIntoView({ block: 'center' }),
    );
  };

  // ── the table ─────────────────────────────────────────────────────────────────────────────────
  // The daily seat over the standing row: the workshop does not lock a standing crew
  // (`toSeatRow`), and nobody is flagged (`fixedSeatFacts`, answer 1 ب).
  const facts = fixedSeatFacts(m);
  const poolEmpty = t('fleet.fixedRoster.poolEmpty');
  const seat = (row: FleetFixedCrewRowDto, slot: CrewSlot): JSX.Element => (
    <SeatCell
      row={toSeatRow(row)}
      slot={slot}
      mayPlan={mayPlan}
      over={over}
      setOver={setOver}
      dragging={dragging}
      setDragging={setDragging}
      facts={facts}
      pool={m.pool}
      searchIndex={m.searchIndex}
      onDrop={(target, which, employeeId) => dropDriver(target.vehicleId, which, employeeId)}
      onClear={(target, which) => m.actions.clear(target.vehicleId, which)}
      emptyLabel={poolEmpty}
      // On a 1280 screen a seat's name may take a second line rather than push the table past
      // its frame: the whole table fits, «ملاحظات» never slides under «إجراءات» (told item 21).
      nameClassName={FIXED_SEAT_NAME}
    />
  );
  const columns: Column<FleetFixedCrewRowDto>[] = [
    {
      key: 'vehicle',
      header: t('fleet.odometer.columns.vehicle'),
      // SORTED IN THE BROWSER, and honestly so: this board is every car that can carry a standing
      // crew, never a page of them.
      sortable: true,
      sortKey: 'code',
      align: 'center',
      className: TIGHT_CELL,
      headerClassName: TIGHT_CELL,
      // Bold white, as the daily board: no colour of its own per car. The code carries the car
      // card by hover only — a board of drag-and-drop seats keeps its Tab order for the seats and
      // the row's buttons.
      render: (row) => (
        <VehicleHoverCode
          vehicleId={row.vehicleId}
          code={row.code}
          focusable={false}
          dir="ltr"
          className={cn('text-sm font-bold', FIGURE)}
        />
      ),
    },
    {
      key: 'state',
      header: t('fleet.vehicles.columns.status'),
      // Ranked by what the badges SAY (the shell's `fixedSortValue`), not by their spelling.
      sortable: true,
      align: 'center',
      render: (row) => <FixedStatusCell row={row} />,
    },
    {
      key: 'mission',
      header: t('fleet.roster.fields.mission'),
      align: 'center',
      className: TIGHT_CELL,
      render: (row) =>
        !mayPlan ? (
          row.missionTypeId === null ? (
            DASH
          ) : (
            m.missionName(row.missionTypeId)
          )
        ) : (
          // The click stops here: this row's other cells are drag sources and drop targets, and a
          // control inside a row must not hand its interaction to the row.
          <div
            className={MISSION_BOX}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {/* A car the workshop holds keeps its standing mission editable — the daily board's
                lock is about a DAY's work, and a standing crew is not one. */}
            <CatalogSelect
              kind="missionType"
              value={row.missionTypeId ?? ''}
              ariaLabel={`${row.code} · ${t('fleet.roster.fields.mission')}`}
              allLabel={t('fleet.fixedRoster.noMissionType')}
              density="tight"
              className="w-full"
              onChange={(id) => m.actions.mission(row.vehicleId, id === '' ? null : id)}
            />
          </div>
        ),
    },
    {
      key: 'driver1',
      header: t('fleet.odometer.fields.driver1'),
      align: 'center',
      className: TIGHT_CELL,
      render: (row) => seat(row, 'driver1EmployeeId'),
    },
    {
      key: 'driver2',
      header: t('fleet.odometer.fields.driver2'),
      align: 'center',
      className: TIGHT_CELL,
      render: (row) => seat(row, 'driver2EmployeeId'),
    },
    {
      key: 'notes',
      // Read here (three lines at most, the whole note on hover); written in the pen dialog.
      header: t('fleet.attendance.fields.notes'),
      align: 'center',
      render: (row) => <FixedNotesCell notes={row.notes} />,
    },
    ...(mayPlan
      ? [
          {
            key: 'actions',
            header: t('fleet.vehicles.columns.actions'),
            align: 'center',
            className: cn(PINNED_CELL, overflowing && PINNED_EDGE),
            headerClassName: cn(PINNED_HEAD, overflowing && PINNED_EDGE),
            // «اعملى الالوان دى»: the pen, the swap of the two seats (indigo) and the bin, in the
            // owner's box (`row-actions-look`) — on a workshop row too.
            render: (row: FleetFixedCrewRowDto) => (
              <span className={cn(ACTION_GROUP, LAPTOP_ACTIONS)} data-row-actions="fixed-roster">
                {/* On EVERY row, crewed or not: a car with no crew is exactly the one that needs
                    a mission or a note put on it. */}
                <button
                  type="button"
                  data-edit-row={row.code}
                  className={actionTone('edit')}
                  aria-label={t('common.edit')}
                  title={t('common.edit')}
                  onClick={() => setEditing(row.vehicleId)}
                >
                  <SquarePenIcon className="h-4 w-4" />
                </button>
                {/* «يخلى السائق الاول السائق الثانى ويخلى السائق الثانى السائق الاول» — offered
                    only where there IS a pair to trade. */}
                {row.driver1EmployeeId !== null && row.driver2EmployeeId !== null && (
                  <button
                    type="button"
                    data-swap-drivers={row.vehicleId}
                    className={actionTone('transfer')}
                    aria-label={t('fleet.roster.swapDrivers')}
                    title={t('fleet.roster.swapDrivers')}
                    onClick={() => m.actions.swap(row.vehicleId)}
                  >
                    <SwapIcon className="h-4 w-4" />
                  </button>
                )}
                {/* «إفراغ الطقم»: BOTH seats in one write, the mission and the note kept, at once
                    — no confirm («تراجع» and «إلغاء» are there for a slip). */}
                {hasDriver(row) && (
                  <button
                    type="button"
                    data-clear-crew={row.code}
                    className={actionTone('delete')}
                    aria-label={t('fleet.fixedRoster.clearCrew')}
                    title={t('fleet.fixedRoster.clearCrew')}
                    onClick={() => m.actions.clearCrew(row.vehicleId)}
                  >
                    <Trash2Icon className="h-4 w-4" />
                  </button>
                )}
              </span>
            ),
          } satisfies Column<FleetFixedCrewRowDto>,
        ]
      : []),
  ];

  const editedCodes = m.changed.map((row) => m.codeOf(row.vehicleId));

  return (
    <>
      <div className={BOARD_FRAME} data-fixed-desk="true">
        {/* The toolbar row under the page header: how many cars the filters leave, and the one
            Excel control of this screen («تصدير Excel» — the table on screen, eight columns). */}
        <div className="flex items-center justify-between gap-2" data-fixed-toolbar="true">
          <span
            role="status"
            data-filtered-count
            title={t('fleet.fixedRoster.matchedRows')}
            className="text-sm font-bold text-slate-600 dark:text-slate-300"
          >
            {m.board !== undefined &&
              t(pluralKey('fleet.fixedRoster.carCount', locale, rows.length), {
                count: num(rows.length),
              })}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <ExcelPill name="fixed-roster" onExport={() => m.actions.exportSheet(rows)} />
          </span>
        </div>

        {/* The boards' dark bar: «كود السيارة» (typing inside), the counters on ONE line, the red
            reset. No «كل المهمات» dropdown — the mission chips are its control here, as on the
            daily board. */}
        <div
          className={cn(DARK_FILTER_BAR, '[&_[role=listbox]]:animate-menu-in')}
          data-fixed-filters="true"
        >
          <FilterBar hasActiveFilters={m.filtered} onClear={resetFilters}>
            <FilterWithIcon
              icon={FILTER_ICON.car}
              tone="text-emerald-600 dark:text-emerald-400"
              className="w-48 shrink-0 lg:[&&]:!w-48 lg:[&&]:!flex-none"
            >
              <VehicleCodeFilter
                fullWidth
                density="tight"
                value={m.codes}
                options={m.codeOptions}
                onChange={(next) => patch({ q: next.length === 0 ? null : next.join(',') })}
              />
            </FilterWithIcon>
            <DeskCounters counters={m.counters} onApply={patch} />
          </FilterBar>
        </div>

        {/* The drivers panel beside the table: 20rem, 24rem from 1750px, and 18.25rem on a laptop,
            with an 8px gap below 1440px — the daily board's grid. */}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_20rem] gap-3 max-[1535px]:grid-cols-[minmax(0,1fr)_18.25rem] max-[1439px]:gap-2 min-[1750px]:grid-cols-[minmax(0,1fr)_24rem] min-[1750px]:gap-4">
          <div
            ref={tableBox}
            className={ROSTER_TABLE}
            data-fixed-table="true"
            data-overflow={overflowing ? 'true' : undefined}
          >
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(row) => row.vehicleId}
              sort={sort}
              onSortChange={onSortChange}
              rowProps={(row) =>
                ({
                  'data-car': row.code,
                  // An unsaved edit outranks the workshop: the workshop is still said by its badge.
                  // A restored draft is drawn for every reader (as the daily board draws it), so
                  // its rows say they are unsaved; only a planner gets the bar to act on them.
                  'data-tint': m.unsavedIds.has(row.vehicleId)
                    ? 'unsaved'
                    : row.inMaintenance
                      ? 'workshop'
                      : undefined,
                }) as never
              }
              loading={m.status.loading}
              error={m.status.error}
              onRetry={m.status.retry}
              // A board with no car at all says so; filters that hide every car get the table's
              // own empty line (the red reset is lit).
              empty={
                m.board !== undefined && m.draft.length === 0 ? (
                  <EmptyState title={t('fleet.fixedRoster.noVehicles')} />
                ) : undefined
              }
              minColumnWidth={4}
              stickyHead
            />
          </div>
          <FixedDriversPanel m={m} mayPlan={mayPlan} />
        </div>

        {mayPlan && m.dirty && (
          <div className="shrink-0">
            <EditsBar
              codes={editedCodes}
              edited={m.dirty}
              undoable={m.undoDepth > 0}
              saving={m.saving}
              onUndo={m.actions.undo}
              onDiscard={discard}
              onSave={save}
              onCode={showCar}
              shape="floating"
            />
          </div>
        )}
      </div>

      {editingRow !== null && (
        <FixedCrewDialog
          row={editingRow}
          m={m}
          onClose={() => setEditing(null)}
          onSave={(values) => {
            applyDialog(editingRow, values);
            setEditing(null);
          }}
        />
      )}
      <Dialog
        open={askDiscard}
        onClose={() => setAskDiscard(false)}
        title={t('fleet.roster.discardAll')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAskDiscard(false)}>
              {t('common.close')}
            </Button>
            <Button
              variant="danger"
              data-confirm="discard"
              onClick={() => {
                m.actions.discard();
                setAskDiscard(false);
              }}
            >
              {t('fleet.roster.discardAll')}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
          {t('fleet.roster.discardBody')}{' '}
          <CodeList
            codes={editedCodes}
            className="font-semibold text-slate-900 dark:text-slate-50"
          />
        </p>
      </Dialog>
    </>
  );
};
