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
// MOVING PEOPLE: drag a chip onto a slot, from a pool or from another row; a full slot refuses;
// back onto a pool frees it. Or press a chip, then «ضع هنا» in a slot — the keyboard's way and the
// phone's. Every move is a pure step in `lib/crew-plan.ts`; nothing is written until «حفظ».
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
import { type Locale, type OperationsCrewMemberDto } from '@ecms/contracts';
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
import {
  CREW_DRAG_TYPE,
  CrewPlanChip,
  RoleLegend,
  carriesCrewMember,
} from '../components/CrewPlanChip';
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
  seatOf,
  shiftTypeStrip,
  slotRefusal,
  toPlan,
  toPlanRows,
  vansFree,
  vehiclelessRow,
  type CrewSlot,
  type PlanRefusal,
  type PlanPool,
  type PlanPoolQuery,
  type PlanRow,
  type ShiftTypeFilter,
} from '../lib/crew-plan';
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

export const CrewBoardPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  const date = resolveCrewDate(sp.get('date'));
  const canPlan = can('operationsCrew.plan');

  const board = useOperationsCrewBoard(date);
  const directory = useOperationsCrewDirectory(date);
  const standing = useOperationsStandingCrew();
  // EVERY active area, not one page: the save holds a new direction to all of them.
  const areaNames = useActiveOperationsAreaNames();
  const shiftTypeList = useOperationsShiftTypes(SHIFT_TYPE_LIST);
  const plan = usePlanOperationsCrew();

  const serverRows = useMemo(() => toPlanRows(board.data), [board.data]);
  const day = date ?? (board.data?.date ?? '').slice(0, 10);

  // ── The draft ────────────────────────────────────────────────────────────────────────────────
  // The server's board is the truth; the draft starts from it and starts again from every new
  // answer (a new day, a save read back) — React's «state from the previous render» pattern, so the
  // table never shows the old day's rows for a frame.
  const [rows, setRows] = useState<readonly PlanRow[]>([]);
  const [seen, setSeen] = useState<readonly PlanRow[] | null>(null);
  const [standingKeys, setStandingKeys] = useState<string[] | null>(null);
  /** The last save's refusal, on the row and the box it names — until that box is changed. */
  const [refusal, setRefusal] = useState<(PlanRefusal & { message: string }) | null>(null);
  if (seen !== serverRows) {
    setSeen(serverRows);
    setRows(serverRows);
    setStandingKeys(null);
    setRefusal(null);
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
  // `selected`: a chip pressed (the keyboard's and the phone's way); `dragging`: a chip in a drag.
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const moving = dragging ?? selected;

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

  const startDrag = (employeeId: string, event: DragEvent<HTMLElement>): void => {
    event.dataTransfer.setData(CREW_DRAG_TYPE, employeeId);
    event.dataTransfer.setData('text/plain', employeeId);
    event.dataTransfer.effectAllowed = 'move';
    setDragging(employeeId);
    setSelected(null);
  };
  const endDrag = (): void => {
    setDragging(null);
    setOver(null);
  };

  /** A drop target's handlers. `accepts` decides; a refused target still lights — in red. */
  const dropZone = (
    zone: string,
    accepts: (employeeId: string) => boolean,
    onMember: (employeeId: string) => void,
  ): Pick<
    HTMLAttributes<HTMLElement>,
    'onDragOver' | 'onDragEnter' | 'onDragLeave' | 'onDrop'
  > => ({
    onDragOver: (event) => {
      if (!carriesCrewMember(event)) return;
      if (over !== zone) setOver(zone);
      if (dragging === null || !accepts(dragging)) {
        event.dataTransfer.dropEffect = 'none';
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    },
    onDragEnter: (event) => {
      if (!carriesCrewMember(event)) return;
      setOver(zone);
      if (dragging !== null && accepts(dragging)) event.preventDefault();
    },
    onDragLeave: (event) => {
      // Moving onto a chip INSIDE the target is not leaving it.
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setOver((current) => (current === zone ? null : current));
    },
    onDrop: (event) => {
      event.preventDefault();
      const employeeId = event.dataTransfer.getData(CREW_DRAG_TYPE) || dragging;
      setOver(null);
      setDragging(null);
      if (employeeId !== null && employeeId !== '' && accepts(employeeId)) onMember(employeeId);
    },
  });

  const place = (key: string, slot: CrewSlot, employeeId: string): void => {
    setRows((current) => placeMember(current, key, slot, employeeId));
    setSelected(null);
  };
  const free = (employeeId: string): void => {
    setRows((current) => freeMember(current, employeeId));
    setSelected(null);
  };
  const patch = (key: string, fields: Parameters<typeof patchRow>[2]): void => {
    setRows((current) => patchRow(current, key, fields));
    // The refused box is changed: what it said no longer describes it.
    setRefusal((current) => (current?.key === key ? null : current));
  };

  const selectChip = (employeeId: string): void =>
    setSelected((current) => (current === employeeId ? null : employeeId));

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
  /** «الطاقم الثابت»: fills EMPTY vans in the draft, and off again empties exactly those. */
  const toggleStanding = (): void => {
    if (standingKeys !== null) {
      setRows((current) => clearStandingFromPlan(current, standingKeys));
      setStandingKeys(null);
      return;
    }
    const load = loadStandingIntoPlan(rows, standingSources);
    setRows(load.rows);
    setStandingKeys(load.filledKeys);
    if (load.unavailable > 0) {
      toast.error(t('operations.crew.standing.unavailable', { count: load.unavailable }));
    }
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
      const message =
        placed.field === 'direction'
          ? t('operations.crewPlan.refused.direction', { parts: placed.parts.join('، ') })
          : t('operations.crewPlan.refused.type');
      setRefusal({ ...placed, message });
      toast.error(errorMessage(failure, locale));
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
    const refusal = moving === null ? null : slotRefusal(rows, row.key, slot, moving);
    const armed = canPlan && moving !== null && refusal === null;
    const isOver = over === zone;
    const refused = isOver && refusal === 'full';
    return (
      <div
        {...(canPlan
          ? dropZone(
              zone,
              (employeeId) => slotRefusal(rows, row.key, slot, employeeId) === null,
              (employeeId) => place(row.key, slot, employeeId),
            )
          : {})}
        role="group"
        aria-label={`${t(`operations.crewPlan.columns.${slot}`)} — ${rowName(row)}`}
        data-slot-zone={zone}
        data-drop-over={isOver ? (armed ? 'accept' : 'refuse') : undefined}
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
              onSelect={() => selectChip(employeeId)}
              onRemove={() => free(employeeId)}
              onDragStart={(event) => startDrag(employeeId, event)}
              onDragEnd={endDrag}
            />
          );
        })}
        {/* Under a drag, the slot says where the name will land — the browser's own drag picture
            is faint, and on a dark board the outline alone was easy to miss. */}
        {dragging !== null && isOver && armed && (
          <span
            aria-hidden
            className="flex h-7 items-center justify-center gap-1 rounded-md bg-brand-500 text-[11.5px] font-black text-white shadow"
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
            className="absolute inset-0 flex items-center justify-center rounded-lg bg-rose-600/85 text-[12px] font-black text-white backdrop-blur-[1px]"
          >
            {t('operations.crewPlan.slotFull')}
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
              onPick={(vanKey) => setRows((current) => attachVan(current, row.key, vanKey))}
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
      <div className={BOARD_FRAME} data-crew-plan="true">
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
                    over: over === `pool:${pool}`,
                    handlers: canPlan ? dropZone(`pool:${pool}`, poolAccepts, free) : {},
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
