// «الطقم الثابت» — the standing crews as ONE model that both layouts draw: the computer's table and
// the phone / tablet cards, in the look of «تعيين السيارات» («واعمل ديزاين شاشة الطاقم الثابت زى
// التعيين اليومى») with no day anywhere.
//
// The standing crew is a fact about a CAR, true until somebody changes it, so this model has no
// calendar, no availability verdict and no absence: it reads `GET /fleet/fixed-roster` (every car
// that can carry a crew, and every driver with the car he is fixed to) and saves through
// `POST /fleet/fixed-roster`, the two functions this screen always had. Everything between is a
// DRAFT, kept as it always was:
//
//   · the draft is the REAL `useDraftBoard(FIXED_ROSTER_DRAFT_KEY, …)` — one key for the whole
//     board, so a reload finds the unsaved edits; «إلغاء» and a stored save drop it;
//   · every edit is a function of `fixed-roster-board.ts` (assign, clear one seat, swap, clear the
//     crew, the pen dialog's four facts) — the rules the server enforces, said once;
//   · «تراجع» takes back the last edit (in memory, at most 50 steps); an edit that changes no fact
//     is no step; the steps lapse when the server answers with another board, and a reload keeps
//     the draft but starts the steps again;
//   · a refused save keeps the draft AND its steps, and says why in Arabic (`fixedSaveRefusal`):
//     the driver by name and the car that holds him, never an id, never the server's English.
//
// Owner's answer 1 (ب): no flag for a standing member who can no longer drive. The lists offer
// every driver the server sends; the server's refusal at «حفظ» is what says why one cannot stay.
//
// No effect seeds anything: the draft is derived during render, which is what lets the specs
// render the model with `renderToStaticMarkup`.
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  compareFleetVehicleCodes,
  splitVehicleCodeList,
  type FleetFixedCrewRowDto,
  type FleetFixedRosterDto,
  type FleetPersonDto,
  type FleetRosterRowDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { toast } from '../../../shared/ui/toast/toast-store';
import { localized } from '../../../shared/lib/format';
import { toggleValue, writeList } from '../../../shared/lib/list-param';
import { type MultiSelectOption } from '../../../shared/ui/MultiSelect';
import { useFixedRoster, useFleetCatalog, useSaveFixedRoster } from '../api/fleet-queries';
import { useFleetPeopleMap } from '../components/EmployeeName';
import { saveSheet } from './fleet-sheet';
import {
  applyEdit,
  assignDriver,
  availableDrivers,
  changedRows,
  clearCrew,
  clearSlot,
  findSeat,
  swapDrivers,
  type CrewSlot,
  type FixedCrewPayloadRow,
} from './fixed-roster-board';
import { fixedSaveRefusal } from './fixed-save-refusal';
import { heldOffBoard } from './daily-roster-board';
import { filterDrivers, type DriverSearchRecord } from './driver-search';
import { FIXED_ROSTER_DRAFT_KEY, ROSTER_EDITABLE_FIELDS } from './draft-storage';
import {
  COUNTER_TONES,
  hasDriver,
  missionTone,
  visibleFixedRows,
  type FixedRosterView,
} from './roster-view';
import {
  UNDO_LIMIT,
  type DriverOption,
  type DriverOptions,
  type MissionOption,
  type RosterCounter,
} from './roster-board';
import { type TableSort } from './table-sort';
import { type TouchLayout } from './roster-layout';
import { useDraftBoard } from './useDraftBoard';
import { matchesVehicleCode } from './vehicle-code-match';

// ── the model's shape ────────────────────────────────────────────────────────────────────────────

export type FixedRosterDriver = FleetFixedRosterDto['drivers'][number];

/** What the shell reads off the URL and hands down. No day anywhere. */
export interface FixedRosterQuery {
  mayPlan: boolean;
  /** The raw `?q=` — the comma list of picked car codes. */
  search: string;
  missions: readonly string[];
  view: FixedRosterView | null;
  patch: (updates: Record<string, string | null>) => void;
}

