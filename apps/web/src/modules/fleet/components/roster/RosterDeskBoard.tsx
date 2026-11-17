// «تعيين السيارات» on a COMPUTER (≥1280px) — «شاشه الكبيوتر اعملها زى باقى شاشات الحركة الجديده ك ui
// و شيل الفلتر بتاع كل المهمات اللى جمب كود السيارة بس وسيب الباقى», approved as shot («اعتمد»).
//
// THE NEW FLEET BOARDS' LOOK (AccidentsPage, MaintenancePage, MaintenanceAlarmsPage): no page title
// and no breadcrumbs — the board opens on its toolbar («14 سيارة» · Excel · the day); the dark
// filter bar with an icon on its filter and the red reset; the boards' dark table (DARK_TABLE,
// words in Cairo, figures in Azeret Mono, values centred, sticky head); the car code with its
// hover card; the row actions in the owner's box.
//
// THE ONE REMOVAL: the «كل المهمات» dropdown beside «كود السيارة». The `mission` URL key stays —
// the per-mission counter chip is now its only control here, and `?mission=` links still narrow.
//
// KEPT: every URL key and the remembered set (the shell); the seven counters (whole day, tap =
// filter); Excel (7 columns, the rows on screen, the file named after the DAY); the day stepper and
// the past day read-only; all seven columns and both sorts; the mission select (disabled for a
// workshop car); the seats' rules, «+ اختيار سائق», the slot bin; drag and drop (pool driver,
// unseated licence-flagged driver, seated driver → a seat: same car's other seat = swap, another
// car = move, same seat = nothing, workshop = refused); the pen dialog, the swap, the clear with
// its confirm; the licence block and its two links; the reason chips; every permission gate. The
// day is a DRAFT until «حفظ» (the board model).
//
// CHANGED (approved): ONE drivers panel with two tabs, so «إجراءات» is on the screen (at 1280 the
// table still scrolls inside its frame and the actions column stays pinned; from 1366 the table
// fits its frame with room to spare — THE LAPTOP below — though a wide name that keeps to one line
// can still widen it past the frame, under the same pinned column); status badges never break
// their words; a seat is name + employee code (amber when the driver has a problem); a workshop
// row says «في الورشة — غير قابلة للتعيين» once; save / cancel live in the unsaved bar at the
// bottom (edited codes, «تراجع», «إلغاء», «حفظ»); the date reads «الاثنين 2026/11/09 اليوم»;
// every figure is in Latin digits.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { type FleetRosterRowDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { PageContainer } from '../../../../platform/layout/PageContainer';
import { cn } from '../../../../shared/lib/cn';
import { toggleValue, writeList } from '../../../../shared/lib/list-param';
import { DataTable, type Column } from '../../../../shared/ui/DataTable';
import { FilterBar } from '../../../../shared/ui/FilterBar';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { SwapIcon } from '../../../../shared/ui/icons';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../board-scroll';
import { DARK_FILTER_BAR } from '../dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from '../FilterWithIcon';
import { NUM } from '../FuelCardBoard';
import { VehicleCodeFilter } from '../VehicleCodeFilter';
import { VehicleHoverCode } from '../VehicleHoverCard';
import { CatalogSelect } from '../CatalogSelect';
import { RosterAssignDialog } from '../RosterAssignDialog';
import { ACTION_GROUP, actionTone } from '../row-actions-look';
import { SquarePenIcon, Trash2Icon } from '../row-action-icons';
import { DARK_TABLE } from '../../pages/VehiclesListPage';
import { type DutySlot } from '../../lib/daily-roster-board';
import { carriesPlan } from '../../lib/roster-view';
import {
  filtersHiding,
  shiftDay,
  type AssignValues,
  type RosterDeskBoardProps,
} from '../../lib/roster-board';
import { DASH, SeatCell, StatusCell, type SeatFacts } from './roster-desk-cells';
import { DeskCounters, DeskDayStepper, DriversPanel, ExcelPill } from './roster-desk-parts';
import { CodeList, EditsBar, PastDayBanner, num } from './roster-parts';

/** A figure on the row — monospace, tabular, one line (Accidents' `FIGURE`). */
const FIGURE = cn('whitespace-nowrap', NUM);

