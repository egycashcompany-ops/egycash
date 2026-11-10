// «تعيين السيارات» on a phone and a tablet — «فى تعديل بسيط ف شاشة تعبين الطاقم فى الحركه عاوز شكلها
// يتغير فى التابلت والفون عشان كux / ui تكون احسن». The approved design («انا برشح دول»: the phone's
// cards, P1, and the landscape tablet's split view, TL2), drawn over the ONE board model the page
// shell holds (`useRosterBoard`) — so a rotate keeps the draft and its undo steps.
//
//   phone       (< 768px)      the title, the day and the car search scroll away; only the filter
//                              row (filter · reset · counters · drivers) stays on top. One card per
//                              car, the workshop's cars grouped last, a seat tap opens the driver
//                              picker sheet, the unsaved bar at the screen's foot
//   portrait    (768–1023px)   the same, wider: two seats side by side per card; the header (title,
//                              stepper, search, filter row with the drivers button) stays on top
//   landscape   (1024–1279px)  the split view: cars 60% · drivers 40%, always visible. Seat first
//                              (a seat tap makes it the TARGET, a driver tap places him) or driver
//                              first (a driver tap chooses him, a seat tap places him). A mouse
//                              still drags a driver onto a seat
//   short       (< 500px tall) a phone held sideways: nothing on top is sticky, so the cars keep
//                              the screen; only the unsaved bar stays at the bottom
//
// The filters are the page's URL keys (`q`, `mission`, `view`, `unavailable` — the shell's), so a
// dashboard link opens the same board on a phone, and the counter it asks for is scrolled into
// sight. The cards follow the day's own order (the code order the server hands it in), not the
// computer's sort.
//
// «ابحث بكود السيارة…» — «مينفعش ابحث فى الفون او التابلت ؟». A visible car-code search on every
// touch layout: the phone under the day stepper (it scrolls away with the title; the sticky filter
// row stays as approved), the landscape title row between the title and the stepper, the portrait
// header as a row of its own. What is typed is THIS board's state — not in the URL, not remembered
// (a half-typed «1» must not come back tomorrow) — and it is ANDed with the picked codes (`q`), the
// missions and the counter view; the counters keep counting the whole day. One matcher for all of
// it: `matchesVehicleCode` (Arabic-Indic digits folded, several codes at once).
import { useEffect, useMemo, useRef, useState } from 'react';
import { splitVehicleCodeList, type FleetRosterRowDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { cn } from '../../../../shared/lib/cn';
import { errorMessage } from '../../../../shared/lib/errors';
import { toggleValue, writeList } from '../../../../shared/lib/list-param';
import { CloseIcon } from '../../../../shared/ui/icons';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { matchesVehicleCode } from '../../lib/vehicle-code-match';
import {
  SLOT_WORD,
  shiftDay,
  type RosterTouchBoardProps,
  type SeatTarget,
} from '../../lib/roster-board';
import { type TouchLayout } from '../../lib/roster-layout';
import { BottomSheet } from './RosterBottomSheet';
import { CarCard, type CardHandlers, type SeatFacts } from './RosterCarCard';
import {
  AvailableList,
  DriverSearch,
  DriverTabs,
  UnavailableList,
  type DriverTab,
} from './roster-drivers';
import { CodeList, EditsBar, PastDayBanner, slashDate, weekdayOf } from './roster-parts';
import {
  CarSearch,
  ConfirmSheet,
  CounterChips,
  DayStepper,
  DriversButton,
  ExcelButton,
  FilterButton,
  FiltersSheet,
  MissionSheet,
  NotesSheet,
  ResetChip,
  WorkshopGroup,
  type TouchCounter,
} from './roster-touch-parts';

/** `[data-car="…"]` for a code — codes are free text («MG 1/2»), so the value is escaped. */
const carSelector = (code: string): string => `[data-car="${CSS.escape(code)}"]`;

export const RosterTouchBoard = ({
  m,
  query,
  resetFilters,
  layout,
  short,
}: RosterTouchBoardProps): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { date, today, editable, mayPlan, missions, view, reasons, patch } = query;

  // ── the car search — this board's own state (see the head of this file) ─────────────────────
  const [carTerm, setCarTerm] = useState('');
  // A box holding no code at all (empty, spaces, a lone dash) narrows nothing, exactly as
  // `matchesVehicleCode` reads it.
  const searching = splitVehicleCodeList(carTerm).length > 0;
  // A reason filter is a filter too, and so is a typed code: the red reset stays lit in the sticky
  // row while the term narrows.
  const filtered = m.filtered || searching;

  const visible = useMemo(
    () => m.visible.filter((row) => matchesVehicleCode(row.code, carTerm)),
    [m.visible, carTerm],
  );
  const onRoad = visible.filter((row) => !row.inMaintenance);
  const inWorkshop = visible.filter((row) => row.inMaintenance);
  /** Does the term ALONE find a car of the day? (No → «لا توجد سيارة بهذا الكود».) */
  const termFinds = !searching || m.shown.some((row) => matchesVehicleCode(row.code, carTerm));

  // ── the counters: the model's seven-plus, counting the whole day. On touch a pressed state chip
  // is let go by a second tap (the computer's chip only sets) — as the approved sample.
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
  const [picker, setPicker] = useState<SeatTarget | null>(null);
  const [tab, setTab] = useState<DriverTab>('available');
  const [term, setTerm] = useState('');
  const [missionFor, setMissionFor] = useState<FleetRosterRowDto | null>(null);
  const [notesFor, setNotesFor] = useState<FleetRosterRowDto | null>(null);
  const [clearing, setClearing] = useState<FleetRosterRowDto | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [poolOpen, setPoolOpen] = useState(false);
  const [target, setTarget] = useState<SeatTarget | null>(null);
  /** Driver first: chosen in a list, waiting for the seat tap that places him. */
  const [pendingDriver, setPendingDriver] = useState<string | null>(null);
  const [workshopOpen, setWorkshopOpen] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);

  const rowOf = (vehicleId: string): FleetRosterRowDto | undefined =>
    m.shown.find((row) => row.vehicleId === vehicleId);

  // A target on another day is no target — reset only when the day actually CHANGES.
  const lastDate = useRef(date);
  useEffect(() => {
    if (lastDate.current === date) return;
    lastDate.current = date;
    setTarget(null);
    setPicker(null);
    setPendingDriver(null);
  }, [date]);

  // A term that finds a workshop car shows the workshop group OPEN (it is folded by default) —
  // «37» must not answer with a closed header. Derived, not an effect, so a fast typist never races
  // it: while such a term stands the group is open unless the reader folded it for THIS term
  // (`foldedFor`); a new term opens it again, and a cleared term leaves the group as the reader had
  // it before the search (`workshopOpen` is his own fold, the search never writes it).
  const searchFindsWorkshop = searching && inWorkshop.length > 0;
  const [foldedFor, setFoldedFor] = useState<string | null>(null);
  const workshopShown =
    view === 'workshop' || (searchFindsWorkshop ? foldedFor !== carTerm : workshopOpen);
  const toggleWorkshop = (): void => {
    if (searchFindsWorkshop) setFoldedFor((folded) => (folded === carTerm ? null : carTerm));
    else setWorkshopOpen((open) => !open);
  };

  // The counter a link or a tap made active is brought into sight in its sideways row — a
  // dashboard link to «غياب الطاقم الثابت» must not arrive on a board narrowed for no visible reason.
  // (The mission chips arrive with the catalog, so their number is part of the question.)
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

  const openFill = (next: SeatTarget): void => {
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
    setTab('available');
    setPicker(next);
  };

  const handlers: CardHandlers = {
    onSlot: openFill,
    onClear: (vehicleId, slot) => {
      m.actions.clear(vehicleId, slot);
      if (target !== null && target.vehicleId === vehicleId) setTarget(null);
    },
    onSwap: (vehicleId) => m.actions.swap(vehicleId),
    onMission: (row) => setMissionFor(row),
    onClearAll: (row) => setClearing(row),
    onEditNotes: (row) => setNotesFor(row),
    onDropDriver: (dropTarget, employeeId) => {
      m.actions.assign(dropTarget, employeeId);
      setTarget(null);
    },
  };

  /** «كل ما أظهره الفلتر» — the cards on show, the typed code included, in their order. */
  const exportSheet = (): void => {
    try {
      m.actions.exportSheet(visible);
    } catch (error) {
      toast.error(errorMessage(error, locale));
    }
  };

  // «حفظ» — the model toasts the outcome; a refusal keeps the draft (and the target, the chosen
  // driver) exactly as they were.
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
  /** An edited car's code in the bar → its card (a term that hides it is cleared first). */
  const showCar = (code: string): void => {
    const row = m.shown.find((candidate) => candidate.code === code);
    if (!matchesVehicleCode(code, carTerm)) setCarTerm('');
    if (row?.inMaintenance === true) {
      setWorkshopOpen(true);
      setFoldedFor(null);
    }
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() =>
        document.querySelector(carSelector(code))?.scrollIntoView({ block: 'center' }),
      ),
    );
  };

  // ── the driver lists (one source for the three homes) ────────────────────────────────────────
  const fillTarget = layout === 'landscape' ? target : picker;
  const options = m.availableFor(term, fillTarget);
  const unavailableShown = m.unavailableFor(term, reasons);
  const toggleReason = (reason: string): void =>
    patch({ unavailable: writeList(toggleValue(reasons, reason)) });
  const occupantOf = (seat: SeatTarget | null): string | null =>
    seat === null ? null : (rowOf(seat.vehicleId)?.[seat.slot] ?? null);
  const lists = (
    onPick: ((employeeId: string) => void) | null,
    extra: {
      onIdlePick?: (employeeId: string) => void;
      draggable?: boolean;
      occupant?: { employeeId: string; onClear: () => void } | null;
    } = {},
  ): JSX.Element | null => {
    // The day has not come yet: the cards area says so; the lists say nothing rather than «none».
    if (m.board === undefined) return null;
    return tab === 'available' ? (
      <AvailableList
        options={options}
        person={m.person}
        onPick={onPick}
        onIdlePick={extra.onIdlePick}
        pendingId={pendingDriver}
        occupant={extra.occupant ?? null}
        licence={m.licence}
        dayHasDrivers={m.dayHasDrivers}
        searched={term.trim() !== ''}
        draggable={extra.draggable ?? false}
      />
    ) : (
      <UnavailableList
        drivers={unavailableShown}
        person={m.person}
        chips={m.chips}
        reasons={reasons}
        onToggleReason={toggleReason}
        searched={term.trim() !== ''}
        dayHasAny={m.unavailable.length > 0}
      />
    );
  };
  const tabs = (
    <DriverTabs
      tab={tab}
      onTab={setTab}
      availableCount={m.poolLicensed.length}
      unavailableCount={m.unavailable.length}
    />
  );

  const facts: SeatFacts = {
    expired: m.expired,
    unavailable: m.unavailableReason,
    transferFrom: m.transferFrom,
    armed: mayPlan && pendingDriver !== null,
    person: m.person,
    reasonLabel: m.reasonLabel,
  };
  const cards = (rows: readonly FleetRosterRowDto[], cardLayout: TouchLayout): JSX.Element[] =>
    rows.map((row) => (
      <CarCard
        key={row.vehicleId}
        row={row}
        layout={cardLayout}
        mayPlan={mayPlan}
        unsaved={editable && m.unsavedIds.has(row.vehicleId)}
        facts={facts}
        missionName={m.missionName}
        target={layout === 'landscape' ? target : picker}
        handlers={handlers}
      />
    ));

  const workshopGroup = (cardLayout: TouchLayout): JSX.Element | null => (
    <WorkshopGroup rows={inWorkshop} open={workshopShown} onToggle={toggleWorkshop}>
      {cards(inWorkshop, cardLayout)}
    </WorkshopGroup>
  );

  const editedCodes = m.changed.map((row) => m.codeOf(row.vehicleId));
  // The funnel counts EVERY narrowing the URL holds — the counter view included.
  const filterCount = m.codes.length + missions.length + (view !== null ? 1 : 0);
  const stepper = (className?: string): JSX.Element => (
    <DayStepper
      date={date}
      isToday={date === today}
      onStep={(delta) => patch({ date: shiftDay(date, delta) })}
      onPick={(ymd) => patch({ date: ymd })}
      onToday={() => patch({ date: today })}
      className={className}
    />
  );
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
    setTab('available');
    setPoolOpen(true);
  };
  const editsBar = (shape: 'phone' | 'strip' | 'floating'): JSX.Element => (
    <EditsBar
      codes={editedCodes}
      edited={m.edited}
      undoable={m.undoDepth > 0}
      saving={m.saving}
      onUndo={m.actions.undo}
      onDiscard={discard}
      onSave={save}
      onCode={showCar}
      shape={shape}
    />
  );
  const empty = onRoad.length === 0 && inWorkshop.length === 0;
  // Nothing to show: the term alone finds no car → say so; otherwise the filters' usual line.
  const emptyLine = empty ? (
    <p
      role="status"
      data-empty={termFinds ? 'filters' : 'code'}
      className="py-12 text-center text-sm text-slate-500"
    >
      {termFinds ? t('common.noResults') : t('fleet.odometer.vehicleNotFound')}
    </p>
  ) : null;
  /** The cars, or why there are none yet: the day still loading, or its request refused. */
  const carsArea = (cardLayout: TouchLayout, roadClass: string): JSX.Element =>
    m.status.error !== undefined ? (
      <ErrorState error={m.status.error} onRetry={m.status.retry} />
    ) : m.status.loading ? (
      <LoadingState />
    ) : (
      <>
        <div className={roadClass}>{cards(onRoad, cardLayout)}</div>
        {workshopGroup(cardLayout)}
        {emptyLine}
      </>
    );
  /**
   * The search box's own changes. A new term is a new question: the workshop group's fold for the
   * last term is forgotten («37», fold, ✕, «37» opens it again), and the answer is shown from its
   * first car — a cars column (landscape) or a page (portrait) left scrolled down would hide the
   * first matches above the screen. The phone needs no scroll: its box is reachable only at the top.
   */
  const changeCarTerm = (value: string): void => {
    setCarTerm(value);
    setFoldedFor(null);
    if (layout === 'landscape') document.querySelector('[data-cars-column]')?.scrollTo({ top: 0 });
    else if (layout === 'portrait') document.querySelector('main')?.scrollTo({ top: 0 });
  };
  const carSearch = (className?: string): JSX.Element => (
    <CarSearch value={carTerm} onChange={changeCarTerm} className={className} />
  );
  /** The red reset: every filter, and the typed code with them — never the day. */
  const resetAll = (): void => {
    setCarTerm('');
    resetFilters();
  };
  const pendingBanner =
    mayPlan && pendingDriver !== null ? (
      <div
        data-pending-driver={m.person(pendingDriver)?.code}
        className="flex min-h-12 items-center gap-2 rounded-xl bg-emerald-700 py-1 pe-1 ps-3.5 text-white shadow-sm dark:bg-emerald-600"
      >
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-white" />
        <span className="min-w-0 flex-1 text-sm font-semibold leading-5">
          {t('fleet.roster.driverNow', { name: m.driverName(pendingDriver) })}
        </span>
        <button
          type="button"
          onClick={() => setPendingDriver(null)}
          aria-label={t('common.cancel')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white/90 hover:bg-white/15"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </div>
    ) : null;

  // ── the sheets every layout shares ───────────────────────────────────────────────────────────
  const pickerOccupant = occupantOf(picker);
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
        toolbar={
          <div className="space-y-2.5">
            {tabs}
            <DriverSearch value={term} onChange={setTerm} />
          </div>
        }
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
        subtitle={
          <span>
            {weekdayOf(date, locale)}{' '}
            <bdi dir="ltr" className="font-figures">
              {slashDate(date)}
            </bdi>
          </span>
        }
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
            {tabs}
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
        onClose={() => setMissionFor(null)}
        onPick={(id) => {
          if (missionFor !== null) m.actions.mission(missionFor.vehicleId, id);
          setMissionFor(null);
        }}
      />
      <NotesSheet
        row={notesFor}
        onClose={() => setNotesFor(null)}
        onSave={(notes) => {
          if (notesFor !== null) m.actions.notes(notesFor.vehicleId, notes);
          setNotesFor(null);
        }}
      />
      <FiltersSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        codes={m.shown.map((row) => row.code)}
        pickedCodes={m.codes}
        onToggleCode={(code) => patch({ q: writeList(toggleValue(m.codes, code)) })}
        missions={m.missionOptions}
        pickedMissions={missions}
        onToggleMission={(id) => patch({ mission: writeList(toggleValue(missions, id)) })}
        onAllMissions={() => patch({ mission: null })}
        onReset={resetAll}
        results={visible.length}
        filtered={filtered}
      />
      <ConfirmSheet
        name="clear"
        open={clearing !== null}
        onClose={() => setClearing(null)}
        title={t('fleet.roster.clearTitle', { code: clearing?.code ?? '' })}
        confirmLabel={t('fleet.roster.clearAssignment')}
        backLabel={t('common.cancel')}
        onConfirm={() => {
          if (clearing !== null) m.actions.clearAll(clearing.vehicleId);
          setClearing(null);
        }}
      >
        {t('fleet.roster.clearBody')}
      </ConfirmSheet>
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
      <div data-roster-touch="landscape" className="flex min-h-0 flex-1 flex-col px-6 pb-4 pt-5">
        <div className="flex shrink-0 items-center gap-3">
          <h1 className="shrink-0 text-xl font-bold text-slate-900 dark:text-slate-50">
            {t('fleet.nav.roster')}
          </h1>
          {/* The search sits over the cars column, in the row's free room (≈490px). */}
          {carSearch('w-[20rem] min-w-0 shrink')}
          <span className="min-w-0 flex-1" />
          {stepper('w-[24rem] shrink-0')}
          <ExcelButton onExport={exportSheet} />
        </div>
        <div className="mt-3 flex shrink-0 items-center gap-2">
          <FilterButton count={filterCount} onOpen={() => setFiltersOpen(true)} />
          {filtered && <ResetChip onReset={resetAll} />}
          {chipRow}
        </div>
        {!editable && <PastDayBanner className="mt-3 shrink-0" />}
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
                  <div
                    data-target-banner="true"
                    className="flex min-h-12 items-center gap-2 rounded-xl bg-brand-600 py-1 pe-1 ps-3.5 text-white shadow-sm dark:bg-brand-600"
                  >
                    <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-white" />
                    <span className="min-w-0 flex-1 text-sm font-semibold leading-5">
                      {t('fleet.roster.targetNow', {
                        code: targetRow.code,
                        slot: t(SLOT_WORD[target.slot]),
                      })}
                      {targetOccupant !== null && <> · {m.driverName(targetOccupant)}</>}
                    </span>
                    <button
                      type="button"
                      onClick={() => setTarget(null)}
                      aria-label={t('common.cancel')}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white/90 hover:bg-white/15"
                    >
                      <CloseIcon className="h-5 w-5" />
                    </button>
                  </div>
                ) : pendingBanner !== null ? (
                  pendingBanner
                ) : (
                  <div
                    data-target-hint="true"
                    className="flex min-h-12 items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3.5 py-2 text-[13px] leading-5 text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300"
                  >
                    {t('fleet.roster.pickSlotHint')}
                  </div>
                ))}
              {tabs}
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
  const titleRow = phone ? (
    <>
      <div className="flex items-center gap-2">
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-slate-900 dark:text-slate-50">
          {t('fleet.nav.roster')}
        </h1>
        <ExcelButton onExport={exportSheet} />
      </div>
      {stepper('mt-2.5')}
      {carSearch('mt-2.5')}
    </>
  ) : (
    <div className="flex items-center gap-3">
      <h1 className="min-w-0 flex-1 truncate text-xl font-bold text-slate-900 dark:text-slate-50">
        {t('fleet.nav.roster')}
      </h1>
      {stepper('w-[24rem] shrink-0')}
      <ExcelButton onExport={exportSheet} />
    </div>
  );
  // Portrait: the title row has ≈185px free — the search is a full-width row of its own under it
  // (inside the sticky header; with the title in the flow when the tablet is too short to pin it).
  const topBlock = phone ? (
    titleRow
  ) : (
    <>
      {titleRow}
      {carSearch('mt-2.5')}
    </>
  );
  const filterRow = (
    <div className="flex items-center gap-2">
      <FilterButton count={filterCount} onOpen={() => setFiltersOpen(true)} compact={phone} />
      {filtered && <ResetChip onReset={resetAll} compact={phone} />}
      {chipRow}
      <DriversButton count={m.poolLicensed.length} onOpen={openPool} compact={phone} />
    </div>
  );
  return (
    // `flex-1`: the board is at least the screen's height, so the bottom bar sits at the screen's
    // bottom even when a search leaves two cars — not under the last card with blank space below.
    <div data-roster-touch={layout} className={cn('flex flex-1 flex-col', phone ? 'px-4' : 'px-6')}>
      {/* Phone (upright or sideways): the title, the day and the search scroll away with the cars. */}
      {phone && <div className="pt-3">{topBlock}</div>}
      <div
        data-touch-header="true"
        data-sticky={stickyMode}
        className={cn(
          'z-20 border-b border-slate-200/80 bg-slate-50 pb-2 dark:border-slate-800 dark:bg-slate-950',
          stickyMode !== 'none' && 'sticky top-0',
          phone ? 'pt-2' : 'pt-3',
          phone ? '-mx-4 px-4' : '-mx-6 px-6',
        )}
      >
        {/* Portrait: the title row and the search always live in the header — sticky or not (a
            tablet whose keyboard shrinks the screen below 500px) — so the box is never moved to
            another parent while it is being typed in: that would unmount it, drop its focus and
            close the keyboard mid-word. */}
        {!phone && <div className="mb-2">{topBlock}</div>}
        {filterRow}
        {pendingBanner !== null && <div className="mt-2">{pendingBanner}</div>}
      </div>

      {!editable && <PastDayBanner className="mt-3" />}

      {carsArea(layout, 'space-y-3 pt-3')}

      {/* The bottom: in the flow and sticky, so the last card is never under it; pushed to the
          board's foot (`mt-auto`) when the cars are fewer than the screen, 20px after them always. */}
      <div className="h-5 shrink-0" />
      <div
        data-touch-bottom="true"
        className={cn(
          'pointer-events-none sticky bottom-0 z-20 mt-auto',
          phone ? '-mx-4' : '-mx-6',
        )}
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