/** A seat: which car, which of its two slots. */
export interface FixedSeatTarget {
  vehicleId: string;
  slot: CrewSlot;
}

/** The pen dialog's four facts. */
export interface FixedEditValues {
  missionTypeId: string | null;
  driver1EmployeeId: string | null;
  driver2EmployeeId: string | null;
  notes: string | null;
}

export interface FixedRosterActions {
  /** Drop, picker, tap: `assignDriver` (another car = move, own other seat = swap, same seat = nothing). */
  assign(target: FixedSeatTarget, employeeId: string): void;
  /** One seat (seat 1 cleared → seat 2 promoted): `clearSlot`. */
  clear(vehicleId: string, slot: CrewSlot): void;
  /** Both seats trade places: `swapDrivers` (no-op, no step, unless both are filled). */
  swap(vehicleId: string): void;
  /** «إفراغ الطقم»: both seats in one write, mission and note KEPT, no confirm: `clearCrew`. */
  clearCrew(vehicleId: string): void;
  /** The mission alone, via `applyEdit`. A car the workshop holds is allowed (fixed rule). */
  mission(vehicleId: string, missionTypeId: string | null): void;
  /** The note alone, via `applyEdit`; trimmed, '' → null. */
  notes(vehicleId: string, notes: string): void;
  /** The pen dialog: ONE undo step via `applyEdit`; nothing changed → no step. */
  apply(vehicleId: string, values: FixedEditValues): void;
  /** «تراجع»: the draft as it was before the last edit. */
  undo(): void;
  /** «إلغاء»: the draft (memory + storage) AND the undo steps. */
  discard(): void;
  /** «حفظ»: toasts itself (saved / `fixedSaveRefusal`); true when stored; a refusal keeps draft + steps. */
  save(): Promise<boolean>;
  /** The 8-column sheet of the rows given, in the order given (today's file, same words). */
  exportSheet(rows: readonly FleetFixedCrewRowDto[]): void;
}

export interface FixedRosterBoardModel {
  board: FleetFixedRosterDto | undefined;
  status: { loading: boolean; error: unknown; retry: () => void };
  saved: FleetFixedCrewRowDto[];
  /** The draft (restored from storage on a reload) — what every board draws and edits. */
  draft: FleetFixedCrewRowDto[];
  /** `draft` narrowed by `q` (whole codes), the missions and the view, in CODE ORDER. */
  visible: FleetFixedCrewRowDto[];
  /** The picked codes of `?q=`. */
  codes: string[];
  /** Every car of the board, code order, as the code filter's options. */
  codeOptions: MultiSelectOption[];
  /** `q`, a mission or a view narrows the board. */
  filtered: boolean;
  /** «إجمالي» brand · «صيانة» rose · «بطقم» emerald · «بلا طقم» YELLOW · one per active mission. Whole draft. */
  counters: RosterCounter[];
  /** Active missions, each with its count on the draft. */
  missionOptions: MissionOption[];
  /** '—' for null or an id the catalog does not (yet) name. */
  missionName: (id: string | null) => string;
  /** The `missionType` catalog's state, for the dialog / sheet lines. */
  missionCatalog: { loading: boolean; failed: boolean; empty: boolean };
  /** The save payload (`changedRows(saved, draft)`) — also what «إلغاء» throws away. */
  changed: FixedCrewPayloadRow[];
  unsavedIds: ReadonlySet<string>;
  dirty: boolean;
  undoDepth: number;
  saving: boolean;
  /** FREE drivers: no seat in the draft and not held on a car off this board. */
  pool: FixedRosterDriver[];
  /** Drivers the SERVER holds on a car that is not on this board (another branch, out of service). */
  heldOff: FixedRosterDriver[];
  searchIndex: ReadonlyMap<string, DriverSearchRecord>;
  person: (employeeId: string) => FleetPersonDto | undefined;
  /** `fullNameAr`, else the id's tail (the sheet's rule); '' for nobody. */
  driverName: (employeeId: string | null) => string;
  codeOf: (vehicleId: string) => string;
  /** The car a save would MOVE him off («سيُنقل من السيارة …»): his SAVED seat on another car. */
  transferFrom: (employeeId: string, vehicleId: string) => string | null;
  /**
   * The list for a pick, searched by name or code. free = `pool`; flagged = [] (answer 1 ب);
   * seated = (target ? drivers the draft seats on ANOTHER car of this board, with that car's code : [])
   *          + ALWAYS the held-off-board drivers the draft seats nowhere, as state 'seated' with
   *          seatedCode null (→ the shared list paints the blue «سيارة أخرى»); elsewhere = [].
   * licenceExpired is always false. The target car's own crew is left out (the swap is its own button).
   */
  availableFor: (term: string, target: FixedSeatTarget | null) => DriverOptions;
  /** The pen dialog's candidates: every driver with no seat in the draft (free + held-off) PLUS this car's own crew. */
  dialogCandidates: (vehicleId: string) => string[];
  actions: FixedRosterActions;
}