/**
 * The row tints, on the row's own data attribute with a hover of their own (the boards'
 * `CLOSED_ROW` pattern) and OPAQUE — the pinned «إجراءات» cell inherits its row's colour, and a
 * see-through colour would show the seats scrolling under it at 1280px. The same colours as the
 * board's unsaved amber and workshop rose, laid over the board's own surface.
 * An unsaved edit outranks the workshop: the workshop is still said by its badge, while an unsaved
 * edit has nothing but this colour.
 */
const ROW_TINTS = cn(
  '[&_tbody_tr]:!bg-white dark:[&_tbody_tr]:!bg-[#111827]',
  '[&_tbody_tr[data-tint=unsaved]]:!bg-[#fffbeb] dark:[&_tbody_tr[data-tint=unsaved]]:!bg-[#261919] [&_tbody_tr[data-tint=unsaved]:hover]:!bg-[#fef3c7] dark:[&_tbody_tr[data-tint=unsaved]:hover]:!bg-[#301911]',
  '[&_tbody_tr[data-tint=workshop]]:!bg-[#fff1f2] dark:[&_tbody_tr[data-tint=workshop]]:!bg-[#291021] [&_tbody_tr[data-tint=workshop]:hover]:!bg-[#ffe4e6] dark:[&_tbody_tr[data-tint=workshop]:hover]:!bg-[#340d1f]',
);

/**
 * THE LAPTOP (1280–1535px) — «تمام اعتمد», on: «على اللابتوب بس (1366 و1440) أصغّر عرض قائمة
 * السواقين اللي على الشمال شوية، وأضيّق خانة «نوع المهمة» وعمود «ملاحظات» شوية. كده الجدول كله
 * يدخل في الشاشة من غير سحب … على 1536 وأكبر الشكل اللي اعتمدته مش هيتغير خالص».
 *
 * Every laptop rule is a `max-[…px]:` variant laid OVER the approved class, never written in its
 * place: from 1536px up the board renders exactly as approved. Two bands:
 * - 1280–1535px (`max-[1535px]:`): the three narrowings the owner named — the drivers panel 20rem →
 *   18.25rem (its header and tabs close up so both titles stay whole), the mission box 9.5rem →
 *   9rem, the notes' floor 5rem → 3.125rem (the width of its «ملاحظات» head). At 1440 these alone
 *   fit the table in its frame, even beside a browser's 17px scrollbar, so the cells keep the
 *   boards' laptop gutters there («على اللاب … المسافات قربت» — DARK_TABLE's 9px).
 * - 1280–1439px (`max-[1439px]:`): at 1366 the three were about 60px short, so only below 1440 the
 *   spacing closes up too — every cell's gutter 4px, an 8px gap beside the panel, the row's icons
 *   2px apart: the same pieces, colours and type, only tighter.
 * Measured with a 15px scrollbar on the table's frame: 1366 and 1440 both fit with about 16px to
 * spare (31px where the browser hides its scrollbars). A name that keeps to one line and is wider
 * than about 150px can still widen the table a few px past its frame, and at 1280 its floor is
 * wider than the frame: then the table scrolls under the pinned «إجراءات».
 */
const LAPTOP_GUTTERS = 'max-[1439px]:[&_td]:!px-1 max-[1439px]:[&_th]:!px-1';
/** The row's three icons closer together below 1440px (8px → 2px apart and from the box). */
const LAPTOP_ACTIONS = 'max-[1439px]:gap-0.5 max-[1439px]:px-0.5';

/** The seats and the mission select fill their cell: a 6px gutter (4px below 1440px), not 9px. */
const TIGHT_CELL = '[&&]:!px-1.5 max-[1439px]:[&&]:!px-1';

/**
 * «إجراءات» pinned to the table's end edge — never the casualty of a narrow screen. The cell takes
 * its row's (opaque) colour; the head takes the head row's.
 */
const PINNED_CELL = 'sticky end-0 z-[1] [background-color:inherit]';
const PINNED_HEAD = 'sticky end-0 z-[2] [background-color:inherit]';
/**
 * …and while the table is wider than its frame (1280px, or a long name at any width), the pinned
 * column's EDGE shows that the rest slides under it: a soft shade on the scrolled side and a 1px
 * rule. Drawn as the cell's own pseudo-elements, because a cell of a `border-collapse` table paints
 * no box-shadow. In RTL `end-full` is `left: 100%`: the shade lies on the side the seats scroll in
 * from.
 */
