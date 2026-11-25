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
//   · the toolbar: the strip counting the rows by type (the legacy strip: إجمالي، يومي، احتياطي … and
//     صيانة — the vans Fleet has in the workshop that day; Round 34 E moved it up here), then the acts
//     — the standing crew, «إضافة صف بدون سيارة», «Excel», «تراجع», «حفظ (n)» (one batch, only with
//     changes);
//   · the bar: the day, the van, the person, the direction and the type filter. The types are
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
// WHO TAKES WHICH SLOT (Round 23) — «ممنوع ان اعين قائد مكان اخصائى والعكس الا فى حالة انه قائد
// اخصائى»: a captain only in «قائد الطاقم», a specialist only in «أخصائي 1/2», a captain-specialist
// (blue) anywhere — the contracts' `fitsCrewSlot`, which the save holds to as well. Every way of
// seating somebody asks it: a drop aimed at a slot not his is refused in words (red while he
// hovers), a drop on the row routes him only into slots he fits, a slot's list offers only who fits
// it (the blue ones last), «اختر ثم ضع هنا» arms only those slots, and the standing crew leaves out a
// seat its person no longer fits. Somebody seated so BEFORE the rule — or before his flags changed —
// keeps the seat, marked, until the planner takes him out, and a row holding him gets no van. And
// in the pools a captain-specialist is listed in «القادة» only, at its end: «لو قائد واخصائى يبقى فى
// القايمة بتاعت القائد بس يكونوا فى الاخر».
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
// since it was picked) is said AND marked on that row's box. A direction is never refused since
// Round 28 («عاوز الاتجاه اقدر اكتبه بايدى لو مش موجود فى الليست»): one typed by hand is saved.
//
// ROUND 24 — after the owner's next look:
//   · «تراجع» IS ONE STEP BACK — «وعاوز تراجع دا يتراجع عن اخر عمليه مش كل العمليات فاهم». It threw away
//     every unsaved change at once; now each press takes back the LAST operation only — a drop, a
//     pick, a ✕, a van given, a row added, deleted or emptied, a type, colour, time, direction or
//     notes change, the standing crew loaded or taken off — and the next press the one before, until
//     nothing is left (`lib/crew-undo.ts`). Ctrl+Z (⌘Z) does the same outside a text box; the
//     button's tooltip says what it will take back. A save clears the history; another desk's save
//     rebases it with the draft;
//   · «بدون سيارة» OFFERS EVERY CAR WITH NO CREW — «مكان بدون سيارة دا لما ادوس عليه يجيب كل السيارات
//     اللى مش عليها طاقم واقدر اختار منهم»: the server's `freeVehicles` through the draft
//     (`lib/crew-vehicles.ts`), in a list like a slot's (`CrewVehiclePicker`). A roster van merges
//     the row into its blank row, as before; any other car turns the row into that car's row, which —
//     off the roster — can be deleted again. A SAVED row keeps its id on its new van, so the محصنات
//     «توزيع المحصنات» placed on it follow it;
//   · THREE MORE FILTERS between the day and the type — «انه يقدر يفلتر ب كود عربيه و كمان ادخل اسم
//     قائد او اخصائى او الكود بتاع اى حد فيهم وكمان افلتر ب الاتجاه» (`lib/crew-plan-filter.ts`). They
//     narrow the table only: hidden rows keep their changes and «حفظ» saves them all. The chips
//     count the whole day; «المعروض N من M» says what the filters leave.
//
// ROUND 24b — «عاوز pallett الالوان يكون على عدد الالوان يكون نفس عدد النوع وعاوز فوق خالص جمب الطاقم
// الثابت لما ادوس عليها يفتح كارد زى جدول اقدر ادى كل نوع لون من الالوان وعاوز اللون فى الجدول يكون
// متشبع اكتر من كدا»: ONE palette, the types', of as many swatches as live types (`lib/type-colours.ts`);
// «ألوان الأنواع» beside «الطاقم الثابت» opens the table that colours the types (a catalog save, never
// a step of «تراجع»); a row is drawn in the colour picked on it, else its type's («تلقائي ويتغيّر
// يدوي»), a deep tint with a solid bar at its start edge.
//
// ROUND 32 — «لما بجيب السجل فى لوحة التشغيل بيخلى اعدل وانا عاوزها اظهار فقط»: a PAST day opens as
// its RECORD, view only for everyone (`lib/crew-record.ts`): every act asks `canPlan`, which a record
// shuts — no drag, no list, no van, no row, no box, no «الطاقم الثابت», no «تراجع», no «حفظ». A calm
// notice says so, and «العودة إلى اليوم» stands where the acts were; the filters and the hover cards
// still work. The server refuses the day's save whatever is sent (422 `OPERATIONS_CREW_DAY_IN_PAST`).
//
// ROUND 32 C — «انا عاوز بقى اقدر اعمل اسوابنج بين عربيتين واقدر احدد هنقل ايه بالظبط للعربيه
// التانيه»: a row's «⇄» opens «تبديل بين سيارتين» (`CrewSwapDialog`) — the two vans' cards side by
// side, every person and field ticked to cross or not, and three arrows between them that MOVE the
// ticked items on the window's working copy (Round 34 D): one way, or both ways for the swap, press
// after press, «تراجع عن آخر نقل» inside. The board's rules hold (`lib/crew-swap.ts`); «تطبيق» is
// ONE operation on the draft for «تراجع», saved by «حفظ» like any other. Not on a record.
//
// ROUND 34 E — «واسمح الحاجات اللى فوق دى وحط مكاناها الاجماليات بدل ما انت لما بختار حاجه بينزل سطر ل
// تحت»: the legend and the hint left the toolbar's start and the TOTALS took it, on the acts' line
// (the acts their icons below 1760, «حفظ» in words); the bar is one line from 1280. Nothing picked
// or chosen takes a line of its own: a chip picked up lies over the totals in their box, «المعروض N
// من M» comes at the bar's end in room the line keeps, and the totals scroll sideways inside their
// box — the hidden edge fading — rather than wrap.
//
// `?date=` is the only thing in the URL: empty means TOMORROW, resolved by the server — crews are
// planned a day ahead (the legacy default).
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type HTMLAttributes,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CREW_SLOT_CAPACITY,
  OPERATIONS_DIRECTION_MAX_LENGTH,
  type Locale,
  type OperationsCrewMemberDto,
  type OperationsShiftTypeDto,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { cn } from '../../../shared/lib/cn';