/** What the shell hands the computer's board (`components/roster/FixedDeskBoard.tsx`). */
export interface FixedDeskBoardProps {
  m: FixedRosterBoardModel;
  query: FixedRosterQuery;
  resetFilters: () => void;
  /** `m.visible` in the order the reader clicked (the shell's sort). */
  rows: FleetFixedCrewRowDto[];
  sort: TableSort[];
  onSortChange: (key: string) => void;
}

/** What the shell hands the phone / tablet board (`components/roster/FixedTouchBoard.tsx`). */
export interface FixedTouchBoardProps {
  m: FixedRosterBoardModel;
  query: FixedRosterQuery;
  resetFilters: () => void;
  layout: TouchLayout;
  short: boolean;
}

// ── pure pieces (exported for the boards and the specs) ──────────────────────────────────────────

/**
 * One edit on the draft: the rows after it, or `null` when it changes no fact — a drop on the seat
 * already held, a swap with one seat filled, a dialog saved as it was. Such an edit is no step:
 * nothing to undo, nothing to write.
 */
export const fixedEditStep = (
  draft: readonly FleetFixedCrewRowDto[],
  change: (rows: readonly FleetFixedCrewRowDto[]) => FleetFixedCrewRowDto[],
): FleetFixedCrewRowDto[] | null => {
  const after = change(draft);
  return changedRows(draft, after).length === 0 ? null : after;
};

/**
 * The undo steps (the drafts as they were before each edit, newest last), with the server board
 * they were taken over. A step holds WHOLE rows — the server's facts too (the workshop) — so it is
 * only good while that board is the board: once the server answers with another one (a save, a
 * refetch), the steps lapse; the draft itself is kept (it is rebuilt over the new board).
 */
export interface FixedUndo {
  base: readonly FleetFixedCrewRowDto[];
  steps: readonly FleetFixedCrewRowDto[][];
}

/** No steps at all. */
export const NO_FIXED_UNDO: FixedUndo = { base: [], steps: [] };

/** The steps, if they were taken over `base` — none otherwise. */
export const fixedUndoSteps = (
  undo: FixedUndo,
  base: readonly FleetFixedCrewRowDto[],
): readonly FleetFixedCrewRowDto[][] => (undo.base === base ? undo.steps : []);

/** Remember `rows` (the draft before an edit), keeping the newest `UNDO_LIMIT`. */
export const pushFixedUndo = (
  undo: FixedUndo,
  base: readonly FleetFixedCrewRowDto[],
  rows: FleetFixedCrewRowDto[],
): FixedUndo => ({ base, steps: [...fixedUndoSteps(undo, base), rows].slice(-UNDO_LIMIT) });

/** Take the newest draft off the steps — `previous` is undefined when there is none. */
export const popFixedUndo = (
  undo: FixedUndo,
  base: readonly FleetFixedCrewRowDto[],
): { undo: FixedUndo; previous: FleetFixedCrewRowDto[] | undefined } => {
  const steps = fixedUndoSteps(undo, base);
  const previous = steps[steps.length - 1];
  if (previous === undefined) return { undo, previous: undefined };
  return { undo: { base, steps: steps.slice(0, -1) }, previous };
};