const PINNED_EDGE = cn(
  "before:pointer-events-none before:absolute before:inset-y-0 before:end-full before:w-3 before:content-['']",
  'rtl:before:bg-gradient-to-r ltr:before:bg-gradient-to-l before:from-slate-900/15 before:to-transparent dark:before:from-black/60',
  "after:pointer-events-none after:absolute after:inset-y-0 after:start-0 after:w-px after:content-['']",
  'after:bg-slate-300 dark:after:bg-slate-600',
);

/**
 * The boards' table (Accidents' recipe): DARK_TABLE and BOARD_TABLE_FILL, words in Cairo, every
 * heading on one line. Inside a seat the boards' 28px icon-button rule is undone — the slot
 * picker's trigger and its options are full-width rows, and the seat bin keeps its own small square
 * (seats and bins named by their own marks, so the table's class never spells the hooks the
 * seats are read by — `data-drop-zone`, `data-clear-slot`).
 */
const ROSTER_TABLE = cn(
  DARK_TABLE,
  BOARD_TABLE_FILL,
  'min-w-0',
  // Words in Cairo for every cell: DARK_TABLE's Azeret Mono comes first otherwise, and its wide
  // space opened gaps inside names («عمرو  حسن»). Figures keep Azeret Mono by their own NUM class.
  "[&_td]:![font-family:'Cairo',ui-sans-serif,sans-serif]",
  '[&_thead_th]:!whitespace-nowrap',
  '[&_td_[data-seat-state]_button]:!h-auto [&_td_[data-seat-state]_button]:!w-full',
  '[&_td_[data-seat-state]_button[data-seat-bin]]:!h-6 [&_td_[data-seat-state]_button[data-seat-bin]]:!w-5',
  ROW_TINTS,
  LAPTOP_GUTTERS,
);

/**
 * The mission select's words in Cairo, as every other select on the boards: the table's cells
 * read figures in Azeret Mono first, whose wide space pushed «نقل أموال (يومي)» past the 9.5rem
 * box sized for Cairo. On a laptop the box is 9rem: «نقل أموال (يومي)» still whole beside the
 * chevron, with about 5px to spare.
 */
const MISSION_BOX =
  "mx-auto w-[9.5rem] max-[1535px]:w-36 [&_select]:![font-family:'Cairo',ui-sans-serif,sans-serif]";

/** Is the table wider than its frame? (Measured, not guessed from the screen's width.) */
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

