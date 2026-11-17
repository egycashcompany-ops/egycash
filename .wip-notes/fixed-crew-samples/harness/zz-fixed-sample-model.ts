// ── DESIGN SAMPLE — NEVER COMMIT (apps/web/src/zz-* is in .git/info/exclude) ────────────────────
// «الطقم الثابت» in the design of «تعيين السيارات»: the standing board as ONE model both layouts draw
// (the computer's table and the phone / tablet cards), in the shape of the daily `useRosterBoard`
// — so the daily's real parts can be laid over it — with the STANDING crew's own rules:
//
//   · no day anywhere: the draft key is the real `FIXED_ROSTER_DRAFT_KEY`, the real `useDraftBoard`;
//   · every edit is the REAL fixed rule (`lib/fixed-roster-board`: assignDriver, clearSlot,
//     clearCrew, applyEdit, availableDrivers, changedRows, findSeat) — the workshop never locks;
//   · the counters are the fixed page's own (إجمالي · صيانة · بطقم · بلا طقم · one per mission),
//     counted off the DRAFT; the filters are `visibleFixedRows` / `readFixedView`;
//   · the pool is ONE company-wide list: server drivers minus everyone the draft seats;
//   · «حفظ» goes through the real `useSaveFixedRoster`, toast «تم حفظ الطقم الثابت», and a refusal
//     keeps the draft (the fixed page's own `commit`).
//
// What the daily model adds and a standing crew has a meaning for: an undo stack («تراجع», at most
// 50 steps, in memory), the move promised on the seat («سيُنقل من السيارة … عند الحفظ», read off the
// SAVED board), and the drivers the draft seats on OTHER cars, for the touch picker.
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  type FleetFixedCrewRowDto,
  type FleetFixedRosterDto,
  type FleetPersonDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from './platform/localization/useT';
import { useAppSelector } from './store';
import { toast } from './shared/ui/toast/toast-store';
import { errorMessage, validationDetails } from './shared/lib/errors';
import { localized } from './shared/lib/format';
import { toggleValue, writeList } from './shared/lib/list-param';
import { type MultiSelectOption } from './shared/ui/MultiSelect';
import {
  useFixedRoster,
  useFleetCatalog,
  useSaveFixedRoster,
} from './modules/fleet/api/fleet-queries';
import { useEmployeeRecords } from './modules/fleet/components/EmployeeName';
import { saveSheet } from './modules/fleet/lib/fleet-sheet';
import { filterDrivers, type DriverSearchRecord } from './modules/fleet/lib/driver-search';
import { FIXED_ROSTER_DRAFT_KEY, ROSTER_EDITABLE_FIELDS } from './modules/fleet/lib/draft-storage';
import { useDraftBoard } from './modules/fleet/lib/useDraftBoard';
import {
  applyEdit,
  assignDriver,
  availableDrivers,
  changedRows,
  clearCrew,
  clearSlot,
  findSeat,
  type CrewSlot,
  type FixedCrewPayloadRow,
} from './modules/fleet/lib/fixed-roster-board';
import {
  COUNTER_TONES,
  hasDriver,
  missionTone,
  visibleFixedRows,
  type FixedRosterView,
} from './modules/fleet/lib/roster-view';
import {
  type MissionOption,
  type RosterCounter,
  type SeatTarget,
} from './modules/fleet/lib/roster-board';

/** The one sentence the sample adds (gap map §7, the only NEW word): the pool is empty. */
export const POOL_EMPTY = 'لا يوجد سائقون بلا طقم ثابت';

/** What the page shell reads off the URL and hands down — the daily `RosterQuery` without a day. */
export interface FixedQuery {
  mayPlan: boolean;
  /** The raw `?q=` — the comma list of picked car codes. */
  search: string;
  missions: readonly string[];
  view: FixedRosterView | null;
  patch: (updates: Record<string, string | null>) => void;
}

/** One row of the driver lists: free (in the pool) or seated by the draft on another car. */
export interface FixedDriverOption {
  employeeId: string;
  state: 'free' | 'seated';
  /** The car the draft seats him on, when seated. */
  seatedCode: string | null;
  /** «سيارة أخرى»: his standing car is not on this board (another branch, or not active). */
  heldElsewhere: boolean;
}