import { formatNumber } from '../../../shared/lib/format';
import { pluralKey } from '../../../shared/lib/plural';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Input } from '../../../shared/ui/form';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useAppSelector } from '../../../store';
import { useMinWidth } from '../../atm/lib/useMinWidth';
import { useUnsavedGuard } from '../../atm/lib/useUnsavedGuard';
import { BOARD_FRAME } from '../../fleet/components/board-scroll';
import { pickOne } from '../../fleet/components/dark-filter-bar';
import { DesignCancel, DesignDialog, DesignSave } from '../../fleet/components/DesignDialog';
import { FILTER_ICON, FilterWithIcon } from '../../fleet/components/FilterWithIcon';
import { BoardIcon, NUM, PATH } from '../../fleet/components/FuelCardBoard';
import {
  useActiveOperationsAreaNames,
  useOperationsCrewBoard,
  useOperationsCrewDirectory,
  useOperationsShiftTypes,
  useOperationsStandingCrew,
  usePlanOperationsCrew,
} from '../api/operations-queries';
import {
  addLandsOn,
  useArchivedOperationsAreaNames,
  useDirectionAreaAdd,
} from '../api/direction-area';
import { CrewVehicleHoverCode } from '../components/BoardCrewCards';
import { CrewPlanChip } from '../components/CrewPlanChip';
import {
  CREW_PLAN_BAR,
  CREW_PLAN_CELLS,
  CREW_PLAN_GRID,
  CREW_PLAN_POOL_HEIGHT,
  CREW_PLAN_POOLS,
  CREW_PLAN_TABLE,
  CREW_PLAN_TABLE_SIDE,
  CrewPlanHand,
  FilteredCount,
  filteredCountAt,
  HEAD_CHIP,
  HEAD_STRIP,
  PlainDot,
  ReturnPickedButton,
  ViewOnlyMark,
  countChipTone,
  targetAt,
  unknownMember,
} from '../components/CrewPlanFrame';
import {
  CELL_BOX,
  DirectionPicker,
  RowColourPicker,
  ShiftTypePicker,
  TimePicker,
  VanPicker,
} from '../components/CrewPlanControls';
import { CrewPlanPool } from '../components/CrewPlanPools';
import { CrewRosterNotice } from '../components/CrewRosterNotice';
import { CrewSlotPicker } from '../components/CrewSlotPicker';
import { CrewSwapDialog } from '../components/CrewSwapDialog';
import { CrewVehiclePicker, NoCodeTag } from '../components/CrewVehiclePicker';
import { PLAN_ICON } from '../components/crew-plan-icons';
import { DayBox, RecordNotice, dayText } from '../components/SecuredDistributionParts';
import { ADD_BUTTON, BRAND_BUTTON } from '../components/ShipmentsBoard';
import { SHIPMENT_PATH } from '../components/shipment-icons';
import { ON_TINT, ShiftTypeDot, rowTint, shiftTypeName } from '../components/shift-type-look';
import { TypeColoursCard } from '../components/TypeColoursCard';
import {
  CREW_SLOTS,
  EMPTY_POOL_QUERY,
  NO_SHIFT_TYPE,
  PLAN_POOLS,
  SHIFT_TYPE_LIST,
  awayOf,
  changeCount,
  clearStandingFromPlan,
  crewRoleOf,
  crewShortfall,
  discardRow,
  freeMember,
  isBlankRow,
  isCrewClash,
  isRemovableRow,
  listPool,
  loadStandingIntoPlan,
  looseRowNumber,
  matchesShiftType,
  patchRow,
  placeMember,
  planChanges,
  planRefusal,
  planRowCard,
  rebaseDraft,
  releaseVan,
  restoreRemovedRow,
  rowMisfits,
  rowPeople,
  seatOf,
  shiftTypeStrip,
  standingForDay,
  toPlan,
  toPlanRows,
  vehiclelessRow,
  wrongSlotOf,
  type CrewRole,
  type CrewRowColourSetting,
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
  refusedAsWrongSlot,
  resolveDrop,
  targetKey,
  type DropDecision,
  type DropTarget,
  type RefusedDrop,
} from '../lib/crew-drag';
import { crewPlanSheet } from '../lib/crew-plan-export';
import {
  EMPTY_ROW_FILTER,
  NO_DIRECTION,
  NO_VAN,
  directionFilterOptions,
  hidesAnyOf,
  isRowFiltering,
  matchesRowFilter,
  vanFilterOptions,
  type PlanRowFilter,
} from '../lib/crew-plan-filter';
import {
  changedRowKeys,
  isBoardUndoKey,
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
import { giveVehicle, vanName, vehicleChoices, type VehicleChoice } from '../lib/crew-vehicles';
import {
  applySwapStepsToDraft,
  swapStepsOperation,
  type SwapRules,
  type SwapStep,
} from '../lib/crew-swap';
import { isCrewRecord } from '../lib/crew-record';
import { useCairoToday } from '../lib/use-cairo-today';
import {
  catalogStateOf,
  colourWearers,
  paletteFor,
  NO_ROW_COLOUR,
  resolveRowColour,
  rowColourChoices,
  typeColourOf,
  type PaletteColour,
} from '../lib/type-colours';
import { saveReportWorkbook } from '../lib/report-export';
import { sideFade, useSideScroll } from '../lib/side-scroll';

/** `?date=` empty means TOMORROW, resolved by the server — the legacy planning default. */
export const resolveCrewDate = (raw: string | null): string | null =>
  raw !== null && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;

/**
 * The boards' table, fitted to a row of controls (`CREW_PLAN_TABLE`, shared with «الطاقم الثابت»
 * since Round 27 — the chips' and controls' own size, the cells' 4px sides), and the board's own:
 *   · a control that IS a box (`data-cell-box` — the type) keeps the box's own height and fills its
 *     column, as the time's and the notes' inputs do: the boards' button rules would otherwise
 *     shrink it to its words, and a column of boxes of every width is what the owner pointed at
 *     («مفيش حاجه داخلة وحاجه خارجه»). The selector names both attributes, to outrank the line above.
 */
const PLAN_TABLE = cn(
  CREW_PLAN_TABLE,
  '[&_td_button[data-cell-control][data-cell-box]]:!h-8 [&_td_button[data-cell-control][data-cell-box]]:!w-full',
  CREW_PLAN_CELLS,
  // Round 24b — on a row drawn in its colour, a marked chip (picked up, refused, away that day, in a
  // seat not his role's) stands on a halo of the page's own colour: an amber ring or dashed outline
  // on an amber row, a rose one on a rose row, would otherwise melt into the tint.
  '[&_tr[data-row-colour]_[data-crew-chip]:is([data-selected],[data-refused],[data-away],[data-wrong-slot])]:shadow-[0_0_0_3px_#fff]',
  'dark:[&_tr[data-row-colour]_[data-crew-chip]:is([data-selected],[data-refused],[data-away],[data-wrong-slot])]:shadow-[0_0_0_3px_#0b1226]',
);

/**
 * Round 34 E — the board's bar on ONE line from 1280 (8px between its boxes): the day, the van, the
 * person, the direction, the type and — at its end, when the filters narrow — «المعروض N من M». The
 * totals left it for the toolbar; «الطاقم الثابت» keeps the shared bar as it was.
 */
const CREW_PLAN_BAR_LINE = cn(CREW_PLAN_BAR, 'min-[1280px]:flex-nowrap min-[1280px]:gap-x-2');

/**
 * Round 34 E — the acts beside the totals. From 1280 to 1759 the totals share the acts' ONE line, and
 * each act but «حفظ» is its icon in a 34px square, its word still its name (`ACT_WORD`, read by a
 * screen reader) and its tooltip: eleven types, «الإجمالي», «بدون نوع» and «صيانة» in 2–3 figures
 * beside the six labelled acts asked 1,600px of a 1440 screen's 1,320. From 1760 every act keeps its
 * word, as before.
 *
 * Round 34 critic — and only there. From 820 to 1279 the totals have a line of their own and the acts
 * keep their words on the next (in English 709px, «Save (n)» 30 more, of the 772px an 820 screen
 * gives the board). Below 820 the words do not fit one line (English at 768: 720px), so the acts are
 * their icons again — in 44px squares there, a finger's size: a phone and a tablet held upright.
 */
const ICON_ACT =
  'max-[819px]:h-11 max-[819px]:w-11 max-[819px]:justify-center max-[819px]:!px-0 min-[1280px]:max-[1759px]:h-[34px] min-[1280px]:max-[1759px]:w-[34px] min-[1280px]:max-[1759px]:justify-center min-[1280px]:max-[1759px]:!px-0';
const ACT_WORD = 'max-[819px]:sr-only min-[1280px]:max-[1759px]:sr-only';
/** An act in words — «حفظ», a past day's mark and «العودة إلى اليوم» — below 820 as high as the icons. */
const WORD_ACT = 'max-[819px]:h-11';
/** A total's figure, beside its name: 11px (11.5 from 1440), the figures' face. */
const HEAD_FIGURE = 'text-[11px] font-black min-[1440px]:text-[11.5px]';

export const CrewBoardPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  const date = resolveCrewDate(sp.get('date'));
  const mayPlan = can('operationsCrew.plan');
  // Round 24b — «ألوان الأنواع» writes the catalog, under the catalog's own grant (no new one).
  const canColourTypes = can('operationsCatalog.manage');

  const board = useOperationsCrewBoard(date);
  const day = date ?? (board.data?.date ?? '').slice(0, 10);
  // Round 32 — a past day is its RECORD: read only, for everyone (`isCrewRecord` — the server's
  // `past` once the read is in, and midnight passing on this screen). Every act below asks this.
  const liveToday = useCairoToday();
  const isRecord = isCrewRecord(
    day,
    liveToday,
    board.data === undefined ? null : { board: board.data, arrivedAt: board.dataUpdatedAt },
  );
  const canPlan = mayPlan && !isRecord;
  // The pool is read for the BOARD'S day, never for «no day». With no `?date=` the board is
  // TOMORROW (the server's planning default), but the roster asked without a date answers for
  // TODAY — and since Round 22 it says who is absent or on leave, a fact about one day: read for
  // today, it faded today's absentees on tomorrow's board and offered tomorrow's, whom the save
  // then refused. So the default board's pool waits for the board to name its day.
  const directory = useOperationsCrewDirectory(day === '' ? null : day, day !== '');
  const standing = useOperationsStandingCrew();
  // EVERY active area, not one page: the save respells a new direction naming any of them.
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
  //
  // Round 24 — THE DRAFT KEEPS ITS HISTORY (`lib/crew-undo.ts`): the rows and the standing crew's
  // toggle on screen, and before each operation the draft as it was, so «تراجع» takes back ONE
  // operation a press. Every change to the draft goes through `apply` — one entry per operation, the
  // rows it touched however many. A new day and the save's own read-back start it afresh; another
  // desk's save rebases every entry the way it rebases the draft (`rebaseHistory`).
  const [history, setHistory] = useState<UndoHistory<CrewDraft>>(() =>
    startHistory({ rows: [], standingKeys: null }),
  );
  // A record shows what the SERVER holds, never a draft (work left unsaved when the day ended is
  // said — `lostOnRecord` — not drawn, counted or sent).
  const rows = isRecord ? serverRows : history.now.rows;
  const standingKeys = history.now.standingKeys;
  const [seen, setSeen] = useState<{ rows: readonly PlanRow[]; day: string | null } | null>(null);
  /** The last save's refusal, on the row and the box it names — until that box is changed. */
  const [refusal, setRefusal] = useState<(PlanRefusal & { message: string }) | null>(null);
  const answeredDay = board.data?.date ?? null;
  if (seen === null || seen.rows !== serverRows) {
    setSeen({ rows: serverRows, day: answeredDay });
    if (seen !== null && seen.day !== null && seen.day === answeredDay && !plan.isPending) {
      const base = seen.rows;
      setHistory((current) =>
        rebaseHistory(
          current,
          (state) => ({ ...state, rows: rebaseDraft(state.rows, base, serverRows) }),
          sameCrewDraft,
        ),
      );
    } else {
      setHistory(startHistory({ rows: serverRows, standingKeys: null }));
      setRefusal(null);
    }
  }
  const sequence = useRef(0);

  /**
   * ONE operation on the draft: the change, and what «تراجع» will say it takes back. Nothing
   * changed (a refused drop, a type picked again) records nothing. `merge` makes a run of keys in
   * one box one operation (the notes), until the box is left (`sealHistory`).
   */
  const apply = (what: UndoWhat, change: (draft: CrewDraft) => CrewDraft, merge?: string): void => {
    // Round 32 critic — the ONE gate of every change to the draft: a list left open as midnight
    // turned the day into its record picked into the draft the record hides — nothing showed, and
    // «انتهى اليوم قبل الحفظ» was said again.
    if (!canPlan) return;
    setHistory((current) =>
      record(
        current,
        change(current.now),
        what,
        merge === undefined ? { same: sameCrewDraft } : { same: sameCrewDraft, merge },
      ),
    );
  };
  /** An operation on the rows alone. */
  const applyRows = (
    what: UndoWhat,
    change: (current: readonly PlanRow[]) => readonly PlanRow[],
    merge?: string,
  ): void => apply(what, (draft) => ({ ...draft, rows: change(draft.rows) }), merge);

  const changes = planChanges(rows, serverRows);
  const pending = changeCount(changes);
  const dirty = pending > 0;
  const guard = useUnsavedGuard({ dirty });
  // Round 32 — the board left open past midnight with work not saved: the record no longer draws it
  // and the leave guard lets go, so it is SAID, once as it happens and on the notice while it stands.
  const lostOnRecord = isRecord ? changeCount(planChanges(history.now.rows, serverRows)) : 0;
  useEffect(() => {
    if (lostOnRecord === 0) return;
    toast.warning(
      t('operations.crewPlan.record.unsavedTitle'),
      t('operations.crewPlan.record.unsaved', { count: formatNumber(lostOnRecord, locale) }),
    );
    // Once per count the record drops — not on every render (`t` and `locale` are not the news).
  }, [lostOnRecord]);

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

  // ── The colours (Round 24b) ──────────────────────────────────────────────────────────────────
  // «عاوز pallett الالوان يكون على عدد الالوان يكون نفس عدد النوع»: ONE palette, the types', of as
  // many swatches as there are live types (`lib/type-colours.ts`). A row is drawn in the colour
  // picked by hand on it, else its type's — «تلقائي ويتغيّر يدوي».
  const palette = useMemo(() => paletteFor(shiftTypes), [shiftTypes]);
  // The palette is the types': until their list answers, the «اللون» list and «ألوان الأنواع» say it
  // is loading (or failed, with «إعادة المحاولة») — never «no active types» while nine exist.
  const typesCatalog = catalogStateOf(shiftTypeList);
  const rereadTypes = async (): Promise<readonly OperationsShiftTypeDto[] | undefined> =>
    (await shiftTypeList.refetch()).data?.items;
  const colourName = (colour: PaletteColour): string =>
    t(`operations.catalogs.shiftType.colours.${colour}`);
  const wornBy = (colour: PaletteColour): string[] =>
    colourWearers(shiftTypes, colour).map((type) => shiftTypeName(type, locale));
  const colourOfRow = (row: PlanRow) =>
    resolveRowColour(row.rowColour, typeColourOf(shiftTypes, row.shiftTypeId));
  const [typeColoursOpen, setTypeColoursOpen] = useState(false);

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
  // Round 24 — the van, the person and the direction, AND-ed with the type. View only: a hidden row
  // keeps its changes, and «حفظ» saves them all. The chips below count the WHOLE DAY.
  const [rowFilter, setRowFilter] = useState<PlanRowFilter>(EMPTY_ROW_FILTER);
  const filtering = isRowFiltering(rowFilter) || typeFilter !== '';
  const isShown = (row: PlanRow): boolean =>
    matchesShiftType(row, typeFilter) &&
    matchesRowFilter(row, rowFilter, { memberOf, areaNames: directions });
  const shown = rows.filter(isShown);
  const clearFilters = (): void => {
    setTypeFilter('');
    setRowFilter(EMPTY_ROW_FILTER);
  };
  const strip = shiftTypeStrip(shiftTypes, rows);
  /**
   * A row's name: its van's code — its plate when the code names nothing (Round 32 critic,
   * `vanName`) — or «بدون سيارة (n)» by its place among `among` (the draft).
   */
  const rowName = (row: PlanRow, among: readonly PlanRow[] = rows): string =>
    vanName(row) ??
    t('operations.crewPlan.looseRow', {
      n: formatNumber(looseRowNumber(among, row.key) ?? 0, locale),
    });

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
   * and why nobody away goes on a row. A slot not his role's (Round 23): «لا يُعيَّن قائد في خانة
   * أخصائي» / «لا يُعيَّن أخصائي في خانة القائد», then whom that slot takes.
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
          : refusedAsWrongSlot(decision.reason)
            ? `operations.crewPlan.drop.${decision.reason}Why`
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
  // «المعروض N من M»: at the bar's end from 1280; below it at the end of the totals' line, which
  // never wraps (Round 34 verifier and critic — there the bar's filters fill its first line) — on a
  // phone in figures only (`compact`).
  const countAt = filteredCountAt({ oneLineHead: useMinWidth(1280) });
  /** «صيانة»'s codes, read with the chip when Tab reaches it (Round 34 critic). */
  const workshopWordsId = useId();
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
    setVanPicker(null);
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
  // ── A row's «بدون سيارة» list (Round 24) ────────────────────────────────────────────────────
  // «مكان بدون سيارة دا لما ادوس عليه يجيب كل السيارات اللى مش عليها طاقم»: ONE list for the board,
  // opened on the row whose cell was pressed — every car with no crew that day (`vehicleChoices`).
  const [vanPicker, setVanPicker] = useState<string | null>(null);
  const vanAnchor = useRef<HTMLElement | null>(null);
  const vanTrigger = useRef<HTMLElement | null>(null);
  /** The toolbar's totals (Round 34 E) — read for the fade over the edge that hides chips. */
  const stripRef = useRef<HTMLDivElement>(null);
  const openVanPicker = (key: string, from: HTMLElement): void => {
    if (vanPicker === key) {
      setVanPicker(null);
      return;
    }
    vanAnchor.current = from.closest<HTMLElement>('[data-van-picker]') ?? from;
    vanTrigger.current = from;
    setSelected(null);
    setPicker(null);
    setVanPicker(key);
  };
  const closeVanPicker = (back: boolean): void => {
    setVanPicker(null);
    if (!back) return;
    requestAnimationFrame(() => {
      const from = vanTrigger.current;
      if (from?.isConnected === true) from.focus({ preventScroll: true });
    });
  };
  // The row was given a van meanwhile (another desk, «تراجع»), or went: nothing left to offer.
  if (vanPicker !== null && !rows.some((row) => row.key === vanPicker && row.vehicleId === null)) {
    setVanPicker(null);
  }
  // Round 32 critic — midnight turning the day into its record under an open list (a slot's, a
  // row's «بدون سيارة») or a picked-up chip shuts them, as it shuts «تبديل بين سيارتين».
  if (!canPlan && (picker !== null || vanPicker !== null || selected !== null)) {
    setPicker(null);
    setVanPicker(null);
    setSelected(null);
  }
  const workshopIds = useMemo(
    () => new Set((board.data?.workshopVehicles ?? []).map((van) => van.vehicleId)),
    [board.data],
  );

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
  const nameOfRow = (key: string): string => {
    const row = rows.find((candidate) => candidate.key === key);
    return row === undefined ? '—' : rowName(row);
  };
  const place = (key: string, slot: CrewSlot, employeeId: string): void => {
    applyRows(
      {
        kind: 'place',
        vars: {
          name: shownMember(employeeId).fullNameAr,
          where: `${nameOfRow(key)} · ${t(`operations.crewPlan.columns.${slot}`)}`,
        },
      },
      (current) => placeMember(current, key, slot, employeeId),
    );
    setSelected(null);
    settleRefusedPerson(employeeId);
  };
  const free = (employeeId: string): void => {
    applyRows({ kind: 'free', vars: { name: shownMember(employeeId).fullNameAr } }, (current) =>
      freeMember(current, employeeId),
    );
    setSelected(null);
    settleRefusedPerson(employeeId);
  };
  /** Which operation a change of a row's own fields is — the tooltip's word for it. */
  const patchKind = (fields: Parameters<typeof patchRow>[2]): string =>
    'direction' in fields
      ? 'direction'
      : 'plannedTime' in fields
        ? 'time'
        : 'shiftTypeId' in fields
          ? 'type'
          : 'rowColour' in fields
            ? 'colour'
            : 'notes';
  const patch = (key: string, fields: Parameters<typeof patchRow>[2]): void => {
    const kind = patchKind(fields);
    applyRows(
      { kind, vars: { row: nameOfRow(key) } },
      (current) => patchRow(current, key, fields),
      // A run of keys in the notes box is ONE operation, until the box is left; the time panel's
      // hour and minute are one, until the panel closes (`mergeKeyOf`).
      mergeKeyOf(kind, key),
    );
    // The refused box is changed: what it said no longer describes it.
    setRefusal((current) => (current?.key === key ? null : current));
  };
  // Round 28c — «الاتجاه»'s «إضافة «…» إلى القائمة» («يعرض عليا اضيفه او لا»): for a planner who also
  // holds the catalog's own grant (no new one). The area is written at once; the row then takes it
  // as any direction change — ONE operation, which «تراجع» takes back without taking the area off.
  const canAddArea = canPlan && can('operationsCatalog.manage');
  const archivedAreas = useArchivedOperationsAreaNames(canAddArea);
  // Round 28c critic — the add belongs to its day and to the row as it was: stepped to another day,
  // the row gone (a «حفظ» read-back renames a new row), or its direction changed meanwhile by
  // another route, and the area is only added to the list — the toast says the row was not changed.
  const areaAdd = useDirectionAreaAdd(day, (key, area, from) => {
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
  /**
   * The row's colour picked by hand — or (null) taken off, back to its type's, or (Round 34 C,
   * `'none'`) taken off altogether, «بدون لون» over its type's. ONE operation for «تراجع», said with
   * the colour: «تلوين الصف 150 باللون كحلي» / «إعادة الصف 150 إلى لون نوعه» / «إزالة لون الصف 150».
   */
  const recolour = (key: string, rowColour: CrewRowColourSetting | null): void =>
    applyRows(
      rowColour === null
        ? { kind: 'colourAuto', vars: { row: nameOfRow(key) } }
        : rowColour === NO_ROW_COLOUR
          ? { kind: 'colourNone', vars: { row: nameOfRow(key) } }
          : { kind: 'colour', vars: { row: nameOfRow(key), colour: colourName(rowColour) } },
      (current) => patchRow(current, key, { rowColour }),
    );

  const selectChip = (employeeId: string): void => {
    setPicker(null);
    setSelected((current) => (current === employeeId ? null : employeeId));
  };

  // ── «تراجع» — one operation a press (Round 24) ─────────────────────────────────────────────
  // «وعاوز تراجع دا يتراجع عن اخر عمليه مش كل العمليات فاهم». The button says what it will take back;
  // the rows it changes are brought into view. What was picked up is put down and the lists close —
  // the hand starts afresh — and a save's refusal stays only on a row the press did not touch.
  const lastOperation = undoableStep(history, plan.isPending);
  const undoWords =
    lastOperation === null
      ? null
      : t(`operations.crewPlan.undo.kind.${lastOperation.what.kind}`, {
          ...lastOperation.what.vars,
        });
  const undoLast = (): void => {
    if (!canPlan || lastOperation === null || undoWords === null) return;
    const touched = changedRowKeys(rows, lastOperation.before.rows);
    setHistory(undo);
    setSelected(null);
    setPicker(null);
    setVanPicker(null);
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
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // Round 32 critic — never under a window over the board («تبديل بين سيارتين», «ألوان
      // الأنواع», the leave dialog): the press took back the board's last operation behind it.
      const overBoard =
        leaveOpenRef.current || document.querySelector('[data-dialog-root]') !== null;
      if (!isBoardUndoKey(event, overBoard)) return;
      event.preventDefault();
      undoRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // ── The acts ─────────────────────────────────────────────────────────────────────────────────
  const addRow = (): void => {
    sequence.current += 1;
    const row = vehiclelessRow(sequence.current);
    applyRows({ kind: 'addRow' }, (current) => [...current, row]);
    // A new row has no van, no person and no direction yet: every filter would hide it.
    clearFilters();
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
        direction: row.direction,
      })),
    [standing.data],
  );
  /**
   * «الطاقم الثابت»: fills EMPTY vans in the draft, and off again empties exactly those. Left off
   * his van, and named so the planner knows whose seat to fill (`standingForDay`): somebody away
   * that day (Round 22 — no row takes him, and the save would refuse him), and somebody whose
   * standing seat is not his role's (Round 23 — written before the rule, or before his flags
   * changed; loaded, he would take a seat the save refuses). Each counts as not loaded.
   *
   * Round 28b — «اه»: a van it fills takes its standing «الاتجاه» too, when its row has none (never
   * one the save refuses; in the areas' spelling, read against EVERY active area as the save reads
   * them). Never the time. Off again clears the direction it wrote, unless it was changed since.
   *
   * Round 28b critic — so it waits for those areas (the toggle is held while their list loads: read
   * against none, a direction of areas past the hand-typed ceiling was left behind without a word,
   * and a shorter one came down in the standing row's spelling); names the vans whose standing
   * direction it left behind all the same (the save would refuse it — a legacy hand-typed one, or
   * any while the areas' list failed); and shows what it filled, the filters going when they would
   * hide it (a van that took its direction left «بدون اتجاه» at the press).
   */
  const toggleStanding = (): void => {
    if (standingKeys !== null) {
      apply({ kind: 'standingClear' }, (draft) => ({
        rows: clearStandingFromPlan(
          draft.rows,
          draft.standingKeys ?? [],
          draft.standingDirections ?? {},
        ),
        standingKeys: null,
      }));
      return;
    }
    const day = standingForDay(standingSources, memberOf);
    const load = loadStandingIntoPlan(rows, day.sources, areaNames.data ?? []);
    // One operation, however many vans it filled: one press of «تراجع» takes the whole load back —
    // its people and its directions together.
    apply({ kind: 'standingLoad' }, () => ({
      rows: load.rows,
      standingKeys: load.filledKeys,
      standingDirections: load.directions,
    }));
    // What it filled is what the planner reviews before «حفظ»: no filter may hide it.
    if (hidesAnyOf(load.rows, load.filledKeys, isShown)) clearFilters();
    if (load.unavailable > 0) {
      toast.error(t('operations.crew.standing.unavailable', { count: load.unavailable }));
    }
    if (load.directionsLeftBehind.length > 0) {
      // The vans and why on the second line: the toast cuts its first one to its width.
      toast.error(
        t('operations.crewPlan.standingDirectionLeft'),
        t('operations.crewPlan.standingDirectionLeftWho', {
          names: load.directionsLeftBehind
            .map((key) => load.rows.find((row) => row.key === key))
            .filter((row): row is PlanRow => row !== undefined)
            .map((row) => rowName(row, load.rows))
            .join('، '),
          max: formatNumber(OPERATIONS_DIRECTION_MAX_LENGTH, locale),
        }),
      );
    }
    if (day.away.length > 0) {
      // The names on the second line: the toast cuts its first one to its width.
      toast.error(
        t('operations.crewPlan.standingAway'),
        day.away.map((employeeId) => shownMember(employeeId).fullNameAr).join('، '),
      );
    }
    if (day.wrongSlot.length > 0) {
      toast.error(
        t('operations.crewPlan.standingWrongSlot'),
        day.wrongSlot
          .map(
            ({ employeeId, slot }) =>
              `${shownMember(employeeId).fullNameAr} (${t(`operations.crewPlan.columns.${slot}`)})`,
          )
          .join('، '),
      );
    }
  };

  /**
   * A row without a van is given one — a roster van's blank row it merges into, or (Round 24) any
   * other car with no crew that day, which it takes where it stands. Not while somebody on it is away that day: the van would put
   * him on a van, which the save refuses (Round 22) — said now, by name, rather than at «حفظ». Nor
   * while somebody on it holds a seat his role does not fit (Round 23): on the van's row that seat
   * is a new one, which the save refuses too.
   */
  const giveVan = (row: PlanRow, choice: VehicleChoice): void => {
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
    // Only people the roster names: whose requirements the board cannot read, the save judges.
    const misfits = rowMisfits(row, (employeeId) =>
      byId.has(employeeId) ? roleOf(employeeId) : null,
    );
    if (misfits.length > 0) {
      toast.error(
        t('operations.crewPlan.vanWrongSlot'),
        t('operations.crewPlan.vanWrongSlotWho', {
          names: misfits.map(({ employeeId }) => shownMember(employeeId).fullNameAr).join('، '),
        }),
      );
      return;
    }
    applyRows(
      { kind: 'giveVan', vars: { code: vanName(choice) ?? choice.vehicleCode, row: rowName(row) } },
      (current) => giveVehicle(current, row.key, choice),
    );
    setRefusal((current) => (current?.key === row.key ? null : current));
    // A pick that merged the row into a roster van's row: that row, in the van's place.
    const landed = choice.vanKey ?? row.key;
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-plan-row="${landed}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    );
  };

  /**
   * Round 24 — the van a save refused (out of service, in the workshop, another desk's since the
   * read), taken off its row in one press (`releaseVan`): «تراجع» takes back only the LAST operation,
   * which is no longer the van once anything came after it. The row is «بدون سيارة» again — its crew
   * and its fields kept — and its cell offers the cars free now. One operation «تراجع» can take back.
   */
  const dropVan = (row: PlanRow): void => {
    const after = releaseVan(rows, serverRows, row.key);
    if (after === rows) return;
    // A saved row merged into a roster van comes back as its own row; any other keeps its key.
    const landed =
      row.key === `van:${row.vehicleId ?? ''}` && row.crewId !== null
        ? `loose:${row.crewId}`
        : row.key;
    const back = after.find((candidate) => candidate.key === landed);
    const named = back === undefined ? rowName(row) : rowName(back, after);
    applyRows({ kind: 'dropVan', vars: { code: vanName(row) ?? '', row: named } }, (current) =>
      releaseVan(current, serverRows, row.key),
    );
    setRefusal((current) => (current?.key === row.key ? null : current));
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-plan-row="${landed}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    );
  };

  // ── «تبديل بين سيارتين» (Round 32 C) ────────────────────────────────────────────────────────
  // «اقدر اعمل اسوابنج بين عربيتين واقدر احدد هنقل ايه بالظبط للعربيه التانيه»: opened on a row, the
  // second picked inside. What it may move is the board's own rules (`lib/crew-swap.ts`); «تطبيق» is
  // ONE operation on the draft, which «تراجع» takes back whole and «حفظ» saves.
  const [swapFrom, setSwapFrom] = useState<string | null>(null);
  // Shut on a record (midnight passing under it), and with its row gone.
  if (swapFrom !== null && (!canPlan || !rows.some((row) => row.key === swapFrom))) {
    setSwapFrom(null);
  }
  const swapRules: SwapRules = {
    // Somebody the roster no longer names is judged by the save, as when a van is given.
    roleOf: (employeeId) => (byId.has(employeeId) ? roleOf(employeeId) : null),
    awayOf: (employeeId) => awayOf(memberOf(employeeId)),
    // A type archived since its row took it stays there: the save takes only an ACTIVE type newly
    // given to a row — or one the receiving row's saved row holds already. A catalog not read yet
    // judges nothing (the save does).
    typeMayGo: (shiftTypeId, toKey) => {
      const type = shiftTypes.find((candidate) => candidate.id === shiftTypeId);
      return (
        type === undefined ||
        type.isActive ||
        serverRows.some((row) => row.key === toKey && row.shiftTypeId === shiftTypeId)
      );
    },
  };
  const openSwap = (key: string): void => {
    setSelected(null);
    setPicker(null);
    setVanPicker(null);
    setSwapFrom(key);
  };
  // Round 34 D — the window's arrows MOVE the ticked items on a working copy; «تطبيق» hands over
  // its presses, replayed here on the draft as it is NOW (another desk's save since the window
  // opened is judged again by the same rules) — ONE operation of «تراجع», whatever the count.
  const swapRows = (bKey: string, steps: readonly SwapStep[]): void => {
    if (!canPlan || swapFrom === null) return;
    const aKey = swapFrom;
    // Round 32 critic — one way throughout is said as a move («نقل المحدد من 213 إلى 255»), never
    // as a swap; and the standing crew's toggle lets go of the two rows (`applySwapStepsToDraft`).
    const what = swapStepsOperation(steps, { a: nameOfRow(aKey), b: nameOfRow(bKey) });
    apply(what, (draft) => applySwapStepsToDraft(draft, aKey, bKey, steps, swapRules));
    setSwapFrom(null);
    // What the last save said about either row no longer describes it.
    setRefusal((current) => (current?.key === aKey || current?.key === bKey ? null : current));
    toast.success(
      t(what.kind === 'swap' ? 'operations.crewPlan.swap.done' : 'operations.crewPlan.swap.moved', {
        ...what.vars,
      }),
      t('operations.crewPlan.swap.doneHint'),
    );
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
      // Saved: nothing is left to take back (the read-back has started the draft afresh already).
      setHistory((current) => startHistory(current.now));
      toast.success(t('operations.crewPlan.saved', { count: formatNumber(pending, locale) }));
    } catch (failure) {
      // A refusal that names a row is said in its own words AND marked on that row's box, brought
      // into view — on a board of fifty vans «this type is no longer active» alone leaves the
      // planner hunting for it. Anything else (a Q11 clash, a row deleted on another desk) is said only.
      const named = failure instanceof ApiError ? planRefusal(failure, sent) : null;
      // Round 24 — a deleted row that holds محصنات: put back where it was, and marked — its own
      // operation, so «تراجع» deletes it again if that is what the planner wants.
      const restored =
        named?.field === 'remove' && named.removed !== undefined
          ? serverRows.find((row) => row.crewId === named.removed?.crewId)
          : undefined;
      if (named?.field === 'remove' && restored !== undefined && named.removed !== undefined) {
        const crewId = named.removed.crewId;
        // Named by its place once it is back — the draft it was deleted from has no place for it.
        const back = rowName(restored, restoreRemovedRow(rows, serverRows, crewId));
        applyRows({ kind: 'restoreRow', vars: { row: back } }, (current) =>
          restoreRemovedRow(current, serverRows, crewId),
        );
      }
      const placed =
        named?.field === 'remove'
          ? restored === undefined
            ? null
            : { ...named, key: restored.key }
          : named;
      // A van refused (taken, in the workshop, out of service since the board was read): read the
      // board again, so the cars its «بدون سيارة» offers are the ones free NOW.
      if (placed?.field === 'vehicle') void board.refetch();
      if (placed === null) {
        // The board owns its errors (`usePlanOperationsCrew`'s `onError`), so this toast is the
        // only one: the plan's sentence for a Q11 clash, the failure's own words otherwise.
        toast.error(
          isCrewClash(failure) ? t('operations.crew.saveFailed') : errorMessage(failure, locale),
        );
        return;
      }
      // Somebody away that day (Round 22), or in a slot not his role's (Round 23): who, by name —
      // his chip on that row is ringed too.
      const aboutPerson = placed.field === 'crew' || placed.field === 'slot';
      const vehicleCode = (vehicleId: string): string => {
        const onRow = rows.find((row) => row.vehicleId === vehicleId);
        const free = board.data?.freeVehicles.find((van) => van.vehicleId === vehicleId);
        return (
          (onRow === undefined ? null : vanName(onRow)) ??
          (free === undefined ? null : vanName(free)) ??
          '—'
        );
      };
      const message =
        placed.field === 'vehicle' && placed.vehicle !== undefined
          ? t(`operations.crewPlan.refused.vehicle.${placed.vehicle.reason}`, {
              code: vehicleCode(placed.vehicle.vehicleId),
            })
          : placed.field === 'remove'
            ? t('operations.crewPlan.refused.remove', {
                count: formatNumber(placed.removed?.shipments ?? 0, locale),
              })
            : aboutPerson
              ? placed.person === undefined
                ? t(`operations.crewPlan.refused.${placed.field}`)
                : t(`operations.crewPlan.refused.${placed.person.reason}`, {
                    name: shownMember(placed.person.employeeId).fullNameAr,
                  })
              : t('operations.crewPlan.refused.type');
      setRefusal({ ...placed, message });
      toast.error(
        errorMessage(failure, locale),
        aboutPerson || placed.field === 'vehicle' || placed.field === 'remove'
          ? message
          : undefined,
      );
      // A filter hiding the row it names would hide the answer: the filters go.
      if (!shown.some((row) => row.key === placed.key)) clearFilters();
      requestAnimationFrame(() =>
        document
          .querySelector(`[data-plan-row="${placed.key}"]`)
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
      );
    }
  };

  useEffect(() => {
    leaveOpenRef.current = guard.leaveOpen;
  });
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
    // A row drawn in a colour: its empty slot's «+ اختيار» stands on the page's colour (`ON_TINT`).
    const tinted = colourOfRow(row).colour !== null;
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
    // Why it refuses, over the slot: full — the person away that day, in his own words — or
    // (Round 23) a slot for the other role: «للقادة فقط» / «للأخصائيين فقط».
    const refusedWord =
      overDecision?.kind === 'refuse' && refusedAsAway(overDecision.reason)
        ? t(`operations.crewPlan.away.day.${overDecision.reason}`)
        : overDecision?.kind === 'refuse' && refusedAsWrongSlot(overDecision.reason)
          ? t(`operations.crewPlan.wrongSlot.over.${overDecision.reason}`)
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
          // A seat held outside his role (Round 23) — marked, never taken from him here. Not for
          // somebody the roster no longer names: his requirements cannot be read, so no claim.
          const wrong = byId.has(employeeId)
            ? wrongSlotOf(crewRoleOf(member.requirements), slot)
            : null;
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
              wrongSlot={
                wrong === null
                  ? null
                  : {
                      why: wrong,
                      badge: t(`operations.crewPlan.wrongSlot.badge.${wrong}`),
                      reason: t(`operations.crewPlan.wrongSlot.held.${wrong}`),
                    }
              }
              refused={
                (refusal?.field === 'crew' || refusal?.field === 'slot') &&
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
              'flex min-h-[2rem] flex-1 items-center justify-center gap-1 rounded-md text-[11.5px] font-bold transition hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:hover:text-brand-200',
              // On a row drawn in a colour, the page's own colour under the words (`ON_TINT`).
              listOpen
                ? cn(
                    'text-brand-700 dark:text-brand-200',
                    tinted ? 'bg-brand-50 dark:bg-[#16203a]' : 'bg-brand-500/15',
                  )
                : tinted
                  ? ON_TINT.pick.tinted
                  : ON_TINT.pick.plain,
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

  /**
   * Round 32 C — the row's «⇄» («تبديل مع سيارة أخرى…»), on the code's second line: beside the
   * row's colour and bin it took 24px the table does not have at 1440 (and at 1920), pushing the bin
   * out of the frame — the Round-24 trouble the «إضافية» tag was moved under the code for. Not on a
   * record (`canPlan`).
   */
  const swapPill = (row: PlanRow): JSX.Element | null =>
    canPlan ? (
      <button
        type="button"
        // Its own size, not the boards' 28px icon square (`CREW_PLAN_TABLE`).
        data-cell-control="swap"
        data-row-swap={row.key}
        aria-haspopup="dialog"
        aria-expanded={swapFrom === row.key}
        aria-label={t('operations.crewPlan.swap.openRow', { row: rowName(row) })}
        title={t('operations.crewPlan.swap.open')}
        onClick={() => openSwap(row.key)}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded border px-1.5 py-px transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
          swapFrom === row.key
            ? 'border-brand-500 bg-brand-500 text-white'
            : 'border-brand-300 bg-white text-brand-700 hover:bg-brand-50 dark:border-brand-500/50 dark:bg-[#0a1233] dark:text-brand-200 dark:hover:bg-brand-500/15',
        )}
      >
        <BoardIcon d={PLAN_ICON.swap} className="h-3 w-3" width={2.25} />
      </button>
    ) : null;

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
              // On a row drawn in a colour, a disc of the page's own colour (`ON_TINT`): it is the
              // board's only sign of a short crew, and amber on a rose or amber row vanished.
              className={cn(
                'inline-flex',
                colourOfRow(row).colour !== null ? ON_TINT.short.tinted : ON_TINT.short.plain,
              )}
            >
              <BoardIcon d={PATH.warn} className="h-4 w-4" />
            </span>
          );
        // The save refused the van this row was given (Round 24): ringed, and why on hover — and,
        // when the van was given on this screen, «إزالة السيارة» takes it off in one press.
        const vanRefused = refusedOn(row, 'vehicle');
        const releasable =
          vanRefused !== null && canPlan && releaseVan(rows, serverRows, row.key) !== rows;
        return row.vehicleId !== null ? (
          <div
            className={cn(
              'flex min-h-[2.25rem] items-center gap-1 px-0.5',
              // Solid, on a white hair (Round 24b): it must read on a row drawn in rose too.
              vanRefused !== null &&
                'rounded-md ring-2 ring-rose-600 ring-offset-1 ring-offset-white dark:ring-rose-400 dark:ring-offset-[#0b1226]',
            )}
            title={vanRefused ?? undefined}
            data-van-refused={vanRefused === null ? undefined : 'true'}
          >
            {/* Round 24 — a van the Fleet roster does not have that day (given here, removable):
                its tag UNDER the code, never beside it — beside it, it widened the column past the
                frame at 1440 and pushed the row's bin and colour out of sight. */}
            <span className="flex flex-col items-start gap-0.5" data-van-code-stack="true">
              <CrewVehicleHoverCode
                // 18px a line: the code and the second line's 16px keep the cell at its 36px.
                // Round 32 critic — a code that names nothing: the PLATE, as the list named it
                // (smaller, and free to wrap between its letters and its digits — a plate is longer
                // than a code, and the column has no width to spare at 1440: on one line it ran the
                // bins out of the frame).
                className={cn(
                  NUM,
                  'cursor-default font-black',
                  row.uncoded == null
                    ? 'text-[14px] leading-[18px]'
                    : 'whitespace-normal text-[12.5px] leading-[16px]',
                )}
                code={vanName(row) ?? '…'}
                vehicleCrew={planRowCard(row, memberOf)}
              />
              <span className="flex flex-wrap items-center gap-0.5" data-van-second-line="true">
                {/* A refused van given here: «إزالة» takes the tag's line (one short line, the
                  column keeps its width) — what the planner can do now matters more than that the
                  van is off the roster. */}
                {releasable ? (
                  <button
                    type="button"
                    data-van-release={row.key}
                    title={t('operations.crewPlan.releaseVan', { code: vanName(row) ?? '' })}
                    aria-label={t('operations.crewPlan.releaseVan', {
                      code: vanName(row) ?? '',
                    })}
                    onClick={() => dropVan(row)}
                    className="inline-flex h-4 shrink-0 items-center gap-0.5 rounded border border-rose-400 bg-rose-500/10 px-0.5 text-[9.5px] font-black leading-none text-rose-700 transition hover:bg-rose-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 dark:border-rose-500/70 dark:text-rose-300"
                  >
                    <BoardIcon d={PLAN_ICON.noVan} className="h-2.5 w-2.5 shrink-0" />
                    {t('operations.crewPlan.releaseVanName')}
                  </button>
                ) : (
                  !row.onRoster && (
                    <span
                      role="img"
                      data-off-roster="true"
                      aria-label={t('operations.crewPlan.offRoster')}
                      title={t('operations.crewPlan.offRosterHint')}
                      className="inline-flex h-4 shrink-0 items-center rounded border border-dashed border-sky-400 px-0.5 text-[9.5px] font-black leading-none text-sky-700 dark:border-sky-500/70 dark:text-sky-300"
                    >
                      {t('operations.crewPlan.offRosterTag')}
                    </span>
                  )
                )}
                {/* Round 32 critic — the plate stands where a code would: «بلا كود», as in the list. */}
                {row.uncoded != null && <NoCodeTag className="!px-0.5 !text-[9.5px]" />}
                {swapPill(row)}
              </span>
            </span>
            {warn}
          </div>
        ) : (
          <div className="flex min-h-[2.25rem] items-center gap-1" data-vehicleless="true">
            <span className="flex flex-col items-start gap-0.5">
              <VanPicker
                rowKey={row.key}
                open={vanPicker === row.key}
                disabled={!canPlan}
                refused={vanRefused}
                onOpen={(from) => openVanPicker(row.key, from)}
              />
              {swapPill(row)}
            </span>
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
          // The panel closed (or a typed time was taken): the next change of it is a new operation.
          onSettle={() => setHistory(sealHistory)}
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
          // Leaving the box ends the typing: the next key in it is a new operation for «تراجع».
          onBlur={() => setHistory(sealHistory)}
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
        // A row without a van — and (Round 24) a van off the roster — is deleted; a roster van's
        // row is emptied.
        const loose = isRemovableRow(row);
        const label = t(loose ? 'operations.crewPlan.row.remove' : 'operations.crewPlan.row.clear');
        return (
          // On the boxes' line: as tall as a box, the swatch and the bin centred in it — never
          // riding above or below the direction, time, type and notes beside them.
          <span className="flex h-8 items-center gap-1" data-row-actions-line="true">
            <RowColourPicker
              rowKey={row.key}
              value={row.rowColour}
              typeColour={typeColourOf(shiftTypes, row.shiftTypeId)}
              hasType={row.shiftTypeId !== null}
              choices={rowColourChoices(palette, row.rowColour)}
              wornBy={wornBy}
              catalog={typesCatalog}
              onRetry={() => void rereadTypes()}
              disabled={!canPlan}
              onChange={(rowColour) => recolour(row.key, rowColour)}
            />
            {canPlan && (
              <button
                type="button"
                data-row-discard={row.key}
                aria-label={`${label} — ${rowName(row)}`}
                title={label}
                disabled={!loose && isBlankRow(row)}
                onClick={() => {
                  applyRows(
                    { kind: loose ? 'removeRow' : 'clearRow', vars: { row: rowName(row) } },
                    (current) => discardRow(current, row.key),
                  );
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
  const workshopWords =
    workshop.length === 0
      ? t('operations.crewPlan.workshopNone')
      : t('operations.crewPlan.workshopHint', {
          codes: workshop.map((van) => van.vehicleCode).join('، '),
        });
  const typeValue = typeFilter === '' ? [] : [typeFilter];
  const pickedName = selected === null ? null : shownMember(selected).fullNameAr;
  const selectedSeated = selected !== null && seatOf(rows, selected) !== null;

  // Round 34 E — the totals' line scrolls sideways when it outgrows its room: the hidden edge fades.
  const stripEdges = useSideScroll(stripRef);
  const stripFade = sideFade(stripEdges, locale === 'ar');

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
          HEAD_CHIP,
          countChipTone(on, count),
          archived && !on && 'border-dashed border-amber-400 dark:border-amber-500/60',
        )}
      >
        {dot}
        {label}
        <span className={cn(NUM, HEAD_FIGURE, 'text-slate-900 dark:text-white')}>
          {formatNumber(count, locale)}
        </span>
      </button>
    );
  };

  return (
    <PageContainer fullHeight>
      <div className={BOARD_FRAME} data-crew-plan="true" {...boardDrop}>
        {/* The toolbar (Round 34 E): the TOTALS at the start, where the legend and the hint were — the
            owner: «واسمح الحاجات اللى فوق دى وحط مكاناها الاجماليات» — and the acts at the end, on ONE
            line from 1280 (the totals on a line of their own below). A chip picked up stands at the
            totals' start, on their line: «بدل ما انت لما بختار حاجه بينزل سطر ل تحت» — nothing moves.
            The role colours are on the chips and the pools' heads; how to seat somebody, on every
            empty slot («+ اختيار»). */}
        <div
          className="flex flex-wrap items-center gap-2 min-[1280px]:flex-nowrap"
          data-crew-plan-toolbar="true"
        >
          <CrewPlanHand
            pickedName={pickedName}
            onCancel={() => setSelected(null)}
            className="basis-full min-[1280px]:basis-0 min-[1280px]:flex-1"
          >
            <div
              ref={stripRef}
              role="group"
              aria-label={t('operations.crewPlan.counts')}
              title={t('operations.crewPlan.countsHint')}
              className={HEAD_STRIP}
              style={{ maskImage: stripFade, WebkitMaskImage: stripFade }}
              data-type-counts="true"
              data-strip-more={
                stripEdges.start || stripEdges.end
                  ? [stripEdges.start && 'start', stripEdges.end && 'end'].filter(Boolean).join(' ')
                  : undefined
              }
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
              {/* صيانة — the vans in the workshop: not rows of this board, so a figure, not a filter.
                  It takes the focus (Round 34 critic), so Tab carries the line to its end and a
                  screen reader says its codes; the mouse reads them in its tooltip. */}
              <span
                data-workshop-count={String(workshop.length)}
                tabIndex={0}
                aria-describedby={workshopWordsId}
                title={workshopWords}
                className={cn(
                  HEAD_CHIP,
                  'cursor-help border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200',
                )}
              >
                <BoardIcon d={PLAN_ICON.wrench} className="h-3 w-3" />
                {t('operations.crewPlan.workshop')}
                <span className={cn(NUM, HEAD_FIGURE)}>
                  {formatNumber(workshop.length, locale)}
                </span>
              </span>
            </div>
            <span id={workshopWordsId} className="sr-only">
              {workshopWords}
            </span>
            {/* Below 1280: what the filters leave, at the end of the totals' line — the bar's first
                line is full there; this line never wraps (the totals give way), so the count can
                never take a line of its own. */}
            {filtering && countAt === 'head' && (
              <FilteredCount
                shown={shown.length}
                total={rows.length}
                onClear={clearFilters}
                compact={phone}
              />
            )}
          </CrewPlanHand>
          <span className="ms-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1 min-[1280px]:flex-nowrap">
            {/* Without the planning grant: the board is read only — said by a lock and «للعرض فقط»,
                why in full in its tooltip (Round 34 E: no line of words over the totals). */}
            {!canPlan && !isRecord && <ViewOnlyMark className={WORD_ACT} />}
            {/* Round 32 — a record has no acts: the day says it is one, and the way back to today (a
                move between days, not a change — for every reader). */}
            {isRecord && (
              <>
                <span
                  data-crew-record-mark="true"
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-sky-200 bg-sky-50 px-2 py-1.5 text-[11px] font-black text-sky-800 sm:gap-1.5 sm:px-3 sm:py-2 sm:text-xs dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200',
                    WORD_ACT,
                  )}
                >
                  <BoardIcon d={[...PATH.lock]} className="h-3.5 w-3.5" />
                  {t('operations.crewPlan.record.mark')}
                </span>
                <button
                  type="button"
                  data-crew-record-today="true"
                  onClick={() => setDay(liveToday)}
                  title={t('operations.crewPlan.record.todayHint', {
                    day: dayText(`${liveToday}T00:00:00.000Z`),
                  })}
                  className={cn(BRAND_BUTTON, WORD_ACT)}
                >
                  <BoardIcon d={[...SHIPMENT_PATH.calendar]} className="h-3.5 w-3.5" />
                  {t('operations.crewPlan.record.today')}
                </button>
              </>
            )}
            {canPlan && (
              <button
                type="button"
                data-standing-toggle="true"
                aria-pressed={standingKeys !== null}
                // Round 28b critic — on, it reads each direction against the areas: not before
                // their list answers. Off never waits.
                disabled={
                  standingKeys === null && (standingSources.length === 0 || areaNames.isPending)
                }
                aria-busy={standingKeys === null && areaNames.isPending}
                title={`${t('operations.crewPlan.standing')} — ${
                  standingSources.length === 0
                    ? t('operations.crew.standing.none')
                    : standingKeys === null && areaNames.isPending
                      ? t('operations.crew.standing.areasLoading')
                      : t('operations.crew.standing.hint')
                }`}
                onClick={toggleStanding}
                className={cn(
                  BRAND_BUTTON,
                  ICON_ACT,
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  standingKeys !== null && '!bg-brand-500 !text-white',
                )}
              >
                <BoardIcon d={PLAN_ICON.layers} className="h-3.5 w-3.5" />
                <span className={ACT_WORD}>{t('operations.crewPlan.standing')}</span>
              </button>
            )}
            {/* Round 24b — «فوق خالص جمب الطاقم الثابت لما ادوس عليها يفتح كارد زى جدول اقدر ادى كل
                نوع لون من الالوان». For whoever reads the board; read only without the catalog's
                grant. */}
            <button
              type="button"
              data-type-colours-open="true"
              aria-haspopup="dialog"
              aria-expanded={typeColoursOpen}
              title={t('operations.crewPlan.typeColours.open')}
              onClick={() => setTypeColoursOpen(true)}
              className={cn(BRAND_BUTTON, ICON_ACT)}
            >
              <BoardIcon d={PLAN_ICON.palette} className="h-3.5 w-3.5" />
              <span className={ACT_WORD}>{t('operations.crewPlan.typeColours.open')}</span>
            </button>
            {canPlan && (
              <button
                type="button"
                data-add-loose-row="true"
                title={t('operations.crewPlan.addRow')}
                onClick={addRow}
                className={cn(BRAND_BUTTON, ICON_ACT)}
              >
                <BoardIcon d={PATH.plus} className="h-3.5 w-3.5" width={2.5} />
                <span className={ACT_WORD}>{t('operations.crewPlan.addRow')}</span>
              </button>
            )}
            <button
              type="button"
              data-crew-plan-excel="true"
              disabled={rows.length === 0}
              title="Excel"
              onClick={exportExcel}
              className={cn(
                BRAND_BUTTON,
                ICON_ACT,
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              <BoardIcon
                d={PATH.excel}
                className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
              />
              <span className={ACT_WORD}>Excel</span>
            </button>
            {canPlan && (
              // «تراجع» — the LAST operation only (Round 24); its tooltip says which.
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
                className={cn(
                  BRAND_BUTTON,
                  ICON_ACT,
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                <BoardIcon d={SHIPMENT_PATH.undo} className="h-3.5 w-3.5" />
                <span className={ACT_WORD}>{t('operations.crewPlan.discard')}</span>
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
                  WORD_ACT,
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

        {/* The day, the van, the person, the direction (Round 24) and the type — ONE line from 1280
            (Round 34 E), «المعروض N من M» at its end when the filters narrow, in room the line keeps. */}
        <div className={CREW_PLAN_BAR_LINE} data-crew-plan-bar="true">
          {/* Any day, a past one too — it opens as its record (Round 32). */}
          <DayBox label={t('operations.crewPlan.day')} value={day} min="" onChange={setDay} />
          {/* «يفلتر ب كود عربيه»: the board's vans by code, and «بدون سيارة». */}
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
              options={[
                { value: NO_VAN, label: t('operations.crewPlan.noVehicle') },
                ...vanFilterOptions(rows),
              ]}
              value={[...rowFilter.vans]}
              onChange={(next) => setRowFilter((current) => ({ ...current, vans: next }))}
            />
          </FilterWithIcon>
          {/* «ادخل اسم قائد او اخصائى او الكود بتاع اى حد فيهم». */}
          <FilterWithIcon
            icon={FILTER_ICON.person}
            tone="text-sky-600 dark:text-sky-400"
            className="w-full shrink-0 sm:w-56 min-[1280px]:max-[1365px]:w-48"
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
          {/* «وكمان افلتر ب الاتجاه»: the areas the board's directions name, and «بدون اتجاه». */}
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
          {/* From 1280: what the filters leave, at the bar's end in room the line keeps — and one
              press to show every row again. Below 1280 it is the totals' line's (`countAt`). */}
          {filtering && countAt === 'bar' && (
            <span className="flex shrink-0 min-[1280px]:ms-auto">
              <FilteredCount shown={shown.length} total={rows.length} onClear={clearFilters} />
            </span>
          )}
        </div>

        {/* Round 32 — a past day: the record's notice, calm, under the bar. */}
        {isRecord && (
          <RecordNotice
            data-crew-record={day}
            title={t('operations.crewPlan.record.title', {
              day: dayText(`${day}T00:00:00.000Z`),
            })}
            body={t('operations.crewPlan.record.body')}
            unsaved={
              lostOnRecord === 0
                ? null
                : t('operations.crewPlan.record.unsaved', {
                    count: formatNumber(lostOnRecord, locale),
                  })
            }
          />
        )}

        <CrewRosterNotice rosterIsDerived={directory.data?.rosterIsDerived} />

        {/* The table at the START, the pools at the END — in Arabic, the vans on the right and the
            names on the left, as the legacy board. The pools come first in the markup so that on a
            phone, where everything stacks, the names are met before fifty vans. */}
        {/* Below 1360 nothing is pinned: the page scrolls, the pools above the table — beside it,
            a 1280 laptop left the table 90px short and scrolling sideways. A height limit there
            also squeezed the pools to nothing on a phone (a flex column shrinks a child allowed
            `min-h-0` before it scrolls). From 1360 the grid takes the height left, and the table
            and each pool scroll inside it. */}
        <div className={CREW_PLAN_GRID} data-crew-plan-grid="true">
          <div className={CREW_PLAN_POOLS}>
            {PLAN_POOLS.map((pool) => {
              const listing = listPool(members, pool, rows, queries[pool]);
              const poolAccepts = (employeeId: string): boolean =>
                seatOf(rows, employeeId) !== null;
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
                // The row in its colour (Round 24b): its own, else its type's — a deep tint and a
                // solid bar at its start edge («عاوز اللون فى الجدول يكون متشبع اكتر من كدا»).
                rowClassName={(row) => {
                  const { colour } = colourOfRow(row);
                  return colour === null ? undefined : rowTint(colour);
                }}
                rowProps={(row) => {
                  const { colour, source } = colourOfRow(row);
                  const marks: Record<string, string> = { 'data-plan-row': row.key };
                  // Where its colour comes from: picked on the row, or its type's — or (Round 34 C)
                  // that «بدون لون» was picked on it, over its type's: drawn as a plain row.
                  if (colour !== null) {
                    marks['data-row-colour'] = colour;
                    marks['data-row-colour-source'] = source ?? 'type';
                  } else if (source === 'none') {
                    marks['data-row-colour-source'] = 'none';
                  }
                  if (refusal?.key === row.key) marks['data-row-refused'] = refusal.field;
                  return marks as HTMLAttributes<HTMLTableRowElement>;
                }}
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

      {/* A row's «بدون سيارة» list (Round 24) — every car with no crew that day. */}
      {vanPicker !== null && (
        <CrewVehiclePicker
          key={vanPicker}
          rowKey={vanPicker}
          rowName={nameOfRow(vanPicker)}
          anchor={vanAnchor}
          trigger={vanTrigger}
          sheet={phone}
          choices={vehicleChoices(
            rows,
            serverRows,
            board.data?.freeVehicles ?? [],
            vanPicker,
            workshopIds,
          )}
          unidentified={board.data?.unidentifiedVehicles ?? 0}
          onPick={(choice) => {
            const row = rows.find((candidate) => candidate.key === vanPicker);
            closeVanPicker(false);
            if (row !== undefined) giveVan(row, choice);
          }}
          onClose={closeVanPicker}
        />
      )}

      {/* «تبديل بين سيارتين» (Round 32 C) — one for the board, opened on the row pressed. */}
      {swapFrom !== null && canPlan && (
        <CrewSwapDialog
          key={swapFrom}
          aKey={swapFrom}
          rows={rows}
          rowName={(row) => rowName(row)}
          member={shownMember}
          rules={swapRules}
          shiftTypes={shiftTypes}
          colourName={colourName}
          locale={locale}
          onApply={swapRows}
          onClose={() => setSwapFrom(null)}
        />
      )}

      {/* «ألوان الأنواع» (Round 24b) — a catalog save per press, never a step of the draft. */}
      <TypeColoursCard
        open={typeColoursOpen}
        onClose={() => setTypeColoursOpen(false)}
        types={shiftTypes}
        listed={strip.chips.map(({ type }) => type)}
        // A record reads the type colours, never writes them (Round 32).
        canEdit={canColourTypes && !isRecord}
        sheet={phone}
        catalog={typesCatalog}
        reread={rereadTypes}
      />

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
