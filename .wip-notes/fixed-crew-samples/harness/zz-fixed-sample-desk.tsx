// ── DESIGN SAMPLE — NEVER COMMIT (apps/web/src/zz-* is in .git/info/exclude) ────────────────────
// «الطقم الثابت» on a COMPUTER (≥1280px), in the design of the merged «تعيين السيارات» desk board
// (RosterDeskBoard) under the screen's OWN header (owner Q2 ج, 2026-11-17: the old header returns —
// the REAL PageHeader, «الطقم الثابت» with «الحركة › الطقم الثابت», as FixedRosterPage draws it, with
// no Excel action: Excel stays the toolbar's pill, one Excel control on the screen), then the
// daily's toolbar («20 سيارة» · Excel; no day stepper and nothing in its place), the dark filter bar
// on ONE line («كود السيارة» · the counters with ‹ › · the red reset), the boards' dark table with
// the daily seat, the drivers panel with ONE list, and the floating unsaved bar (edited codes ·
// «تراجع» · «إلغاء» · «حفظ»).
//
// REAL, imported as they are: the page frame and table kit (PageContainer, BOARD_FRAME, DARK_TABLE,
// DARK_FILTER_BAR, FilterBar, FilterWithIcon, VehicleCodeFilter, VehicleHoverCode, CatalogSelect,
// DataTable), the daily pieces (SeatCell, DeskCounters, ExcelPill, EditsBar, DriverSearch, CodeList,
// num), the row actions' look. The daily seat is handed the row with `inMaintenance: false` — the
// standing crew is never locked by the workshop — while the badge and the rose row read the real row;
// and EMPTY flag sets — this screen flags nobody who can no longer drive (owner Q1 ب, the daily's job).
//
// COPIED (module-private in RosterDeskBoard): the row tints, the laptop rules, the tight cell, the
// pinned «إجراءات», the table recipe, the mission box, `useOverflowing`.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { type FleetFixedCrewRowDto, type FleetRosterRowDto } from '@ecms/contracts';
import { useT } from './platform/localization/useT';
import { PageContainer, PageHeader } from './platform/layout/PageContainer';
import { cn } from './shared/lib/cn';
import { DataTable, type Column } from './shared/ui/DataTable';
import { FilterBar } from './shared/ui/FilterBar';
import { Button } from './shared/ui/Button';
import { Dialog } from './shared/ui/Dialog';
import { SwapIcon } from './shared/ui/icons';
import { type TableSort } from './modules/fleet/lib/table-sort';
import { BOARD_FRAME, BOARD_TABLE_FILL } from './modules/fleet/components/board-scroll';
import { DARK_FILTER_BAR } from './modules/fleet/components/dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from './modules/fleet/components/FilterWithIcon';
import { NUM } from './modules/fleet/components/FuelCardBoard';
import { VehicleCodeFilter } from './modules/fleet/components/VehicleCodeFilter';
import { VehicleHoverCode } from './modules/fleet/components/VehicleHoverCard';
import { CatalogSelect } from './modules/fleet/components/CatalogSelect';
import { ACTION_GROUP, actionTone } from './modules/fleet/components/row-actions-look';
import { SquarePenIcon, Trash2Icon } from './modules/fleet/components/row-action-icons';
import { DARK_TABLE } from './modules/fleet/pages/VehiclesListPage';
import { type CrewSlot } from './modules/fleet/lib/fixed-roster-board';
import { hasDriver } from './modules/fleet/lib/roster-view';
import { SeatCell, type SeatFacts } from './modules/fleet/components/roster/roster-desk-cells';
import { DeskCounters, ExcelPill } from './modules/fleet/components/roster/roster-desk-parts';
import { DriverSearch } from './modules/fleet/components/roster/roster-drivers';
import { CodeList, EditsBar, num } from './modules/fleet/components/roster/roster-parts';
import { fixedFiltersHiding, type FixedModel, type FixedQuery } from './zz-fixed-sample-model';
import {
  DASH,
  DriversHead,
  EditCrewDialog,
  FixedDriverList,
  FixedStatusCell,
} from './zz-fixed-sample-parts';

