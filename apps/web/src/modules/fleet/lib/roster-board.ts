// «تعيين السيارات» — the day's board as ONE model that both layouts draw: the computer's table and
// the phone / tablet cards («فى تعديل بسيط ف شاشة تعبين الطاقم فى الحركه عاوز شكلها يتغير فى
// التابلت والفون»).
//
// THE DAY IS A DRAFT, exactly as RosterPage always kept it. The server derives the day (stored
// assignments, else the fixed crew, cut down by the workshop and the availability seam); from then
// until «حفظ» every drop, pick, mission and note edits a LOCAL copy (`useDraftBoard`, kept in
// sessionStorage per date), and «حفظ» sends `rowsToSave` through the one plan mutation. A refusal
// (FR-5 workshop, FR-6 unavailable driver, FR-7 driver held elsewhere — all 409 CONFLICT) is
// toasted with `errorMessage` and the draft STAYS.
//
// What the model adds to the page's old state block, as the approved touch sample has it:
//
//   · an UNDO stack per day (in memory, at most 50 steps) — «تراجع» takes back the last edit only;
//     an edit that changes no fact is not a step;
//   · `apply`, the pen dialog's four facts as ONE step;
//   · `liveFlags` — on touch the EDITED rows re-derive `manned` / `crewGaps` / `stalePlan` from the
//     draft, so «بلا سائق» follows a pick at once; the computer keeps the server's flags until
//     «حفظ» re-reads the day, as RosterPage does.
//
// No effect seeds anything here: the draft is derived during render (`useDraftBoard`), which is
// what lets the specs render the screen with `renderToStaticMarkup`.
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  type FleetPersonDto,
  type FleetRosterDayDto,
  type FleetRosterRowDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { toast } from '../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../shared/lib/errors';
import { localized } from '../../../shared/lib/format';
import { toggleValue, writeList } from '../../../shared/lib/list-param';
import { type MultiSelectOption } from '../../../shared/ui/MultiSelect';
import { useFleetCatalog, usePlanRoster, useRosterDay } from '../api/fleet-queries';
import { useEmployeeRecords } from '../components/EmployeeName';
import { saveSheet, sheetDay } from './fleet-sheet';
import { type TableSort } from './table-sort';
import {
  applyEdit,
  assignDriver,
  availableDrivers,
  changedRows,
  clearCrew,
  clearSlot,
  findSeat,
  hasEdits,
  rowsToSave,
  setMission,
  swapDrivers,
  type DutyPayloadRow,
  type DutySlot,
} from './daily-roster-board';
import { filterDrivers, type DriverSearchRecord } from './driver-search';
import { rosterDraftKey, ROSTER_EDITABLE_FIELDS } from './draft-storage';
import {
  COUNTER_TONES,
  byReasons,
  carriesPlan,
  expiredLicenceIds,
  hasCrewGap,
  hasDriver,
  isReady,
  isUnmanned,
  licenceCheckLinks,
  missionTone,
  reasonChips,
  reasonSubtotals,
  visibleRows,
  withoutExpiredLicence,
  type RosterView,
} from './roster-view';
import { useDraftBoard } from './useDraftBoard';
import { type TouchLayout } from './roster-layout';

// ── pure pieces (exported for the boards and the specs) ──────────────────────────────────────────

/** The one thing a drag carries, exactly as the fixed board spells it. */
export const DRAG_TYPE = 'application/x-ecms-driver';

/** A seat's name — «السائق الأول» / «السائق الثاني». */
export const SLOT_WORD: Record<DutySlot, string> = {
  driver1EmployeeId: 'fleet.odometer.fields.driver1',
  driver2EmployeeId: 'fleet.odometer.fields.driver2',
};

/** The seam's verdicts (`DriverUnavailableReason`); anything newer shows as sent. */
export const KNOWN_REASONS: ReadonlySet<string> = new Set([
  'notADriver',
  'profileInactive',
  'notEmployed',
  'fleetUnavailability',
  'hrLeave',
  'licenceExpired',
]);