export const RosterDeskBoard = ({
  m,
  query,
  resetFilters,
  rows,
  sort,
  onSortChange,
}: RosterDeskBoardProps): JSX.Element => {
  const t = useT();
  const { date, today, mayPlan, missions, view, reasons, patch } = query;

  const [tableBox, overflowing] = useOverflowing();

  // ── what is open ──────────────────────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState<string | null>(null);
  const [clearing, setClearing] = useState<FleetRosterRowDto | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const editingRow = m.shown.find((row) => row.vehicleId === editing) ?? null;

  // ── the edits (each one a board function on the draft, through the model) ───────────────────
  const dropDriver = (row: FleetRosterRowDto, slot: DutySlot, employeeId: string): void => {
    setOver(null);
    setDragging(null);
    m.actions.assign({ vehicleId: row.vehicleId, slot }, employeeId);
  };
  /**
   * «تعديل التعيين» — the dialog's four facts as ONE edit (one «تراجع» step). A dialog saved with
   * nothing changed adds nothing to undo.
   */
  const applyDialog = (row: FleetRosterRowDto, values: AssignValues): void => {
    const same =
      values.driver1EmployeeId === row.driver1EmployeeId &&
      values.driver2EmployeeId === row.driver2EmployeeId &&
      values.missionTypeId === row.missionTypeId &&
      values.notes === row.notes;
    if (!same) m.actions.apply(row.vehicleId, values);
  };

  // «حفظ» — a refusal is toasted by the model with `errorMessage` and the draft STAYS.
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
   * is lifted — only that one: the codes, the missions, the counter view, each kept when the row
   * passes it (the drivers panel's reason chips hide no car, so they are never touched).
   */
  const showCar = (code: string): void => {
    const row = m.shown.find((candidate) => candidate.code === code);
    if (row !== undefined && !rows.some((candidate) => candidate.code === code)) {
      patch(filtersHiding(row, { search: query.search, missions, view }));
    }
    window.requestAnimationFrame(() =>
      document
        .querySelector(`tr[data-car="${CSS.escape(code)}"]`)
        ?.scrollIntoView({ block: 'center' }),
    );
  };

  // ── the table ─────────────────────────────────────────────────────────────────────────────────
  const facts: SeatFacts = {
    expired: m.expired,
    unavailable: m.unavailableReason,
    transferFrom: m.transferFrom,
    person: m.person,
    reasonLabel: m.reasonLabel,
  };
  const seat = (row: FleetRosterRowDto, slot: DutySlot): JSX.Element => (
    <SeatCell
      row={row}
      slot={slot}
      mayPlan={mayPlan}
      over={over}
      setOver={setOver}
      dragging={dragging}
      setDragging={setDragging}
      facts={facts}
      pool={m.pool}
      searchIndex={m.searchIndex}
      onDrop={dropDriver}
      onClear={(target, which) => m.actions.clear(target.vehicleId, which)}
    />
  );
  const columns: Column<FleetRosterRowDto>[] = [
    {
      key: 'vehicle',
      header: t('fleet.odometer.columns.vehicle'),
      // SORTED IN THE BROWSER, and honestly so: this board is the whole day's fleet, never a page.
      sortable: true,
      sortKey: 'code',
      align: 'center',
      className: TIGHT_CELL,
      headerClassName: TIGHT_CELL,
      // The code carries the car card by hover only: a board of drag-and-drop seats keeps its Tab
      // order for the seats and the row's buttons.
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
      // Ranked by what the badges SAY (the shell's `rosterSortValue`), not by their spelling.
      sortable: true,
      align: 'center',
      render: (row) => <StatusCell row={row} />,
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
            <CatalogSelect
              kind="missionType"
              value={row.missionTypeId ?? ''}
              ariaLabel={`${row.code} · ${t('fleet.roster.fields.mission')}`}
              allLabel={t('fleet.fixedRoster.noMissionType')}
              // A car the workshop holds takes no mission (FR-5 refuses it with a 409): disabled
              // rather than hidden, so a mission already on the row stays legible.
              disabled={row.inMaintenance}
              density="tight"
              className="w-full"
              onChange={(id) => {
                // The GUARD, not just the attribute: a change dispatched in code still reaches
                // the handler, and the draft must never hold a mission the reader cannot remove.
                if (row.inMaintenance) return;
                m.actions.mission(row.vehicleId, id === '' ? null : id);
              }}
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
      // Read here; written in the pen dialog.
      header: t('fleet.attendance.fields.notes'),
      align: 'center',
      render: (row) =>
        row.notes === null ? (
          DASH
        ) : (
          // 3.125rem on a laptop, the width of «ملاحظات» over it; a longer note takes more lines.
          <span className="mx-auto block min-w-[5rem] max-w-[8rem] whitespace-normal break-words text-xs leading-snug [text-wrap:balance] max-[1535px]:min-w-[3.125rem]">
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
            // «اعملى الالوان دى»: the pen, the swap of the two seats (indigo) and the bin, in the
            // owner's box (`row-actions-look`).
            render: (row: FleetRosterRowDto) => (
              <span className={cn(ACTION_GROUP, LAPTOP_ACTIONS)} data-row-actions="roster">
                {/* FR-5: a car the workshop holds cannot be ASSIGNED, but clearing stays legal. */}
                {!row.inMaintenance && (
                  <button
                    type="button"
                    data-edit-row={row.code}
                    className={actionTone('edit')}
                    aria-label={t('fleet.roster.editAssignment')}
                    title={t('fleet.roster.editAssignment')}
                    onClick={() => setEditing(row.vehicleId)}
                  >
                    <SquarePenIcon className="h-4 w-4" />
                  </button>
                )}
                {/* «يخلى السائق الاول السائق الثانى ويخلى السائق الثانى السائق الاول» — offered only
                    where there IS a pair to trade and a car that may be assigned. */}
                {!row.inMaintenance &&
                  row.driver1EmployeeId !== null &&
                  row.driver2EmployeeId !== null && (
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
                {/* CLEARS THE WHOLE ROW — both drivers, the mission and the note — after a confirm. */}
                {carriesPlan(row) && (
                  <button
                    type="button"
                    data-clear-row={row.code}
                    className={actionTone('delete')}
                    aria-label={t('fleet.roster.clearAssignment')}
                    title={t('fleet.roster.clearAssignment')}
                    onClick={() => setClearing(row)}
                  >
                    <Trash2Icon className="h-4 w-4" />
                  </button>
                )}
              </span>
            ),
          } satisfies Column<FleetRosterRowDto>,
        ]
      : []),
  ];

  const editedCodes = m.changed.map((row) => m.codeOf(row.vehicleId));

  return (
    <PageContainer fullHeight>
      <div className={BOARD_FRAME} data-roster-desk="true">
        {/* «زى باقى شاشات الحركة»: no page title — the board opens on its toolbar. */}
        <div className="flex items-center justify-between gap-2" data-roster-toolbar="true">
          <span
            role="status"
            data-filtered-count
            title={t('fleet.filters.matchedRows')}
            className="text-sm font-bold text-slate-600 dark:text-slate-300"
          >
            {m.board !== undefined && t('fleet.vehicles.count', { count: num(rows.length) })}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <ExcelPill onExport={() => m.actions.exportSheet(rows)} />
            <DeskDayStepper
              date={date}
              isToday={date === today}
              onStep={(delta) => patch({ date: shiftDay(date, delta) })}
              onPick={(ymd) => patch({ date: ymd })}
              onToday={() => patch({ date: today })}
            />
          </span>
        </div>

        {/* A past day states what it is, once and at the top: the absence of «حفظ» is then read
            as the day being over, not as a permission problem. */}
        {!query.editable && <PastDayBanner />}

        {/* The boards' dark bar: «كود السيارة» (typing inside), the counters, the red reset — ONE
            row («لا صغر شوية كود السيارة وخلى كله صف واحد»). «كود السيارة» is 12rem, not 15rem:
            its placeholder, its icon and one code or three («215, 216, 217») still whole, and the
            48px it gives up (with DeskCounters' tighter chips) lets the six counters and the
            twelve missions stand beside the reset at 1920px on the measured day's figures —
            longer figures take more room (see DeskCounters). Where they do not fit (a laptop, a
            pinned nav, a busy day), the row stays one line and DeskCounters stands a ‹ › at each
            end of it («أ اعمل الأسهم»). */}
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

        {/* The drivers panel beside the table: 20rem, 24rem from 1750px, and 18.25rem on a laptop,
            with an 8px gap below 1440px (THE LAPTOP above). */}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_20rem] gap-3 max-[1535px]:grid-cols-[minmax(0,1fr)_18.25rem] max-[1439px]:gap-2 min-[1750px]:grid-cols-[minmax(0,1fr)_24rem] min-[1750px]:gap-4">
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
                  'data-tint':
                    query.editable && m.unsavedIds.has(row.vehicleId)
                      ? 'unsaved'
                      : row.inMaintenance
                        ? 'workshop'
                        : undefined,
                }) as never
              }
              // `board === undefined` while the query holds another date's answer is still
              // loading THIS date — the table says so rather than an empty day.
              loading={m.status.loading}
              error={m.status.error}
              onRetry={m.status.retry}
              minColumnWidth={4}
              stickyHead
            />
          </div>
          <DriversPanel
            m={m}
            mayPlan={mayPlan}
            reasons={reasons}
            onToggleReason={(reason) =>
              patch({ unavailable: writeList(toggleValue(reasons, reason)) })
            }
          />
        </div>

        {mayPlan && m.dirty && (
          <div className="shrink-0">
            <EditsBar
              codes={editedCodes}
              edited={m.edited}
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

      {m.board !== undefined && (
        <RosterAssignDialog
          open={editingRow !== null}
          onClose={() => setEditing(null)}
          onSave={(values) => {
            if (editingRow !== null) applyDialog(editingRow, values);
          }}
          row={editingRow}
          board={m.board}
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
            <Button
              variant="danger"
              data-confirm="clear"
              onClick={() => {
                if (clearing !== null) m.actions.clearAll(clearing.vehicleId);
                setClearing(null);
              }}
            >
              {t('fleet.roster.clearAssignment')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('fleet.roster.clearBody')}</p>
      </Dialog>
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
