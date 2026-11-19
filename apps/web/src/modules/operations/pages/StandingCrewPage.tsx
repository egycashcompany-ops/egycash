// The standing crew (الطاقم الثابت) — who normally crews each cash-transfer vehicle.
//
// NEW CAPABILITY, no legacy screen to port. Legacy's `/tashghela` rendered `t.leader || ""`
// (contad_app.js:2305-2311) and started empty every single morning, which is precisely why the
// whole crew had to be dragged again each day. This screen is the permanent answer, and the daily
// board is seeded from it («تحميل الطاقم الثابت» on «لوحة التشغيلة»).
//
// ROUND 27 — THE OWNER: «عاوزك تخلى شاشة الطاقم الثابت نفس شكل لوحة التشغيل بقى فاهم». The screen IS
// the board now, minus the day: the board's frame, toolbar and bar, its table of rows (السيارة | قائد
// الطاقم | أخصائي 1 | أخصائي 2 | الاتجاه | التوقيت | the bin), its slots and chips, its two pools on the
// side — every piece the board's own component (`CrewPlanFrame`, `CrewPlanSlot`, `CrewPlanChip`,
// `CrewPlanPool`, `CrewSlotPicker`, `CrewVehiclePicker`, the row controls), told by
// `CrewPlanScopeProvider` that it is on the standing crew. And the board's hands:
//   · THE DROP is Round 22's (`lib/crew-drag.ts`): who is dragged is kept in a ref from the chip's
//     own `dragstart`, the whole frame accepts our drag, and the drop decides where it landed
//     (`targetAt`, then `resolveDrop`) — a slot means that slot, anywhere else on a row the slot the
//     person's role takes, a pool frees him, a full slot is SAID. The old screen read the drag's
//     data in each dashed box's own `onDrop` — the pattern Round 22 took off the board;
//   · PRESS A SLOT — «+ اختيار قائد» / «+ اختيار أخصائي», and a «+» beside a half-full slot's ✕ —
//     for its list (`CrewSlotPicker`); or press a chip, then «ضع هنا»;
//   · THE PERSON'S CARD on every chip, on a hover;
//   · THE SLOT RULE (Round 23 — «ممنوع ان اعين قائد مكان اخصائى والعكس الا فى حالة انه قائد اخصائى»):
//     every way of seating somebody asks `resolveDrop`, which refuses a slot his role does not fit,
//     in the board's words; a seat held from before the rule is ringed and worded, never removed;
//   · «تراجع» takes back ONE operation a press (`lib/crew-undo.ts`), and Ctrl+Z (⌘Z) outside a box;
//   · THE FILTERS — the vehicle's code, a person's name or code, the direction — view only;
//   · «إزالة» of a vehicle is the board's bin, a step of the draft («تراجع» takes it back); and
//     «إضافة سيارة» opens the board's list of cars (Round 24's `CrewVehiclePicker`) on the vehicles
//     that may still join, where the old screen had a bare <select>.
//
// WHAT STAYS THIS LIST'S OWN:
//   · NO DAY — that absence IS the entity. Where the board has «يوم التشغيلة», the bar says «بلا يوم»
//     and that each day's board is loaded from here. No notes, no type, no row colour: each is a
//     fact about a day's crew.
//   · NO DAY'S MARKS. The directory answers who is absent or on leave, and which van holds whom, for
//     ONE day (the server's today, asked without one). A dateless list must not fade a man absent
//     today nor refuse him a standing seat — the server's save has no attendance gate, and the day's
//     board leaves him off when it loads this list (`standingForDay`). So the roster is read without
//     them (`standingMember`), and the person's card leaves out its attendance line, the van's card
//     its drivers (`crew-plan-scope`).
//   · ONE PERSON, ONE VEHICLE across the whole list (the server's end-state rule): a drop MOVES him,
//     as on the board, so the draft is always a list the server takes.
//   · A CAPTAIN MOVES WITH HIS CREW — this screen's rule since it was built («لما أنقل قائد طاقم على
//     سيارة جديدة يسحب الأخصائيين اللى معاه»): put in another vehicle's «قائد الطاقم», the specialists
//     riding with him follow where they fit and there is room (`placeWithCrew`).
//   · «حفظ (n)» sends the vehicles taken out (one DELETE each — removal is its own act on the server)
//     and then the changed rows in ONE PUT, whose body is `toStandingPayloadRows`' as before.
//
// The pools' searches and icon filters are remembered in the URL across visits, as they were.
import { useEffect, useMemo, useRef, useState, type DragEvent, type HTMLAttributes } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CREW_SLOT_CAPACITY,
  fitsCrewSlot,
  type Locale,
  type OperationsCrewMemberDto,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { cn } from '../../../shared/lib/cn';
