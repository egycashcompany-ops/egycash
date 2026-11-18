// «الطقم الثابت» on a phone and a tablet — «واعمل ديزاين شاشة الطاقم الثابت زى التعيين اليومى»: the
// daily «تعيين السيارات» touch board (`RosterTouchBoard`) with its own pieces, minus the day. Drawn
// over the ONE board model the page shell holds (`useFixedRosterBoard`), so a rotate keeps the
// draft and its undo steps.
//
//   phone       (< 768px)      the page header and the first row (the car search, the Excel
//                              button) scroll away; only the filter row (filter · reset · counters
//                              · drivers) stays on top. One card per car, a seat tap opens the
//                              driver picker sheet, the unsaved bar at the screen's foot
//   portrait    (768–1023px)   the same, wider: two seats side by side per card; the first row and
//                              the filter row (with the drivers button) stay on top
//   landscape   (1024–1279px)  the split view: cars 60% · drivers 40%, always visible. Seat first
//                              (a seat tap makes it the TARGET, a driver tap places him) or driver
//                              first (a driver tap chooses him, a seat tap places him). A mouse
//                              still drags a driver onto a seat
//   short       (< 500px tall) a phone held sideways: nothing on top is sticky, so the cars keep
//                              the screen; only the unsaved bar stays at the bottom
//
// MINUS THE DAY: a standing crew is a fact about a car, true until somebody changes it — so no
// stepper, no «يوم سابق», no tabs of who is free today, no absent list, no availability word. The
// page header («الطقم الثابت» under «الحركة») is the shell's, on top at every width (owner's
// answer 2 ج): this board draws no title, and its Excel button is the screen's one Excel control.
// It is written for the shell's `PageContainer`: no outer padding of its own; what runs edge to
// edge (the sticky header, the unsaved bar) bleeds by the container's padding.
//
// THE FIXED RULES, unchanged: a car the workshop holds keeps an editable standing crew, so its card
// stays in code order, in its place, unlocked (its mission, its seats, its note); «إفراغ الطقم»
// (⋮) empties both seats at once and keeps the mission and the note, with no question («تراجع» and
// «إلغاء» are there). Owner's answer 1 (ب): no seat, card or list flags a standing member who can
// no longer drive — the server's refusal at «حفظ» says why one cannot stay.
//
// The filters are the shell's URL keys (`q`, `mission`, `view`). The typed car code is THIS
// board's state — not in the URL, not remembered (a half-typed «1» must not come back) — ANDed
// with them; the counters keep counting the whole board. The cards are always in CODE ORDER.
import { useEffect, useMemo, useState } from 'react';
import { type FleetRosterRowDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { cn } from '../../../../shared/lib/cn';
import { errorMessage } from '../../../../shared/lib/errors';
import { toggleValue, writeList } from '../../../../shared/lib/list-param';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { matchesVehicleCode } from '../../lib/vehicle-code-match';
import { SLOT_WORD } from '../../lib/roster-board';
import { type TouchLayout } from '../../lib/roster-layout';
import {
  fixedFiltersHiding,
  fixedTouchCars,
  toCardRow,
  type FixedSeatTarget,
  type FixedTouchBoardProps,
} from '../../lib/fixed-roster-model';
import { BottomSheet } from './RosterBottomSheet';
import { CarCard, type CardHandlers } from './RosterCarCard';
import { AvailableList, DriverSearch, DriversHeading } from './roster-drivers';
import { CodeList, EditsBar } from './roster-parts';
import {
  CarSearch,
  ConfirmSheet,
  CounterChips,
  DriversButton,
  ExcelButton,
  FilterButton,
  FiltersSheet,
  MissionSheet,
  NotesSheet,
  ResetChip,
  type TouchCounter,
} from './roster-touch-parts';
import {
  FixedRowBadges,
  NOTE_MAX,
  PendingBanner,
  SlotHint,
  TargetBanner,
  carSelector,
  editTitle,
  fixedCardMenu,
  fixedTouchFacts,
  missionNotice,
} from './fixed-touch-parts';

/** The shell's `PageContainer` padding, taken back by what runs edge to edge. */
const BLEED = '-mx-4 px-4 sm:-mx-6 sm:px-6';

export const FixedTouchBoard = ({
  m,
  query,
  resetFilters,
  layout,
  short,
}: FixedTouchBoardProps): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { mayPlan, missions, view, patch } = query;

  // ── the car search — this board's own state (see the head of this file) ─────────────────────
  const [carTerm, setCarTerm] = useState('');
  // What the term finds over what the URL narrows, in code order — the workshop's cars in their
  // place — and whether the term alone finds a car of the board at all.
  const { searching, drawn, termFinds } = useMemo(
    () => fixedTouchCars(m.visible, m.draft, carTerm),
    [m.visible, m.draft, carTerm],
  );
  // A typed code is a filter too: the red reset stays lit in the sticky row while it narrows.
  const filtered = m.filtered || searching;

  // ── the counters: the model's, counting the whole board. On touch a pressed state chip is let
  // go by a second tap (the computer's chip only sets), as on the daily board.
  const counters: TouchCounter[] = m.counters.map((counter) => ({
    key: counter.key,
    label: counter.label,
    value: counter.value,
    tone: counter.tone,
    active: counter.active,
    apply: () =>
      patch(
        counter.active && typeof counter.apply.view === 'string' ? { view: null } : counter.apply,
      ),
  }));

  // ── what is open ──────────────────────────────────────────────────────────────────────────────
  const [picker, setPicker] = useState<FixedSeatTarget | null>(null);
  const [term, setTerm] = useState('');
  const [missionFor, setMissionFor] = useState<FleetRosterRowDto | null>(null);
  const [notesFor, setNotesFor] = useState<FleetRosterRowDto | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [poolOpen, setPoolOpen] = useState(false);
  const [target, setTarget] = useState<FixedSeatTarget | null>(null);
  /** Driver first: chosen in a list, waiting for the seat tap that places him. */
  const [pendingDriver, setPendingDriver] = useState<string | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);

  const rowOf = (vehicleId: string) => m.draft.find((row) => row.vehicleId === vehicleId);

  // The counter a link or a tap made active is brought into sight in its sideways row — a link to
  // «بلا طقم» must not arrive on a board narrowed for no visible reason. (The mission chips arrive
  // with the catalog, so their number is part of the question.)
  const missionsKey = missions.join(',');
  const counterCount = m.counters.length;
  useEffect(() => {
    document
      .querySelector('[data-counter][data-active]')
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [view, missionsKey, layout, counterCount]);

  // Landscape: bring the targeted car into view (the panel names it, the ring marks it).
  useEffect(() => {
    if (target === null || layout !== 'landscape') return;
    document.querySelector(carSelector(m.codeOf(target.vehicleId)))?.scrollIntoView({
      block: 'nearest',
    });
  }, [target, layout]);

  const stickyMode = short ? 'none' : layout === 'phone' ? 'filters' : 'header';

  const openFill = (next: FixedSeatTarget): void => {
    // Driver first: the seat tap places the chosen driver — nothing else opens.
    if (pendingDriver !== null) {
      m.actions.assign(next, pendingDriver);
      setPendingDriver(null);
      return;
    }
    if (layout === 'landscape') {
      setTarget((current) =>
        current !== null && current.vehicleId === next.vehicleId && current.slot === next.slot
          ? null
          : next,
      );
      return;
    }
    setTerm('');
    setPicker(next);
  };

  /** A seat that is the target of a car whose crew just changed is no target any more. */
  const dropTargetOn = (vehicleId: string): void => {
    if (target !== null && target.vehicleId === vehicleId) setTarget(null);
  };
  const handlers: CardHandlers = {
    onSlot: openFill,
    onClear: (vehicleId, slot) => {
      m.actions.clear(vehicleId, slot);
      dropTargetOn(vehicleId);
    },
    onSwap: (vehicleId) => m.actions.swap(vehicleId),
    onMission: (row) => setMissionFor(row),
    // «إفراغ الطقم» — at once: both seats, the mission and the note kept, no question.
    onClearAll: (row) => {
      m.actions.clearCrew(row.vehicleId);
      dropTargetOn(row.vehicleId);
    },
    onEditNotes: (row) => setNotesFor(row),
    onDropDriver: (dropTarget, employeeId) => {
      m.actions.assign(dropTarget, employeeId);
      setTarget(null);
    },
  };

  /** «كل ما أظهره الفلتر» — the cards on show, the typed code included, in the order drawn. */
  const exportSheet = (): void => {
    try {
      m.actions.exportSheet(drawn);
    } catch (error) {
      toast.error(errorMessage(error, locale));
    }
  };

  // «حفظ» — the model toasts the outcome (a refusal in Arabic, naming the driver and the car); a
  // refusal keeps the draft (and the target, the chosen driver) exactly as they were.
  const save = (): void => {
    if (m.saving || !m.dirty) return;
    void m.actions.save().then((stored) => {
      if (!stored) return;
      setTarget(null);
      setPendingDriver(null);
    });
  };
  // «إلغاء» drops EVERY edit: more than one car's work is asked about first.
  const discard = (): void => {
    if (m.changed.length > 1) setAskDiscard(true);
    else m.actions.discard();
  };
  /**
   * An edited car's code in the bar → its card. What hides it is lifted first, and only that: the
   * typed term, and each URL filter the car fails (`fixedFiltersHiding` — a car filled under
   * «بلا طقم» leaves that view at once).
   */
  const showCar = (code: string): void => {
    const row = m.draft.find((candidate) => candidate.code === code);
    if (!matchesVehicleCode(code, carTerm)) setCarTerm('');
    if (row !== undefined && !m.visible.includes(row)) {
      patch(fixedFiltersHiding(row, { search: query.search, missions, view }));
    }
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() =>
        document.querySelector(carSelector(code))?.scrollIntoView({ block: 'center' }),
      ),
    );
  };

  // ── the driver list (one source for the three homes) ─────────────────────────────────────────
  const fillTarget = layout === 'landscape' ? target : picker;
  const options = m.availableFor(term, fillTarget);
  const occupantOf = (seat: FixedSeatTarget | null): string | null =>
    seat === null ? null : (rowOf(seat.vehicleId)?.[seat.slot] ?? null);
  const lists = (
    onPick: ((employeeId: string) => void) | null,
    extra: {
      onIdlePick?: (employeeId: string) => void;
      draggable?: boolean;
      occupant?: { employeeId: string; onClear: () => void } | null;
    } = {},
  ): JSX.Element | null => {
    // The board has not come yet: the cards area says so; the list says nothing rather than «none».
    if (m.board === undefined) return null;
    return (
      <AvailableList
        options={options}
        person={m.person}
        onPick={onPick}
        onIdlePick={extra.onIdlePick}
        pendingId={pendingDriver}
        occupant={extra.occupant ?? null}
        licence={null}
        dayHasDrivers={m.board.drivers.length > 0}
        searched={term.trim() !== ''}
        draggable={extra.draggable ?? false}
        freeBadge={false}
        emptyLabel={t('fleet.fixedRoster.poolEmpty')}
      />
    );
  };

  const facts = fixedTouchFacts(m, mayPlan && pendingDriver !== null);
  const menu = fixedCardMenu(t);
  const cards = (cardLayout: TouchLayout): JSX.Element[] =>
    drawn.map((row) => (
      <CarCard
        key={row.vehicleId}
        row={toCardRow(row)}
        layout={cardLayout}
        mayPlan={mayPlan}
        unsaved={m.unsavedIds.has(row.vehicleId)}
        facts={facts}
        missionName={m.missionName}
        target={fillTarget}
        handlers={handlers}
        workshopLock={false}
        badges={<FixedRowBadges row={row} />}
        menu={menu}
      />
    ));

  const editedCodes = m.changed.map((row) => m.codeOf(row.vehicleId));
  // The funnel counts EVERY narrowing the URL holds — the counter view included.
  const filterCount = m.codes.length + missions.length + (view !== null ? 1 : 0);
  const chipRow = (
    <div
      // `px-1`: the active chip's ring sits 3px outside it — room for it at both ends of the row.
      className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto scroll-px-1 px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      data-counters="true"
    >
      <CounterChips counters={counters} />
    </div>
  );
  const openPool = (): void => {
    setTerm('');
    setPoolOpen(true);
  };
  const editsBar = (shape: 'phone' | 'strip' | 'floating'): JSX.Element => (
    <EditsBar
      codes={editedCodes}
      edited={m.dirty}
      undoable={m.undoDepth > 0}
      saving={m.saving}
      onUndo={m.actions.undo}
      onDiscard={discard}
      onSave={save}
      onCode={showCar}
      shape={shape}
    />
  );
  // Nothing to show: a board with no car says so; the term alone finding no car says that;
  // otherwise the filters' usual line.
  const emptyLine =
    drawn.length === 0 ? (
      <p
        role="status"
        data-empty={m.draft.length === 0 ? 'board' : termFinds ? 'filters' : 'code'}
        className="py-12 text-center text-sm text-slate-500"
      >
        {m.draft.length === 0
          ? t('fleet.fixedRoster.noVehicles')
          : termFinds
            ? t('common.noResults')
            : t('fleet.odometer.vehicleNotFound')}
      </p>
    ) : null;
  /** The cars, or why there are none yet: the board still loading, or its request refused. */
  const carsArea = (cardLayout: TouchLayout, listClass: string): JSX.Element =>
    m.status.error !== undefined ? (
      <ErrorState error={m.status.error} onRetry={m.status.retry} />
    ) : m.status.loading ? (
      <LoadingState />
    ) : (
      <>
        <div className={listClass}>{cards(cardLayout)}</div>
        {emptyLine}
      </>
    );
  /**
   * The search box's own changes. A new term is a new question, answered from its first car — a
   * cars column (landscape) or a page (portrait) left scrolled down would hide the first matches.
   * The phone needs no scroll: its box is reachable only at the top.
   */
  const changeCarTerm = (value: string): void => {
    setCarTerm(value);
    if (layout === 'landscape') document.querySelector('[data-cars-column]')?.scrollTo({ top: 0 });
    else if (layout === 'portrait') document.querySelector('main')?.scrollTo({ top: 0 });
  };
  const carSearch = (className?: string): JSX.Element => (
    <CarSearch value={carTerm} onChange={changeCarTerm} className={className} />
  );
  const excel = <ExcelButton name="fixed-roster" onExport={exportSheet} />;
  /** The red reset: every filter, and the typed code with them. */
  const resetAll = (): void => {
    setCarTerm('');
    resetFilters();
  };
  const pendingBanner =
    mayPlan && pendingDriver !== null ? (
      <PendingBanner
        code={m.person(pendingDriver)?.code}
        name={m.driverName(pendingDriver)}
        onCancel={() => setPendingDriver(null)}
      />
    ) : null;

  // ── the sheets every layout shares ───────────────────────────────────────────────────────────
  const pickerOccupant = occupantOf(picker);
  const missionCode = missionFor?.code ?? '';
  const notesCode = notesFor?.code ?? '';
  const sheets = (
    <>
      <BottomSheet
        name="picker"
        tall
        open={picker !== null}
        onClose={() => setPicker(null)}
        title={t('fleet.roster.assignTitle', {
          code: picker === null ? '' : m.codeOf(picker.vehicleId),
        })}
        subtitle={
          picker === null
            ? undefined
            : pickerOccupant === null
              ? t(SLOT_WORD[picker.slot])
              : `${t(SLOT_WORD[picker.slot])} · ${m.driverName(pickerOccupant)}`
        }
        toolbar={<DriverSearch value={term} onChange={setTerm} />}
      >
        {picker !== null &&
          lists(
            (employeeId) => {
              m.actions.assign(picker, employeeId);
              setPicker(null);
            },
            {
              occupant:
                pickerOccupant === null
                  ? null
                  : {
                      employeeId: pickerOccupant,
                      onClear: () => {
                        m.actions.clear(picker.vehicleId, picker.slot);
                        setPicker(null);
                      },
                    },
            },
          )}
      </BottomSheet>
      <BottomSheet
        name="pool"
        tall
        open={poolOpen}
        onClose={() => setPoolOpen(false)}
        title={t('fleet.fixedRoster.driversTitle')}
        toolbar={
          <div className="space-y-2.5">
            {mayPlan && (
              <p
                data-pool-hint="true"
                className="text-[13px] leading-5 text-slate-500 dark:text-slate-400"
              >
                {t('fleet.roster.poolHint')}
              </p>
            )}
            <DriverSearch value={term} onChange={setTerm} />
          </div>
        }
      >
        {lists(
          null,
          mayPlan
            ? {
                // Driver first: the sheet closes, the banner names him, the next seat tap places him.
                onIdlePick: (employeeId) => {
                  setPendingDriver(employeeId);
                  setPoolOpen(false);
                },
              }
            : {},
        )}
      </BottomSheet>
      <MissionSheet
        row={missionFor}
        missions={m.missionOptions}
        title={editTitle(t, missionCode)}
        notice={missionNotice(t, m.missionCatalog)}
        onClose={() => setMissionFor(null)}
        onPick={(id) => {
          if (missionFor !== null) m.actions.mission(missionFor.vehicleId, id);
          setMissionFor(null);
        }}
      />
      <NotesSheet
        row={notesFor}
        title={editTitle(t, notesCode)}
        subtitle={t('fleet.attendance.fields.notes')}
        maxLength={NOTE_MAX}
        onClose={() => setNotesFor(null)}
        onSave={(notes) => {
          if (notesFor !== null) m.actions.notes(notesFor.vehicleId, notes);
          setNotesFor(null);
        }}
      />
      <FiltersSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        codes={m.codeOptions.map((option) => option.value)}
        pickedCodes={m.codes}
        onToggleCode={(code) => patch({ q: writeList(toggleValue(m.codes, code)) })}
        missions={m.missionOptions}
        pickedMissions={missions}
        onToggleMission={(id) => patch({ mission: writeList(toggleValue(missions, id)) })}
        onAllMissions={() => patch({ mission: null })}
        onReset={resetAll}
        results={drawn.length}
        filtered={filtered}
      />
      <ConfirmSheet
        name="discard"
        open={askDiscard}
        onClose={() => setAskDiscard(false)}
        title={t('fleet.roster.discardAll')}
        confirmLabel={t('fleet.roster.discardAll')}
        backLabel={t('common.close')}
        onConfirm={() => {
          m.actions.discard();
          setAskDiscard(false);
        }}
      >
        {t('fleet.roster.discardBody')}{' '}
        <CodeList codes={editedCodes} className="font-semibold text-slate-900 dark:text-slate-50" />
      </ConfirmSheet>
    </>
  );

  // ── TABLET LANDSCAPE: the split view ─────────────────────────────────────────────────────────
  if (layout === 'landscape') {
    const targetRow = target === null ? null : (rowOf(target.vehicleId) ?? null);
    const targetOccupant = occupantOf(target);
    return (
      // `-mb-4`: the container's 32px foot less the daily board's own 16px under its bar.
      <div data-fixed-touch="landscape" className="-mb-4 flex min-h-0 flex-1 flex-col">
        <div data-first-row="true" className="flex shrink-0 items-center gap-3">
          {/* The search sits over the cars column; the Excel button at the row's end. */}
          {carSearch('w-[20rem] min-w-0 shrink')}
          <span className="min-w-0 flex-1" />
          {excel}
        </div>
        <div className="mt-3 flex shrink-0 items-center gap-2">
          <FilterButton count={filterCount} onOpen={() => setFiltersOpen(true)} />
          {filtered && <ResetChip onReset={resetAll} />}
          {chipRow}
        </div>
        <div className="mt-3 grid min-h-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4">
          <div
            data-cars-column="true"
            className="min-h-0 overflow-y-auto overscroll-contain pb-3 pe-1"
          >
            {carsArea('landscape', 'space-y-3')}
          </div>
          <aside
            data-drivers-panel="true"
            className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="shrink-0 space-y-2.5 border-b border-slate-200 p-3 dark:border-slate-800">
              {mayPlan &&
                (target !== null && targetRow !== null ? (
                  <TargetBanner
                    code={targetRow.code}
                    slot={t(SLOT_WORD[target.slot])}
                    occupant={targetOccupant === null ? null : m.driverName(targetOccupant)}
                    onCancel={() => setTarget(null)}
                  />
                ) : pendingBanner !== null ? (
                  pendingBanner
                ) : (
                  <SlotHint />
                ))}
              <DriversHeading label={t('fleet.fixedRoster.driversTitle')} count={m.pool.length} />
              <DriverSearch value={term} onChange={setTerm} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {lists(
                mayPlan && target !== null
                  ? (employeeId) => {
                      m.actions.assign(target, employeeId);
                      setTarget(null);
                    }
                  : null,
                {
                  draggable: mayPlan,
                  ...(mayPlan && target === null
                    ? {
                        onIdlePick: (employeeId: string) =>
                          setPendingDriver((current) =>
                            current === employeeId ? null : employeeId,
                          ),
                      }
                    : {}),
                },
              )}
            </div>
          </aside>
        </div>
        {mayPlan && m.dirty && <div className="mt-3 shrink-0">{editsBar('floating')}</div>}
        {sheets}
      </div>
    );
  }

  // ── PHONE and TABLET PORTRAIT: one column of cards ───────────────────────────────────────────
  const phone = layout === 'phone';
  // The first row: the search and, at its end, the Excel button — one per width.
  const firstRow = (
    <div data-first-row="true" className={cn('flex items-center', phone ? 'gap-2' : 'gap-3')}>
      {carSearch('min-w-0 flex-1')}
      {excel}
    </div>
  );
  const filterRow = (
    <div className="flex items-center gap-2">
      <FilterButton count={filterCount} onOpen={() => setFiltersOpen(true)} compact={phone} />
      {filtered && <ResetChip onReset={resetAll} compact={phone} />}
      {chipRow}
      <DriversButton
        count={m.pool.length}
        label={t('fleet.fixedRoster.driversTitle')}
        onOpen={openPool}
        compact={phone}
      />
    </div>
  );
  return (
    // `flex-1`: the board is at least the screen's height, so the bottom bar sits at the screen's
    // bottom even when a search leaves two cars. `-mb-6` takes back the container's bottom padding
    // for the same reason: the bar is the screen's foot, not 24px above it.
    <div data-fixed-touch={layout} className="-mb-6 flex flex-1 flex-col">
      {/* Phone (upright or sideways): the first row scrolls away with the page header. */}
      {phone && firstRow}
      <div
        data-touch-header="true"
        data-sticky={stickyMode}
        className={cn(
          'z-20 border-b border-slate-200/80 bg-slate-50 pb-2 dark:border-slate-800 dark:bg-slate-950',
          stickyMode !== 'none' && 'sticky top-0',
          phone ? 'pt-2' : 'pt-3',
          BLEED,
        )}
      >
        {/* Portrait: the first row always lives in the header — sticky or not (a tablet whose
            keyboard shrinks the screen below 500px) — so the box is never moved to another parent
            while it is being typed in: that would unmount it, drop its focus and close the
            keyboard mid-word. */}
        {!phone && <div className="mb-2">{firstRow}</div>}
        {filterRow}
        {pendingBanner !== null && <div className="mt-2">{pendingBanner}</div>}
      </div>

      {carsArea(layout, 'space-y-3 pt-3')}

      {/* The bottom: in the flow and sticky, so the last card is never under it; pushed to the
          board's foot (`mt-auto`) when the cars are fewer than the screen, 20px after them always. */}
      <div className="h-5 shrink-0" />
      <div
        data-touch-bottom="true"
        className="pointer-events-none sticky bottom-0 z-20 -mx-4 mt-auto sm:-mx-6"
      >
        {mayPlan && m.dirty ? (
          editsBar(phone ? 'phone' : 'strip')
        ) : (
          <div className="h-[env(safe-area-inset-bottom)]" />
        )}
      </div>
      {sheets}
    </div>
  );
};