/** The day `delta` days from `date` (YYYY-MM-DD), on the calendar the whole screen reads. */
export const shiftDay = (date: string, delta: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

/** How far back «تراجع» reaches on one day. */
export const UNDO_LIMIT = 50;

/** One undo stack per day: the drafts as they were before each edit, newest last. */
export type UndoStacks = Readonly<Record<string, readonly FleetRosterRowDto[][]>>;

/** Remember `rows` (the draft before an edit) on `date`'s stack, keeping the newest `UNDO_LIMIT`. */
export const pushUndo = (
  stacks: UndoStacks,
  date: string,
  rows: FleetRosterRowDto[],
): UndoStacks => ({
  ...stacks,
  [date]: [...(stacks[date] ?? []), rows].slice(-UNDO_LIMIT),
});

/** Take the newest draft off `date`'s stack — `previous` is undefined when there is none. */
export const popUndo = (
  stacks: UndoStacks,
  date: string,
): { stacks: UndoStacks; previous: FleetRosterRowDto[] | undefined } => {
  const stack = stacks[date] ?? [];
  const previous = stack[stack.length - 1];
  if (previous === undefined) return { stacks, previous: undefined };
  return { stacks: { ...stacks, [date]: stack.slice(0, -1) }, previous };
};

/**
 * The touch rule (approved): an EDITED row's day flags re-derived from the draft, as the server
 * derives them (R-06) — every other row keeps the server's own flags.
 *
 *   manned     a seat names a driver available on the day
 *   crewGaps   a gap closes once its seat holds an available driver (the server's crewCovered)
 *   stalePlan  stays only while a seat still names an unavailable driver
 */
export const reflagEdited = (
  rows: readonly FleetRosterRowDto[],
  unsavedIds: ReadonlySet<string>,
  availableIds: ReadonlySet<string>,
  unavailableIds: ReadonlySet<string>,
): FleetRosterRowDto[] => {
  const mans = (id: string | null): boolean => id !== null && availableIds.has(id);
  return rows.map((row) => {
    if (!unsavedIds.has(row.vehicleId)) return row;
    const seats = [row.driver1EmployeeId, row.driver2EmployeeId] as const;
    return {
      ...row,
      manned: seats.some(mans),
      crewGaps: (row.crewGaps ?? []).filter((gap) => !mans(seats[gap.seat - 1] ?? null)),
      stalePlan:
        row.stalePlan === true && seats.some((id) => id !== null && unavailableIds.has(id)),
    };
  });
};

// ── the model's shape ────────────────────────────────────────────────────────────────────────────

/** What the page shell reads off the URL and hands down. */
export interface RosterQuery {
  date: string;
  today: string;
  editable: boolean;
  mayPlan: boolean;
  /** The raw `?q=` — the comma list of picked car codes. */
  search: string;
  missions: readonly string[];
  view: RosterView | null;
  reasons: readonly string[];
  patch: (updates: Record<string, string | null>) => void;
}

/** A seat: which car, which of its two slots. */
export interface SeatTarget {
  vehicleId: string;
  slot: DutySlot;
}

/** One row of the driver lists (picker sheet, pool sheet, tablet panel, desktop panel). */
export interface DriverOption {
  employeeId: string;
  /** `free` — in the pool; `seated` — the DRAFT has him on a car (a pick MOVES him). */
  state: 'free' | 'seated';
  /** The car the draft seats him on, when `seated` — said as a fact, never as a promise. */
  seatedCode: string | null;
  /** …and whether that car is the very one being filled (shown, never pickable). */
  onTarget: boolean;
  /** R-02 on the day (flag mode: still plannable, listed under «منهم رخصة منتهية»). */
  licenceExpired: boolean;
}

export interface DriverOptions {
  free: DriverOption[];
  flagged: DriverOption[];
  seated: DriverOption[];
}

/** One counter chip: tap = `query.patch(counter.apply)`. */
export interface RosterCounter {
  key: string;
  label: string;
  value: number;
  tone: string;
  active: boolean;
  apply: Record<string, string | null>;
}

/** An active mission type, as the touch sheets and the counters name it. */
export interface MissionOption {
  id: string;
  label: string;
  tone: string;
  /** Cars the day shows on this mission. */
  count: number;
}

/** The licence block's two checks — each opens ITS screen, so each wears that screen's guard. */
export interface LicenceLinks {
  drivers: string | null;
  vehicles: string | null;
  vehiclesCount: number;
}

export interface LicenceBlock {
  /** Every flagged driver of the day, seated or not. */
  count: number;
  links: LicenceLinks;
}

/** The pen dialog's four facts (`RosterAssignDialog` hands them back). */
export interface AssignValues {
  missionTypeId: string | null;
  driver1EmployeeId: string | null;
  driver2EmployeeId: string | null;
  notes: string | null;
}

export interface RosterActions {
  /** Drop, picker, tap: `assignDriver` (another car = move, own other seat = swap). */
  assign(target: SeatTarget, employeeId: string): void;
  /** One seat (seat 1 cleared → seat 2 promoted). */
  clear(vehicleId: string, slot: DutySlot): void;
  swap(vehicleId: string): void;
  /** «إلغاء التعيين»: both seats in one write, then the mission and the note. */
  clearAll(vehicleId: string): void;
  /** No-op on a car the workshop holds (FR-5). */
  mission(vehicleId: string, missionTypeId: string | null): void;
  /** The note only, the other three facts as they are; '' → null. */
  notes(vehicleId: string, notes: string): void;
  /** The pen dialog: ONE undo step. */
  apply(vehicleId: string, values: AssignValues): void;
  undo(): void;
  /** «إلغاء»: the draft AND the day's undo stack. */
  discard(): void;
  /** «حفظ» — toasts itself; true when the day was stored. */
  save(): Promise<boolean>;
  /** The rows the board shows, in its order. */
  exportSheet(rows: readonly FleetRosterRowDto[]): void;
}

export type RosterDriver = FleetRosterDayDto['availableDrivers'][number];
export type UnavailableDriver = FleetRosterDayDto['unavailableDrivers'][number];

export interface RosterBoardModel {
  /** Only THIS date's board — undefined while it loads, even when another day is cached. */
  board: FleetRosterDayDto | undefined;
  status: { loading: boolean; error: unknown; retry: () => void };
  saved: FleetRosterRowDto[];
  draft: FleetRosterRowDto[];
  /** What the day shows: the draft (a past day: the server's board); touch re-flags edited rows. */
  shown: FleetRosterRowDto[];
  /** `shown` narrowed by `q`, the missions and the view — in the day's order, NOT sorted. */
  visible: FleetRosterRowDto[];
  /** The picked codes of `?q=`. */
  codes: string[];
  /** Every car of the day, as the code filter's options. */
  codeOptions: MultiSelectOption[];
  /** `q`, a mission, a view or a reason narrows something. */
  filtered: boolean;
  counters: RosterCounter[];
  missionOptions: MissionOption[];
  missionName: (id: string | null) => string;
  changed: DutyPayloadRow[];
  unsavedIds: ReadonlySet<string>;
  pending: DutyPayloadRow[];
  /** A save would write something (an edit, or a projected operation). */
  dirty: boolean;
  /** The reader edited something («إلغاء» has work to throw away). */
  edited: boolean;
  undoDepth: number;
  saving: boolean;
  pool: RosterDriver[];
  poolLicensed: RosterDriver[];
  flagged: RosterDriver[];
  expired: ReadonlySet<string>;
  expiredVehicles: FleetRosterRowDto[];
  licence: LicenceBlock | null;
  dayHasDrivers: boolean;
  /** employeeId → the code of the car the draft seats him on. */
  seatedOn: ReadonlyMap<string, string>;
  unavailable: UnavailableDriver[];
  unavailableReason: ReadonlyMap<string, string>;
  subtotals: { reason: string; count: number }[];
  chips: { reason: string; count: number }[];
  searchIndex: ReadonlyMap<string, DriverSearchRecord>;
  person: (employeeId: string) => FleetPersonDto | undefined;
  /** The board's own name for a driver: `fullNameAr`, else the id's tail; '' for nobody. */
  driverName: (employeeId: string | null) => string;
  reasonLabel: (reason: string) => string;
  codeOf: (vehicleId: string) => string;
  /** The car a save would MOVE him off («سيُنقل من السيارة …»), or null. */
  transferFrom: (employeeId: string, vehicleId: string) => string | null;
  availableFor: (term: string, target: SeatTarget | null) => DriverOptions;
  unavailableFor: (term: string, reasons: readonly string[]) => UnavailableDriver[];
  actions: RosterActions;
}

export interface RosterBoardProps {
  m: RosterBoardModel;
  query: RosterQuery;
  resetFilters: () => void;
}

export interface RosterDeskBoardProps extends RosterBoardProps {
  rows: FleetRosterRowDto[];
  sort: TableSort[];
  onSortChange: (key: string) => void;
}

export interface RosterTouchBoardProps extends RosterBoardProps {
  layout: TouchLayout;
  short: boolean;
}

// ── the hook ─────────────────────────────────────────────────────────────────────────────────────

export const useRosterBoard = (
  query: RosterQuery,
  { liveFlags }: { liveFlags: boolean },
): RosterBoardModel => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { date, editable, mayPlan, search, missions, view, reasons } = query;
  /** The lists as ONE value each, so the memos below are not invalidated by a fresh array. */
  const missionsKey = missions.join(',');
  const reasonsKey = reasons.join(',');

  const boardQuery = useRosterDay(date);
  /**
   * The board, ONLY if it is this day's board. The response carries the day it describes, so the
   * model checks rather than trusts: everything below reads `board`, so one check covers the
   * cards, the table, the counters, the pool, the draft and what «حفظ» sends.
   */
  const board = boardQuery.data?.date.slice(0, 10) === date ? boardQuery.data : undefined;
  // The BASELINE: the day as the server derived it — what «إلغاء» returns to and what the save
  // measures against.
  const saved = useMemo(() => board?.rows ?? [], [board]);

  // The draft, keyed by the DATE, so one day's edits never greet another day.
  const {
    draft,
    setDraft,
    discard,
    accept: acceptDraft,
  } = useDraftBoard(rosterDraftKey(date), saved, ROSTER_EDITABLE_FIELDS);
  // `setDraft` folds over the draft of the LAST render; two edits in one tap must fold over each
  // other. So the newest rows are kept here together with the draft they were made from, and are
  // used only while that is still the draft in hand: once React renders them — or the server's
  // answer resets the draft — the draft itself is the newer one.
  const inFlight = useRef<{ from: FleetRosterRowDto[]; rows: FleetRosterRowDto[] } | null>(null);
  const latest = (): FleetRosterRowDto[] =>
    inFlight.current !== null && inFlight.current.from === draft ? inFlight.current.rows : draft;
  // Undo: one stack per day, in memory — a reload keeps the draft, not its history.
  const [undoStacks, setUndoStacks] = useState<UndoStacks>({});
  const undoDepth = editable ? (undoStacks[date]?.length ?? 0) : 0;

  // What a save would WRITE: edits, plus any operation still only projected from the fixed crew.
  const pending = useMemo(() => rowsToSave(saved, draft), [saved, draft]);
  const dirty = pending.length > 0;
  // What «إلغاء» would throw away — the reader's own edits.
  const edited = useMemo(() => hasEdits(saved, draft), [saved, draft]);
  const changed = useMemo(() => changedRows(saved, draft), [saved, draft]);
  // The cars the reader changed and has not saved — `changedRows`, never `pending`, so a row whose
  // operation is only projected is not tinted as an edit nobody made.
  const unsavedIds = useMemo(
    () => new Set(changedRows(saved, draft).map((row) => row.vehicleId)),
    [saved, draft],
  );

  const plan = usePlanRoster();
  const missionTypes = useFleetCatalog('missionType');
  const missionName = (id: string | null): string => {
    if (id === null) return '—';
    const item = missionTypes.data?.items.find((entry) => entry.id === id);
    return item === undefined ? '—' : localized(item.name, locale);
  };

  const availableIds = useMemo(
    () => new Set((board?.availableDrivers ?? []).map((driver) => driver.employeeId)),
    [board],
  );
  const unavailableIds = useMemo(
    () => new Set((board?.unavailableDrivers ?? []).map((driver) => driver.employeeId)),
    [board],
  );
  /** A past day shows the SERVER's board, never a draft that outlived midnight. */
  const plain = editable ? draft : saved;
  const shown = useMemo(
    () =>
      liveFlags && editable ? reflagEdited(plain, unsavedIds, availableIds, unavailableIds) : plain,
    [liveFlags, editable, plain, unsavedIds, availableIds, unavailableIds],
  );
  // DISPLAY ONLY: the draft, the counters, the pool and the payload read the whole day.
  const visible = useMemo(
    () => visibleRows(shown, { term: search, missions, view }),
    [shown, search, missionsKey, view],
  );
  const codes = useMemo(
    () =>
      search
        .split(',')
        .map((code) => code.trim())
        .filter((code) => code !== ''),
    [search],
  );
  /** Every car the board reports on, as the picker's options — no request for what is on screen. */
  const codeOptions = useMemo(
    () => shown.map((row) => ({ value: row.code, label: row.code })),
    [shown],
  );
  const filtered = search !== '' || missions.length > 0 || view !== null || reasons.length > 0;
  const codeByVehicle = useMemo(
    () => new Map(shown.map((row) => [row.vehicleId, row.code])),
    [shown],
  );
  const codeOf = (vehicleId: string): string => codeByVehicle.get(vehicleId) ?? '';
  const missionOptions = useMemo(
    (): MissionOption[] =>
      (missionTypes.data?.items ?? [])
        .filter((item) => item.isActive)
        .map((item) => ({
          id: item.id,
          label: localized(item.name, locale),
          tone: missionTone(item.id),
          count: shown.filter((row) => row.missionTypeId === item.id).length,
        })),
    [missionTypes.data, locale, shown],
  );

  /**
   * The day's tally, counted off what the day SHOWS — the whole day, never the narrowed list.
   * «إجمالي» clears the mission and the view, the state chips set a view, and one chip per ACTIVE
   * mission type (named by the catalog) toggles that mission in `?mission=`.
   */
  const counters = useMemo((): RosterCounter[] => {
    const byMission = new Map<string, number>();
    for (const row of shown) {
      if (row.missionTypeId === null) continue;
      byMission.set(row.missionTypeId, (byMission.get(row.missionTypeId) ?? 0) + 1);
    }
    return [
      {
        key: 'total',
        label: t('fleet.roster.counter.total'),
        value: shown.length,
        tone: COUNTER_TONES.total,
        apply: { mission: null, view: null },
        active: missions.length === 0 && view === null,
      },
      {
        key: 'workshop',
        label: t('fleet.roster.counter.workshop'),
        value: shown.filter((row) => row.inMaintenance).length,
        tone: COUNTER_TONES.workshop,
        apply: { view: 'workshop' },
        active: view === 'workshop',
      },
      {
        key: 'assigned',
        label: t('fleet.roster.counter.assigned'),
        value: shown.filter(carriesPlan).length,
        tone: COUNTER_TONES.assigned,
        apply: { view: 'assigned' },
        active: view === 'assigned',
      },
      {
        key: 'ready',
        label: t('fleet.roster.counter.ready'),
        value: shown.filter(isReady).length,
        tone: COUNTER_TONES.ready,
        apply: { view: 'ready' },
        active: view === 'ready',
      },
      {
        key: 'unmanned',
        label: t('fleet.roster.counter.unmanned'),
        value: shown.filter(isUnmanned).length,
        tone: COUNTER_TONES.unmanned,
        apply: { view: 'unmanned' },
        active: view === 'unmanned',
      },
      {
        key: 'crewGap',
        label: t('fleet.roster.counter.crewGap'),
        value: shown.filter(hasCrewGap).length,
        tone: COUNTER_TONES.crewGap,
        apply: { view: 'crewGap' },
        active: view === 'crewGap',
      },
      ...(missionTypes.data?.items ?? [])
        .filter((item) => item.isActive)
        .map((item) => ({
          key: item.id,
          label: localized(item.name, locale),
          value: byMission.get(item.id) ?? 0,
          tone: missionTone(item.id),
          apply: { mission: writeList(toggleValue(missions, item.id)) },
          active: missions.includes(item.id),
        })),
    ];
  }, [shown, missionTypes.data, locale, t, missionsKey, view]);

  // The pool is DERIVED from the draft: everyone the draft seats leaves it the moment the edit
  // lands, and comes back the moment a seat is cleared — no round trip in between.
  const pool = useMemo(
    () => availableDrivers(board?.availableDrivers ?? [], shown),
    [board, shown],
  );
  const unavailable = useMemo(() => board?.unavailableDrivers ?? [], [board]);
  // Both halves indexed together — and the seated drivers too, whose names the seats, the
  // licence block and the Excel file print. Same query keys the names already render from.
  const records = useEmployeeRecords(
    useMemo(
      () => [
        ...pool.map((driver) => driver.employeeId),
        ...unavailable.map((driver) => driver.employeeId),
        ...shown.flatMap((row) =>
          [row.driver1EmployeeId, row.driver2EmployeeId].filter((id): id is string => id !== null),
        ),
      ],
      [pool, unavailable, shown],
    ),
  );
  const searchIndex = useMemo(() => {
    const index = new Map<string, DriverSearchRecord>();
    for (const [employeeId, person] of records) {
      index.set(employeeId, {
        employeeId,
        nameAr: person.fullNameAr,
        // Fleet's roster carries ONE name and ONE code — the two a search here is typed with.
        nameEn: null,
        code: person.code,
        employeeNumber: null,
      });
    }
    return index;
  }, [records]);
  const person = useCallback(
    (employeeId: string): FleetPersonDto | undefined => records.get(employeeId),
    [records],
  );
  const driverName = (employeeId: string | null): string => {
    if (employeeId === null) return '';
    // The id's tail is the stand-in every name on this screen falls back to (no `fleetDriver.view`,
    // or not landed yet) — a seat that is taken must not read as empty.
    return records.get(employeeId)?.fullNameAr ?? employeeId.slice(-8);
  };

  // ── the licence flag (R-04, Q-01) ────────────────────────────────────────────────────────────
  // A driver whose licence has expired is not counted «available today»: the list and its count
  // leave him out, and «منهم رخصة منتهية N» lists every such driver of the day, seated or not. While
  // the rule only flags he stays in `pool`, so the pickers and the drag rules still offer him.
  const expired = useMemo(() => expiredLicenceIds(board), [board]);
  const poolLicensed = useMemo(() => withoutExpiredLicence(pool, expired), [pool, expired]);
  const flagged = useMemo(
    () => (board?.availableDrivers ?? []).filter((driver) => driver.licence === 'expired'),
    [board],
  );
  /** The vehicles whose licence expired on the day — the other half of the owner's list. */
  const expiredVehicles = useMemo(
    () => saved.filter((row) => row.licenceExpired === true),
    [saved],
  );
  /** Where the draft seats each driver, so a flagged driver already on a car says which. */
  const seatedOn = useMemo(() => {
    const at = new Map<string, string>();
    for (const row of shown) {
      for (const id of [row.driver1EmployeeId, row.driver2EmployeeId]) {
        if (id !== null) at.set(id, row.code);
      }
    }
    return at;
  }, [shown]);
  const licenceCheck =
    board?.licenceRule !== 'refuse' && (flagged.length > 0 || expiredVehicles.length > 0);
  const checkLinks = licenceCheckLinks(date);
  const licence: LicenceBlock | null = licenceCheck
    ? {
        count: flagged.length,
        // Each check opens ITS screen, so each is offered only with that screen's own guard.
        links: {
          drivers: can('fleetDriver.view') ? checkLinks.drivers : null,
          vehicles: can('fleetVehicle.view') ? checkLinks.vehicles : null,
          vehiclesCount: expiredVehicles.length,
        },
      }
    : null;

  // ── the unavailable half ─────────────────────────────────────────────────────────────────────
  /** Why a seated driver is out today — the seat says it. */
  const unavailableReason = useMemo(
    () => new Map(unavailable.map((driver) => [driver.employeeId, driver.reason])),
    [unavailable],
  );
  const subtotals = useMemo(() => reasonSubtotals(unavailable), [unavailable]);
  // …and a pressed chip (0) for a reason asked for that nobody has today, so it can be taken off.
  const chips = useMemo(() => reasonChips(subtotals, reasons), [subtotals, reasonsKey]);
  const reasonLabel = (reason: string): string =>
    KNOWN_REASONS.has(reason) ? t(`fleet.roster.reason.${reason}`) : reason;

  // ── the lists ────────────────────────────────────────────────────────────────────────────────
  /**
   * «سيُنقل من السيارة {{code}} عند الحفظ» — the ONE place a move is promised: where the SERVER has
   * him today, if that is another car than the one the draft now puts him on.
   */
  const transferFrom = useCallback(
    (employeeId: string, vehicleId: string): string | null => {
      if (!editable) return null;
      const was = findSeat(saved, employeeId);
      if (was === null || was.vehicleId === vehicleId) return null;
      return saved.find((row) => row.vehicleId === was.vehicleId)?.code ?? null;
    },
    [editable, saved],
  );

  /**
   * The AVAILABLE list for a pick, searched by name or code:
   *   free     the pool, licensed («السائقون المتاحون (n)»)
   *   flagged  EVERY flagged driver of the day, seated or not («منهم رخصة منتهية»)
   *   seated   when there is a seat to fill: the other available drivers the draft seats on
   *            ANOTHER car, as the assign dialog lists `board.availableDrivers`
   * The target car's own crew is left out of `seated`: a swap is the card's own button.
   */
  const availableFor = useCallback(
    (term: string, target: SeatTarget | null): DriverOptions => {
      const searched = filterDrivers(board?.availableDrivers ?? [], searchIndex, term);
      const inPool = new Set(pool.map((driver) => driver.employeeId));
      const option = (employeeId: string): DriverOption => {
        const seat = findSeat(shown, employeeId);
        return {
          employeeId,
          state: seat === null ? 'free' : 'seated',
          seatedCode: seat === null ? null : (codeByVehicle.get(seat.vehicleId) ?? null),
          onTarget: seat !== null && target !== null && seat.vehicleId === target.vehicleId,
          licenceExpired: expired.has(employeeId),
        };
      };
      const free = searched.filter(
        (driver) => inPool.has(driver.employeeId) && !expired.has(driver.employeeId),
      );
      const flaggedShown = searched.filter((driver) => expired.has(driver.employeeId));
      const seated =
        target === null
          ? []
          : searched.filter((driver) => {
              if (inPool.has(driver.employeeId) || expired.has(driver.employeeId)) return false;
              const seat = findSeat(shown, driver.employeeId);
              return seat !== null && seat.vehicleId !== target.vehicleId;
            });
      return {
        free: free.map((driver) => option(driver.employeeId)),
        flagged: flaggedShown.map((driver) => option(driver.employeeId)),
        seated: seated.map((driver) => option(driver.employeeId)),
      };
    },
    [board, searchIndex, pool, shown, codeByVehicle, expired],
  );

  /** The UNAVAILABLE list, searched by its own term and narrowed to the reasons asked for. */
  const unavailableFor = useCallback(
    (term: string, asked: readonly string[]): UnavailableDriver[] =>
      byReasons(filterDrivers(unavailable, searchIndex, term), asked),
    [unavailable, searchIndex],
  );

  // ── the edits: each one a real board function on the draft ──────────────────────────────────
  const edit = useCallback(
    (change: (rows: readonly FleetRosterRowDto[]) => FleetRosterRowDto[]): void => {
      if (!mayPlan) return;
      const before = latest();
      const after = change(before);
      // An edit that changes no fact — a drop on the seat already held, a car the workshop holds,
      // a note or a dialog saved as it was — is not a step: nothing to undo, nothing to write.
      if (changedRows(before, after).length === 0) return;
      inFlight.current = { from: draft, rows: after };
      setUndoStacks((all) => pushUndo(all, date, before));
      setDraft(() => after);
    },
    [mayPlan, date, draft, setDraft],
  );

  const assign = (target: SeatTarget, employeeId: string): void =>
    edit((rows) => assignDriver(rows, target.vehicleId, target.slot, employeeId));
  const clear = (vehicleId: string, slot: DutySlot): void =>
    edit((rows) => clearSlot(rows, vehicleId, slot));
  const swap = (vehicleId: string): void => edit((rows) => swapDrivers(rows, vehicleId));
  const mission = (vehicleId: string, missionTypeId: string | null): void =>
    edit((rows) => {
      const row = rows.find((candidate) => candidate.vehicleId === vehicleId);
      // A car the workshop holds takes no mission (FR-5) — the guard the select's `disabled` keeps.
      if (row === undefined || row.inMaintenance) return [...rows];
      return setMission(rows, vehicleId, missionTypeId);
    });
  const notes = (vehicleId: string, text: string): void =>
    edit((rows) => {
      const row = rows.find((candidate) => candidate.vehicleId === vehicleId);
      if (row === undefined) return [...rows];
      return applyEdit(rows, vehicleId, {
        missionTypeId: row.missionTypeId,
        driver1EmployeeId: row.driver1EmployeeId,
        driver2EmployeeId: row.driver2EmployeeId,
        // '' is not a note — the contract refuses it, as RosterAssignDialog says.
        notes: text.trim() === '' ? null : text.trim(),
      });
    });
  /**
   * The pen dialog's four facts as ONE edit — one «تراجع» step — through `applyEdit`, so a driver
   * picked from another car MOVES, exactly as a drag would.
   */
  const apply = (vehicleId: string, values: AssignValues): void =>
    edit((rows) =>
      applyEdit(rows, vehicleId, {
        ...values,
        notes: values.notes === null || values.notes.trim() === '' ? null : values.notes.trim(),
      }),
    );
  /** «تراجع» — the draft as it was before the last edit. */
  const undo = (): void => {
    const { previous } = popUndo(undoStacks, date);
    if (previous === undefined) return;
    inFlight.current = { from: draft, rows: previous };
    setUndoStacks((all) => popUndo(all, date).stacks);
    setDraft(() => previous);
  };
  const discardEdits = (): void => {
    setUndoStacks((all) => ({ ...all, [date]: [] }));
    discard();
  };

  /**
   * «حفظ»: the day's `pending` rows through the EXISTING plan mutation. Saved — the draft becomes
   * the server's board and the day's undo stack goes. Refused — the toast names why and the draft
   * stays, so nothing the reader did is lost.
   */
  const commit = async (): Promise<boolean> => {
    if (!dirty) return false;
    if (!mayPlan) return false;
    try {
      await plan.mutateAsync({ dateKey: date, body: { date: new Date(date), rows: pending } });
      acceptDraft();
      // A save the server folds away — a row of nulls for a car with no stored plan is nothing, so
      // the day projects it again — answers with the very board it held, and the query cache keeps
      // that board's identity. The draft, tied to the board by identity, would outlive the save
      // («تغييرات غير محفوظة» still up). So the save drops it in memory too: the server's answer IS
      // the day now.
      discard();
      setUndoStacks((all) => ({ ...all, [date]: [] }));
      toast.success(t('fleet.roster.saved'));
      return true;
    } catch (error) {
      // The hook's own `onError` opts the mutation OUT of the global error toast — said here.
      toast.error(errorMessage(error, locale));
      return false;
    }
  };

  /**
   * BOTH SEATS IN ONE WRITE, then the rest of the row. Clearing seat 1 alone promotes seat 2, which
   * is right for one seat's ✕ and wrong here — «بتمسح واحد واحد بس».
   */
  const confirmClear = (vehicleId: string): void =>
    edit((rows) =>
      applyEdit(clearCrew(rows, vehicleId), vehicleId, {
        missionTypeId: null,
        driver1EmployeeId: null,
        driver2EmployeeId: null,
        notes: null,
      }),
    );

  /**
   * «للشاشات دى اعملى اكسلات هتاخد اللى الفلتر عامله بس · ومفيش امضاءات» — the rows the board
   * shows (the draft on a plannable day), seven columns, the file named after the DAY the roster
   * is for. A hand-typed date that does not parse names the file after today instead.
   */
  const exportSheet = (rows: readonly FleetRosterRowDto[]): void => {
    const day = new Date(`${date}T00:00:00Z`);
    saveSheet(
      {
        name: t('fleet.nav.roster'),
        serialHeader: t('fleet.violations.report.serial'),
        header: [
          t('fleet.odometer.columns.vehicle'),
          t('fleet.vehicles.inWorkshop'),
          t('fleet.roster.assigned'),
          t('fleet.roster.fields.mission'),
          t('fleet.odometer.fields.driver1'),
          t('fleet.odometer.fields.driver2'),
          t('fleet.attendance.fields.notes'),
        ],
        rows: rows.map((row) => [
          row.code,
          row.inMaintenance ? t('common.yes') : t('common.no'),
          // `hasDriver`, exactly as the badge asks it — a mission with nobody on it is not an
          // assignment.
          hasDriver(row) ? t('common.yes') : t('common.no'),
          // Empty stays EMPTY: a dash in a sheet is a value nobody can filter on.
          row.missionTypeId === null ? '' : missionName(row.missionTypeId),
          driverName(row.driver1EmployeeId),
          driverName(row.driver2EmployeeId),
          row.notes ?? '',
        ]),
      },
      sheetDay(Number.isNaN(day.getTime()) ? new Date() : day),
    );
  };

  const actions: RosterActions = {
    assign,
    clear,
    swap,
    clearAll: confirmClear,
    mission,
    notes,
    apply,
    undo,
    discard: discardEdits,
    save: commit,
    exportSheet,
  };

  return {
    board,
    status: {
      // Still waiting for THIS date while another date's answer is in hand counts as loading.
      loading: boardQuery.isPending || (board === undefined && !boardQuery.isError),
      error: boardQuery.isError ? boardQuery.error : undefined,
      retry: () => void boardQuery.refetch(),
    },
    saved,
    draft,
    shown,
    visible,
    codes,
    codeOptions,
    filtered,
    counters,
    missionOptions,
    missionName,
    changed,
    unsavedIds,
    pending,
    dirty,
    edited,
    undoDepth,
    saving: plan.isPending,
    pool,
    poolLicensed,
    flagged,
    expired,
    expiredVehicles,
    licence,
    dayHasDrivers: (board?.availableDrivers.length ?? 0) > 0,
    seatedOn,
    unavailable,
    unavailableReason,
    subtotals,
    chips,
    searchIndex,
    person,
    driverName,
    reasonLabel,
    codeOf,
    transferFrom,
    availableFor,
    unavailableFor,
    actions,
  };
};
