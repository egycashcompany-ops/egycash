// The shipments board — the toolbar's figures, the dark icon filter bar and the dark table that
// «اليوم التشغيلي» (`pages/DailyOperationsPage.tsx`, one day), «سجل الشحنات»
// (`pages/ShipmentsHistoryPage.tsx`, a range of days) and «الشحنات المحصنة»
// (`pages/SecuredBacklogPage.tsx`, every open محصنة) all show. «عاوز اعمل dublicat للشاشة دى بس
// التاريخ هيكون من الى»: the history is THIS screen with two dates where the day was; «شاشة الشحنات
// المحصنة عاوز شكلها يكون زى شاشة اليوم التشغيلى بس هنزود التاريخ التسليم يظهر فى الجدول والحالة»:
// the secured screen is THIS screen with a delivery-date column, the محصنة's stage as its status,
// and no «النوع» — every row on it is a محصنة. The pages share one board rather than one copy each — a column, a filter or a figure
// fixed on one of them is fixed on all three, and they cannot drift apart.
//
// A FOURTH SCREEN, THE VAULT'S. «شاشة الاستلام من الخزنة خليها زى شاشة التشغيل اليومى برضو»: the
// vault's receive queue (`pages/VaultReceivePage.tsx`) is this board too — the secured screen's
// columns, over the rows the vault receives. What it adds, it hands in through four small hooks
// that the other three screens leave alone: its own act on a row (`rowAction` — the vault's ✓),
// a line under the status (`statusNote`), its own row colour (`tintOf`) and its own toolbar
// controls (`toolbarExtras`); and it turns off what the treasury does not do there
// (`canEditRows`).
//
// THE STATUS, ON EVERY SCREEN. A daily row says who delivered it — «لم يتم التسليم», then «تم
// التسليم» on a yellow row (the crew captain, from the mobile app) or a green one (the desk's ✓).
// A secured row says its STAGE (`securedStage`, the server's; `lib/secured-stage.ts`): «لم يتم
// التسليم» white, «تم الاستلام من القائد» yellow, «بالخزينة» green, «خرجت للتسليم» blue, «تم
// التسليم» green — on the secured screen, and on the day board and the history alike, where a
// محصنة due for delivery is listed whatever its stage.
//
// WHAT THE PAGES OWN, AND WHAT THIS OWNS. A page owns its period — which rows the server is asked
// for (today, or from–to), the history's two date pickers and what a reset does to them — and
// what may be DONE from it (`canCreate`, `canToggleReceived`, what «إضافة شحنة» creates), and hands
// the answer in, with which board it is (`kind` — the secured screen's columns and filters differ).
// This owns
// everything over the answer: the filters (in the URL, remembered by the page's
// `useRememberedFilters`), the figures, the «عملات أخرى» breakdown, the table with its hover
// cards, tints and row actions — «السجل», each row's action log, among them on both screens — and
// «إضافة شحنة». All of it is presentation over rows the server already chose; the rules are pure
// functions in `lib/day-board.ts`, because the legacy versions of them read rendered HTML
// (main_ops.ejs:995). The history also hands in its range for the deleted shipments' icon.
//
// THE LEGACY TABLE (main_ops.ejs:829-897): م | السيارة | اسم البنك | من فرع | الى فرع | العملة |
// قيمة الشحنة | قائد الطاقم | التاريخ | النوع | المنطقة | ملاحظات | actions.
import { Fragment, useState, type ReactNode } from 'react';
import { type SetURLSearchParams } from 'react-router-dom';
import {
  MAX_PAGE_SIZE,
  type OperationsCurrencyDto,
  type OperationsDayBoardShipmentDto,
  type OperationsDayBoardVehicleCrewDto,
  type OperationsSecuredStage,
  type OperationsShipmentDto,
  type OperationsShipmentType,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Input } from '../../../shared/ui/form';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { formatAmount, formatNumber } from '../../../shared/lib/format';
import { useAppSelector } from '../../../store';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../../fleet/components/board-scroll';
import { DARK_FILTER_BAR, pickOne } from '../../fleet/components/dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from '../../fleet/components/FilterWithIcon';
import { FleetPager } from '../../fleet/components/FleetPager';
import { BoardIcon, NUM, PATH } from '../../fleet/components/FuelCardBoard';
import { ACTION_GROUP, PRESSED, actionTone } from '../../fleet/components/row-actions-look';
import { SquarePenIcon, Trash2Icon } from '../../fleet/components/row-action-icons';
import { DARK_TABLE } from '../../fleet/pages/VehiclesListPage';
import { CheckIcon, HistoryIcon } from '../../../shared/ui/icons';
import {
  useDeleteOperationsShipment,
  useOperationsBanks,
  useOperationsCurrencies,
  useSetShipmentReceived,
} from '../api/operations-queries';
import {
  DAY_BOARD_FILTER_PARAMS,
  branchCell,
  branchCellText,
  filterDayBoard,
  hasActiveFilter,
  boardDelivery,
  boardFigures,
  currencyOfKind,
  isReceived,
  otherCurrencies,
  readDayBoardFilters,
  offeredFilters,
  orderedBoardTotals,
  type BoardKind,
  type DayBoardFilters,
} from '../lib/day-board';
import {
  SECURED_SCREEN_STAGES,
  boardRowTint,
  offersDeliveryToggle,
  shownStage,
} from '../lib/secured-stage';
import {
  HISTORY_PAGE_SIZE,
  HISTORY_PAGE_SIZES,
  pageOfRows,
  type HistoryRange,
} from '../lib/shipment-history';
import { shipmentCaption } from '../lib/shipment-log';
import { DeliveryStatusBadge, SecuredStageBadge, ShipmentTypeBadge } from './ShipmentBadges';
import { BoardFigurePill, FIGURE_TONE, OtherCurrenciesDialog } from './BoardFigures';
import {
  ShipmentReceiptImageCell,
  ShipmentReceiptImagePreviewDialog,
} from './ShipmentReceiptImageCell';
import { CaptainHoverName, CrewVehicleHoverCode } from './BoardCrewCards';
import { DeletedShipmentsControl } from './DeletedShipments';
import { ShipmentFormDialog } from './ShipmentFormDialog';
import { ShipmentLogDialog, type ShipmentLogTarget } from './ShipmentLogDialog';
import { SHIPMENT_PATH } from './shipment-icons';

/** Every filter is `density="tight"`, as on the Fleet boards. */
const TIGHT = 'tight' as const;