export interface FixedActions {
  assign(target: SeatTarget, employeeId: string): void;
  clear(vehicleId: string, slot: CrewSlot): void;
  /** «تبديل السائق الأول والثاني» — the fixed rule's swap within a car (`assignDriver`). */
  swap(vehicleId: string): void;
  /** «إفراغ الطقم» — both seats in one write; the mission and the note stay. */
  clearCrew(vehicleId: string): void;
  mission(vehicleId: string, missionTypeId: string | null): void;
  /** The note only; '' → null. */
  notes(vehicleId: string, notes: string): void;
  /** The «تعديل» dialog's four facts — ONE undo step. */
  apply(vehicleId: string, values: EditValues): void;
  undo(): void;
  discard(): void;
  save(): Promise<boolean>;
  exportSheet(rows: readonly FleetFixedCrewRowDto[]): void;
}

export interface EditValues {
  missionTypeId: string | null;
  driver1EmployeeId: string | null;
  driver2EmployeeId: string | null;
  notes: string | null;
}

export interface FixedModel {
  board: FleetFixedRosterDto | undefined;
  status: { loading: boolean; error: unknown; retry: () => void };
  saved: FleetFixedCrewRowDto[];
  draft: FleetFixedCrewRowDto[];
  /** The draft narrowed by `q`, the missions and the view — in the board's order. */
  visible: FleetFixedCrewRowDto[];
  codes: string[];
  codeOptions: MultiSelectOption[];
  filtered: boolean;
  counters: RosterCounter[];
  missionOptions: MissionOption[];
  missionName: (id: string | null) => string;
  missionTypes: ReturnType<typeof useFleetCatalog>;
  changed: FixedCrewPayloadRow[];
  unsavedIds: ReadonlySet<string>;
  dirty: boolean;
  undoDepth: number;
  saving: boolean;
  pool: FleetFixedRosterDto['drivers'];
  searchIndex: ReadonlyMap<string, DriverSearchRecord>;
  person: (employeeId: string) => FleetPersonDto | undefined;
  driverName: (employeeId: string | null) => string;
  codeOf: (vehicleId: string) => string;
  transferFrom: (employeeId: string, vehicleId: string) => string | null;
  /**
   * What a list row says about a driver: held off the board («سيارة أخرى») — and nothing else. No
   * flag for a standing member who can no longer drive (owner Q1 ب): that is the daily's.
   */
  driverFlags: (employeeId: string) => { held: boolean };
  /** The free pool, searched — and, for a seat being filled, the drivers on OTHER cars. */
  optionsFor: (
    term: string,
    target: SeatTarget | null,
  ) => {
    free: FixedDriverOption[];
    seated: FixedDriverOption[];
  };
  actions: FixedActions;
}

const UNDO_LIMIT = 50;

