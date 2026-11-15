// «لوحة التشغيلة» — the day's crews on the day's vans, rebuilt after the legacy board (Round 20).
//
// THE OWNER: «عاوز على حسب الحاجات اللى انا مسجلها فى متطلبات الطاقم يظهر جمب القائد او الاخصائى. اللى
// فى خانة القادة بس لونهم ازرق وفى الاخر دول اخصائيين … اقدر اوظفهم ك قائد او اخصائى. كل عربيه هيبقى
// عليه من 1 ل 2 قادة و من 2 ل 4 اخصائيين وطبعا كل دا دراج و دروب ولما اعمل هوفر على العربيه يظهر
// السواقيين اللى عليها و الاتجاه اقدر اكتب بس فى الاخر لازم اختار من الاتجاهات اللى موجوده … و التوقيت
// اعملى حاجه اختار منها زى التاريخ … وعاوز زرار يبقى فى كذا لون اقدر الون به الصف وعاوز اقدر اضيف صف
// ميكونش ليه عربيه واضيف كل البيانات برضو».
//
// THE SCREEN, in the boards' look (ShipmentsBoard's pieces — dark and light, RTL):
//   · the toolbar: what to do with the keyboard and where things stand; then the acts — the standing
//     crew, «إضافة صف بدون سيارة», «Excel», «تراجع», «حفظ (n)» (one batch, only with changes);
//   · the bar: the day, the type filter, and a chip per type counting the rows (the legacy strip:
//     إجمالي، يومي، احتياطي … and صيانة — the vans Fleet has in the workshop that day). The types are
//     «أنواع التشغيل» on the reference screen — «انا عاوز النوع يكون بيضاف من البيانات المرجعيه» — so
//     the filter, the strip and every row's list follow that catalog: its active types in its order;
//   · the TABLE: السيارة (the van's code opens the round-4 card — its drivers, its crew, its
//     direction) | قائد الطاقم | أخصائي 1 | أخصائي 2 — each a DROP TARGET of up to two | الاتجاه | التوقيت
//     | النوع | ملاحظات | the row's colour and its bin;
//   · the POOLS at the end — on the left in Arabic: القادة (green, and blue) and الأخصائيون (red).
//
// MOVING PEOPLE, three ways, one rule (`resolveDrop`, then `placeMember`):
//   · PRESS A SLOT (Round 22 E) — «وعاوز مكان عند العربيه زى الحركة كدا لما ادوس عليه يجيب قايمة الناس
//     اللى اختار منهم»: an empty slot says «+ اختيار قائد» / «+ اختيار أخصائي», a half-full one has a
//     «+» beside its chip's ✕; either opens the list to pick from (`CrewSlotPicker`), as Fleet's
//     «الحركة» seat opens its drivers. Seating somebody never depends on a drag;
//   · drag a chip onto a slot, or anywhere on a row — the vehicle's cell included — and it goes to
//     the slot its role takes; from a pool or from another row; a full slot refuses, in words; back
//     onto a pool frees it (Round 22, `lib/crew-drag.ts`);
//   · or press a CHIP, then «ضع هنا» in a slot — the person first, then where (Fleet's touch board
//     keeps both orders too). While a chip is picked up, a slot offers «ضع هنا» in place of its «+».
// Every move is a pure step in `lib/crew-plan.ts`; nothing is written until «حفظ».
//
// AWAY THAT DAY (Round 22 F) — «وعاوز لو القائد غايب يظهر تحت الكل بقى فى الاخر يبقى باللون الباهت
// ومقدرش احطه على العربيه و كذلك الاخصائيين»: HR's absent / on leave (`awayOf`) is listed last in his
// pool, pale, and cannot be dragged, picked up or picked; every slot refuses him, in words; the
// standing crew does not load him and a row holding him is given no van. Seated before HR recorded
// it, he stays — marked — until taken off, and the save passes (the server keeps a held seat).
//
// THE ROW'S BOXES LINE UP: «شكلها فى الشاشة تكون زى الساعة والملاحظات كله تحت بعض مفيش حاجه داخلة
// وحاجه خارجه». The direction, the time, the type and the notes are one box each, of one height and
// one look, filling their column — so each column is a straight line of boxes down the table.
//
// THE SAVE is one `PlanOperationsCrew` (`toPlan`): the changed rows, a saved row without a van by
// its id, and the saved ones deleted. A refusal that names a row (a type archived on another desk
// since it was picked, a direction that is not an area) is said AND marked on that row's box.
//
// `?date=` is the only thing in the URL: empty means TOMORROW, resolved by the server — crews are
// planned a day ahead (the legacy default).
import { useEffect, useMemo, useRef, useState, type DragEvent, type HTMLAttributes } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CREW_SLOT_CAPACITY, type Locale, type OperationsCrewMemberDto } from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { cn } from '../../../shared/lib/cn';
import { formatNumber } from '../../../shared/lib/format';
import { pluralKey } from '../../../shared/lib/plural';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useAppSelector } from '../../../store';
import { useMinWidth } from '../../atm/lib/useMinWidth';
import { useUnsavedGuard } from '../../atm/lib/useUnsavedGuard';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../../fleet/components/board-scroll';
import { pickOne } from '../../fleet/components/dark-filter-bar';
import { DesignCancel, DesignDialog, DesignSave } from '../../fleet/components/DesignDialog';
import { FilterWithIcon } from '../../fleet/components/FilterWithIcon';
import { BoardIcon, NUM, PATH } from '../../fleet/components/FuelCardBoard';
import {
  useActiveOperationsAreaNames,
  useOperationsCrewBoard,
  useOperationsCrewDirectory,
  useOperationsShiftTypes,
  useOperationsStandingCrew,
  usePlanOperationsCrew,
} from '../api/operations-queries';
import { CrewVehicleHoverCode } from '../components/BoardCrewCards';
import { CrewPlanChip, RoleLegend } from '../components/CrewPlanChip';
import {
  CELL_BOX,
  DirectionPicker,
  ROW_TINT,
  RowColourPicker,
  ShiftTypePicker,
  TimePicker,
  VanPicker,
} from '../components/CrewPlanControls';
import { CrewPlanPool } from '../components/CrewPlanPools';
import { CrewRosterNotice } from '../components/CrewRosterNotice';
import { CrewSlotPicker } from '../components/CrewSlotPicker';
import { PLAN_ICON } from '../components/crew-plan-icons';
import { DAY_BAR, DayBox } from '../components/SecuredDistributionParts';
import { ADD_BUTTON, BOARD_TABLE_LOOK, BRAND_BUTTON } from '../components/ShipmentsBoard';
import { SHIPMENT_PATH } from '../components/shipment-icons';
import { ShiftTypeDot, shiftTypeName } from '../components/shift-type-look';
import {
  CREW_SLOTS,
  EMPTY_POOL_QUERY,
  NO_SHIFT_TYPE,
  PLAN_POOLS,
  SHIFT_TYPE_LIST,
  attachVan,
  awayOf,
  changeCount,
  clearStandingFromPlan,
  crewRoleOf,
  crewShortfall,
  discardRow,
  freeMember,
  isBlankRow,
  isCrewClash,
  listPool,
  loadStandingIntoPlan,
  matchesShiftType,
  outOfRole,
  patchRow,
  placeMember,
  planChanges,
  planRefusal,
  planRowCard,
  rebaseDraft,
  rowPeople,
  seatOf,
  shiftTypeStrip,
  toPlan,
  toPlanRows,
  vansFree,
  vehiclelessRow,
  type CrewRole,
  type CrewSlot,
  type PlanRefusal,
  type PlanPool,
  type PlanPoolQuery,
  type PlanRow,
  type ShiftTypeFilter,
} from '../lib/crew-plan';
import {
  CREW_DRAG_TYPE,
  acceptsDragOver,
  beginDrag,
  droppedMember,
  parseTargetKey,
  refusedAsAway,
  resolveDrop,
  targetFromMarks,
  targetKey,
  type DropDecision,
  type DropTarget,
  type RefusedDrop,
} from '../lib/crew-drag';
import { crewPlanSheet } from '../lib/crew-plan-export';
import { saveReportWorkbook } from '../lib/report-export';