/**
 * The board's tally, counted off the WHOLE draft (never the narrowed rows). «إجمالي» clears the
 * mission and the view, the state chips set a view, and one chip per ACTIVE mission toggles it in
 * `?mission=`. «بلا طقم» wears the daily «بلا سائق» yellow — rose is the workshop's alone.
 */
export const fixedCounters = (
  draft: readonly FleetFixedCrewRowDto[],
  activeMissions: readonly { id: string; label: string }[],
  narrowing: { missions: readonly string[]; view: FixedRosterView | null },
  t: (key: string) => string,
): RosterCounter[] => {
  const { missions, view } = narrowing;
  const byMission = new Map<string, number>();
  for (const row of draft) {
    if (row.missionTypeId === null) continue;
    byMission.set(row.missionTypeId, (byMission.get(row.missionTypeId) ?? 0) + 1);
  }
  const crewed = draft.filter(hasDriver).length;
  return [
    {
      key: 'total',
      label: t('fleet.roster.counter.total'),
      value: draft.length,
      tone: COUNTER_TONES.total,
      apply: { mission: null, view: null },
      active: missions.length === 0 && view === null,
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
      key: 'crewed',
      label: t('fleet.fixedRoster.counter.crewed'),
      value: crewed,
      tone: COUNTER_TONES.assigned,
      apply: { view: 'crewed' },
      active: view === 'crewed',
    },
    {
      key: 'uncrewed',
      label: t('fleet.fixedRoster.counter.uncrewed'),
      value: draft.length - crewed,
      tone: COUNTER_TONES.unmanned,
      apply: { view: 'uncrewed' },
      active: view === 'uncrewed',
    },
    ...activeMissions.map((mission) => ({
      key: mission.id,
      label: mission.label,
      value: byMission.get(mission.id) ?? 0,
      tone: missionTone(mission.id),
      apply: { mission: writeList(toggleValue(missions, mission.id)) },
      active: missions.includes(mission.id),
    })),
  ];
};

/**
 * The URL filters that HIDE `row`, each set to null — an edited car's code in the unsaved bar
 * brings its car back by lifting only those (the picked codes, the missions, the view). Empty when
 * nothing hides it.
 */
export const fixedFiltersHiding = (
  row: FleetFixedCrewRowDto,
  narrowing: { search: string; missions: readonly string[]; view: FixedRosterView | null },
): Record<string, null> => {
  const passes = (filter: Parameters<typeof visibleFixedRows>[1]): boolean =>
    visibleFixedRows([row], filter).length === 1;
  return {
    ...(passes({ term: narrowing.search }) ? {} : { q: null }),
    ...(passes({ missions: narrowing.missions }) ? {} : { mission: null }),
    ...(passes({ view: narrowing.view }) ? {} : { view: null }),
  };
};

/** What the touch board draws for a typed car code. */
export interface FixedTouchCars {
  /** The box holds at least one code (empty, spaces, a lone dash narrow nothing). */
  searching: boolean;
  /** The cars on show, in CODE ORDER — a workshop car in its place, never grouped apart. */
  drawn: FleetFixedCrewRowDto[];
  /** Does the term ALONE find a car of the board? No → «لا توجد سيارة بهذا الكود». */
  termFinds: boolean;
}

/**
 * The touch board's typed car code over what the URL already narrows (`visible`), ANDed. The typed
 * term is a SEARCH (`matchesVehicleCode`: a part of the code, several codes at once) — «41» finds
 * 410 — while the picked codes in `visible` are whole codes. `all` is the whole board, which only
 * says whether the term finds a car at all.
 */