import { formatNumber } from '../../../shared/lib/format';
import { pluralKey } from '../../../shared/lib/plural';
import { readList, writeList } from '../../../shared/lib/list-param';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Input } from '../../../shared/ui/form';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useAppSelector } from '../../../store';
import { useMinWidth } from '../../atm/lib/useMinWidth';
import { useUnsavedGuard } from '../../atm/lib/useUnsavedGuard';
import { BOARD_FRAME } from '../../fleet/components/board-scroll';
import { DesignCancel, DesignDialog, DesignSave } from '../../fleet/components/DesignDialog';
import { FILTER_ICON, FilterWithIcon } from '../../fleet/components/FilterWithIcon';
import { BoardIcon, NUM, PATH } from '../../fleet/components/FuelCardBoard';
import {
  useActiveOperationsAreaNames,
  useOperationsCrewDirectory,
  useOperationsStandingCrew,
  useRemoveOperationsStandingCrew,
  useSetOperationsStandingCrew,
} from '../api/operations-queries';
import {
  addLandsOn,
  useArchivedOperationsAreaNames,
  useDirectionAreaAdd,
} from '../api/direction-area';
import { CrewVehicleHoverCode } from '../components/BoardCrewCards';
import { DirectionPicker, TimePicker } from '../components/CrewPlanControls';
import {
  COUNT_CHIP,
  CREW_PLAN_BAR,
  CREW_PLAN_CELLS,
  CREW_PLAN_GRID,
  CREW_PLAN_POOL_HEIGHT,
  CREW_PLAN_POOLS,
  CREW_PLAN_TABLE,
  CREW_PLAN_TABLE_SIDE,
  CrewPlanHand,
  FilteredCount,
  PlainDot,
  ReturnPickedButton,
  countChipTone,
  targetAt,
  unknownMember,
} from '../components/CrewPlanFrame';
import { CrewPlanPool } from '../components/CrewPlanPools';
import { CrewPlanSlot } from '../components/CrewPlanSlot';
import { CrewRosterNotice } from '../components/CrewRosterNotice';
import { CrewSlotPicker } from '../components/CrewSlotPicker';
import { CrewVehiclePicker } from '../components/CrewVehiclePicker';
import { PLAN_ICON } from '../components/crew-plan-icons';
import { CrewPlanScopeProvider } from '../components/crew-plan-scope';
import { ADD_BUTTON, BRAND_BUTTON } from '../components/ShipmentsBoard';
import { SHIPMENT_PATH } from '../components/shipment-icons';
import { ON_TINT } from '../components/shift-type-look';
import {
  CREW_SLOTS,
  PLAN_FLAGS,
  PLAN_POOLS,
  crewRoleOf,
  crewShortfall,
  discardRow,
  freeMember,
  isCrewClash,
  listPool,
  patchRow,
  planRefusal,
  planRowCard,
  seatOf,
  wrongSlotOf,
  type CrewRole,
  type CrewSlot,
  type PlanFlag,
  type PlanPool,
  type PlanPoolQuery,
  type PlanRefusal,
  type PlanRow,
} from '../lib/crew-plan';
import {
  CREW_DRAG_TYPE,
  acceptsDragOver,
  beginDrag,
  droppedMember,
  parseTargetKey,
  refusedAsAway,
  refusedAsWrongSlot,
  resolveDrop,
  targetKey,
  type DropDecision,
  type DropTarget,
  type RefusedDrop,
} from '../lib/crew-drag';
import { standingCrewSheet } from '../lib/crew-plan-export';
import {
  EMPTY_ROW_FILTER,
  NO_DIRECTION,
  directionFilterOptions,
  isRowFiltering,
  matchesRowFilter,
  vanFilterOptions,
  type PlanRowFilter,
} from '../lib/crew-plan-filter';
import {
  changedRowKeys,
  mergeKeyOf,
  rebaseHistory,
  record,
  sameCrewDraft,
  sealHistory,
  startHistory,
  undo,
  undoableStep,
  type CrewDraft,
  type UndoHistory,
  type UndoWhat,
} from '../lib/crew-undo';
import { type VehicleChoice } from '../lib/crew-vehicles';
import { saveReportWorkbook } from '../lib/report-export';
import { cairoToday } from '../lib/shipment-history';
import {
  STANDING_CREW_STATES,
  newStandingPlanRow,
  placeWithCrew,
  rebaseStandingDraft,
  removedBeforeStop,
  sendStandingSave,
  standingCounts,
  standingCrewState,
  standingEditsLost,
  standingMember,
  standingPutRows,
  standingSave,
  standingVehicleChoices,
  toStandingPlanRows,
  type StandingCrewState,
} from '../lib/standing-crew';

/**
 * Each pool's search and icon filters, in the URL and remembered across visits — one pair of
 * params per pool, because the two pools narrow independently: `cq`/`cflags` for the captains,
 * `sq`/`sflags` for the specialists. Written out LITERALLY below rather than looked up from a
 * table: `remembered-filters-coverage.spec.ts` finds a page's params by matching their literal
 * names where they are read and patched, and a lookup hid all four from it — a param dropped from
 * this list would then have stopped being remembered with every test still green.
 */
const REMEMBERED_FILTERS = ['cq', 'cflags', 'sq', 'sflags'] as const;

/** A pool's icon filters as the URL keeps them — only the icons a pool filters by. */
const asFlags = (values: readonly string[]): PlanFlag[] =>
  values.filter((value): value is PlanFlag => (PLAN_FLAGS as readonly string[]).includes(value));

/** A crew state's dot in the bar — the board's colours for full, short (its ⚠) and empty. */
const STATE_DOT: Record<StandingCrewState, string> = {
  complete: 'bg-emerald-500',
  short: 'bg-amber-500',
  empty: 'bg-slate-400',
};

/** The table: the board's (`CREW_PLAN_TABLE`), its cells' sides and tops after. */
const STANDING_TABLE = cn(CREW_PLAN_TABLE, CREW_PLAN_CELLS);

export const StandingCrewPage = (): JSX.Element => (
  <CrewPlanScopeProvider value="standing">
    <StandingCrewBoard />
  </CrewPlanScopeProvider>
);