/** `?date=` empty means TOMORROW, resolved by the server — the legacy planning default. */
export const resolveCrewDate = (raw: string | null): string | null =>
  raw !== null && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;

/**
 * The boards' table, fitted to a row of controls:
 *   · the boards size every button in a cell as a 28px icon square (`DARK_TABLE`); the chips and the
 *     cell's own controls (`data-cell-control`) take their own size instead — the attribute outranks
 *     the boards' rule;
 *   · the cells' sides 4px rather than 9: eleven columns of controls beside the pools on a laptop;
 *   · a control that IS a box (`data-cell-box` — the type) keeps the box's own height and fills its
 *     column, as the time's and the notes' inputs do: the boards' button rules would otherwise
 *     shrink it to its words, and a column of boxes of every width is what the owner pointed at
 *     («مفيش حاجه داخلة وحاجه خارجه»). The selector names both attributes, to outrank the line above.
 */
const PLAN_TABLE = cn(
  BOARD_TABLE_LOOK,
  BOARD_TABLE_FILL,
  '[&_td_button[data-cell-control]]:!h-auto [&_td_button[data-cell-control]]:!w-auto',
  '[&_td_button[data-cell-control][data-cell-box]]:!h-8 [&_td_button[data-cell-control][data-cell-box]]:!w-full',
  '[&_tbody_td]:!px-1 [&_thead_th]:!px-1.5 [&_tbody_td]:!py-1.5 [&_tbody_td]:align-top',
);

/** The bar's lists in the boards' colours (`DARK_FILTER_BAR`'s), on the day's bar. */
const PLAN_BAR = cn(
  DAY_BAR,
  '[&_button[aria-haspopup]]:!border-slate-300 dark:[&_button[aria-haspopup]]:!border-slate-700/80 [&_button[aria-haspopup]]:!bg-slate-50 dark:[&_button[aria-haspopup]]:!bg-[#080C14] [&_button[aria-haspopup]]:!text-slate-800 dark:[&_button[aria-haspopup]]:!text-slate-200',
  '[&_[role=listbox]]:!border-slate-300 dark:[&_[role=listbox]]:!border-slate-700 [&_[role=listbox]]:!bg-white dark:[&_[role=listbox]]:!bg-[#111827]',
);

/**
 * A count chip of the strip — a button that filters the table to its type. A hair tighter below
 * 1440: there the twelve chips were 50px short of one line, and the second line they wrapped onto
 * came off a 768px-high laptop's table and pools.
 */
const COUNT_CHIP =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border px-1 py-1 text-[11.5px] font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 min-[1440px]:px-1.5';

/** A dot of the strip that is no type's colour — «الإجمالي», «بدون نوع». */
const PlainDot = ({ tone }: { tone: string }): JSX.Element => (
  <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', tone)} />
);

/**
 * Somebody the roster no longer names (left since the plan was saved): still shown, never a raw id.
 * Asserted rather than annotated: the roster's DTO grows fields this stand-in has no value for. The
 * ones the chip's person card reads (Round 22) are here, as «nothing on file» — a dash on the card.
 */
const unknownMember = (employeeId: string, name: string): OperationsCrewMemberDto =>
  ({
    employeeId,
    code: '—',
    fullNameAr: name,
    status: 'unknown',
    jobTitle: null,
    phone: null,
    branchId: null,
    requirements: null,
    assignedVehicleId: null,
  }) as OperationsCrewMemberDto;

/**
 * What is under the pointer during a drag, read off the marks the board draws (the DOM half of
 * `targetFromMarks`): the nearest slot, row and pool around the element. A text node answers through
 * its parent.
 */
const targetAt = (node: EventTarget | null): DropTarget | null => {
  const element = node instanceof Element ? node : node instanceof Node ? node.parentElement : null;
  if (element === null) return null;
  const mark = (name: string): string | null =>
    element.closest(`[${name}]`)?.getAttribute(name) ?? null;
  return targetFromMarks({
    slotZone: mark('data-slot-zone'),
    rowKey: mark('data-plan-row'),
    pool: mark('data-plan-pool'),
  });
};