/**
 * The Fleet boards' toolbar buttons (ReceiptsPage). Exported for a page's own toolbar controls
 * (`toolbarExtras`), so they wear the board's buttons rather than a look of their own.
 */
export const BRAND_BUTTON =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-brand-500/50 bg-brand-500/15 px-2 py-1.5 text-[11px] font-bold text-brand-700 transition hover:bg-brand-500/25 active:scale-95 sm:gap-1.5 sm:px-3 sm:py-2 sm:text-xs dark:text-brand-200';
export const ADD_BUTTON =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-gradient-to-r from-brand-700 to-brand-500 px-2 py-1.5 text-[11px] font-black text-white shadow-md shadow-brand-700/30 transition hover:from-brand-600 hover:to-brand-400 sm:gap-1.5 sm:px-3.5 sm:py-2 sm:text-xs active:scale-95';

/** The Fleet boards' table — no column lines, every value in Cairo's bold. */
const SHIPMENTS_TABLE = cn(
  DARK_TABLE,
  BOARD_TABLE_FILL,
  '[&_td+td]:!border-s-0 [&_th+th]:!border-s-0',
  "[&_td]:[font-family:'Cairo',ui-sans-serif,sans-serif] [&_td_*]:!font-bold",
  // Fourteen columns beside the menu on a laptop: the two icon boxes (the receipt's and the row's
  // actions) sit their icons closer than the Fleet boards' twelve-column tables need to.
  '[&_[data-row-actions]]:!gap-1 [&_[data-row-actions]]:!px-1 [&_[data-image-actions]]:!gap-1 [&_[data-image-actions]]:!px-1',
  // «السجل» made the day board's actions four icons (✎ ✓ السجل 🗑), 32px more than the table had
  // to spare at 1440 beside the menu — the bin went under the edge. The two cells that hold an icon
  // box give up most of their side padding (the box draws its own frame, and the columns have no
  // lines between them), and the notes' cut-off moves in by 8px: that buys the width back without
  // shrinking an icon or a name.
  '[&_td:has([data-row-actions])]:!px-1 [&_td:has([data-image-actions])]:!px-1',
);

/**
 * THE FILTER BAR'S ROWS — «الفلاتر هتكون كلها على صف واحد», on both screens («على نفس الصف»):
 *
 *   · a phone — two even columns, rather than boxes of four widths wrapping raggedly;
 *   · a tablet — the boxes' own widths, wrapping (the Fleet bar's own behaviour);
 *   · the day board from 1024px — the Fleet bar's single row (`DARK_FILTER_BAR`): its nine filters
 *     share the row evenly and the reset keeps its size at the row's end. Nothing to add here;
 *   · the history from 1280px — the same single row, but its two dates do not share: a date cut
 *     short is unreadable, so «من» and «إلى» keep their own width (`w-36`, a date and its name) and
 *     the nine other filters share what is left. Between 1024 and 1279 a row of eleven leaves a
 *     share narrower than a date, so there the history keeps TWO rows of even columns, the reset
 *     in a column of its own spanning both. That column is IMPLICIT — made by the reset's own
 *     placement, so it exists only while the reset shows; a spare explicit one would take a filter
 *     into it whenever there is nothing to reset.
 *
 * Written out because Tailwind reads class names from the source text, never a built one.
 */
const BAR_LAYOUT =
  'max-sm:[&>div]:!grid max-sm:[&>div]:!grid-cols-2 max-sm:[&>div>*:not(.ms-auto)]:!w-auto';
const PERIOD_BAR_LAYOUT = cn(
  'lg:max-xl:[&>div]:!grid lg:max-xl:[&>div]:!grid-cols-6 lg:max-xl:[&>div>.ms-auto]:!col-start-7',
  // In a grid cell a box keeps its own width (`w-32`) unless told to fill the cell.
  'lg:max-xl:[&>div]:!gap-x-1.5 lg:max-xl:[&>div]:!gap-y-2 lg:max-xl:[&>div>*:not(.ms-auto)]:!w-auto',
  'lg:max-xl:[&>div>.ms-auto]:!row-span-2 lg:max-xl:[&>div>.ms-auto]:!row-start-1 lg:max-xl:[&>div>.ms-auto]:!self-center',
  // One row from 1280: a date box keeps its own width instead of the Fleet bar's even share.
  'xl:[&>div>*:has(>input[type=date])]:!flex-none',
  // Up to 1439 that row leaves the nine others 82–96px each, narrower than the day board's at
  // 1024 — so the words go a size down, as the Fleet bar takes them at 1024–1279, and read whole.
  // The open list's search box keeps its own padding (`:where`, as the Fleet bar's rule).
  'xl:max-[1439px]:[&_:where(:not([role=listbox]_*))_>_input]:!px-1.5 xl:max-[1439px]:[&_input]:!text-xs',
  'xl:max-[1439px]:[&_button[aria-haspopup]]:!px-1.5 xl:max-[1439px]:[&_button[aria-haspopup]]:!text-xs',
  'xl:max-[1439px]:[&_button[aria-haspopup]_svg]:!h-3 xl:max-[1439px]:[&_button[aria-haspopup]_svg]:!w-3',
);

/** A figure in the table: monospace, tabular, never broken over two lines. */
const FIGURE = cn('whitespace-nowrap', NUM);
/** An empty cell, as the boards draw one. */
const DASH = <span className="text-slate-400">—</span>;
/**
 * A name that may wrap onto a second line rather than widen its column — the table's cells are
 * `nowrap`, and fourteen columns of unbroken names do not fit a laptop beside the menu.
 */
const WRAP = 'block min-w-[5rem] max-w-[9rem] whitespace-normal leading-tight';

/**
 * A date picker in the bar, at the «التاريخ» column's place: the history's «من» and «إلى» (the day
 * board has none — it is always today). The page owns the value and what a change writes.
 */
export interface BoardDatePicker {
  /** The URL param it is kept in — its key, too. */
  param: string;
  /** Its name, written on hover and read to a screen reader. */
  label: string;
  /**
   * Also WRITE the name in the box, beside its calendar — for the history's «من» and «إلى», which
   * are two boxes of the same look a reader must not mix up.
   */
  showLabel?: boolean;
  value: string;
  onChange: (value: string) => void;
}