const StandingCrewBoard = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const canPlan = can('operationsCrew.plan');

  const standing = useOperationsStandingCrew();
  // The pool is the Operations roster. The date it is asked for decides only the day's facts —
  // `availability` and `assignedVehicleId` — which this screen leaves out (`standingMember`).
  const directory = useOperationsCrewDirectory(null);
  // EVERY active area — the direction box offers the board's list.
  const areaNames = useActiveOperationsAreaNames();
  const putStanding = useSetOperationsStandingCrew();
  const removeStanding = useRemoveOperationsStandingCrew();
  const [saving, setSaving] = useState(false);

  const serverRows = useMemo(() => toStandingPlanRows(standing.data?.rows), [standing.data]);

  // ── The draft ────────────────────────────────────────────────────────────────────────────────
  // The server's list is the truth; the draft starts from it and keeps its history, so «تراجع»
  // takes back ONE operation a press (`lib/crew-undo.ts`). A NEW answer — another desk's save, a
  // reconnect, this screen's own save read back — is REBASED under the unsaved work (the board's
  // `rebaseDraft`, through `rebaseStandingDraft`): a row the planner did not touch takes the answer,
  // one he changed keeps his version, a vehicle he took out stays out, and one new on the server is
  // added. A vehicle taken out ON THE SERVER is never brought back — not even one he had changed:
  // the standing PUT upserts by vehicle, and would put it and its crew back in the fleet (Round 27
  // review). Its dropped edit is SAID (`standingEditsLost`), once, after the render.
  const [history, setHistory] = useState<UndoHistory<CrewDraft>>(() =>
    startHistory({ rows: serverRows, standingKeys: null }),
  );
  const rows = history.now.rows;
  const [seen, setSeen] = useState<readonly PlanRow[]>(serverRows);
  const [lostOnServer, setLostOnServer] = useState<readonly string[]>([]);
  if (seen !== serverRows) {
    setSeen(serverRows);
    const base = seen;
    const lost = standingEditsLost(history.now.rows, base, serverRows);
    if (lost.length > 0) {
      setLostOnServer(lost.map((row) => row.vehicleCode ?? row.vehicleId ?? '…'));
    }
    setHistory((current) =>
      rebaseHistory(
        current,
        (state) => ({ ...state, rows: rebaseStandingDraft(state.rows, base, serverRows) }),
        sameCrewDraft,
      ),
    );
  }

  /** ONE operation on the draft: the change, and what «تراجع» will say it takes back. */
  const applyRows = (
    what: UndoWhat,
    change: (current: readonly PlanRow[]) => readonly PlanRow[],
    merge?: string,
  ): void =>
    setHistory((current) =>
      record(
        current,
        { ...current.now, rows: change(current.now.rows) },
        what,
        merge === undefined ? { same: sameCrewDraft } : { same: sameCrewDraft, merge },
      ),
    );

  const pending = standingSave(rows, serverRows);
  const dirty = pending.count > 0;
  const guard = useUnsavedGuard({ dirty });
  /** A list of vehicle codes or names, in the reader's language. */
  const listed = (items: readonly string[]): string => items.join(locale === 'ar' ? '، ' : ', ');

  // A vehicle another desk took out while this one held an unsaved change of it: the change is gone
  // with the vehicle — said, never dropped without a word.
  useEffect(() => {
    if (lostOnServer.length === 0) return;
    toast.warning(
      t('operations.standingCrew.goneOnServer.title', { codes: listed(lostOnServer) }),
      t('operations.standingCrew.goneOnServer.body'),
    );
    setLostOnServer([]);
    // Only a new list of vehicles is a new thing to say: the words are read when it is said.
  }, [lostOnServer]);

  /** The last save's refusal (Round 23: a person in a slot not his role's) — on his row, ringed. */
  const [refusal, setRefusal] = useState<(PlanRefusal & { message: string }) | null>(null);
  /** The save named this person: moving him, or taking him off, answers it. */
  const settleRefusedPerson = (employeeId: string): void =>
    setRefusal((current) => (current?.person?.employeeId === employeeId ? null : current));

  // ── The people ───────────────────────────────────────────────────────────────────────────────
  const members = useMemo(
    () => (directory.data?.members ?? []).map(standingMember),
    [directory.data],
  );
  const byId = useMemo(() => new Map(members.map((m) => [m.employeeId, m])), [members]);
  const memberOf = (employeeId: string): OperationsCrewMemberDto | undefined =>
    byId.get(employeeId);
  const shownMember = (employeeId: string): OperationsCrewMemberDto =>
    byId.get(employeeId) ?? unknownMember(employeeId, t('operations.crewPlan.unknownPerson'));
  const rosterReady = !directory.isPending && !directory.isError;
  const roleOf = (employeeId: string): CrewRole =>
    crewRoleOf(memberOf(employeeId)?.requirements ?? null);
  /** May this person take this slot (Round 23)? Nobody on the roster, or nobody ticked, is a specialist. */
  const fits = (employeeId: string, slot: CrewSlot): boolean =>
    fitsCrewSlot(roleOf(employeeId), slot);

  const directions = useMemo(
    () => [...(areaNames.data ?? [])].sort((a, b) => a.localeCompare(b, 'ar')),
    [areaNames.data],
  );

  // ── The view: the pools' searches (remembered), the table's filters ────────────────────────────
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const queries: Record<PlanPool, PlanPoolQuery> = {
    captains: { search: sp.get('cq') ?? '', flags: asFlags(readList(sp, 'cflags')) },
    specialists: { search: sp.get('sq') ?? '', flags: asFlags(readList(sp, 'sflags')) },
  };
  // Replaces rather than pushes: narrowing a pool is a view of this list, not a place to go Back to.
  const patchParams = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [name, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(name);
      else next.set(name, value);
    }
    setSp(next, { replace: true });
  };
  const setQuery = (pool: PlanPool, next: PlanPoolQuery): void =>
    pool === 'captains'
      ? patchParams({ cq: next.search, cflags: writeList(next.flags) })
      : patchParams({ sq: next.search, sflags: writeList(next.flags) });

  const [rowFilter, setRowFilter] = useState<PlanRowFilter>(EMPTY_ROW_FILTER);
  const [stateFilter, setStateFilter] = useState<StandingCrewState | null>(null);
  const filtering = isRowFiltering(rowFilter) || stateFilter !== null;
  const shown = rows.filter(
    (row) =>
      (stateFilter === null || standingCrewState(row) === stateFilter) &&
      matchesRowFilter(row, rowFilter, { memberOf, areaNames: directions }),
  );
  const clearFilters = (): void => {
    setRowFilter(EMPTY_ROW_FILTER);
    setStateFilter(null);
  };
  const counts = standingCounts(rows);
  const rowName = (row: PlanRow): string => row.vehicleCode ?? '…';
  const nameOfRow = (key: string): string => {
    const row = rows.find((candidate) => candidate.key === key);
    return row === undefined ? '—' : rowName(row);
  };

  // ── Picking up, dragging, dropping — the board's hands (Round 22) ───────────────────────────────
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const dragRef = useRef<string | null>(null);
  const overRef = useRef<string | null>(null);
  const drawnRef = useRef(false);
  const dragTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (selected === null) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSelected(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected]);
  if (selected !== null && !byId.has(selected) && seatOf(rows, selected) === null)
    setSelected(null);

  /** Where somebody sits: the vehicle on the pool's chip, the vehicle and the slot in its card. */
  const placedAt = (employeeId: string): { short: string; long: string } | null => {
    const seat = seatOf(rows, employeeId);
    if (seat === null) return null;
    const short = nameOfRow(seat.key);
    return { short, long: `${short} · ${t(`operations.crewPlan.columns.${seat.slot}`)}` };
  };
  /** Somebody a drop may carry: on the roster, or seated (a stand-in the roster no longer names). */
  const onBoard = (employeeId: string): boolean =>
    byId.has(employeeId) || seatOf(rows, employeeId) !== null;
  /** What a drop — or a pick from a slot's list, or «ضع هنا» — does here: the board's one rule. */
  const decide = (target: DropTarget | null, employeeId: string): DropDecision | null =>
    target === null ? null : resolveDrop(rows, target, employeeId, roleOf(employeeId), null);
  /** A refused drop, SAID in the board's words: what is full, or (Round 23) whom the slot takes. */
  const sayRefusal = (decision: RefusedDrop, employeeId: string): void => {
    const vars = {
      slot: t(`operations.crewPlan.columns.${decision.slots[0] ?? 'captain'}`),
      row: nameOfRow(decision.key),
      name: shownMember(employeeId).fullNameAr,
    };
    toast.error(
      t(`operations.crewPlan.drop.${decision.reason}`, vars),
      t(
        refusedAsAway(decision.reason)
          ? 'operations.crewPlan.drop.awayWhy'
          : refusedAsWrongSlot(decision.reason)
            ? `operations.crewPlan.drop.${decision.reason}Why`
            : 'operations.crewPlan.drop.takeOff',
        vars,
      ),
    );
  };

  // ── A slot's list (Round 22 E) — one for the screen; a phone gets the bottom sheet ──────────────
  const phone = !useMinWidth(640);
  const [picker, setPicker] = useState<{ key: string; slot: CrewSlot } | null>(null);
  const pickerAnchor = useRef<HTMLElement | null>(null);
  const pickerTrigger = useRef<HTMLElement | null>(null);
  const [adding, setAdding] = useState(false);
  const addTrigger = useRef<HTMLElement | null>(null);
  const openPicker = (key: string, slot: CrewSlot, from: HTMLElement): void => {
    if (picker?.key === key && picker.slot === slot) {
      setPicker(null);
      return;
    }
    pickerAnchor.current = from.closest<HTMLElement>('[data-slot-zone]') ?? from;
    pickerTrigger.current = from;
    setSelected(null);
    setAdding(false);
    setPicker({ key, slot });
  };
  const backTo = (from: HTMLElement | null): void => {
    requestAnimationFrame(() => {
      if (from?.isConnected === true) from.focus({ preventScroll: true });
    });
  };
  const closePicker = (back: boolean): void => {
    setPicker(null);
    if (back) backTo(pickerTrigger.current);
  };
  const hasRoom = (key: string, slot: CrewSlot): boolean => {
    const row = rows.find((candidate) => candidate.key === key);
    return row !== undefined && row.slots[slot].length < CREW_SLOT_CAPACITY;
  };
  if (picker !== null && !hasRoom(picker.key, picker.slot)) setPicker(null);
  const pickInto = (employeeId: string): void => {
    if (picker === null) return;
    const { key, slot } = picker;
    const decision = decide({ kind: 'slot', key, slot }, employeeId);
    setPicker(null);
    if (decision?.kind === 'refuse') {
      sayRefusal(decision, employeeId);
      return;
    }
    if (decision?.kind !== 'place') return;
    place(key, slot, employeeId);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(
          `[data-slot-zone="${key}|${slot}"] [data-crew-chip="${employeeId}"] button`,
        )
        ?.focus({ preventScroll: true }),
    );
  };

  const settleDrag = (): void => {
    window.clearTimeout(dragTimer.current);
    dragRef.current = null;
    overRef.current = null;
    setDragging(null);
    setOver(null);
  };
  // The drag's data and who it is — no state: a re-render in `dragstart` cost a slow PC its drag.
  const startDrag = (employeeId: string, event: DragEvent<HTMLElement>): void => {
    beginDrag(event.dataTransfer, employeeId);
    window.clearTimeout(dragTimer.current);
    dragRef.current = employeeId;
    drawnRef.current = false;
  };
  // Drawn one task AFTER the first dragover was answered — the browser hears the page's «yes» first.
  const drawDrag = (employeeId: string): void => {
    if (drawnRef.current) return;
    drawnRef.current = true;
    dragTimer.current = window.setTimeout(() => {
      if (dragRef.current !== employeeId) return;
      setDragging(employeeId);
      setSelected(null);
      setPicker(null);
      setAdding(false);
    }, 0);
  };
  const endDrag = (): void => {
    if (dragRef.current !== null) settleDrag();
  };
  const endDragRef = useRef(endDrag);
  useEffect(() => {
    endDragRef.current = endDrag;
  });
  // A chip gone from the page mid-drag never delivers its `dragend`: a pointer moving with no button
  // held means the drag is over.
  useEffect(() => {
    const moved = (event: PointerEvent): void => {
      if (event.buttons === 0 && dragRef.current !== null) endDragRef.current();
    };
    window.addEventListener('pointermove', moved, { passive: true });
    return () => window.removeEventListener('pointermove', moved);
  }, []);

  /** THE WHOLE SCREEN IS ONE DROP TARGET for our drag; the drop decides where it landed. */
  const overDrag = (event: DragEvent<HTMLElement>): void => {
    const employeeId = dragRef.current;
    if (!acceptsDragOver(employeeId)) return;
    event.preventDefault();
    drawDrag(employeeId);
    const target = targetAt(event.target);
    const key = target === null ? null : targetKey(target);
    if (overRef.current !== key) {
      overRef.current = key;
      setOver(key);
    }
  };
  const frameDrop: Pick<
    HTMLAttributes<HTMLElement>,
    'onDragOver' | 'onDragEnter' | 'onDragLeave' | 'onDrop'
  > = canPlan
    ? {
        onDragEnter: overDrag,
        onDragOver: overDrag,
        onDragLeave: (event) => {
          if (dragRef.current === null) return;
          const to = event.relatedTarget;
          if (to instanceof Node && event.currentTarget.contains(to)) return;
          overRef.current = null;
          setOver(null);
        },
        onDrop: (event) => {
          const own = dragRef.current;
          const custom = event.dataTransfer.getData(CREW_DRAG_TYPE);
          // Not a drag of ours — a text dropped into a box: the browser's own drop.
          if (own === null && custom === '') return;
          event.preventDefault();
          const text = event.dataTransfer.getData('text/plain');
          const employeeId = droppedMember({ own, custom, text }, onBoard);
          const decision = employeeId === null ? null : decide(targetAt(event.target), employeeId);
          settleDrag();
          if (employeeId === null || decision === null) return;
          if (decision.kind === 'place') place(decision.key, decision.slot, employeeId);
          else if (decision.kind === 'free') free(employeeId);
          else if (decision.kind === 'refuse') sayRefusal(decision, employeeId);
        },
      }
    : {};
  const overTarget = over === null ? null : parseTargetKey(over);
  const overDecision = dragging === null ? null : decide(overTarget, dragging);

  // ── The operations ───────────────────────────────────────────────────────────────────────────
  /**
   * Seat somebody — the drop, a pick, «ضع هنا». A captain put in another vehicle's «قائد الطاقم»
   * brings his crew (`placeWithCrew`); «تراجع» then says so, and takes the whole move back at once.
   */
  const place = (key: string, slot: CrewSlot, employeeId: string): void => {
    const step = placeWithCrew(rows, key, slot, employeeId, fits);
    const where = `${nameOfRow(key)} · ${t(`operations.crewPlan.columns.${slot}`)}`;
    const name = shownMember(employeeId).fullNameAr;
    applyRows(
      step.companions.length > 0
        ? { kind: 'moveCrew', vars: { name, where } }
        : { kind: 'place', vars: { name, where } },
      (current) => placeWithCrew(current, key, slot, employeeId, fits).rows,
    );
    // His crew came with him — from a drop, a pick in a slot's list, or «ضع هنا»: SAID, by name. The
    // slot's list says only that picking him moves HIM, and his old vehicle is left without them.
    if (step.companions.length > 0) {
      toast.info(
        t('operations.standingCrew.movedWithCrew.title'),
        t('operations.standingCrew.movedWithCrew.body', {
          name,
          where,
          names: listed(step.companions.map((companion) => shownMember(companion).fullNameAr)),
        }),
      );
    }
    settleRefusedPerson(employeeId);
    setSelected(null);
  };
  const free = (employeeId: string): void => {
    applyRows({ kind: 'free', vars: { name: shownMember(employeeId).fullNameAr } }, (current) =>
      freeMember(current, employeeId),
    );
    settleRefusedPerson(employeeId);
    setSelected(null);
  };
  const patch = (
    key: string,
    fields: { direction: string | null } | { plannedTime: string | null },
  ) => {
    const kind = 'direction' in fields ? 'direction' : 'time';
    applyRows(
      { kind, vars: { row: nameOfRow(key) } },
      (current) => patchRow(current, key, fields),
      mergeKeyOf(kind, key),
    );
  };
  // Round 28c — the board's «إضافة «…» إلى القائمة», on the same box: for a planner who also holds
  // the catalog's own grant; the area written at once, the vehicle's direction one operation.
  const canAddArea = canPlan && can('operationsCatalog.manage');
  const archivedAreas = useArchivedOperationsAreaNames(canAddArea);
  // Round 28c critic — and lands only on the row as it was sent (gone, or its direction changed
  // meanwhile by another route: only added to the list, the toast says so). One board: one scope.
  const areaAdd = useDirectionAreaAdd('standing', (key, area, from) => {
    if (!addLandsOn(rows, key, from)) return false;
    patch(key, { direction: area });
    return true;
  });
  const addFor = (row: { key: string; direction: string | null }) =>
    canAddArea
      ? areaAdd.forRow(
          row.key,
          row.direction,
          areaNames.isSuccess && archivedAreas.isSuccess ? archivedAreas.data : null,
        )
      : undefined;
  const takeOut = (row: PlanRow): void => {
    applyRows({ kind: 'removeVehicle', vars: { code: rowName(row) } }, (current) =>
      discardRow(current, row.key),
    );
    setRefusal((current) => (current?.key === row.key ? null : current));
  };
  const selectChip = (employeeId: string): void => {
    setPicker(null);
    setSelected((current) => (current === employeeId ? null : employeeId));
  };

  // ── «إضافة سيارة» — the board's list of cars, on the vehicles that may still join ─────────────
  const choices = standingVehicleChoices(
    rows,
    serverRows,
    standing.data?.available ?? [],
    standing.data?.availableIsFiltered !== false,
  );
  const openAdding = (from: HTMLElement): void => {
    addTrigger.current = from;
    setSelected(null);
    setPicker(null);
    setAdding((open) => !open);
  };
  const closeAdding = (back: boolean): void => {
    setAdding(false);
    if (back) backTo(addTrigger.current);
  };
  const addVehicle = (choice: VehicleChoice): void => {
    const row = newStandingPlanRow(choice, serverRows);
    applyRows({ kind: 'addVehicle', vars: { code: choice.vehicleCode } }, (current) =>
      current.some((candidate) => candidate.vehicleId === choice.vehicleId)
        ? current
        : [...current, row],
    );
    // A new vehicle has nobody and no direction yet: every filter would hide it.
    clearFilters();
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-plan-row="${row.key}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    );
  };

  // ── «تراجع» — one operation a press (Round 24) ─────────────────────────────────────────────
  const lastOperation = undoableStep(history, saving);
  const undoWords =
    lastOperation === null
      ? null
      : t(`operations.standingCrew.undo.${lastOperation.what.kind}`, {
          ...lastOperation.what.vars,
        });
  const undoLast = (): void => {
    if (!canPlan || lastOperation === null || undoWords === null) return;
    const touched = changedRowKeys(rows, lastOperation.before.rows);
    setHistory(undo);
    setSelected(null);
    setPicker(null);
    setAdding(false);
    setRefusal((current) => (current !== null && touched.includes(current.key) ? null : current));
    toast.info(t('operations.crewPlan.undo.done', { what: undoWords }));
    const first = touched.find((key) => lastOperation.before.rows.some((row) => row.key === key));
    if (first !== undefined) {
      requestAnimationFrame(() =>
        document
          .querySelector(`[data-plan-row="${first}"]`)
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
      );
    }
  };
  // Ctrl+Z (⌘Z on a Mac) — the same press, outside a text box (a box keeps its own undo).
  const undoRef = useRef(undoLast);
  const leaveOpenRef = useRef(false);
  useEffect(() => {
    undoRef.current = undoLast;
    leaveOpenRef.current = guard.leaveOpen;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
      if (event.code !== 'KeyZ' && event.key.toLowerCase() !== 'z') return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest('input, textarea, select, [contenteditable="true"]') !== null)
      ) {
        return;
      }
      if (leaveOpenRef.current) return;
      event.preventDefault();
      undoRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // ── «حفظ (n)» ────────────────────────────────────────────────────────────────────────────────
  // The vehicles taken out FIRST — a person freed from one of them may sit on another vehicle in
  // the PUT, and the server checks one person, one vehicle against the whole list — then the
  // changed rows in one PUT (`sendStandingSave`). Each answer is read back and rebased under the
  // draft, so a failure half-way leaves exactly what is still to save. A vehicle another desk took
  // out first is done, not a failure: its DELETE re-read nothing, so the list is read here.
  // The page owns every failure (both hooks keep the global notifier quiet): ONE toast each.
  const save = async (): Promise<void> => {
    if (!dirty || saving) return;
    const { put, removeVehicleIds, count } = pending;
    // The rows the PUT is written from, in its order: a refusal names its row by its place there.
    const sent = standingPutRows(rows, serverRows);
    const codeOf = (vehicleId: string): string =>
      serverRows.find((row) => row.vehicleId === vehicleId)?.vehicleCode ?? vehicleId;
    setSaving(true);
    setRefusal(null);
    try {
      const outcome = await sendStandingSave(
        { removeVehicleIds, put },
        {
          remove: (vehicleId) => removeStanding.mutateAsync(vehicleId),
          put: () => putStanding.mutateAsync({ rows: put }),
        },
      );
      if (outcome.alreadyGone.length > 0) await standing.refetch();
      // The vehicles taken out before the save stopped ARE out — the re-read drops them from the
      // table and from «تراجع». Said beside the failure, or «تعذّر» reads as «nothing was saved».
      const out = removedBeforeStop({ removeVehicleIds }, outcome);
      const partly =
        out.length === 0
          ? null
          : t('operations.standingCrew.partlySaved', { codes: listed(out.map(codeOf)) });
      const withPartly = (line: string | null): string | undefined =>
        [line, partly].filter((part): part is string => part !== null).join(' ') || undefined;
      if (outcome.kind === 'removeFailed') {
        // The server's reason beside the vehicle.
        toast.error(
          t('operations.standingCrew.removeFailed'),
          withPartly(`${codeOf(outcome.vehicleId)} — ${errorMessage(outcome.failure, locale)}`),
        );
        return;
      }
      if (outcome.kind === 'putFailed') {
        const failure = outcome.failure;
        // Round 23: somebody newly in a slot not his role's (another desk changed his flags on
        // «متطلبات الطاقم» since the roster was read). The server names him and his row — by its
        // place in the PUT — and, as on the board, he is RINGED there, his row brought into view.
        const named =
          failure instanceof ApiError && failure.code === 'OPERATIONS_CREW_MEMBER_WRONG_SLOT'
            ? planRefusal(failure, sent)
            : null;
        if (named !== null && named.person !== undefined) {
          const message = t(`operations.crewPlan.refused.${named.person.reason}`, {
            name: shownMember(named.person.employeeId).fullNameAr,
          });
          setRefusal({ ...named, message });
          toast.error(errorMessage(failure, locale), withPartly(message));
          // A filter hiding the row it names would hide the answer: the filters go.
          if (!shown.some((row) => row.key === named.key)) clearFilters();
          requestAnimationFrame(() =>
            document
              .querySelector(`[data-plan-row="${named.key}"]`)
              ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
          );
          return;
        }
        // The list's own sentence ONLY for what it is about — one person on two vehicles, the
        // end-state 409 (`isCrewClash`, the board's test). Anything else — offline, a 500, a 404, a
        // vehicle the server does not know — in the failure's own words: never as a double booking
        // it is not, which would send the planner hunting for a duplicate that does not exist.
        toast.error(
          isCrewClash(failure)
            ? t('operations.standingCrew.saveFailed')
            : errorMessage(failure, locale),
          withPartly(null),
        );
        return;
      }
      setHistory((current) => startHistory(current.now));
      toast.success(
        t('operations.standingCrew.savedCount', { count: formatNumber(count, locale) }),
      );
    } finally {
      setSaving(false);
    }
  };

  const exportExcel = (): void =>
    saveReportWorkbook(
      t('operations.standingCrew.fileStem'),
      [standingCrewSheet(t, shown, memberOf)],
      // The day it was exported — the list itself has none.
      cairoToday(),
    );

  // ── The table ────────────────────────────────────────────────────────────────────────────────
  const shortText = (row: PlanRow): string | null => {
    const short = crewShortfall(row);
    if (short === null) return null;
    return [
      short.captains > 0 ? t('operations.crewPlan.short.captain') : null,
      short.specialists === 2
        ? t('operations.crewPlan.short.specialists2')
        : short.specialists === 1
          ? t('operations.crewPlan.short.specialists1')
          : null,
    ]
      .filter((part): part is string => part !== null)
      .join(' · ');
  };
  const columns: Column<PlanRow>[] = [
    {
      key: 'vehicle',
      header: t('operations.crewPlan.columns.vehicle'),
      render: (row) => {
        const short = shortText(row);
        const added = row.crewId === null;
        return (
          <div className="flex min-h-[2.25rem] items-center gap-1 px-0.5">
            <span className="flex flex-col items-start gap-0.5" data-van-code-stack="true">
              <CrewVehicleHoverCode
                className={cn(NUM, 'cursor-default text-[14px] font-black')}
                code={rowName(row)}
                vehicleCrew={planRowCard(row, memberOf)}
              />
              {/* Added here, not saved yet: its tag UNDER the code, as the board's «إضافية». */}
              {added && (
                <span
                  role="img"
                  data-standing-new="true"
                  aria-label={t('operations.standingCrew.newHint')}
                  title={t('operations.standingCrew.newHint')}
                  className="inline-flex h-4 shrink-0 items-center rounded border border-dashed border-sky-400 px-0.5 text-[9.5px] font-black leading-none text-sky-700 dark:border-sky-500/70 dark:text-sky-300"
                >
                  {t('operations.standingCrew.newTag')}
                </span>
              )}
            </span>
            {short !== null && (
              <span
                role="img"
                data-crew-short="true"
                aria-label={short}
                title={short}
                className={cn('inline-flex', ON_TINT.short.plain)}
              >
                <BoardIcon d={PATH.warn} className="h-4 w-4" />
              </span>
            )}
          </div>
        );
      },
    },
    ...CREW_SLOTS.map((slot): Column<PlanRow> => ({
      key: slot,
      header: t(`operations.crewPlan.columns.${slot}`),
      render: (row) => (
        <CrewPlanSlot
          rowKey={row.key}
          rowName={rowName(row)}
          slot={slot}
          seats={row.slots[slot].map((employeeId) => {
            const member = shownMember(employeeId);
            return {
              member,
              // A seat held outside his role (Round 23) — marked, never taken from him here. Not
              // for somebody the roster no longer names: his requirements cannot be read.
              wrong: byId.has(employeeId)
                ? wrongSlotOf(crewRoleOf(member.requirements), slot)
                : null,
              // The last save named him on this row (Round 23) — ringed, as on the board.
              refused: refusal?.key === row.key && refusal.person?.employeeId === employeeId,
              seatedAt: placedAt(employeeId)?.long ?? null,
            };
          })}
          canPlan={canPlan}
          selected={selected}
          dragging={dragging}
          overDecision={overDecision}
          decide={decide}
          listOpen={picker?.key === row.key && picker.slot === slot}
          // The board's empty slot on a coloured row: its «+ اختيار» on the page's own colour, in
          // slate-600 (7.6:1). A standing row has no colour, and the bare slate-400 is under AA.
          tinted
          onSelect={selectChip}
          onRemove={free}
          onOpenList={(from) => openPicker(row.key, slot, from)}
          onPlace={(employeeId) => place(row.key, slot, employeeId)}
          onDragStart={startDrag}
          onDragEnd={endDrag}
        />
      ),
    })),
    {
      key: 'direction',
      header: t('operations.crewPlan.columns.direction'),
      render: (row) => (
        // The board's width as its floor (`min-w-full`): its own column is wider here — 7 columns
        // share the table's width where the board has 9 — and the box fills it, not dead space.
        <div className="w-[7.5rem] min-w-full min-[1440px]:w-[8rem] min-[1750px]:w-[10rem]">
          <DirectionPicker
            rowKey={row.key}
            value={row.direction}
            options={directions}
            disabled={!canPlan}
            onChange={(direction) => patch(row.key, { direction })}
            add={addFor(row)}
          />
        </div>
      ),
    },
    {
      key: 'time',
      header: t('operations.crewPlan.columns.time'),
      render: (row) => (
        <TimePicker
          rowKey={row.key}
          value={row.plannedTime}
          disabled={!canPlan}
          onChange={(plannedTime) => patch(row.key, { plannedTime })}
          onSettle={() => setHistory(sealHistory)}
        />
      ),
    },
    // «إزالة» — the bin, for a planner only. A reader without the plan permission gets no column
    // at all: a header over empty cells is not the board, whose last column always holds something.
    ...(canPlan
      ? [
          {
            key: 'actions',
            header: t('operations.standingCrew.columns.actions'),
            render: (row: PlanRow) => {
              const label = t('operations.standingCrew.removeVehicle', { code: rowName(row) });
              return (
                <span className="flex h-8 items-center gap-1" data-row-actions-line="true">
                  <button
                    type="button"
                    data-row-discard={row.key}
                    aria-label={label}
                    title={label}
                    onClick={() => takeOut(row)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-rose-600 transition hover:border-rose-400 hover:bg-rose-50 dark:border-slate-700 dark:bg-[#0a1233] dark:text-rose-400 dark:hover:bg-rose-500/10"
                  >
                    <BoardIcon d={PATH.trash} className="h-4 w-4" />
                  </button>
                </span>
              );
            },
          } satisfies Column<PlanRow>,
        ]
      : []),
  ];

  // ── The page ─────────────────────────────────────────────────────────────────────────────────
  const pickedName = selected === null ? null : shownMember(selected).fullNameAr;
  const selectedSeated = selected !== null && seatOf(rows, selected) !== null;
  const stateChip = (
    state: StandingCrewState | null,
    label: string,
    count: number,
    dot: JSX.Element,
  ): JSX.Element => {
    const on = stateFilter === state;
    return (
      <button
        key={state ?? 'all'}
        type="button"
        data-standing-count={state ?? 'all'}
        aria-pressed={on}
        onClick={() => setStateFilter(on || state === null ? null : state)}
        className={cn(COUNT_CHIP, countChipTone(on, count))}
      >
        {dot}
        {label}
        <span className={cn(NUM, 'text-[12.5px] font-black text-slate-900 dark:text-white')}>
          {formatNumber(count, locale)}
        </span>
      </button>
    );
  };

  return (
    <PageContainer fullHeight>
      <div className={BOARD_FRAME} data-crew-plan="true" data-standing-crew="true" {...frameDrop}>
        {/* The toolbar: what the hands do at the start; the acts at the end — the board's. */}
        <div
          className="flex flex-wrap items-center justify-between gap-2"
          data-crew-plan-toolbar="true"
        >
          <CrewPlanHand
            pickedName={pickedName}
            onCancel={() => setSelected(null)}
            hint={
              canPlan ? t('operations.standingCrew.hint') : t('operations.standingCrew.viewOnly')
            }
          />
          <span className="ms-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1 sm:gap-2">
            {/* Where this list goes: each day's board loads it («الطاقم الثابت» there). */}
            <Link
              to="/operations/crew-board"
              data-standing-to-board="true"
              title={t('operations.standingCrew.toBoardHint')}
              className={BRAND_BUTTON}
            >
              <BoardIcon d={PLAN_ICON.layers} className="h-3.5 w-3.5" />
              {t('operations.standingCrew.toBoard')}
            </Link>
            {canPlan && (
              <button
                type="button"
                data-standing-add="true"
                aria-haspopup="dialog"
                aria-expanded={adding}
                onClick={(event) => openAdding(event.currentTarget)}
                className={BRAND_BUTTON}
              >
                <BoardIcon d={PATH.plus} className="h-3.5 w-3.5" width={2.5} />
                {t('operations.standingCrew.addVehicle')}
              </button>
            )}
            <button
              type="button"
              data-crew-plan-excel="true"
              disabled={rows.length === 0}
              onClick={exportExcel}
              className={cn(BRAND_BUTTON, 'disabled:cursor-not-allowed disabled:opacity-50')}
            >
              <BoardIcon
                d={PATH.excel}
                className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
              />
              Excel
            </button>
            {canPlan && (
              <button
                type="button"
                data-crew-plan-discard="true"
                data-crew-plan-undo={String(history.past.length)}
                disabled={lastOperation === null}
                title={
                  undoWords === null
                    ? t('operations.crewPlan.undo.none')
                    : t('operations.crewPlan.undo.title', { what: undoWords })
                }
                aria-label={
                  undoWords === null
                    ? t('operations.crewPlan.undo.none')
                    : t('operations.crewPlan.undo.title', { what: undoWords })
                }
                aria-keyshortcuts="Control+Z Meta+Z"
                onClick={undoLast}
                className={cn(BRAND_BUTTON, 'disabled:cursor-not-allowed disabled:opacity-50')}
              >
                <BoardIcon d={SHIPMENT_PATH.undo} className="h-3.5 w-3.5" />
                {t('operations.crewPlan.discard')}
              </button>
            )}
            {canPlan && (
              <button
                type="button"
                data-crew-plan-save={String(pending.count)}
                disabled={!dirty || saving}
                aria-busy={saving}
                onClick={() => void save()}
                className={cn(
                  dirty ? ADD_BUTTON : BRAND_BUTTON,
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                {saving ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : (
                  <BoardIcon d={SHIPMENT_PATH.check} className="h-3.5 w-3.5" width={2.5} />
                )}
                {dirty
                  ? t('operations.crewPlan.saveCount', {
                      count: formatNumber(pending.count, locale),
                    })
                  : t('common.save')}
              </button>
            )}
          </span>
        </div>

        {/* The bar: where the board has its day, this list says it has none; then the vehicle, the
            person and the direction, and the counters of the crews. */}
        <div className={CREW_PLAN_BAR} data-crew-plan-bar="true">
          <span
            data-standing-dayless="true"
            title={t('operations.standingCrew.daylessHint')}
            className="inline-flex h-9 w-full shrink-0 cursor-help items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2.5 text-[12px] font-bold text-slate-600 sm:w-auto dark:border-slate-700/80 dark:bg-[#080C14] dark:text-slate-300"
          >
            <BoardIcon
              d={PLAN_ICON.layers}
              className="h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-400"
            />
            {t('operations.standingCrew.dayless')}
          </span>
          <FilterWithIcon
            icon={FILTER_ICON.car}
            tone="text-emerald-600 dark:text-emerald-400"
            className="w-full shrink-0 sm:w-36"
          >
            <MultiSelect
              clearable
              fullWidth
              density="tight"
              showSelectedValues
              label={t('operations.crewPlan.filter.van')}
              options={vanFilterOptions(rows)}
              value={[...rowFilter.vans]}
              onChange={(next) => setRowFilter((current) => ({ ...current, vans: next }))}
            />
          </FilterWithIcon>
          <FilterWithIcon
            icon={FILTER_ICON.person}
            tone="text-sky-600 dark:text-sky-400"
            className="w-full shrink-0 sm:w-56"
          >
            <Input
              type="search"
              density="tight"
              data-filter-person="true"
              aria-label={t('operations.crewPlan.filter.person')}
              placeholder={t('operations.crewPlan.filter.personHint')}
              value={rowFilter.person}
              onChange={(event) =>
                setRowFilter((current) => ({ ...current, person: event.target.value }))
              }
            />
          </FilterWithIcon>
          <FilterWithIcon
            icon={SHIPMENT_PATH.route}
            tone="text-indigo-600 dark:text-indigo-300"
            className="w-full shrink-0 sm:w-40"
          >
            <MultiSelect
              clearable
              fullWidth
              density="tight"
              showSelectedValues
              label={t('operations.crewPlan.filter.direction')}
              options={[
                ...directionFilterOptions(rows, directions),
                { value: NO_DIRECTION, label: t('operations.crewPlan.filter.noDirection') },
              ]}
              value={[...rowFilter.directions]}
              onChange={(next) => setRowFilter((current) => ({ ...current, directions: next }))}
            />
          </FilterWithIcon>
          {filtering && (
            <FilteredCount shown={shown.length} total={rows.length} onClear={clearFilters} />
          )}
          <div
            role="group"
            aria-label={t('operations.standingCrew.counts')}
            title={t('operations.standingCrew.countsHint')}
            className="flex w-full min-w-0 flex-wrap items-center gap-1 sm:w-auto sm:flex-1"
            data-standing-counts="true"
          >
            {stateChip(
              null,
              t('operations.standingCrew.total'),
              counts.total,
              <PlainDot tone="bg-brand-500" />,
            )}
            {STANDING_CREW_STATES.map((state) =>
              stateChip(
                state,
                t(`operations.standingCrew.state.${state}`),
                counts[state],
                <PlainDot tone={STATE_DOT[state]} />,
              ),
            )}
          </div>
        </div>

        <CrewRosterNotice rosterIsDerived={directory.data?.rosterIsDerived} />
        {standing.data?.availableIsFiltered === false && canPlan && (
          // Said out loud: an unfiltered list of cars looks exactly like a correctly filtered one,
          // and the operator would otherwise never learn why a scrapped van is on offer.
          <p
            data-standing-unfiltered="true"
            className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-[12px] font-bold text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-100"
          >
            {t('operations.standingCrew.unfiltered')}
          </p>
        )}

        {/* The table at the START, the pools at the END — as the board; on a phone the pools first. */}
        <div className={CREW_PLAN_GRID} data-crew-plan-grid="true">
          <div className={CREW_PLAN_POOLS}>
            {PLAN_POOLS.map((pool) => {
              const listing = listPool(members, pool, rows, queries[pool]);
              return (
                <CrewPlanPool
                  key={pool}
                  pool={pool}
                  className={CREW_PLAN_POOL_HEIGHT}
                  listed={listing.listed}
                  total={listing.total}
                  free={listing.free}
                  ready={rosterReady}
                  query={queries[pool]}
                  onQueryChange={(next) => setQuery(pool, next)}
                  chips={{
                    selected,
                    dragging,
                    canPlan,
                    placedAt,
                    onSelect: selectChip,
                    onDragStart: startDrag,
                    onDragEnd: endDrag,
                  }}
                  drop={{
                    armed: canPlan && dragging !== null && seatOf(rows, dragging) !== null,
                    over:
                      overDecision?.kind === 'free' &&
                      overTarget?.kind === 'pool' &&
                      overTarget.pool === pool,
                  }}
                  returnSelected={
                    canPlan && selectedSeated && selected !== null ? (
                      <ReturnPickedButton
                        pool={pool}
                        name={pickedName ?? ''}
                        onReturn={() => free(selected)}
                      />
                    ) : null
                  }
                />
              );
            })}
          </div>

          <div className={CREW_PLAN_TABLE_SIDE}>
            <div className={STANDING_TABLE} data-crew-plan-table="true">
              <DataTable
                columns={columns}
                rows={shown as PlanRow[]}
                rowKey={(row) => row.key}
                loading={standing.isPending}
                error={standing.error}
                onRetry={() => void standing.refetch()}
                empty={
                  rows.length === 0 ? (
                    // Nobody has named a cash-transfer vehicle yet — the list is explicit.
                    <div className="py-6 text-center" data-standing-empty="true">
                      <p className="text-[14px] font-black text-slate-800 dark:text-slate-100">
                        {t('operations.standingCrew.empty')}
                      </p>
                      <p className="mt-1 text-[12px] font-bold text-slate-500 dark:text-slate-400">
                        {t('operations.standingCrew.emptyHint')}
                      </p>
                    </div>
                  ) : (
                    t('operations.standingCrew.noneShown')
                  )
                }
                rowProps={(row) =>
                  ({
                    'data-plan-row': row.key,
                    ...(row.crewId === null ? { 'data-standing-added': 'true' } : {}),
                    // The row the last save's refusal names, as the board marks its own.
                    ...(refusal?.key === row.key ? { 'data-row-refused': refusal.field } : {}),
                  }) as HTMLAttributes<HTMLTableRowElement>
                }
                stickyHead
                minColumnWidth={4}
              />
            </div>
          </div>
        </div>
      </div>

      {/* The slot's list — one for the screen, started afresh for each slot pressed. */}
      {picker !== null && (
        <CrewSlotPicker
          key={`${picker.key}|${picker.slot}`}
          target={picker}
          slotName={t(`operations.crewPlan.columns.${picker.slot}`)}
          rowName={nameOfRow(picker.key)}
          anchor={pickerAnchor}
          trigger={pickerTrigger}
          sheet={phone}
          members={members}
          rows={rows}
          ready={rosterReady}
          seatLabel={(employeeId) => placedAt(employeeId)?.long ?? null}
          onPick={pickInto}
          onClose={closePicker}
        />
      )}

      {/* «إضافة سيارة» — the board's list of cars, on the ones that may still join. */}
      {adding && (
        <CrewVehiclePicker
          rowKey="standing-add"
          rowName={t('operations.standingCrew.title')}
          anchor={addTrigger}
          trigger={addTrigger}
          sheet={phone}
          choices={choices}
          words={{
            title: t('operations.standingCrew.picker.title'),
            subtitle:
              standing.data?.availableIsFiltered === false
                ? t('operations.standingCrew.picker.unfiltered')
                : t('operations.standingCrew.picker.filtered'),
            none: t('operations.standingCrew.picker.none'),
            search: t('operations.standingCrew.picker.search'),
          }}
          onPick={(choice) => {
            closeAdding(false);
            addVehicle(choice);
          }}
          onClose={closeAdding}
        />
      )}

      {/* «تغييرات غير محفوظة» — a link in the menu, «لوحة التشغيلة», a reload. */}
      <DesignDialog
        open={guard.leaveOpen}
        onClose={guard.cancel}
        title={t('operations.crewPlan.leaveTitle')}
        icon={PATH.warn}
        width="lg"
        panelProps={{ 'data-crew-plan-leave': 'true' }}
        footer={
          <>
            <DesignSave onClick={guard.confirm} label={t('operations.crewPlan.leaveConfirm')} />
            <DesignCancel onClick={guard.cancel} label={t('operations.crewPlan.leaveStay')} />
          </>
        }
      >
        <p className="text-[15px] font-semibold leading-7 text-slate-700 dark:text-slate-200">
          {t(pluralKey('operations.standingCrew.leaveBody', locale, pending.count), {
            count: formatNumber(pending.count, locale),
          })}
        </p>
      </DesignDialog>
    </PageContainer>
  );
};