export const useFixedSample = (query: FixedQuery): FixedModel => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { mayPlan, search, missions, view } = query;
  const missionsKey = missions.join(',');

  const boardQuery = useFixedRoster();
  const board = boardQuery.data;
  const save = useSaveFixedRoster();
  const saved = useMemo(() => board?.rows ?? [], [board]);

  // The draft — no date in its key: «الطقم الثابت» is not a day.
  const { draft, setDraft, discard, accept } = useDraftBoard(
    FIXED_ROSTER_DRAFT_KEY,
    saved,
    ROSTER_EDITABLE_FIELDS,
  );
  const inFlight = useRef<{ from: FleetFixedCrewRowDto[]; rows: FleetFixedCrewRowDto[] } | null>(
    null,
  );
  const latest = (): FleetFixedCrewRowDto[] =>
    inFlight.current !== null && inFlight.current.from === draft ? inFlight.current.rows : draft;
  const [undo, setUndo] = useState<{
    base: readonly FleetFixedCrewRowDto[];
    steps: FleetFixedCrewRowDto[][];
  }>({
    base: [],
    steps: [],
  });
  const steps = undo.base === saved ? undo.steps : [];

  const changed = useMemo(() => changedRows(saved, draft), [saved, draft]);
  const dirty = changed.length > 0;
  const unsavedIds = useMemo(() => new Set(changed.map((row) => row.vehicleId)), [changed]);

  const missionTypes = useFleetCatalog('missionType');
  const missionName = (id: string | null): string => {
    if (id === null) return '—';
    const item = missionTypes.data?.items.find((entry) => entry.id === id);
    return item === undefined ? '—' : localized(item.name, locale);
  };

  const visible = useMemo(
    () => visibleFixedRows(draft, { term: search, missions, view }),
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
    () => draft.map((row) => ({ value: row.code, label: row.code })),
    [draft],
  );
  const filtered = search !== '' || missions.length > 0 || view !== null;
  const codeByVehicle = useMemo(
    () => new Map(draft.map((row) => [row.vehicleId, row.code])),
    [draft],
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
          count: draft.filter((row) => row.missionTypeId === item.id).length,
        })),
    [missionTypes.data, locale, draft],
  );

  /** The fixed page's tally (P:597-656), off the DRAFT — the whole board, never the filtered rows. */
  const counters = useMemo((): RosterCounter[] => {
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
        // The daily's hue for a car with nobody on it («بلا سائق»): rose stays the workshop's.
        tone: COUNTER_TONES.unmanned,
        apply: { view: 'uncrewed' },
        active: view === 'uncrewed',
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
  }, [draft, missionTypes.data, locale, t, missionsKey, view]);

  // The pool, DERIVED from the draft — the fixed board's rule.
  const pool = useMemo(() => availableDrivers(board?.drivers ?? [], draft), [board, draft]);
  const records = useEmployeeRecords(
    useMemo(
      () => [
        ...(board?.drivers ?? []).map((driver) => driver.employeeId),
        ...draft.flatMap((row) =>
          [row.driver1EmployeeId, row.driver2EmployeeId].filter((id): id is string => id !== null),
        ),
      ],
      [board, draft],
    ),
  );
  const searchIndex = useMemo(() => {
    const index = new Map<string, DriverSearchRecord>();
    for (const [employeeId, person] of records) {
      index.set(employeeId, {
        employeeId,
        nameAr: person.fullNameAr,
        nameEn: null,
        code: person.code,
        employeeNumber: null,
      });
    }
    return index;
  }, [records]);
  const person = useCallback((employeeId: string) => records.get(employeeId), [records]);
  const driverName = (employeeId: string | null): string =>
    employeeId === null ? '' : (records.get(employeeId)?.fullNameAr ?? employeeId.slice(-8));

  /** «سيُنقل من السيارة {{code}} عند الحفظ» — where the SAVED board holds him, if another car. */
  const transferFrom = useCallback(
    (employeeId: string, vehicleId: string): string | null => {
      const was = findSeat(saved, employeeId);
      if (was === null || was.vehicleId === vehicleId) return null;
      return saved.find((row) => row.vehicleId === was.vehicleId)?.code ?? null;
    },
    [saved],
  );

  const onBoard = useMemo(() => new Set(draft.map((row) => row.vehicleId)), [draft]);
  const heldOn = useMemo(
    () =>
      new Map(
        (board?.drivers ?? []).map((driver) => [driver.employeeId, driver.assignedVehicleId]),
      ),
    [board],
  );
  const driverFlags = useCallback(
    (employeeId: string) => {
      const holder = heldOn.get(employeeId) ?? null;
      return {
        held: findSeat(draft, employeeId) === null && holder !== null && !onBoard.has(holder),
      };
    },
    [heldOn, draft, onBoard],
  );
  const optionsFor = useCallback(
    (term: string, target: SeatTarget | null) => {
      const all = board?.drivers ?? [];
      const inPool = new Set(pool.map((driver) => driver.employeeId));
      const option = (driver: (typeof all)[number]): FixedDriverOption => {
        const seat = findSeat(draft, driver.employeeId);
        return {
          employeeId: driver.employeeId,
          state: seat === null ? 'free' : 'seated',
          seatedCode: seat === null ? null : (codeByVehicle.get(seat.vehicleId) ?? null),
          heldElsewhere:
            seat === null &&
            driver.assignedVehicleId !== null &&
            !onBoard.has(driver.assignedVehicleId),
        };
      };
      const searched = filterDrivers(all, searchIndex, term);
      const free = searched.filter((driver) => inPool.has(driver.employeeId)).map(option);
      const seated =
        target === null
          ? []
          : searched
              .filter((driver) => {
                if (inPool.has(driver.employeeId)) return false;
                const seat = findSeat(draft, driver.employeeId);
                return seat !== null && seat.vehicleId !== target.vehicleId;
              })
              .map(option);
      return { free, seated };
    },
    [board, pool, draft, searchIndex, codeByVehicle, onBoard],
  );

  // ── the edits: each a REAL fixed rule on the draft, one undo step each ───────────────────────
  const edit = (
    change: (rows: readonly FleetFixedCrewRowDto[]) => FleetFixedCrewRowDto[],
  ): void => {
    if (!mayPlan) return;
    const before = latest();
    const after = change(before);
    // An edit that changes no fact is not a step.
    if (changedRows(before, after).length === 0) return;
    inFlight.current = { from: draft, rows: after };
    setUndo((was) => ({
      base: saved,
      steps: [...(was.base === saved ? was.steps : []), before].slice(-UNDO_LIMIT),
    }));
    setDraft(() => after);
  };
  const actions: FixedActions = {
    assign: (target, employeeId) =>
      edit((rows) => assignDriver(rows, target.vehicleId, target.slot, employeeId)),
    clear: (vehicleId, slot) => edit((rows) => clearSlot(rows, vehicleId, slot)),
    swap: (vehicleId) =>
      edit((rows) => {
        const row = rows.find((candidate) => candidate.vehicleId === vehicleId);
        if (row === undefined || row.driver2EmployeeId === null) return [...rows];
        return assignDriver(rows, vehicleId, 'driver1EmployeeId', row.driver2EmployeeId);
      }),
    clearCrew: (vehicleId) => edit((rows) => clearCrew(rows, vehicleId)),
    mission: (vehicleId, missionTypeId) =>
      edit((rows) => {
        const row = rows.find((candidate) => candidate.vehicleId === vehicleId);
        if (row === undefined) return [...rows];
        return applyEdit(rows, vehicleId, {
          missionTypeId,
          driver1EmployeeId: row.driver1EmployeeId,
          driver2EmployeeId: row.driver2EmployeeId,
          notes: row.notes,
        });
      }),
    notes: (vehicleId, text) =>
      edit((rows) => {
        const row = rows.find((candidate) => candidate.vehicleId === vehicleId);
        if (row === undefined) return [...rows];
        return applyEdit(rows, vehicleId, {
          missionTypeId: row.missionTypeId,
          driver1EmployeeId: row.driver1EmployeeId,
          driver2EmployeeId: row.driver2EmployeeId,
          notes: text.trim() === '' ? null : text.trim(),
        });
      }),
    apply: (vehicleId, values) => edit((rows) => applyEdit(rows, vehicleId, values)),
    undo: () => {
      const previous = steps[steps.length - 1];
      if (previous === undefined) return;
      inFlight.current = { from: draft, rows: previous };
      setUndo({ base: saved, steps: steps.slice(0, -1) });
      setDraft(() => previous);
    },
    discard: () => {
      setUndo({ base: saved, steps: [] });
      discard();
    },
    // The fixed page's own `commit`: success → the cache is replaced (the hook), the draft dropped,
    // the toast; a refusal → the draft STAYS, nothing re-read, the server's detail toasted.
    save: async () => {
      if (!dirty || !mayPlan) return false;
      try {
        await save.mutateAsync({ rows: changed });
        accept();
        discard();
        setUndo({ base: [], steps: [] });
        toast.success(t('fleet.fixedRoster.saved'));
        return true;
      } catch (error) {
        const detail = validationDetails(error).find((d) => d.message.trim() !== '');
        toast.error(
          detail === undefined
            ? errorMessage(error, locale)
            : detail.field === undefined || detail.field === ''
              ? detail.message
              : `${detail.message} (${detail.field})`,
        );
        return false;
      }
    },
    // The fixed file, unchanged: the rows on screen, eight columns, named after the screen.
    exportSheet: (rows) =>
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
          row.missionTypeId === null ? '' : missionName(row.missionTypeId),
          driverName(row.driver1EmployeeId),
          driverName(row.driver2EmployeeId),
          row.notes ?? '',
        ]),
      }),
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
    missionTypes,
    changed,
    unsavedIds,
    dirty,
    undoDepth: steps.length,
    saving: save.isPending,
    pool,
    searchIndex,
    person,
    driverName,
    codeOf,
    transferFrom,
    driverFlags,
    optionsFor,
    actions,
  };
};

/**
 * The URL filters that HIDE `row` — the daily `filtersHiding`, over the standing board's three
 * views: an edited car's code in the bar lifts only what hides it.
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