export const fixedTouchCars = (
  visible: readonly FleetFixedCrewRowDto[],
  all: readonly FleetFixedCrewRowDto[],
  carTerm: string,
): FixedTouchCars => {
  const searching = splitVehicleCodeList(carTerm).length > 0;
  return {
    searching,
    drawn: visible.filter((row) => matchesVehicleCode(row.code, carTerm)),
    termFinds: !searching || all.some((row) => matchesVehicleCode(row.code, carTerm)),
  };
};

/**
 * A standing row as the daily SEAT reads it (`SeatCell`): the workshop does not lock a standing
 * crew, so the seat is told the car is on the road — the row's badge and tint still read the real
 * row. `planned` because a standing crew is always a decision somebody made.
 */
export const toSeatRow = (row: FleetFixedCrewRowDto): FleetRosterRowDto => ({
  ...row,
  inMaintenance: false,
  planned: true,
});

/** A standing row as the daily CARD reads it (`CarCard`, drawn with `workshopLock={false}`). */
export const toCardRow = (row: FleetFixedCrewRowDto): FleetRosterRowDto => ({
  ...row,
  planned: true,
});

/** The cars in the fleet's own code order — 150 upward, then the worded ones. */
const inCodeOrder = (rows: readonly FleetFixedCrewRowDto[]): FleetFixedCrewRowDto[] =>
  [...rows].sort((a, b) => compareFleetVehicleCodes(a.code, b.code));

// ── the hook ─────────────────────────────────────────────────────────────────────────────────────