const FIGURE = cn('whitespace-nowrap', NUM);

/** RosterDeskBoard's ROW_TINTS: opaque unsaved amber over workshop rose. */
const ROW_TINTS = cn(
  '[&_tbody_tr]:!bg-white dark:[&_tbody_tr]:!bg-[#111827]',
  '[&_tbody_tr[data-tint=unsaved]]:!bg-[#fffbeb] dark:[&_tbody_tr[data-tint=unsaved]]:!bg-[#261919] [&_tbody_tr[data-tint=unsaved]:hover]:!bg-[#fef3c7] dark:[&_tbody_tr[data-tint=unsaved]:hover]:!bg-[#301911]',
  '[&_tbody_tr[data-tint=workshop]]:!bg-[#fff1f2] dark:[&_tbody_tr[data-tint=workshop]]:!bg-[#291021] [&_tbody_tr[data-tint=workshop]:hover]:!bg-[#ffe4e6] dark:[&_tbody_tr[data-tint=workshop]:hover]:!bg-[#340d1f]',
);
const LAPTOP_GUTTERS = 'max-[1439px]:[&_td]:!px-1 max-[1439px]:[&_th]:!px-1';
const LAPTOP_ACTIONS = 'max-[1439px]:gap-0.5 max-[1439px]:px-0.5';
const TIGHT_CELL = '[&&]:!px-1.5 max-[1439px]:[&&]:!px-1';
const PINNED_CELL = 'sticky end-0 z-[1] [background-color:inherit]';
const PINNED_HEAD = 'sticky end-0 z-[2] [background-color:inherit]';
const PINNED_EDGE = cn(
  "before:pointer-events-none before:absolute before:inset-y-0 before:end-full before:w-3 before:content-['']",
  'rtl:before:bg-gradient-to-r ltr:before:bg-gradient-to-l before:from-slate-900/15 before:to-transparent dark:before:from-black/60',
  "after:pointer-events-none after:absolute after:inset-y-0 after:start-0 after:w-px after:content-['']",
  'after:bg-slate-300 dark:after:bg-slate-600',
);
const ROSTER_TABLE = cn(
  DARK_TABLE,
  BOARD_TABLE_FILL,
  'min-w-0',
  "[&_td]:![font-family:'Cairo',ui-sans-serif,sans-serif]",
  '[&_thead_th]:!whitespace-nowrap',
  '[&_td_[data-seat-state]_button]:!h-auto [&_td_[data-seat-state]_button]:!w-full',
  '[&_td_[data-seat-state]_button[data-seat-bin]]:!h-6 [&_td_[data-seat-state]_button[data-seat-bin]]:!w-5',
  ROW_TINTS,
  LAPTOP_GUTTERS,
);
const MISSION_BOX =
  "mx-auto w-[9.5rem] max-[1535px]:w-36 [&_select]:![font-family:'Cairo',ui-sans-serif,sans-serif]";

/** The daily drivers panel's controls at a computer's size (DESK_CONTROLS). */
const DESK_CONTROLS = '[&_input]:!h-9 [&_input]:!text-sm';
/**
 * Below 1440 the panel is half a rem narrower than the daily's (see the grid below); its rows give
 * those 8px back from their side padding (16px → 12px), so a name has the room it has at 1440.
 */
const LAPTOP_POOL = 'max-[1439px]:[&_[data-fixed-pool]_.px-4]:!px-3';

const useOverflowing = (): [RefObject<HTMLDivElement>, boolean] => {
  const box = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const table = box.current?.querySelector('table');
    const scroller = table?.parentElement;
    if (table === undefined || table === null || scroller === null || scroller === undefined)
      return undefined;
    const measure = (): void => setOverflowing(scroller.scrollWidth > scroller.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    observer.observe(table);
    return () => observer.disconnect();
  });
  return [box, overflowing];
};

/**
 * Owner Q1 ب: no flag on a standing seat for a member who can no longer drive (no amber frame, no
 * «الملف موقوف» / «ليس على وظيفة سائق» / «رخصة منتهية») — the daily seat's two flag shapes get nothing.
 */