export const ShipmentsBoard = <T extends OperationsDayBoardShipmentDto>({
  search: [sp, setSp],
  shipments,
  crews,
  loaded,
  loading,
  error,
  onRetry,
  datePickers = [],
  periodActive = false,
  periodParams = [],
  canCreate,
  createType = 'daily',
  canToggleReceived,
  kind = 'shipments',
  empty,
  refusal = null,
  paged = false,
  deletedShipments,
  canEditRows = true,
  stages = SECURED_SCREEN_STAGES,
  rowAction,
  statusNote,
  tintOf,
  toolbarExtras,
}: {
  /** The page's `useSearchParams()` — the filters live in the URL beside the page's period. */
  search: [URLSearchParams, SetURLSearchParams];
  /**
   * The rows the server chose for the period, newest created first — board rows, or rows that
   * carry more (the vault queue's `vaultReceivedAt`), which the page's hooks below are handed back.
   */
  shipments: readonly T[];
  /** The crews the rows ride, for the van's card. */
  crews: readonly OperationsDayBoardVehicleCrewDto[];
  /** The period's answer has arrived — the figures wait for it. */
  loaded: boolean;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  /** The period's pickers — none on the day board, which is always today. */
  datePickers?: readonly BoardDatePicker[];
  /** The period is not the page's default — a reset has something to undo. */
  periodActive?: boolean;
  /** The URL params the period lives in, cleared by the reset in the same write as the filters. */
  periodParams?: readonly string[];
  /**
   * «إضافة شحنة» is offered here — the day board, where the desk enters the day's work. The
   * history is not a place to add from («مش هيقدر يضيف»). Still subject to the permission.
   */
  canCreate: boolean;
  /**
   * What «إضافة شحنة» creates — decided by the screen, never chosen in the form: the day board adds
   * daily shipments («اشيل النوع ويكون يومى بس»), the secured screen secured ones («الفورم بتاعت
   * الاضافى لما اضيف اتوماتيك محصنة»), as legacy /mohsana did.
   */
  createType?: OperationsShipmentType;
  /**
   * The ✓ that confirms a delivery (and undoes one) is offered here — the day board, where the
   * day's deliveries are confirmed. Not from the history («مش هيقدر منها يسلم او يستلم»), which
   * still edits and deletes («عاوز عادى يعدل و يحذف»), nor from the secured screen, whose rows move
   * on by the captain's, the vault's and the dispatch's acts. Still subject to the permission, and
   * offered only on a row the server would take it for (`offersDeliveryToggle`).
   */
  canToggleReceived: boolean;
  /**
   * Which board this is (`BoardKind`). `shipments` — the day board and the history, daily rows and
   * محصنات side by side. `secured` — the secured screen, every row a محصنة, so:
   *   · «هنزود التاريخ التسليم يظهر فى الجدول» — a «تاريخ التسليم» column beside the date, which is
   *     then named for what it is on a محصنة, «تاريخ الاستلام» (elsewhere a secured row prints both
   *     days in the one date cell);
   *   · «الحالة» is filtered by stage, one at a time — «delivered or not» would lump four stages
   *     together;
   *   · no «النوع», column or filter — it would say «محصنة» on every row, and its 68px are what
   *     the extra date column needs to keep the actions on a 1440 laptop's screen.
   */
  kind?: BoardKind;
  empty: string;
  /**
   * Why the rows were not asked for, or were refused — said in the table's place instead of an
   * empty table or a generic failure (the history's range checks).
   */
  refusal?: string | null;
  /** Cut the table into pages — the history's thousands of rows. The figures stay over them all. */
  paged?: boolean;
  /**
   * «اعملى ايقون اقدر اجيب منه اللى اتمسح» — the icon in the toolbar that lists the shipments
   * deleted from the period's days, and brings one back. The history's: it hands in its range (and
   * whether the endpoint would take it). The day board has none.
   */
  deletedShipments?: { range: HistoryRange; enabled: boolean };
  /**
   * The row's edit and delete, and its receipt image's upload / replace / delete, are offered here
   * — still subject to the permissions. Every screen but one: on the vault's receive queue the
   * treasury RECEIVES; it does not edit the desk's shipments there («NO edit/delete»). The image
   * can still be looked at.
   */
  canEditRows?: boolean;
  /**
   * On a secured board (`kind`), the stages its «الحالة» filter offers — the ones its rows can be
   * in. The secured screen's open stages by default; the vault queue hands in its own (with or
   * without «الكل»). A stage in the URL that is not offered narrows nothing, as a param with no box.
   */
  stages?: readonly OperationsSecuredStage[];
  /**
   * The page's own act on a row, drawn in the row-actions group at the ✓'s place — the vault's ✓
   * («استلام في الخزينة») on its receive queue. The page decides on which rows (null on the rest),
   * and for whom (undefined: nobody — the hook is not handed in).
   */
  rowAction?: ((row: T) => ReactNode) | undefined;
  /** A line under the row's «الحالة» badge — the vault queue's «استلمها القائد …» / «استُلمت …». */
  statusNote?: (row: T) => ReactNode;
  /**
   * The row's colour, where a page colours by a rule of its own instead of the stage's
   * (`boardRowTint`) — the vault queue keeps a row it received today green even once it has left.
   */
  tintOf?: (row: T) => string | undefined;
  /**
   * The page's own controls in the toolbar, after «الإحصائيات» where the day board has «إضافة
   * شحنة» — the vault queue's colour legend and «الكل». Handed the rows SHOWN (the filters
   * applied, every page of them), as the figures are counted over; called before an answer is in
   * as well, so what must wait for one is the page's to say.
   */
  toolbarExtras?: (shown: readonly T[]) => ReactNode;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state) => state.locale.locale);

  const banks = useOperationsBanks({
    page: 1,
    pageSize: MAX_PAGE_SIZE,
    sortBy: 'code',
    sortDir: 'asc',
  });
  const currencies = useOperationsCurrencies({ page: 1, pageSize: MAX_PAGE_SIZE });

  const setReceived = useSetShipmentReceived();
  const remove = useDeleteOperationsShipment();

  // The filters live in the URL so the board is shareable and survives a reload — and so the
  // page's remembered-filters hook has something to remember. Filtering still happens in the
  // browser over the rows the server returned; only where the state LIVES is the URL. Written with
  // `replace`, because narrowing the board is a view of it rather than a place to go Back to.
  // A filter this board offers no box for reads as empty: a param with no box on screen never
  // narrows the table.
  const filters = offeredFilters(readDayBoardFilters(sp), kind, stages);
  const secured = kind === 'secured';
  const setFilter = (patch: Partial<DayBoardFilters>): void => {
    const params = new URLSearchParams(sp);
    for (const [name, value] of Object.entries({ ...filters, ...patch })) {
      if (value === '') params.delete(name);
      else params.set(name, value);
    }
    setSp(params, { replace: true });
  };

  const [editing, setEditing] = useState<OperationsDayBoardShipmentDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [statsOpen, setStatsOpen] = useState(true);
  const [othersOpen, setOthersOpen] = useState(false);
  const [previewingReceipt, setPreviewingReceipt] = useState<OperationsShipmentDto | null>(null);
  const [logOf, setLogOf] = useState<ShipmentLogTarget | null>(null);

  const bankNameOf = (id: string): string =>
    banks.data?.items.find((bank) => bank.id === id)?.opsName ?? '';
  const currencyOf = (id: string): OperationsCurrencyDto | undefined =>
    currencies.data?.items.find((currency) => currency.id === id);

  // The crew rows the legs ride, for the van card — by the leg's crew row, not the van: one van
  // can run two crews in a day.
  const crewOf = new Map(crews.map((crew) => [crew.crewAssignmentId, crew]));
  // Branch names come WITH the rows — no page-capped catalog lookup to run out. «من فرع» and
  // «الى فرع» search the text their cell prints, bank line included, as legacy's did.
  const rows = filterDayBoard(
    shipments,
    filters,
    bankNameOf,
    (row, side) => branchCellText(row, side, bankNameOf),
    (row) => row.crew?.captainName ?? '',
    (row) => row.crew?.vehicleCode ?? '',
  );

  // The figures: over the rows SHOWN — the filtered ones, every page of them — per currency, in
  // the legacy strip's order (`orderedBoardTotals`).
  const figures = boardFigures(rows, currencyOf);
  const others = otherCurrencies(rows, currencyOf);
  // The pills are labelled with the catalog's own word for the two currencies — the pound and the
  // dollar as `currencyKind` knows them, by code, name or legacy alias. Their unit is the ISO
  // code, fixed: the catalog's code may be a legacy number («1», «2») that means nothing as a unit.
  const currencyList = currencies.data?.items ?? [];
  const poundName = currencyOfKind(currencyList, 'pound')?.name ?? 'EGP';
  const dollarName = currencyOfKind(currencyList, 'dollar')?.name ?? 'USD';

  // A page of the filtered rows, when the board is paged. Kept with the view it was chosen on: the
  // filters or the period changing (the query string) puts the reader back on page 1, rather than
  // on a page number of a list they are no longer looking at.
  const view = sp.toString();
  const [paging, setPaging] = useState({ view, page: 1, size: HISTORY_PAGE_SIZE });
  // The reset is STORED, not only derived: deriving it alone kept the old page under the old view,
  // so going back to that view — the reset button, or a filter typed and erased — brought back a
  // page deep in the list. Adjusting state while rendering is React's own pattern for this.
  if (paging.view !== view) setPaging({ view, page: 1, size: paging.size });
  const page = paging.view === view ? paging.page : 1;
  const shown = paged ? pageOfRows(rows, page, paging.size) : null;

  // What the SCREEN offers and what the reader may do, both — the vault queue offers neither
  // (`canEditRows`); everywhere else, whoever holds the permission edits and deletes.
  const canEdit = canEditRows && can('operationsShipment.edit');
  const canDelete = canEditRows && can('operationsShipment.delete');
  // «السجل» — on BOTH screens, to whoever may see the rows: the log is read on the same grant.
  const canViewLog = can('operationsShipment.view');
  // What the SCREEN offers and what the reader may do, both: the history offers neither, whoever
  // is reading it; the day board offers both, to whoever holds the permission.
  const canAdd = canCreate && can('operationsShipment.create');
  const canComplete = canToggleReceived && can('operationsShipment.complete');

  const toggleReceived = async (shipment: OperationsDayBoardShipmentDto): Promise<void> => {
    try {
      await setReceived.mutateAsync({
        id: shipment.id,
        received: !isReceived(shipment),
        body: { version: shipment.version },
      });
    } catch {
      toast.error(t('operations.shipment.receiveFailed'));
    }
  };

  const removeShipment = async (shipment: OperationsDayBoardShipmentDto): Promise<void> => {
    // Destructive and not obviously reversible from this screen — always confirmed.
    if (!window.confirm(t('operations.shipment.confirmDelete'))) return;
    try {
      await remove.mutateAsync(shipment.id);
      toast.success(t('operations.shipment.deleted'));
    } catch {
      toast.error(t('operations.shipment.deleteFailed'));
    }
  };

  const everyColumn: Column<T>[] = [
    {
      key: 'vehicle',
      header: t('operations.board.vehicle'),
      // «لما اقف على العربيه تجيب مين اللى متعين عليها»: the code opens the van's crew card.
      render: (row) =>
        row.crew === null ? (
          DASH
        ) : (
          <CrewVehicleHoverCode
            className={FIGURE}
            code={row.crew.vehicleCode ?? '…'}
            vehicleCrew={crewOf.get(row.crew.crewAssignmentId)}
          />
        ),
    },
    {
      key: 'bank',
      header: t('operations.board.bank'),
      render: (row) => bankNameOf(row.mainBankId),
    },
    {
      key: 'origin',
      header: t('operations.shipment.origin'),
      render: (row) => {
        const cell = branchCell(row, 'origin', bankNameOf);
        return (
          <div className="leading-tight">
            {/* The money came from ANOTHER bank than the one billed: said above the branch, as the
                legacy board said the to-bank (main_ops.ejs:867-872). */}
            {cell.bank !== null && (
              <div className="text-[11px] text-amber-700 dark:text-amber-300">{cell.bank}</div>
            )}
            <div className={WRAP}>{cell.branch ?? '…'}</div>
          </div>
        );
      },
    },
    {
      key: 'destination',
      header: t('operations.shipment.destination'),
      render: (row) => {
        const cell = branchCell(row, 'destination', bankNameOf);
        return (
          <div className="leading-tight">
            {/* The cross-bank movement legacy printed in dark red, because it is the case an
                operator must not miss (main_ops.ejs:867). */}
            {cell.bank !== null && (
              <div className="text-[11px] text-red-700 dark:text-red-400">{cell.bank}</div>
            )}
            <div className={WRAP}>{cell.branch ?? '…'}</div>
          </div>
        );
      },
    },
    // «خلى المنطقة بعد الفرع الى»: the area is the destination branch's, so it sits beside it.
    {
      key: 'area',
      header: t('operations.shipment.area'),
      render: (row) => row.areaName ?? DASH,
    },
    {
      key: 'amount',
      header: t('operations.shipment.form.amount'),
      // «الشحنة نفسها فى الصف … كل العملات ظاهرها بالاجمالى ل كل عملة»: one line per currency, its
      // name beside its total — مصري, then دولار, then the rest by name, as the figures read.
      // «الارقام … تبقى اكنها عمود مش شوية داخلين وشوية خارجين»: the names take one fixed width in
      // every row, so the amounts sit in one column down the whole table — each in a box of the same
      // width, right-aligned, so units sit under units and a million reads longer than a thousand.
      render: (row) => (
        <div className="grid grid-cols-[4.75rem_6.25rem] items-baseline gap-x-2 gap-y-0.5">
          {orderedBoardTotals([row], currencyOf).map((total) => (
            <Fragment key={total.currencyId}>
              <span className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                {currencyOf(total.currencyId)?.name ?? '…'}
              </span>
              <span className={cn(FIGURE, 'text-right')} dir="ltr">
                {formatAmount(total.amount, locale)}
              </span>
            </Fragment>
          ))}
        </div>
      ),
    },
    {
      key: 'captain',
      header: t('operations.board.captain'),
      // «لما اقف على القائد يجيب بياناته زى ما عاملين فى الحركه»: the Fleet driver card's facts.
      render: (row) =>
        row.crew?.captainName == null ? (
          DASH
        ) : (
          <CaptainHoverName className={WRAP} crew={row.crew} />
        ),
    },
    {
      key: 'date',
      // With its own «تاريخ التسليم» beside it, the date is named for the day it is: the day a
      // محصنة is collected from the bank («تاريخ التسليم تانى يوم الاستلام»).
      header: t(secured ? 'operations.board.collectedOn' : 'operations.board.date'),
      // A secured row is about two days: collected (green) and delivered — legacy :882-897. Where
      // the delivery day has a column of its own, this cell is the collection day alone.
      render: (row) => (
        <div className={cn('leading-tight', FIGURE)}>
          {row.shipmentType === 'secured' && !secured ? (
            <>
              <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
                {row.collectionDate.slice(0, 10)}
              </div>
              <div>{row.deliveryDate?.slice(0, 10) ?? '—'}</div>
            </>
          ) : (
            row.collectionDate.slice(0, 10)
          )}
        </div>
      ),
    },
    {
      key: 'deliveryDate',
      header: t('operations.shipment.deliveryDate'),
      // The secured screen's alone (`kind`) — see the filter after the list.
      render: (row) =>
        row.deliveryDate === null ? (
          DASH
        ) : (
          <span className={FIGURE}>{row.deliveryDate.slice(0, 10)}</span>
        ),
    },
    {
      key: 'type',
      header: t('operations.shipment.type'),
      render: (row) => <ShipmentTypeBadge shipmentType={row.shipmentType} />,
    },
    {
      key: 'status',
      header: t('operations.common.status'),
      // «النوع هيفضل زى ماهو بس هنفصل عنه الحالة»: its own column. A daily row in the desk's two
      // words — «لم يتم التسليم» / «تم التسليم» — whoever delivered (the row's colour says who); a
      // محصنة in its stage's words, «والحالة لم التسليم و تم الاستلام من القائد و بالخزينة» — except
      // one on the road its delivery captain has delivered, which says «تم التسليم» as a daily row
      // does until the desk's ✓ (`shownStage`).
      render: (row) => {
        const stage = shownStage(row);
        const badge =
          stage !== null ? (
            <SecuredStageBadge stage={stage} />
          ) : (
            <DeliveryStatusBadge delivery={boardDelivery(row)} />
          );
        // The page's line under it, where it has one (the vault queue's "when").
        const note = statusNote?.(row);
        return note === undefined || note === null ? (
          badge
        ) : (
          <div className="space-y-0.5">
            {badge}
            {note}
          </div>
        );
      },
    },
    {
      key: 'notes',
      header: t('operations.shipment.notes'),
      // Cut short with its whole text on hover; 5rem rather than 5.5 since «السجل» joined the actions.
      render: (row) =>
        row.notes === null ? (
          DASH
        ) : (
          <span className="block max-w-[5rem] truncate" title={row.notes}>
            {row.notes}
          </span>
        ),
    },
    {
      key: 'receiptImage',
      header: t('operations.board.receiptImage'),
      align: 'center',
      // «عاوز عمود كمان لصورة الايصال زى شاشة السيارات اقدر ارفع صوره»: the vehicles' image cell —
      // the dashed cloud to upload, then view / replace / delete.
      // On the vault queue it is looked at, never managed (`canEditRows`).
      render: (row) => (
        <ShipmentReceiptImageCell
          row={row}
          onPreview={setPreviewingReceipt}
          readOnly={!canEditRows}
        />
      ),
    },
    {
      key: 'actions',
      header: t('operations.board.actions'),
      render: (row) => {
        // The page's own act on this row (the vault's ✓), or null where it has none here.
        const own = rowAction?.(row) ?? null;
        // Nothing at all to do on this row (a vault-only treasurer's green row): a dash, as an empty
        // cell reads — not an empty box.
        if (!canEdit && !canComplete && !canViewLog && !canDelete && own === null) return DASH;
        return (
          <span className={ACTION_GROUP} data-row-actions="shipment">
            {canEdit && (
              <button
                type="button"
                className={actionTone('edit')}
                aria-label={t('common.edit')}
                title={t('common.edit')}
                onClick={() => setEditing(row)}
              >
                <SquarePenIcon className="h-4 w-4" />
              </button>
            )}
            {/* «إستلام» — a toggle, as legacy's was (main_ops.ejs:919-928): pressed once received.
              Its NAME stays «تأكيد التسليم» either way and `aria-pressed` carries the state: a
              name that flipped to «التراجع عن التسليم» would be announced "undo delivery,
              pressed", as if the undo were what is switched on. The tooltip may still say what
              a click does next. */}
            {canComplete && offersDeliveryToggle(row) && (
              <button
                type="button"
                className={cn(actionTone('status'), isReceived(row) && PRESSED)}
                aria-pressed={isReceived(row)}
                aria-label={t('operations.shipment.receive')}
                title={t(
                  isReceived(row) ? 'operations.shipment.unreceive' : 'operations.shipment.receive',
                )}
                disabled={setReceived.isPending}
                onClick={() => void toggleReceived(row)}
              >
                <CheckIcon className="h-4 w-4" />
              </button>
            )}
            {/* A محصنة still on its way to the vault, or in it, takes no ✓ — its next step is the
              captain's, the vault's or the dispatch's, and the server would refuse the desk's. Its
              square is kept, empty, so the log and the bin stand where they stand on every row. */}
            {canComplete && !offersDeliveryToggle(row) && (
              <span aria-hidden className={cn(actionTone('status'), 'invisible')} />
            )}
            {/* The page's own act, at the ✓'s place — the vault's ✓ on its receive queue. A row it
              has none for keeps its square, empty, while «السجل» or the bin follow, so they stand
              where they stand on every row (as the desk ✓'s square above). */}
            {rowAction !== undefined &&
              (own ??
                ((canViewLog || canDelete) && (
                  <span aria-hidden className={cn(actionTone('status'), 'invisible')} />
                )))}
            {/* «سجل بالاكشنز اللى حصلت على الشحنة»: the row's story, a log among the actions — slate,
              between the ✓ and the bin (`row-actions-look`). */}
            {canViewLog && (
              <button
                type="button"
                data-shipment-log={row.id}
                aria-haspopup="dialog"
                className={actionTone('history')}
                aria-label={t('operations.shipment.log.open')}
                title={t('operations.shipment.log.open')}
                onClick={() =>
                  setLogOf({ id: row.id, caption: shipmentCaption(row, bankNameOf, t) })
                }
              >
                <HistoryIcon className="h-4 w-4" />
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                className={actionTone('delete')}
                aria-label={t('common.remove')}
                title={t('common.remove')}
                onClick={() => void removeShipment(row)}
              >
                <Trash2Icon className="h-4 w-4" />
              </button>
            )}
          </span>
        );
      },
    },
  ];
  // The delivery-date column is the secured screen's alone, and «النوع» everyone else's (`kind`);
  // both are declared in their places in the list above, so the columns read in one order on
  // every screen.
  const boardColumns = everyColumn.filter(
    (column) => column.key !== (secured ? 'type' : 'deliveryDate'),
  );
  // A screen that offers this reader nothing to do on a row (the vault queue, read by a treasurer
  // who may neither receive nor read the log) draws no actions column — not a column of empty boxes.
  const offersRowActions =
    canEdit || canComplete || canViewLog || canDelete || rowAction !== undefined;
  const columns = offersRowActions
    ? boardColumns
    : boardColumns.filter((column) => column.key !== 'actions');

  const typeValue = filters.type === '' ? [] : [filters.type];
  const receivedValue = filters.received === '' ? [] : [filters.received];
  const stageValue = filters.stage === '' ? [] : [filters.stage];

  return (
    <>
      <div className={BOARD_FRAME}>
        {/* The Fleet boards open on their toolbar. «عاوز الاحصائيات تكون مكان تشغيل يوم … شيل العنوان
          دا … وخلى الاحصائيات تفتح يمين»: no title; at the start (the right) the figures behind
          «الإحصائيات» — how many shipments the filters left, the pound, the dollar, and «عملات
          أخرى» — or, with them closed, the count alone. The buttons stay at the end. */}
        <div
          className="flex flex-wrap items-center justify-between gap-2"
          data-shipments-toolbar="true"
        >
          {/* The money pills sort currencies by kind, so they wait for the catalog: before it, every
            currency would read as «عملات أخرى» beside a pound and a dollar of 0. */}
          {statsOpen && loaded && currencies.data !== undefined ? (
            <div
              role="status"
              aria-label={t('operations.board.stats')}
              data-shipment-figures="true"
              className="flex min-w-0 animate-fade-in flex-wrap items-center gap-1.5"
            >
              <BoardFigurePill
                icon={SHIPMENT_PATH.shipment}
                tone={FIGURE_TONE.count}
                label={t('operations.board.figures.count')}
                value={
                  rows.length === shipments.length
                    ? formatNumber(rows.length, locale)
                    : `${formatNumber(rows.length, locale)} / ${formatNumber(shipments.length, locale)}`
                }
                unit={t('operations.board.figures.countUnit')}
              />
              <BoardFigurePill
                icon={SHIPMENT_PATH.money}
                tone={FIGURE_TONE.pound}
                label={poundName}
                value={formatAmount(figures.egp, locale)}
                unit="EGP"
                data-figure="EGP"
              />
              <BoardFigurePill
                icon={SHIPMENT_PATH.money}
                tone={FIGURE_TONE.dollar}
                label={dollarName}
                value={formatAmount(figures.usd, locale)}
                unit="USD"
                data-figure="USD"
              />
              {/* «مكان يورو تبقى اسمها عملات اخرى ويجيب مجموع كل العملات ما عدا المصرى والدولار»:
                a sum of DIFFERENT currencies, which is why a click lists each one apart. */}
              <BoardFigurePill
                icon={SHIPMENT_PATH.money}
                tone={FIGURE_TONE.others}
                label={t('operations.board.figures.otherCurrencies')}
                value={formatAmount(figures.othersSum, locale)}
                title={t('operations.board.figures.otherCurrenciesHint')}
                onClick={() => setOthersOpen(true)}
                data-figure="others"
              />
            </div>
          ) : (
            <span role="status" className="text-sm font-bold text-slate-600 dark:text-slate-300">
              {loaded
                ? t('operations.dailyOps.count', {
                    count: formatNumber(rows.length, locale),
                    total: formatNumber(shipments.length, locale),
                  })
                : ''}
            </span>
          )}
          {/* `max-w-full flex-wrap`: a page's own controls can make this group wider than a phone;
            it then wraps inside itself instead of running off the screen. */}
          <span className="ms-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1 sm:gap-2">
            <button
              type="button"
              data-shipment-stats-toggle="true"
              aria-expanded={statsOpen}
              onClick={() => setStatsOpen((open) => !open)}
              className={BRAND_BUTTON}
            >
              {statsOpen ? t('operations.board.statsHide') : t('operations.board.stats')}
              {/* Opens to the side (the figures take the title's place), so the chevron points
                that way rather than down. */}
              <svg
                viewBox="0 0 24 24"
                aria-hidden
                className={cn(
                  'h-3 w-3 transition-transform sm:h-3.5 sm:w-3.5 rtl:-scale-x-100',
                  statsOpen && 'rotate-180',
                )}
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {/* The page's own controls, where the day board has «إضافة شحنة», handed the rows the
              figures count. Drawn whether or not an answer is in: the page decides what waits for
              one (the vault's legend does; its «الكل» does not — a choice of view stays on screen
              while the list loads or is refused). */}
            {toolbarExtras?.(rows)}
            {canAdd && (
              <button
                type="button"
                data-shipment-new="true"
                onClick={() => setCreating(true)}
                className={ADD_BUTTON}
              >
                <BoardIcon d={PATH.plus} className="h-3.5 w-3.5" width={2.5} />
                {t(
                  createType === 'secured'
                    ? 'operations.secured.backlog.add'
                    : 'operations.shipment.add',
                )}
              </button>
            )}
            {/* The history's deleted shipments, at the end where the day board's «إضافة شحنة» is. */}
            {deletedShipments !== undefined && (
              <DeletedShipmentsControl
                range={deletedShipments.range}
                enabled={deletedShipments.enabled}
                bankNameOf={bankNameOf}
                currencyOf={currencyOf}
              />
            )}
          </span>
        </div>

        {/* The Fleet boards' dark bar: every filter's name written in its box, an icon at its start.
          «ارتب الفلاتر على حسب عواميد الجدول»: the filters in the table's column order — السيارة,
          اسم البنك, من فرع, إلى فرع, المنطقة, قائد الطاقم, (the history's من and إلى,) النوع,
          الحالة, ملاحظات (the amount, the receipt image and the actions have nothing to type).
          Widths go on the WRAPPER — `Input` carries its own `w-full`, and `cn` does not merge a
          width passed to it; from 1024px the bar's row overrides them (`BAR_LAYOUT`). */}
        <div
          className={cn(
            DARK_FILTER_BAR,
            '[&_[role=listbox]]:animate-menu-in',
            BAR_LAYOUT,
            datePickers.length > 0 && PERIOD_BAR_LAYOUT,
          )}
          data-shipment-filters="true"
        >
          <FilterBar
            hasActiveFilters={hasActiveFilter(filters) || periodActive}
            onClear={() => {
              // ONE write. The history's period goes back to its default alongside the filters: it
              // is not a filter — it is what the screen IS — but a "clear" that left last week on
              // screen would be a reset the user can see failing. Two separate writes would not do
              // it, because the second would be built from the params the first had replaced.
              const next = new URLSearchParams(sp);
              for (const name of [...DAY_BOARD_FILTER_PARAMS, ...periodParams]) next.delete(name);
              setSp(next, { replace: true });
            }}
          >
            {/* «ضيف كود العربيه ف الفلاتر»: the «السيارة» column's code, first as the column is. */}
            <FilterWithIcon
              icon={FILTER_ICON.car}
              tone="text-emerald-600 dark:text-emerald-400"
              className="w-28 shrink-0"
            >
              <Input
                density={TIGHT}
                aria-label={t('operations.board.vehicleCode')}
                placeholder={t('operations.board.vehicleCode')}
                value={filters.vehicle}
                onChange={(e) => setFilter({ vehicle: e.target.value })}
              />
            </FilterWithIcon>
            <FilterWithIcon
              icon={SHIPMENT_PATH.bank}
              tone="text-violet-600 dark:text-violet-300"
              className="w-32 shrink-0"
            >
              <Input
                density={TIGHT}
                aria-label={t('operations.board.bank')}
                placeholder={t('operations.board.bank')}
                value={filters.bank}
                onChange={(e) => setFilter({ bank: e.target.value })}
              />
            </FilterWithIcon>
            <FilterWithIcon
              icon={FILTER_ICON.branch}
              tone="text-violet-600 dark:text-violet-300"
              className="w-32 shrink-0"
            >
              <Input
                density={TIGHT}
                aria-label={t('operations.shipment.origin')}
                placeholder={t('operations.shipment.origin')}
                value={filters.origin}
                onChange={(e) => setFilter({ origin: e.target.value })}
              />
            </FilterWithIcon>
            <FilterWithIcon
              icon={FILTER_ICON.branch}
              tone="text-violet-600 dark:text-violet-300"
              className="w-32 shrink-0"
            >
              <Input
                density={TIGHT}
                aria-label={t('operations.shipment.destination')}
                placeholder={t('operations.shipment.destination')}
                value={filters.destination}
                onChange={(e) => setFilter({ destination: e.target.value })}
              />
            </FilterWithIcon>
            <FilterWithIcon
              icon={SHIPMENT_PATH.route}
              tone="text-slate-600 dark:text-slate-300"
              className="w-28 shrink-0"
            >
              <Input
                density={TIGHT}
                aria-label={t('operations.shipment.area')}
                placeholder={t('operations.shipment.area')}
                value={filters.area}
                onChange={(e) => setFilter({ area: e.target.value })}
              />
            </FilterWithIcon>
            <FilterWithIcon
              icon={FILTER_ICON.person}
              tone="text-emerald-600 dark:text-emerald-400"
              className="w-36 shrink-0"
            >
              <Input
                density={TIGHT}
                aria-label={t('operations.board.captain')}
                placeholder={t('operations.board.captain')}
                value={filters.captain}
                onChange={(e) => setFilter({ captain: e.target.value })}
              />
            </FilterWithIcon>
            {/* «التاريخ» — the history's «من» and «إلى»: the page's period, at the date column's
              place (the day board has no picker: it is always today). A date box draws its own
              format hint and ignores a placeholder, so its name is its title (on hover) and its
              aria-label. */}
            {datePickers.map((picker) => (
              <FilterWithIcon
                key={picker.param}
                icon={FILTER_ICON.calendar}
                tone="text-cyan-600 dark:text-cyan-400"
                // A box that writes its name measures itself (a size container), so the name shows
                // only while the box has room for it AND the date — never over the digits.
                className={cn(
                  'w-36 shrink-0',
                  picker.showLabel === true && '[container-type:inline-size]',
                )}
                datePicker={{ label: picker.label }}
              >
                <Input
                  type="date"
                  dir="ltr"
                  density={TIGHT}
                  aria-label={picker.label}
                  title={picker.label}
                  value={picker.value}
                  onChange={(e) => picker.onChange(e.target.value)}
                  // On an English page the date would start right after the calendar, where the
                  // name is written: it goes to the box's far side instead, as on an Arabic page.
                  // The browser pads a date's fields a pixel above and below, which stood the two
                  // dates 2px taller than the boxes beside them in the one row.
                  className={cn(
                    'dark:[color-scheme:dark] [&::-webkit-datetime-edit-fields-wrapper]:py-0',
                    picker.showLabel === true && '[[dir=ltr]_&]:text-right',
                  )}
                />
                {/* The date sits at the box's far side, so the name takes the free room beside the
                    calendar — shown only from a box wide enough for both (the input already carries
                    the name for a reader, and as its hover title). */}
                {picker.showLabel === true && (
                  <span
                    aria-hidden
                    data-date-label={picker.param}
                    className="pointer-events-none absolute start-6 top-0 hidden h-9 items-center text-xs font-bold text-slate-500 dark:text-slate-400 [@container(min-width:8.75rem)]:flex"
                  >
                    {picker.label}
                  </span>
                )}
              </FilterWithIcon>
            ))}
            {/* Two answers each — ONE at a time: ticking one replaces the other, and clearing it is
              «all», as the Fleet boards' two-answer filters read. No «النوع» on the secured screen,
              where every row is a محصنة. */}
            {!secured && (
              <FilterWithIcon icon={FILTER_ICON.make} tone="text-slate-600 dark:text-slate-300">
                <MultiSelect
                  clearable
                  fullWidth
                  density={TIGHT}
                  showSelectedValues
                  label={t('operations.shipment.type')}
                  options={[
                    { value: 'daily', label: t('operations.shipment.type.daily') },
                    { value: 'secured', label: t('operations.shipment.type.secured') },
                  ]}
                  value={typeValue}
                  onChange={(next) =>
                    setFilter({ type: (pickOne(typeValue, next) ?? '') as DayBoardFilters['type'] })
                  }
                />
              </FilterWithIcon>
            )}
            {/* «الحالة» — on a secured board the محصنة's stages, in their order («the status
              filter must offer the stages on this screen» — the page's `stages`); elsewhere
              «التسليم», delivered or not. One box either way, at the status column's place. */}
            {secured ? (
              <FilterWithIcon icon={FILTER_ICON.status} tone="text-slate-600 dark:text-slate-300">
                <MultiSelect
                  clearable
                  fullWidth
                  density={TIGHT}
                  showSelectedValues
                  label={t('operations.common.status')}
                  options={stages.map((stage) => ({
                    value: stage,
                    label: t(`operations.board.stage.${stage}`),
                  }))}
                  value={stageValue}
                  onChange={(next) =>
                    setFilter({
                      stage: (pickOne(stageValue, next) ?? '') as DayBoardFilters['stage'],
                    })
                  }
                />
              </FilterWithIcon>
            ) : (
              <FilterWithIcon icon={FILTER_ICON.status} tone="text-slate-600 dark:text-slate-300">
                <MultiSelect
                  clearable
                  fullWidth
                  density={TIGHT}
                  showSelectedValues
                  label={t('operations.dailyOps.received')}
                  options={[
                    { value: 'yes', label: t('operations.dailyOps.receivedYes') },
                    { value: 'no', label: t('operations.dailyOps.receivedNo') },
                  ]}
                  value={receivedValue}
                  onChange={(next) =>
                    setFilter({
                      received: (pickOne(receivedValue, next) ?? '') as DayBoardFilters['received'],
                    })
                  }
                />
              </FilterWithIcon>
            )}
            <FilterWithIcon
              icon={SHIPMENT_PATH.note}
              tone="text-slate-600 dark:text-slate-300"
              className="w-32 shrink-0"
            >
              <Input
                density={TIGHT}
                aria-label={t('operations.shipment.notes')}
                placeholder={t('operations.shipment.notes')}
                value={filters.notes}
                onChange={(e) => setFilter({ notes: e.target.value })}
              />
            </FilterWithIcon>
          </FilterBar>
        </div>

        {refusal !== null ? (
          // Said where the rows would be, in words that name what to change — not an empty table
          // that reads as "nothing happened", nor a failure with a retry that would only fail again.
          <div
            role="alert"
            data-shipments-refusal="true"
            className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
          >
            <BoardIcon
              d={PATH.warn}
              className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
            />
            <p>{refusal}</p>
          </div>
        ) : (
          <>
            <div className={SHIPMENTS_TABLE}>
              <DataTable
                columns={columns}
                rows={shown?.rows ?? rows}
                rowKey={(row) => row.id}
                loading={loading}
                error={error}
                onRetry={onRetry}
                empty={empty}
                // «لو تم التسليم من القائد … الصف لونه اصفر ولما ادوس انا على صح … يبقى الصف اخضر»:
                // a daily row green once the desk confirmed (legacy's `#a9e6b8`, main_ops.ejs:851),
                // yellow while only the crew captain has; a محصنة by its stage — yellow with the
                // captain, green in the vault («هتبقى اخضر عند الخزنة وعند العمليات»), blue on the
                // road (`boardRowTint`).
                // A page with a rule of its own (`tintOf` — the vault queue's) colours by it.
                rowClassName={(row) => (tintOf === undefined ? boardRowTint(row) : tintOf(row))}
                stickyHead
                // Thirteen columns of short things — a van code, a bank, a date, three icons. The
                // default floor (7.5rem a column) would make the table 98rem wide and push the notes
                // and the actions off a laptop screen; the cells' own content is narrower than that.
                minColumnWidth={5.5}
              />
            </div>
            {shown !== null && shown.meta.totalItems > 0 && (
              // The Fleet boards' pager, one slim line under the table so the rows get the height.
              <div className="shrink-0 [&>div]:!py-0" data-shipments-pager="true">
                <FleetPager
                  meta={shown.meta}
                  pageSizeOptions={HISTORY_PAGE_SIZES}
                  onPageChange={(next) => setPaging({ view, page: next, size: paging.size })}
                  onPageSizeChange={(size) => setPaging({ view, page: 1, size })}
                />
              </div>
            )}
          </>
        )}
      </div>

      <ShipmentLogDialog target={logOf} onClose={() => setLogOf(null)} />

      <ShipmentReceiptImagePreviewDialog
        open={previewingReceipt !== null}
        onClose={() => setPreviewingReceipt(null)}
        row={previewingReceipt}
        readOnly={!canEditRows}
      />

      <OtherCurrenciesDialog
        open={othersOpen}
        onClose={() => setOthersOpen(false)}
        cards={others.cards}
        sum={others.sum}
        shipments={others.shipments}
        currencyOf={currencyOf}
        locale={locale}
      />

      <ShipmentFormDialog
        // The screen's kind: daily from the day board («اشيل النوع ويكون يومى بس»), secured from
        // the secured screen («لما اضيف اتوماتيك محصنة»).
        createType={createType}
        open={(canAdd && creating) || editing !== null}
        shipment={editing}
        banks={banks.data?.items ?? []}
        currencies={currencyList}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </>
  );
};