export const useFixedRosterBoard = (query: FixedRosterQuery): FixedRosterBoardModel => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { mayPlan, search, missions, view } = query;
  /** The list as ONE value, so the memos below are not invalidated by a fresh array. */
  const missionsKey = missions.join(',');

  const boardQuery = useFixedRoster();
  const board = boardQuery.data;
  // The BASELINE: the standing crews as the server holds them — what «إلغاء» returns to and what
  // the save measures against.
  const saved = useMemo(() => board?.rows ?? [], [board]);

  // The draft, under the board's ONE key: a standing crew has no day, so one board, one draft.
  const {
    draft,
    setDraft,
    discard,
    accept: acceptDraft,
  } = useDraftBoard(FIXED_ROSTER_DRAFT_KEY, saved, ROSTER_EDITABLE_FIELDS);
  // `setDraft` folds over the draft of the LAST render; two edits in one tap must fold over each
  // other. So the newest rows are kept here with the draft they were made from, and are used only
  // while that is still the draft in hand.
  const inFlight = useRef<{ from: FleetFixedCrewRowDto[]; rows: FleetFixedCrewRowDto[] } | null>(
    null,
  );
  const latest = (): FleetFixedCrewRowDto[] =>
    inFlight.current !== null && inFlight.current.from === draft ? inFlight.current.rows : draft;
  // Undo: one stack, in memory — a reload keeps the draft, not its history.
  const [undoStack, setUndoStack] = useState<FixedUndo>(NO_FIXED_UNDO);
  const undoDepth = mayPlan ? fixedUndoSteps(undoStack, saved).length : 0;

  // What «حفظ» sends — and, being the reader's own edits, what the tint and the bar read.
  const changed = useMemo(() => changedRows(saved, draft), [saved, draft]);
  const dirty = changed.length > 0;
  const unsavedIds = useMemo(() => new Set(changed.map((row) => row.vehicleId)), [changed]);

  const saveMutation = useSaveFixedRoster();
  // The SAME `missionType` catalog the daily roster reads — never the workshop's vocabulary.
  const missionTypes = useFleetCatalog('missionType');
  const activeMissions = useMemo(
    () =>
      (missionTypes.data?.items ?? [])
        .filter((item) => item.isActive)
        .map((item) => ({ id: item.id, label: localized(item.name, locale) })),
    [missionTypes.data, locale],
  );
  /** The catalog's name for an id — null for none, or for an id it does not (yet) name. */
  const missionLabel = (id: string | null): string | null => {
    if (id === null) return null;
    const item = missionTypes.data?.items.find((entry) => entry.id === id);
    return item === undefined ? null : localized(item.name, locale);
  };
  const missionName = (id: string | null): string => missionLabel(id) ?? '—';
  const catalogItems = missionTypes.data?.items.length ?? 0;
  const missionCatalog = {
    loading: missionTypes.isPending,
    failed: missionTypes.isError,
    empty: !missionTypes.isPending && !missionTypes.isError && catalogItems === 0,
  };

  // DISPLAY ONLY: the draft, the counters, the pool and the payload read the whole board.
  const visible = useMemo(
    () => inCodeOrder(visibleFixedRows(draft, { term: search, missions, view })),
    [draft, search, missionsKey, view],
  );
  const codes = useMemo(
    () =>
      search
        .split(',')
        .map((code) => code.trim())
        .filter((code) => code !== ''),
    [search],
  );
  const codeOptions = useMemo(
    () => inCodeOrder(draft).map((row) => ({ value: row.code, label: row.code })),
    [draft],
  );
  const filtered = search !== '' || missions.length > 0 || view !== null;
  const codeByVehicle = useMemo(
    () => new Map(draft.map((row) => [row.vehicleId, row.code])),
    [draft],
  );
  const codeOf = (vehicleId: string): string => codeByVehicle.get(vehicleId) ?? '';

  const counters = useMemo(
    () => fixedCounters(draft, activeMissions, { missions, view }, t),
    [draft, activeMissions, missionsKey, view, t],
  );
  const missionOptions = useMemo(
    (): MissionOption[] =>
      activeMissions.map((mission) => ({
        id: mission.id,
        label: mission.label,
        tone: missionTone(mission.id),
        count: draft.filter((row) => row.missionTypeId === mission.id).length,
      })),
    [activeMissions, draft],
  );

  // ── the drivers ──────────────────────────────────────────────────────────────────────────────
  const drivers = useMemo(() => board?.drivers ?? [], [board]);
  // Fixed to a car that is NOT on this board — another branch's car, or a car out of service. No
  // edit here can release him, so he is never in the pool: he is listed apart, under «معيّنون على
  // سيارات أخرى», with the blue «سيارة أخرى».
  const heldOff = useMemo(() => heldOffBoard(drivers, saved), [drivers, saved]);
  const heldOffIds = useMemo(() => new Set(heldOff.map((driver) => driver.employeeId)), [heldOff]);
  // The pool is DERIVED from the draft: everyone the draft seats leaves it the moment the edit
  // lands, and comes back the moment a seat is cleared — minus the drivers held off the board.
  const pool = useMemo(
    () => availableDrivers(drivers, draft).filter((driver) => !heldOffIds.has(driver.employeeId)),
    [drivers, draft, heldOffIds],
  );

  // ONE people map for every name on the screen — the seats, the lists, the file, the refusal.
  const people = useFleetPeopleMap();
  const searchIndex = useMemo(() => {
    const ids = new Set(drivers.map((driver) => driver.employeeId));
    for (const row of draft) {
      for (const id of [row.driver1EmployeeId, row.driver2EmployeeId]) if (id !== null) ids.add(id);
    }
    const index = new Map<string, DriverSearchRecord>();
    for (const employeeId of ids) {
      const found = people.get(employeeId);
      if (found === undefined) continue;
      // Fleet's roster carries ONE name and ONE code — the two a search here is typed with.
      index.set(employeeId, {
        employeeId,
        nameAr: found.fullNameAr,
        nameEn: null,
        code: found.code,
        employeeNumber: null,
      });
    }
    return index;
  }, [drivers, draft, people]);
  const person = useCallback(
    (employeeId: string): FleetPersonDto | undefined => people.get(employeeId),
    [people],
  );
  const driverName = (employeeId: string | null): string =>
    employeeId === null ? '' : (people.get(employeeId)?.fullNameAr ?? employeeId.slice(-8));

  /** «سيُنقل من السيارة {{code}} عند الحفظ» — where the SERVER has him, if another car. */
  const transferFrom = useCallback(
    (employeeId: string, vehicleId: string): string | null => {
      const was = findSeat(saved, employeeId);
      if (was === null || was.vehicleId === vehicleId) return null;
      return saved.find((row) => row.vehicleId === was.vehicleId)?.code ?? null;
    },
    [saved],
  );

  const availableFor = useCallback(
    (term: string, target: FixedSeatTarget | null): DriverOptions => {
      const searched = filterDrivers(drivers, searchIndex, term);
      const inPool = new Set(pool.map((driver) => driver.employeeId));
      const option = (
        employeeId: string,
        state: DriverOption['state'],
        seatedCode: string | null,
      ): DriverOption => ({
        employeeId,
        state,
        seatedCode,
        onTarget: false,
        licenceExpired: false,
      });
      const free = searched
        .filter((driver) => inPool.has(driver.employeeId))
        .map((driver) => option(driver.employeeId, 'free', null));
      // A pick MOVES him: the draft seats him on another car of this board (its code is said).
      const moves =
        target === null
          ? []
          : searched.flatMap((driver) => {
              if (inPool.has(driver.employeeId)) return [];
              const seat = findSeat(draft, driver.employeeId);
              if (seat === null || seat.vehicleId === target.vehicleId) return [];
              return [
                option(driver.employeeId, 'seated', codeByVehicle.get(seat.vehicleId) ?? null),
              ];
            });
      // Held off the board, and seated by the draft nowhere: listed always, with no code.
      const away = searched
        .filter(
          (driver) =>
            heldOffIds.has(driver.employeeId) && findSeat(draft, driver.employeeId) === null,
        )
        .map((driver) => option(driver.employeeId, 'seated', null));
      return { free, flagged: [], seated: [...moves, ...away], elsewhere: [] };
    },
    [drivers, searchIndex, pool, draft, codeByVehicle, heldOffIds],
  );

  /** Everyone the draft seats nowhere (free and held off), then this car's own crew. */
  const dialogCandidates = useCallback(
    (vehicleId: string): string[] => {
      const ids = availableDrivers(drivers, draft).map((driver) => driver.employeeId);
      const own = draft.find((row) => row.vehicleId === vehicleId);
      for (const id of [own?.driver1EmployeeId ?? null, own?.driver2EmployeeId ?? null]) {
        if (id !== null && !ids.includes(id)) ids.push(id);
      }
      return ids;
    },
    [drivers, draft],
  );

  // ── the edits: each one a real board function on the draft ──────────────────────────────────
  const edit = (
    change: (rows: readonly FleetFixedCrewRowDto[]) => FleetFixedCrewRowDto[],
  ): void => {
    if (!mayPlan) return;
    const before = latest();
    const after = fixedEditStep(before, change);
    if (after === null) return;
    inFlight.current = { from: draft, rows: after };
    setUndoStack((stack) => pushFixedUndo(stack, saved, before));
    setDraft(() => after);
  };
  /** The row's other facts as they are, with one of them changed — through `applyEdit`. */
  const editRow =
    (vehicleId: string, values: Partial<FixedEditValues>) =>
    (rows: readonly FleetFixedCrewRowDto[]): FleetFixedCrewRowDto[] => {
      const row = rows.find((candidate) => candidate.vehicleId === vehicleId);
      if (row === undefined) return [...rows];
      return applyEdit(rows, vehicleId, {
        missionTypeId: row.missionTypeId,
        driver1EmployeeId: row.driver1EmployeeId,
        driver2EmployeeId: row.driver2EmployeeId,
        notes: row.notes,
        ...values,
      });
    };
  /** '' is not a note — the contract refuses it; nothing is spelled null. */
  const note = (text: string | null): string | null =>
    text === null || text.trim() === '' ? null : text.trim();

  const forgetSteps = (): void => setUndoStack({ base: saved, steps: [] });

  const commit = async (): Promise<boolean> => {
    if (!mayPlan || !dirty) return false;
    try {
      await saveMutation.mutateAsync({ rows: changed });
      // Stored: what was sent is the SERVER's board now, so it stops being a draft — in storage
      // and in memory (an answer equal to the board in hand would otherwise keep it).
      acceptDraft();
      discard();
      forgetSteps();
      toast.success(t('fleet.fixedRoster.saved'));
      return true;
    } catch (error) {
      // The hook's own `onError` opts the mutation out of the global toast — said here, in Arabic,
      // and the draft and its steps stay: nothing the reader did is lost.
      toast.error(
        fixedSaveRefusal(error, {
          t,
          locale,
          nameOf: (employeeId) => people.get(employeeId)?.fullNameAr ?? null,
        }),
      );
      return false;
    }
  };

  /**
   * «للشاشات دى اعملى اكسلات هتاخد اللى الفلتر عامله بس · ومفيش امضاءات» — the rows on screen (the
   * draft, unsaved edits included), in the order given, eight columns with «م»; «الحالة» split in
   * two (the workshop, and crewed or not), as the file always was.
   */
  const exportSheet = (rows: readonly FleetFixedCrewRowDto[]): void => {
    saveSheet({
      name: t('fleet.nav.fixedRoster'),
      serialHeader: t('fleet.violations.report.serial'),
      header: [
        t('fleet.odometer.columns.vehicle'),
        t('fleet.vehicles.inWorkshop'),
        t('fleet.vehicles.columns.status'),
        t('fleet.roster.fields.mission'),
        t('fleet.odometer.fields.driver1'),
        t('fleet.odometer.fields.driver2'),
        t('fleet.attendance.fields.notes'),
      ],
      rows: rows.map((row) => [
        row.code,
        row.inMaintenance ? t('common.yes') : t('common.no'),
        hasDriver(row) ? t('fleet.roster.assigned') : t('fleet.fixedRoster.unassigned'),
        // Empty stays EMPTY: a dash in a sheet is a value nobody can filter on.
        missionLabel(row.missionTypeId) ?? '',
        driverName(row.driver1EmployeeId),
        driverName(row.driver2EmployeeId),
        row.notes ?? '',
      ]),
    });
  };

  const actions: FixedRosterActions = {
    assign: (target, employeeId) =>
      edit((rows) => assignDriver(rows, target.vehicleId, target.slot, employeeId)),
    clear: (vehicleId, slot) => edit((rows) => clearSlot(rows, vehicleId, slot)),
    swap: (vehicleId) => edit((rows) => swapDrivers(rows, vehicleId)),
    clearCrew: (vehicleId) => edit((rows) => clearCrew(rows, vehicleId)),
    mission: (vehicleId, missionTypeId) => edit(editRow(vehicleId, { missionTypeId })),
    notes: (vehicleId, text) => edit(editRow(vehicleId, { notes: note(text) })),
    apply: (vehicleId, values) =>
      edit((rows) => applyEdit(rows, vehicleId, { ...values, notes: note(values.notes) })),
    undo: () => {
      if (!mayPlan) return;
      const { previous } = popFixedUndo(undoStack, saved);
      if (previous === undefined) return;
      inFlight.current = { from: draft, rows: previous };
      setUndoStack((stack) => popFixedUndo(stack, saved).undo);
      setDraft(() => previous);
    },
    discard: () => {
      if (!mayPlan) return;
      forgetSteps();
      discard();
    },
    save: commit,
    exportSheet,
  };

  return {
    board,
    status: {
      loading: boardQuery.isPending,
      error: boardQuery.isError ? boardQuery.error : undefined,
      retry: () => void boardQuery.refetch(),
    },
    saved,
    draft,
    visible,
    codes,
    codeOptions,
    filtered,
    counters,
    missionOptions,
    missionName,
    missionCatalog,
    changed,
    unsavedIds,
    dirty,
    undoDepth,
    saving: saveMutation.isPending,
    pool,
    heldOff,
    searchIndex,
    person,
    driverName,
    codeOf,
    transferFrom,
    availableFor,
    dialogCandidates,
    actions,
  };
};