const NO_EXPIRED: ReadonlySet<string> = new Set();
const NO_OUT: ReadonlyMap<string, string> = new Map();

/** The daily seat is the standing seat once the workshop's lock is taken off the row it reads. */
const seatRow = (row: FleetFixedCrewRowDto): FleetRosterRowDto => ({
  ...row,
  inMaintenance: false,
  planned: true,
});

export const FixedDeskBoard = ({
  m,
  query,
  resetFilters,
  rows,
  sort,
  onSortChange,
}: {
  m: FixedModel;
  query: FixedQuery;
  resetFilters: () => void;
  rows: FleetFixedCrewRowDto[];
  sort: TableSort[];
  onSortChange: (key: string) => void;
}): JSX.Element => {
  const t = useT();
  const { mayPlan, missions, view, patch } = query;
  const [tableBox, overflowing] = useOverflowing();

  const [editing, setEditing] = useState<string | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [driverTerm, setDriverTerm] = useState('');
  const editingRow = m.draft.find((row) => row.vehicleId === editing) ?? null;

  const drop = (vehicleId: string, slot: CrewSlot, employeeId: string): void => {
    setOver(null);
    setDragging(null);
    m.actions.assign({ vehicleId, slot }, employeeId);
  };
  const save = (): void => {
    if (m.saving || !m.dirty) return;
    void m.actions.save();
  };
  const discard = (): void => {
    if (m.changed.length > 1) setAskDiscard(true);
    else m.actions.discard();
  };
  /** An edited car's code in the bar → its row, centred; only the filter that hides it is lifted. */
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

  const facts: SeatFacts = {
    expired: NO_EXPIRED,
    unavailable: NO_OUT,
    transferFrom: m.transferFrom,
    person: m.person,
    reasonLabel: (reason) => reason,
  };
  const seat = (row: FleetFixedCrewRowDto, slot: CrewSlot): JSX.Element => (
    <SeatCell
      row={seatRow(row)}
      slot={slot}
      mayPlan={mayPlan}
      over={over}
      setOver={setOver}
      dragging={dragging}
      setDragging={setDragging}
      facts={facts}
      pool={m.pool}
      searchIndex={m.searchIndex}
      onDrop={(target, which, employeeId) => drop(target.vehicleId, which, employeeId)}
      onClear={(target, which) => m.actions.clear(target.vehicleId, which)}
    />
  );

  const columns: Column<FleetFixedCrewRowDto>[] = [
    {
      key: 'vehicle',
      header: t('fleet.odometer.columns.vehicle'),
      sortable: true,
      sortKey: 'code',
      align: 'center',
      className: TIGHT_CELL,
      headerClassName: TIGHT_CELL,
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
          row.missionTypeId === null || m.missionName(row.missionTypeId) === '—' ? (
            DASH
          ) : (
            m.missionName(row.missionTypeId)
          )
        ) : (
          <div
            className={MISSION_BOX}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {/* ENABLED on a workshop car: a standing crew keeps its mission in the workshop. */}
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
      header: t('fleet.attendance.fields.notes'),
      align: 'center',
      render: (row) =>
        row.notes === null ? (
          DASH
        ) : (
          // The daily's note box (5rem floor, 3.125rem on a laptop, 8rem at most), held to THREE
          // lines with the whole note in its title — today's rule (one line + title), since a note
          // may hold 500 letters and must never set a row's height.
          <span
            data-notes={row.code}
            title={row.notes}
            className="mx-auto line-clamp-3 min-w-[5rem] max-w-[8rem] whitespace-normal break-words text-xs leading-snug [text-wrap:balance] max-[1535px]:min-w-[3.125rem]"
          >
            {row.notes}
          </span>
        ),
    },
    ...(mayPlan
      ? [
          {
            key: 'actions',
            header: t('fleet.vehicles.columns.actions'),
            align: 'center',
            className: cn(PINNED_CELL, overflowing && PINNED_EDGE),
            headerClassName: cn(PINNED_HEAD, overflowing && PINNED_EDGE),
            render: (row: FleetFixedCrewRowDto) => (
              <span className={cn(ACTION_GROUP, LAPTOP_ACTIONS)} data-row-actions="fixed">
                {/* «تعديل» on EVERY row, workshop cars too — the fixed dialog. */}
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
                {/* NEW (the daily's): the two seats traded — the fixed rule's swap within a car. */}
                {row.driver1EmployeeId !== null && row.driver2EmployeeId !== null && (
                  <button
                    type="button"
                    data-swap-drivers={row.code}
                    className={actionTone('transfer')}
                    aria-label={t('fleet.roster.swapDrivers')}
                    title={t('fleet.roster.swapDrivers')}
                    onClick={() => m.actions.swap(row.vehicleId)}
                  >
                    <SwapIcon className="h-4 w-4" />
                  </button>
                )}
                {/* «إفراغ الطقم»: both seats in one edit, the mission and the note stay, no confirm. */}
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
  const options = m.optionsFor(driverTerm, null);

  return (
    <PageContainer fullHeight>
      {/* Q2 ج: the old header, exactly as FixedRosterPage.tsx renders it — minus its Excel action,
          which stays the toolbar's pill below (one Excel control). */}
      <PageHeader
        title={t('fleet.nav.fixedRoster')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.fixedRoster') },
        ]}
      />
      <div className={BOARD_FRAME} data-fixed-desk="true">
        <div className="flex items-center justify-between gap-2" data-roster-toolbar="true">
          <span
            role="status"
            data-filtered-count
            title={t('fleet.filters.matchedRows')}
            className="text-sm font-bold text-slate-600 dark:text-slate-300"
          >
            {m.board !== undefined && t('fleet.vehicles.count', { count: num(rows.length) })}
          </span>
          <ExcelPill onExport={() => m.actions.exportSheet(rows)} />
        </div>

        <div
          className={cn(DARK_FILTER_BAR, '[&_[role=listbox]]:animate-menu-in')}
          data-roster-filters="true"
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

        {/* The daily's panel widths, and below 1440 half a rem less (17.75rem): a standing board
            carries a note on most cars, and at 1280 those 8px keep the whole table inside its frame —
            no note slides under the pinned «إجراءات» (the daily, with almost no notes, lets the
            table scroll there). This panel has ONE heading, not the daily's two tabs whose titles
            set its 18.25rem. */}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_20rem] gap-3 max-[1535px]:grid-cols-[minmax(0,1fr)_18.25rem] max-[1439px]:grid-cols-[minmax(0,1fr)_17.75rem] max-[1439px]:gap-2 min-[1750px]:grid-cols-[minmax(0,1fr)_24rem] min-[1750px]:gap-4">
          <div
            ref={tableBox}
            className={ROSTER_TABLE}
            data-roster-table="true"
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
              empty={
                <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                  {t('fleet.fixedRoster.noVehicles')}
                </p>
              }
              minColumnWidth={4}
              stickyHead
            />
          </div>
          <aside
            data-drivers-panel="true"
            className={cn(
              'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]',
              DESK_CONTROLS,
              LAPTOP_POOL,
            )}
          >
            <div className="shrink-0 space-y-2.5 border-b border-slate-200 p-3 max-[1535px]:p-2 dark:border-slate-800">
              <DriversHead count={m.pool.length} />
              <DriverSearch value={driverTerm} onChange={setDriverTerm} />
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
              data-drivers-list="pool"
            >
              {m.board !== undefined && (
                <FixedDriverList
                  options={options}
                  person={m.person}
                  hasDrivers={m.pool.length > 0}
                  searched={driverTerm.trim() !== ''}
                  onPick={null}
                  draggable={mayPlan}
                  onDragDriver={setDragging}
                  hoverCard
                />
              )}
            </div>
          </aside>
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
        <EditCrewDialog
          row={editingRow}
          pool={m.pool}
          missionTypes={m.missionTypes}
          flags={m.driverFlags}
          onClose={() => setEditing(null)}
          onSave={(values) => {
            m.actions.apply(editingRow.vehicleId, values);
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
    </PageContainer>
  );
};