export const CrewBoardPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  const date = resolveCrewDate(sp.get('date'));
  const canPlan = can('operationsCrew.plan');

  const board = useOperationsCrewBoard(date);
  const day = date ?? (board.data?.date ?? '').slice(0, 10);
  // The pool is read for the BOARD'S day, never for «no day». With no `?date=` the board is
  // TOMORROW (the server's planning default), but the roster asked without a date answers for
  // TODAY — and since Round 22 it says who is absent or on leave, a fact about one day: read for
  // today, it faded today's absentees on tomorrow's board and offered tomorrow's, whom the save
  // then refused. So the default board's pool waits for the board to name its day.
  const directory = useOperationsCrewDirectory(day === '' ? null : day, day !== '');
  const standing = useOperationsStandingCrew();
  // EVERY active area, not one page: the save holds a new direction to all of them.
  const areaNames = useActiveOperationsAreaNames();
  const shiftTypeList = useOperationsShiftTypes(SHIFT_TYPE_LIST);
  const plan = usePlanOperationsCrew();

  const serverRows = useMemo(() => toPlanRows(board.data), [board.data]);

  // ── The draft ────────────────────────────────────────────────────────────────────────────────
  // The server's board is the truth; the draft starts from it — React's «state from the previous
  // render» pattern, so the table never shows the old day's rows for a frame. It STARTS AGAIN from a
  // new day and from its own save read back (the read-back arrives while the save is still pending:
  // `usePlanOperationsCrew` refetches before it settles). Any other new answer — another desk's
  // save, a reconnect — is REBASED under the planner's unsaved work (`rebaseDraft`, Round 22): Round
  // 20 replaced the draft there, and a name just dropped went back to its pool on its own.
  const [rows, setRows] = useState<readonly PlanRow[]>([]);
  const [seen, setSeen] = useState<{ rows: readonly PlanRow[]; day: string | null } | null>(null);
  const [standingKeys, setStandingKeys] = useState<string[] | null>(null);
  /** The last save's refusal, on the row and the box it names — until that box is changed. */
  const [refusal, setRefusal] = useState<(PlanRefusal & { message: string }) | null>(null);
  const answeredDay = board.data?.date ?? null;
  if (seen === null || seen.rows !== serverRows) {
    setSeen({ rows: serverRows, day: answeredDay });
    if (seen !== null && seen.day !== null && seen.day === answeredDay && !plan.isPending) {
      setRows(rebaseDraft(rows, seen.rows, serverRows));
    } else {
      setRows(serverRows);
      setStandingKeys(null);
      setRefusal(null);
    }
  }
  const sequence = useRef(0);

  const changes = planChanges(rows, serverRows);
  const pending = changeCount(changes);
  const dirty = pending > 0;
  const guard = useUnsavedGuard({ dirty });

  // ── The people ───────────────────────────────────────────────────────────────────────────────
  const members = useMemo(() => directory.data?.members ?? [], [directory.data]);
  const byId = useMemo(() => new Map(members.map((m) => [m.employeeId, m])), [members]);
  const memberOf = (employeeId: string): OperationsCrewMemberDto | undefined =>
    byId.get(employeeId);
  const shownMember = (employeeId: string): OperationsCrewMemberDto =>
    byId.get(employeeId) ?? unknownMember(employeeId, t('operations.crewPlan.unknownPerson'));
  const rosterReady = !directory.isPending && !directory.isError;

  // «أنواع التشغيل» — the whole catalog, archived types included (a row's archived type is named).
  const shiftTypes = useMemo(() => shiftTypeList.data?.items ?? [], [shiftTypeList.data]);
  const typeName = (shiftTypeId: string): string => {
    const type = shiftTypes.find((candidate) => candidate.id === shiftTypeId);
    return type === undefined ? '—' : shiftTypeName(type, locale);
  };

  const directions = useMemo(
    () => [...(areaNames.data ?? [])].sort((a, b) => a.localeCompare(b, 'ar')),
    [areaNames.data],
  );

  // ── The view ─────────────────────────────────────────────────────────────────────────────────
  const [typeFilter, setTypeFilter] = useState<ShiftTypeFilter>('');
  const [queries, setQueries] = useState<Record<PlanPool, PlanPoolQuery>>({
    captains: EMPTY_POOL_QUERY,
    specialists: EMPTY_POOL_QUERY,
  });
  const shown = rows.filter((row) => matchesShiftType(row, typeFilter));
  const strip = shiftTypeStrip(shiftTypes, rows);
  const looseNumber = new Map(
    rows.filter((row) => row.vehicleId === null).map((row, index) => [row.key, index + 1]),
  );
  const rowName = (row: PlanRow): string =>
    row.vehicleCode ??
    t('operations.crewPlan.looseRow', { n: formatNumber(looseNumber.get(row.key) ?? 0, locale) });

  // ── Picking up, dragging, dropping ───────────────────────────────────────────────────────────
  // `selected`: a chip pressed (the keyboard's and the phone's way). `dragging`: a chip in a drag,
  // for the DRAWING only — the armed slots, the faded chip, no card or tip. WHO is dragged is
  // `dragRef`, set by the chip's own dragstart, and every drop is decided from it alone, never from
  // what the browser shows of the drag (`lib/crew-drag.ts` — «بسحب الاسم بالماوس وبيرجع تانى»).
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  /** What is under the pointer (`targetKey`) — for the drawing; a repeated dragover keeps it. */
  const [over, setOver] = useState<string | null>(null);
  const moving = dragging ?? selected;
  const dragRef = useRef<string | null>(null);
  const overRef = useRef<string | null>(null);
  /** The drag is drawn (`drawDrag`) — or about to be: once per drag. */
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
  // A chip that left the roster or the board while picked up is put down.
  if (selected !== null && !byId.has(selected) && seatOf(rows, selected) === null)
    setSelected(null);

  /** Where somebody sits: the row on the pool's chip, the row and the slot in its hover. */
  const placedAt = (employeeId: string): { short: string; long: string } | null => {
    const seat = seatOf(rows, employeeId);
    if (seat === null) return null;
    const row = rows.find((candidate) => candidate.key === seat.key);
    if (row === undefined) return null;
    const short = rowName(row);
    return { short, long: `${short} · ${t(`operations.crewPlan.columns.${seat.slot}`)}` };
  };

  const roleOf = (employeeId: string): CrewRole =>
    crewRoleOf(memberOf(employeeId)?.requirements ?? null);
  /** Somebody a drop may carry: on the roster, or seated (a stand-in the roster no longer names). */
  const onBoard = (employeeId: string): boolean =>
    byId.has(employeeId) || seatOf(rows, employeeId) !== null;
  /** What a drop — or a pick from a slot's list — does here: the one rule both gestures share. */
  const decide = (target: DropTarget | null, employeeId: string): DropDecision | null =>
    target === null
      ? null
      : resolveDrop(rows, target, employeeId, roleOf(employeeId), awayOf(memberOf(employeeId)));
  /**
   * A refused drop, SAID: what is full — the slot (the first of the row's, for a drop on the row) on
   * which row — then what to do about it, on the toast's second line. Somebody away that day: who,
   * and why nobody away goes on a row.
   */
  const sayRefusal = (decision: RefusedDrop, employeeId: string): void => {
    const row = rows.find((candidate) => candidate.key === decision.key);
    const vars = {
      slot: t(`operations.crewPlan.columns.${decision.slots[0] ?? 'captain'}`),
      row: row === undefined ? '—' : rowName(row),
      name: shownMember(employeeId).fullNameAr,
    };
    toast.error(
      t(`operations.crewPlan.drop.${decision.reason}`, vars),
      t(
        refusedAsAway(decision.reason)
          ? 'operations.crewPlan.drop.awayWhy'
          : decision.reason === 'captainFull'
            ? 'operations.crewPlan.drop.captainElsewhere'
            : 'operations.crewPlan.drop.takeOff',
        vars,
      ),
    );
  };

  // ── A slot's list (Round 22 E) ───────────────────────────────────────────────────────────────
  // «لما ادوس عليه يجيب قايمة الناس اللى اختار منهم»: ONE list for the board, opened on the slot that
  // was pressed. A phone gets Fleet's bottom sheet. The slot (its zone) places it; what opened it
  // takes the focus back on Escape.
  const phone = !useMinWidth(640);
  const [picker, setPicker] = useState<{ key: string; slot: CrewSlot } | null>(null);
  const pickerAnchor = useRef<HTMLElement | null>(null);
  const pickerTrigger = useRef<HTMLElement | null>(null);
  const openPicker = (key: string, slot: CrewSlot, from: HTMLElement): void => {
    if (picker?.key === key && picker.slot === slot) {
      setPicker(null);
      return;
    }
    pickerAnchor.current = from.closest<HTMLElement>('[data-slot-zone]') ?? from;
    pickerTrigger.current = from;
    setSelected(null);
    setPicker({ key, slot });
  };
  const closePicker = (back: boolean): void => {
    setPicker(null);
    if (!back) return;
    requestAnimationFrame(() => {
      const from = pickerTrigger.current;
      if (from?.isConnected === true) from.focus({ preventScroll: true });
    });
  };
  /** A slot has room for one more — the only slot that offers its list. */
  const hasRoom = (key: string, slot: CrewSlot): boolean => {
    const row = rows.find((candidate) => candidate.key === key);
    return row !== undefined && row.slots[slot].length < CREW_SLOT_CAPACITY;
  };
  // The slot filled meanwhile (a drop, another desk's save), its row gone, or the day changed: the
  // list has nothing left to offer, and closes.
  if (picker !== null && !hasRoom(picker.key, picker.slot)) setPicker(null);
  /** A pick: the drop's own decision and step, then the focus on the name just seated. */
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

  const startDrag = (employeeId: string, event: DragEvent<HTMLElement>): void => {
    // The drag's data and who it is — no state: a re-render here cost a slow PC its drag
    // (`beginDrag`). The drawing waits for the browser's first answer (`drawDrag`).
    beginDrag(event.dataTransfer, employeeId);
    window.clearTimeout(dragTimer.current);
    dragRef.current = employeeId;
    drawnRef.current = false;
  };

  /**
   * Draw the drag — the armed slots, the faded chip, no card or tip — one task AFTER the first
   * dragover was answered, never before: re-drawing the board's 321 chips takes 10–20 ms on a laptop
   * and five times that on a slow PC, and the browser cannot hear the page's first «yes» while it
   * runs. Measured on the real stack (6× CPU, a hand let go the moment it arrived): drawn straight
   * after dragstart, the first drag of the day was refused; drawn after the first answer, it lands.
   */
  const drawDrag = (employeeId: string): void => {
    if (drawnRef.current) return;
    drawnRef.current = true;
    dragTimer.current = window.setTimeout(() => {
      if (dragRef.current !== employeeId) return;
      setDragging(employeeId);
      setSelected(null);
      setPicker(null);
    }, 0);
  };

  /** The drag ended — dropped (already settled), let go off the board, or Esc. */
  const endDrag = (): void => {
    if (dragRef.current !== null) settleDrag();
  };
  const endDragRef = useRef(endDrag);
  useEffect(() => {
    endDragRef.current = endDrag;
  });
  // A chip gone from the page mid-drag (its row re-read, its pool re-filtered) never delivers its
  // `dragend` to React. The browser sends no pointer events during a drag, so a pointer moving with
  // no button held means the drag is over, whatever the board still believes.
  useEffect(() => {
    const moved = (event: PointerEvent): void => {
      if (event.buttons === 0 && dragRef.current !== null) endDragRef.current();
    };
    window.addEventListener('pointermove', moved, { passive: true });
    return () => window.removeEventListener('pointermove', moved);
  }, []);

  /**
   * THE BOARD IS ONE DROP TARGET — its frame takes every drag event of OUR drag and accepts it
   * wherever the pointer is (`acceptsDragOver`); the drop then finds what is under it (`targetAt`):
   * a slot means that slot; anywhere else on a row, the vehicle's cell included, means the slot the
   * person's role takes; a pool frees him; a full slot is SAID. Legacy accepted on every cell of a
   * row and alerted a refusal; the Round-20 board accepted only on the dashed boxes — 29% of a row
   * at 1920 — and refused the rest, and every late answer on a slow PC, without a word.
   */
  const overDrag = (event: DragEvent<HTMLElement>): void => {
    const employeeId = dragRef.current;
    if (!acceptsDragOver(employeeId)) return;
    event.preventDefault();
    drawDrag(employeeId);
    // What is under the pointer, for the drawing only: the slot the drop would land in, or refuse.
    const target = targetAt(event.target);
    const key = target === null ? null : targetKey(target);
    if (overRef.current !== key) {
      overRef.current = key;
      setOver(key);
    }
  };
  const boardDrop: Pick<
    HTMLAttributes<HTMLElement>,
    'onDragOver' | 'onDragEnter' | 'onDragLeave' | 'onDrop'
  > = canPlan
    ? {
        onDragEnter: overDrag,
        onDragOver: overDrag,
        onDragLeave: (event) => {
          if (dragRef.current === null) return;
          // Moving onto another part of the board is not leaving it.
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
  // What a drop where the pointer is would do — drawn on the slot it lands in, or refuses.
  const overTarget = over === null ? null : parseTargetKey(over);
  const overDecision = dragging === null ? null : decide(overTarget, dragging);

  /** The last save named this person (somebody away): moving him answers it. */
  const settleRefusedPerson = (employeeId: string): void =>
    setRefusal((current) => (current?.person?.employeeId === employeeId ? null : current));
  const place = (key: string, slot: CrewSlot, employeeId: string): void => {
    setRows((current) => placeMember(current, key, slot, employeeId));
    setSelected(null);
    settleRefusedPerson(employeeId);
  };
  const free = (employeeId: string): void => {
    setRows((current) => freeMember(current, employeeId));
    setSelected(null);
    settleRefusedPerson(employeeId);
  };
  const patch = (key: string, fields: Parameters<typeof patchRow>[2]): void => {
    setRows((current) => patchRow(current, key, fields));
    // The refused box is changed: what it said no longer describes it.
    setRefusal((current) => (current?.key === key ? null : current));
  };

  const selectChip = (employeeId: string): void => {
    setPicker(null);
    setSelected((current) => (current === employeeId ? null : employeeId));
  };

  // ── The acts ─────────────────────────────────────────────────────────────────────────────────
  const addRow = (): void => {
    sequence.current += 1;
    const row = vehiclelessRow(sequence.current);
    setRows((current) => [...current, row]);
    setTypeFilter('');
    // Brought into view: on a board of fifty vans the new row is otherwise below the fold.
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-plan-row="${row.key}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    );
  };

  const standingSources = useMemo(
    () =>
      (standing.data?.rows ?? []).map((row) => ({
        vehicleId: row.vehicleId,
        captainEmployeeIds: row.captainEmployeeIds,
        specialist1EmployeeIds: row.specialist1EmployeeIds,
        specialist2EmployeeIds: row.specialist2EmployeeIds,
      })),
    [standing.data],
  );
  /**
   * «الطاقم الثابت»: fills EMPTY vans in the draft, and off again empties exactly those. Somebody
   * away that day is left off his van (Round 22 — no row takes him, and the save would refuse him)
   * and named, so the planner knows whose seat to fill.
   */
  const toggleStanding = (): void => {
    if (standingKeys !== null) {
      setRows((current) => clearStandingFromPlan(current, standingKeys));
      setStandingKeys(null);
      return;
    }
    const left = new Set<string>();
    const present = (ids: readonly string[]): string[] =>
      ids.filter((employeeId) => {
        const away = awayOf(memberOf(employeeId)) !== null;
        if (away) left.add(employeeId);
        return !away;
      });
    const load = loadStandingIntoPlan(
      rows,
      standingSources.map((source) => ({
        vehicleId: source.vehicleId,
        captainEmployeeIds: present(source.captainEmployeeIds),
        specialist1EmployeeIds: present(source.specialist1EmployeeIds),
        specialist2EmployeeIds: present(source.specialist2EmployeeIds),
      })),
    );
    setRows(load.rows);
    setStandingKeys(load.filledKeys);
    if (load.unavailable > 0) {
      toast.error(t('operations.crew.standing.unavailable', { count: load.unavailable }));
    }
    if (left.size > 0) {
      // The names on the second line: the toast cuts its first one to its width.
      toast.error(
        t('operations.crewPlan.standingAway'),
        [...left].map((employeeId) => shownMember(employeeId).fullNameAr).join('، '),
      );
    }
  };

  /**
   * A row without a van is given one. Not while somebody on it is away that day: the van would put
   * him on a van, which the save refuses (Round 22) — said now, by name, rather than at «حفظ».
   */
  const giveVan = (row: PlanRow, vanKey: string): void => {
    const away = rowPeople(row).filter((employeeId) => awayOf(memberOf(employeeId)) !== null);
    if (away.length > 0) {
      toast.error(
        t('operations.crewPlan.vanAway'),
        t('operations.crewPlan.vanAwayWho', {
          names: away.map((employeeId) => shownMember(employeeId).fullNameAr).join('، '),
        }),
      );
      return;
    }
    setRows((current) => attachVan(current, row.key, vanKey));
  };

  const exportExcel = (): void =>
    saveReportWorkbook(
      t('operations.crewPlan.fileStem'),
      [crewPlanSheet(t, shown, memberOf, typeName)],
      day || 'board',
    );

  const save = async (): Promise<void> => {
    if (!dirty || plan.isPending) return;
    const sent = changes.changed;
    setRefusal(null);
    try {
      await plan.mutateAsync(toPlan(day, changes));
      toast.success(t('operations.crewPlan.saved', { count: formatNumber(pending, locale) }));
    } catch (failure) {
      // A refusal that names a row is said in its own words AND marked on that row's box, brought
      // into view — on a board of fifty vans «a direction is not an area» alone leaves the planner
      // hunting for it. Anything else (a Q11 clash, a row deleted on another desk) is said only.
      const placed = failure instanceof ApiError ? planRefusal(failure, sent) : null;
      if (placed === null) {
        // The board owns its errors (`usePlanOperationsCrew`'s `onError`), so this toast is the
        // only one: the plan's sentence for a Q11 clash, the failure's own words otherwise.
        toast.error(
          isCrewClash(failure) ? t('operations.crew.saveFailed') : errorMessage(failure, locale),
        );
        return;
      }
      // Somebody away that day (Round 22): who, by name — his chip on that row is ringed too.
      const message =
        placed.field === 'direction'
          ? t('operations.crewPlan.refused.direction', { parts: placed.parts.join('، ') })
          : placed.field === 'crew'
            ? placed.person === undefined
              ? t('operations.crewPlan.refused.crew')
              : t(`operations.crewPlan.refused.${placed.person.away}`, {
                  name: shownMember(placed.person.employeeId).fullNameAr,
                })
            : t('operations.crewPlan.refused.type');
      setRefusal({ ...placed, message });
      toast.error(errorMessage(failure, locale), placed.field === 'crew' ? message : undefined);
      if (!shown.some((row) => row.key === placed.key)) setTypeFilter('');
      requestAnimationFrame(() =>
        document
          .querySelector(`[data-plan-row="${placed.key}"]`)
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
      );
    }
  };

  const setDay = (value: string): void =>
    guard.confirmLeave(() => {
      const next = new URLSearchParams(sp);
      if (value === '') next.delete('date');
      else next.set('date', value);
      setSp(next);
    });

  // ── A slot ───────────────────────────────────────────────────────────────────────────────────
  const slotCell = (row: PlanRow, slot: CrewSlot): JSX.Element => {
    const zone = `${row.key}|${slot}`;
    const people = row.slots[slot];
    // Armed: what is picked up or dragged would land here — the drop's own answer, so somebody away
    // that day lights no slot but on the row he already sits on (Round 22).
    const armed =
      canPlan &&
      moving !== null &&
      decide({ kind: 'slot', key: row.key, slot }, moving)?.kind === 'place';
    const slotWord = t(`operations.crewPlan.columns.${slot}`);
    // Its list, «+ اختيار»: on a slot with room, whenever nothing is picked up (then it is «ضع هنا»).
    const offerList = canPlan && selected === null && people.length < CREW_SLOT_CAPACITY;
    const listOpen = picker?.key === row.key && picker.slot === slot;
    const chooseWord = t(
      `operations.crewPlan.picker.choose.${slot === 'captain' ? 'captain' : 'specialist'}`,
    );
    // Where the pointer's drop would land — this slot, aimed at or routed to from anywhere on its
    // row — or the slot(s) refusing it; the frame takes the events themselves (`boardDrop`).
    const isOver =
      overDecision?.kind === 'place' && overDecision.key === row.key && overDecision.slot === slot;
    const refused =
      overDecision?.kind === 'refuse' &&
      overDecision.key === row.key &&
      overDecision.slots.includes(slot);
    // Why it refuses, over the slot: full — or the person away that day, in his own words.
    const refusedWord =
      overDecision?.kind === 'refuse' && refusedAsAway(overDecision.reason)
        ? t(`operations.crewPlan.away.day.${overDecision.reason}`)
        : t('operations.crewPlan.slotFull');
    return (
      <div
        role="group"
        aria-label={`${slotWord} — ${rowName(row)}`}
        data-slot-zone={zone}
        data-drop-over={isOver ? 'accept' : refused ? 'refuse' : undefined}
        className={cn(
          'relative flex min-h-[2.25rem] w-[8.75rem] flex-col gap-1 rounded-lg p-0.5 transition-colors min-[1440px]:w-[9.75rem] min-[1750px]:w-[10.5rem] min-[1900px]:w-[12.25rem]',
          people.length === 0 &&
            'border border-dashed border-slate-300/80 dark:border-slate-700/70',
          armed &&
            'outline-dashed outline-2 -outline-offset-1 outline-brand-300/80 dark:outline-brand-500/45',
          isOver &&
            armed &&
            'bg-brand-50 [&&]:outline [&&]:outline-brand-500 dark:bg-brand-500/20 dark:[&&]:outline-brand-400',
          refused &&
            'bg-rose-50 outline-dashed outline-2 -outline-offset-1 outline-rose-400 dark:bg-rose-500/10',
        )}
      >
        {people.map((employeeId) => {
          const member = shownMember(employeeId);
          const role = crewRoleOf(member.requirements);
          return (
            <CrewPlanChip
              key={employeeId}
              member={member}
              variant="seat"
              selected={selected === employeeId}
              dragging={dragging === employeeId}
              canPlan={canPlan}
              // The person card's «في التشغيلة» line; and no card or icon tip under a drag.
              seatedAt={placedAt(employeeId)?.long ?? null}
              dragActive={dragging !== null}
              outOfRole={
                outOfRole(role, slot)
                  ? t(
                      `operations.crewPlan.outOfRole.${slot === 'captain' ? 'captain' : 'specialist'}`,
                    )
                  : null
              }
              refused={
                refusal?.field === 'crew' &&
                refusal.key === row.key &&
                refusal.person?.employeeId === employeeId
              }
              onSelect={() => selectChip(employeeId)}
              onRemove={() => free(employeeId)}
              // A slot with room for one more: its list, from the «+» beside the ✕.
              onAdd={
                offerList
                  ? {
                      label: t('operations.crewPlan.picker.add', {
                        slot: slotWord,
                        row: rowName(row),
                      }),
                      open: (from) => openPicker(row.key, slot, from),
                    }
                  : undefined
              }
              onDragStart={(event) => startDrag(employeeId, event)}
              onDragEnd={endDrag}
            />
          );
        })}
        {/* An EMPTY slot is its own «+ اختيار» — Fleet's «+ اختيار سائق» in the dashed seat: the
            dashed box says a name goes here, a press opens who can. Kept, unseen, under a drag —
            nothing in the row moves while the hand is on its way. */}
        {people.length === 0 && offerList && (
          <button
            type="button"
            data-cell-control="pick"
            data-slot-pick={zone}
            aria-haspopup="dialog"
            aria-expanded={listOpen}
            aria-label={`${chooseWord} — ${slotWord} — ${rowName(row)}`}
            onClick={(event) => openPicker(row.key, slot, event.currentTarget)}
            className={cn(
              'flex min-h-[2rem] flex-1 items-center justify-center gap-1 rounded-md text-[11.5px] font-bold text-slate-400 transition hover:bg-brand-500/10 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:text-slate-500 dark:hover:text-brand-200',
              listOpen && 'bg-brand-500/15 text-brand-700 dark:text-brand-200',
              dragging !== null && 'invisible',
            )}
          >
            <BoardIcon d={PATH.plus} className="h-3 w-3" width={3} />
            {chooseWord}
          </button>
        )}
        {/* Under a drag, the slot says where the name will land — the browser's own drag picture
            is faint, and on a dark board the outline alone was easy to miss. OVER the slot, never
            in its flow (Round 22): a drop anywhere on a row lights the slot it routes to, and a
            line added there grew the row and slid the rows below it out from under the pointer —
            a hand aiming at the next van dropped on this one. */}
        {dragging !== null && isOver && armed && (
          <span
            aria-hidden
            data-drop-landing="true"
            className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1 rounded-lg bg-brand-500/90 text-[11.5px] font-black text-white shadow"
          >
            <BoardIcon d={PATH.plus} className="h-3 w-3" width={3} />
            {t('operations.crewPlan.placeHere')}
          </span>
        )}
        {selected !== null && armed && (
          <button
            type="button"
            data-cell-control="place"
            data-place={zone}
            onClick={() => place(row.key, slot, selected)}
            className="flex min-h-[1.75rem] items-center justify-center gap-1 rounded-md border border-dashed border-brand-400 bg-brand-500/10 text-[11.5px] font-black text-brand-700 transition hover:bg-brand-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-200"
          >
            <BoardIcon d={PATH.plus} className="h-3 w-3" width={3} />
            {t('operations.crewPlan.placeHere')}
          </button>
        )}
        {/* The refusal over the WHOLE slot: a badge at its edge sat on the second name and cut it
            in half; this says «full» in the one place the eye is — where the drop was aimed. */}
        {refused && (
          <span
            role="status"
            className="absolute inset-0 flex items-center justify-center rounded-lg bg-rose-600/85 px-1 text-center text-[12px] font-black leading-4 text-white backdrop-blur-[1px]"
          >
            {refusedWord}
          </span>
        )}
      </div>
    );
  };

  // ── The table ────────────────────────────────────────────────────────────────────────────────
  const freeVans = vansFree(rows);
  /** What the last save said about this row's box, or null. */
  const refusedOn = (row: PlanRow, field: PlanRefusal['field']): string | null =>
    refusal !== null && refusal.key === row.key && refusal.field === field ? refusal.message : null;
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
        const warn =
          short === null ? null : (
            <span
              role="img"
              data-crew-short="true"
              aria-label={short}
              title={short}
              className="inline-flex text-amber-500 dark:text-amber-400"
            >
              <BoardIcon d={PATH.warn} className="h-4 w-4" />
            </span>
          );
        return row.vehicleId !== null ? (
          <div className="flex min-h-[2.25rem] items-center gap-1 px-0.5">
            <CrewVehicleHoverCode
              className={cn(NUM, 'cursor-default text-[14px] font-black')}
              code={row.vehicleCode ?? '…'}
              vehicleCrew={planRowCard(row, memberOf)}
            />
            {warn}
          </div>
        ) : (
          <div className="flex min-h-[2.25rem] items-center gap-1" data-vehicleless="true">
            <VanPicker
              rowKey={row.key}
              vans={freeVans}
              disabled={!canPlan}
              onPick={(vanKey) => giveVan(row, vanKey)}
            />
            {warn}
          </div>
        );
      },
    },
    ...CREW_SLOTS.map((slot): Column<PlanRow> => ({
      key: slot,
      header: t(`operations.crewPlan.columns.${slot}`),
      render: (row) => slotCell(row, slot),
    })),
    {
      key: 'direction',
      header: t('operations.crewPlan.columns.direction'),
      render: (row) => (
        <div className="w-[7.5rem] min-[1440px]:w-[8rem] min-[1750px]:w-[10rem]">
          <DirectionPicker
            rowKey={row.key}
            value={row.direction}
            options={directions}
            disabled={!canPlan}
            refused={refusedOn(row, 'direction')}
            onChange={(direction) => patch(row.key, { direction })}
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
        />
      ),
    },
    {
      key: 'type',
      header: t('operations.crewPlan.columns.type'),
      render: (row) => (
        // The column's width is the box's: one width down the column, as the time's and the
        // notes' (see `PLAN_TABLE`).
        <div className="w-[7.75rem] min-[1750px]:w-[8.5rem]">
          <ShiftTypePicker
            rowKey={row.key}
            value={row.shiftTypeId}
            types={shiftTypes}
            locale={locale}
            disabled={!canPlan}
            refused={refusedOn(row, 'type')}
            onChange={(shiftTypeId) => patch(row.key, { shiftTypeId })}
          />
        </div>
      ),
    },
    {
      key: 'notes',
      header: t('operations.crewPlan.columns.notes'),
      render: (row) => (
        <input
          type="text"
          aria-label={`${t('operations.crewPlan.columns.notes')} — ${rowName(row)}`}
          placeholder={t('operations.crewPlan.columns.notes')}
          title={row.notes ?? undefined}
          disabled={!canPlan}
          value={row.notes ?? ''}
          onChange={(event) => patch(row.key, { notes: event.target.value })}
          // 16px under the sample's below 1440: the type's names («احتياطي سفر») took them, in a
          // table with nothing to spare there.
          className={cn(CELL_BOX, 'w-[4.5rem] min-[1440px]:w-[6.5rem] min-[1750px]:w-[10rem]')}
        />
      ),
    },
    {
      key: 'actions',
      header: t('operations.crewPlan.columns.actions'),
      render: (row) => {
        const loose = row.vehicleId === null;
        const label = t(loose ? 'operations.crewPlan.row.remove' : 'operations.crewPlan.row.clear');
        return (
          // On the boxes' line: as tall as a box, the swatch and the bin centred in it — never
          // riding above or below the direction, time, type and notes beside them.
          <span className="flex h-8 items-center gap-1" data-row-actions-line="true">
            <RowColourPicker
              rowKey={row.key}
              value={row.rowColour}
              disabled={!canPlan}
              onChange={(rowColour) => patch(row.key, { rowColour })}
            />
            {canPlan && (
              <button
                type="button"
                data-row-discard={row.key}
                aria-label={`${label} — ${rowName(row)}`}
                title={label}
                disabled={!loose && isBlankRow(row)}
                onClick={() => {
                  setRows((current) => discardRow(current, row.key));
                  setRefusal((current) => (current?.key === row.key ? null : current));
                }}
                className="flex items-center justify-center rounded-lg border border-slate-200 bg-white text-rose-600 transition hover:border-rose-400 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-35 dark:border-slate-700 dark:bg-[#0a1233] dark:text-rose-400 dark:hover:bg-rose-500/10"
              >
                <BoardIcon d={PATH.trash} className="h-4 w-4" />
              </button>
            )}
          </span>
        );
      },
    },
  ];

  // ── The page ─────────────────────────────────────────────────────────────────────────────────
  const workshop = board.data?.workshopVehicles ?? [];
  const typeValue = typeFilter === '' ? [] : [typeFilter];
  const pickedName = selected === null ? null : shownMember(selected).fullNameAr;
  const selectedSeated = selected !== null && seatOf(rows, selected) !== null;

  const countChip = (
    filter: ShiftTypeFilter,
    label: string,
    count: number,
    dot: JSX.Element,
    archived = false,
  ): JSX.Element => {
    const on = typeFilter === filter;
    return (
      <button
        key={filter || 'all'}
        type="button"
        data-type-count={filter || 'all'}
        data-type-archived={archived ? 'true' : undefined}
        aria-pressed={on}
        title={archived ? `${label} — ${t('operations.crewPlan.type.archivedHint')}` : undefined}
        onClick={() => setTypeFilter(on && filter !== '' ? '' : filter)}
        className={cn(
          COUNT_CHIP,
          on
            ? 'border-brand-500 bg-brand-500/15 text-brand-800 dark:border-brand-400 dark:text-brand-100'
            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-[#0a1233] dark:text-slate-200 dark:hover:border-slate-600',
          archived && !on && 'border-dashed border-amber-400 dark:border-amber-500/60',
          count === 0 && !on && 'opacity-55',
        )}
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
      <div className={BOARD_FRAME} data-crew-plan="true" {...boardDrop}>
        {/* The toolbar: what the hands do at the start; the acts at the end. */}
        <div
          className="flex flex-wrap items-center justify-between gap-2"
          data-crew-plan-toolbar="true"
        >
          <div aria-live="polite" className="min-w-0 flex-1">
            {pickedName !== null ? (
              <p
                data-crew-picked="true"
                className="inline-flex max-w-full items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-[12.5px] font-bold text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-100"
              >
                <span className="min-w-0 truncate">
                  {t('operations.crewPlan.picked', { name: pickedName })}
                </span>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="shrink-0 rounded-md bg-amber-200/70 px-2 py-0.5 text-[11.5px] font-black text-amber-900 hover:bg-amber-200 dark:bg-amber-400/20 dark:text-amber-100"
                >
                  {t('operations.crewPlan.cancelPick')}
                </button>
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <RoleLegend />
                <p className="text-xs font-bold leading-5 text-slate-500 dark:text-slate-400">
                  {canPlan ? t('operations.crewPlan.hint') : t('operations.crewPlan.viewOnly')}
                </p>
              </div>
            )}
          </div>
          <span className="ms-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1 sm:gap-2">
            {canPlan && (
              <button
                type="button"
                data-standing-toggle="true"
                aria-pressed={standingKeys !== null}
                disabled={standingSources.length === 0 && standingKeys === null}
                title={
                  standingSources.length === 0
                    ? t('operations.crew.standing.none')
                    : t('operations.crew.standing.hint')
                }
                onClick={toggleStanding}
                className={cn(
                  BRAND_BUTTON,
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  standingKeys !== null && '!bg-brand-500 !text-white',
                )}
              >
                <BoardIcon d={PLAN_ICON.layers} className="h-3.5 w-3.5" />
                {t('operations.crewPlan.standing')}
              </button>
            )}
            {canPlan && (
              <button
                type="button"
                data-add-loose-row="true"
                onClick={addRow}
                className={BRAND_BUTTON}
              >
                <BoardIcon d={PATH.plus} className="h-3.5 w-3.5" width={2.5} />
                {t('operations.crewPlan.addRow')}
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
                disabled={!dirty}
                onClick={() => {
                  setRows(serverRows);
                  setStandingKeys(null);
                  setSelected(null);
                  setRefusal(null);
                }}
                className={cn(BRAND_BUTTON, 'disabled:cursor-not-allowed disabled:opacity-50')}
              >
                <BoardIcon d={SHIPMENT_PATH.undo} className="h-3.5 w-3.5" />
                {t('operations.crewPlan.discard')}
              </button>
            )}
            {canPlan && (
              <button
                type="button"
                data-crew-plan-save={String(pending)}
                disabled={!dirty || plan.isPending}
                aria-busy={plan.isPending}
                onClick={() => void save()}
                className={cn(
                  dirty ? ADD_BUTTON : BRAND_BUTTON,
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                {plan.isPending ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : (
                  <BoardIcon d={SHIPMENT_PATH.check} className="h-3.5 w-3.5" width={2.5} />
                )}
                {dirty
                  ? t('operations.crewPlan.saveCount', { count: formatNumber(pending, locale) })
                  : t('common.save')}
              </button>
            )}
          </span>
        </div>

        {/* The day, the type, and the strip counting the rows by type. */}
        <div className={PLAN_BAR} data-crew-plan-bar="true">
          <DayBox label={t('operations.crewPlan.day')} value={day} min="" onChange={setDay} />
          <FilterWithIcon
            icon={PLAN_ICON.tag}
            tone="text-slate-600 dark:text-slate-300"
            className="w-full shrink-0 sm:w-40"
          >
            <MultiSelect
              clearable
              fullWidth
              density="tight"
              showSelectedValues
              label={t('operations.crewPlan.typeAll')}
              options={[
                ...strip.chips.map(({ type }) => ({
                  value: type.id,
                  label: shiftTypeName(type, locale),
                })),
                { value: NO_SHIFT_TYPE, label: t('operations.crewPlan.type.untyped') },
              ]}
              value={typeValue}
              onChange={(next) =>
                setTypeFilter((pickOne(typeValue, next) ?? '') as ShiftTypeFilter)
              }
            />
          </FilterWithIcon>
          <div
            role="group"
            aria-label={t('operations.crewPlan.counts')}
            className="flex w-full min-w-0 flex-wrap items-center gap-1 lg:w-auto lg:flex-1 min-[1360px]:gap-0.5 min-[1440px]:gap-1"
            data-type-counts="true"
          >
            {countChip(
              '',
              t('operations.crewPlan.total'),
              strip.total,
              <PlainDot tone="bg-brand-500" />,
            )}
            {strip.chips.map(({ type, count }) =>
              countChip(
                type.id,
                shiftTypeName(type, locale),
                count,
                <ShiftTypeDot colour={type.colour} size="sm" />,
                !type.isActive,
              ),
            )}
            {strip.none > 0 &&
              countChip(
                NO_SHIFT_TYPE,
                t('operations.crewPlan.type.untyped'),
                strip.none,
                <PlainDot tone="bg-slate-400" />,
              )}
            {/* صيانة — the vans in the workshop: not rows of this board, so a figure, not a filter. */}
            <span
              data-workshop-count={String(workshop.length)}
              title={
                workshop.length === 0
                  ? t('operations.crewPlan.workshopNone')
                  : t('operations.crewPlan.workshopHint', {
                      codes: workshop.map((van) => van.vehicleCode).join('، '),
                    })
              }
              className={cn(
                COUNT_CHIP,
                'cursor-help border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200',
              )}
            >
              <BoardIcon d={PLAN_ICON.wrench} className="h-3.5 w-3.5" />
              {t('operations.crewPlan.workshop')}
              <span className={cn(NUM, 'text-[13px] font-black')}>
                {formatNumber(workshop.length, locale)}
              </span>
            </span>
          </div>
        </div>

        <CrewRosterNotice rosterIsDerived={directory.data?.rosterIsDerived} />

        {/* The table at the START, the pools at the END — in Arabic, the vans on the right and the
            names on the left, as the legacy board. The pools come first in the markup so that on a
            phone, where everything stacks, the names are met before fifty vans. */}
        {/* Below 1360 nothing is pinned: the page scrolls, the pools above the table — beside it,
            a 1280 laptop left the table 90px short and scrolling sideways. A height limit there
            also squeezed the pools to nothing on a phone (a flex column shrinks a child allowed
            `min-h-0` before it scrolls). From 1360 the grid takes the height left, and the table
            and each pool scroll inside it. */}
        <div
          className="grid shrink-0 gap-3 min-[1360px]:min-h-0 min-[1360px]:flex-1 min-[1360px]:shrink min-[1360px]:grid-cols-[minmax(0,1fr)_14rem] min-[1700px]:grid-cols-[minmax(0,1fr)_29rem]"
          data-crew-plan-grid="true"
        >
          <div className="grid gap-3 sm:grid-cols-2 min-[1360px]:col-start-2 min-[1360px]:row-start-1 min-[1360px]:min-h-0 min-[1360px]:grid-cols-1 min-[1360px]:grid-rows-2 min-[1700px]:grid-cols-2 min-[1700px]:grid-rows-1">
            {PLAN_POOLS.map((pool) => {
              const listing = listPool(members, pool, rows, queries[pool]);
              const poolAccepts = (employeeId: string): boolean =>
                seatOf(rows, employeeId) !== null;
              return (
                <CrewPlanPool
                  key={pool}
                  pool={pool}
                  className="h-[20rem] min-[1360px]:h-auto"
                  listed={listing.listed}
                  total={listing.total}
                  free={listing.free}
                  ready={rosterReady}
                  query={queries[pool]}
                  onQueryChange={(next) => setQueries((current) => ({ ...current, [pool]: next }))}
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
                    armed: canPlan && dragging !== null && poolAccepts(dragging),
                    over:
                      overDecision?.kind === 'free' &&
                      overTarget?.kind === 'pool' &&
                      overTarget.pool === pool,
                  }}
                  returnSelected={
                    canPlan && selectedSeated && selected !== null ? (
                      <button
                        type="button"
                        data-return-picked={pool}
                        onClick={() => free(selected)}
                        className="mb-1 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-brand-400 bg-brand-500/10 py-1.5 text-[12px] font-black text-brand-700 hover:bg-brand-500/20 dark:text-brand-200"
                      >
                        <BoardIcon d={SHIPMENT_PATH.undo} className="h-3.5 w-3.5" />
                        {t('operations.crewPlan.pools.returnPicked', { name: pickedName ?? '' })}
                      </button>
                    ) : null
                  }
                />
              );
            })}
          </div>

          <div className="flex min-w-0 flex-col min-[1360px]:col-start-1 min-[1360px]:row-start-1 min-[1360px]:min-h-0">
            <div className={PLAN_TABLE} data-crew-plan-table="true">
              <DataTable
                columns={columns}
                rows={shown as PlanRow[]}
                rowKey={(row) => row.key}
                loading={board.isPending}
                error={board.error}
                onRetry={() => void board.refetch()}
                empty={
                  rows.length === 0
                    ? t('operations.crew.noVehicles')
                    : t('operations.crewPlan.noneOfType')
                }
                rowClassName={(row) =>
                  row.rowColour === null ? undefined : ROW_TINT[row.rowColour]
                }
                rowProps={(row) =>
                  ({
                    'data-plan-row': row.key,
                    ...(row.rowColour === null ? {} : { 'data-row-colour': row.rowColour }),
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

      {/* The slot's list — one for the board, started afresh for each slot pressed. */}
      {picker !== null && (
        <CrewSlotPicker
          key={`${picker.key}|${picker.slot}`}
          target={picker}
          slotName={t(`operations.crewPlan.columns.${picker.slot}`)}
          rowName={(() => {
            const row = rows.find((candidate) => candidate.key === picker.key);
            return row === undefined ? '—' : rowName(row);
          })()}
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

      {/* «تغييرات غير محفوظة» — another day, a link in the menu, a reload. */}
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
          {t(pluralKey('operations.crewPlan.leaveBody', locale, pending), {
            count: formatNumber(pending, locale),
          })}
        </p>
      </DesignDialog>
    </PageContainer>
  );
};
