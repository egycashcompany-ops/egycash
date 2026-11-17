// «توزيع المحصنات» (Round 12) — the day's محصنات placed on the day's vans.
//
// The owner: «المحصنة اللى يومها هتخرج هتظهر تلقائى فى شاشة توزيع المحصنات هيكون فيها العربيه اللى
// اتحط عليها القادة والاخصائين والاتجاه هتبقى العربيات على اليمين والمحصنات على الشمال وهشد المحصنة
// احطها على العربيه او المحصنة اللى نفس الاتجاه بتاع العربيه تتحط تلقائى ولما يحفظ …».
//
// WHAT IT SHOWS — one read (`GET /operations/secured/distribution?date=`):
//   · THE DAY: today by default, any later day by the picker, never a past one (a past day's vans
//     have left — the boards' rule; a stale `?date=` opens on today);
//   · THE VANS, on the RIGHT: every crew row of the day's crew board, as a card — number, planned
//     time, direction, captain(s), both specialists (by the crew plan's grant: without it the slots
//     are not drawn, rather than drawn empty), what it carries and its load;
//   · THE MAHSANAT, on the LEFT: those due on the day not yet out (any stage before the vault hands
//     them over — each with its stage badge) and the ones still in the vault past their day
//     («متأخرة»). The ones on no van of the day; each van's are on its card.
//
// WHAT IT DOES — nothing is written until «حفظ»:
//   · DRAG a shipment onto a van, or back to the left to take it off; or «نقل إلى…» on the card
//     (the keyboard's way, and the phone's) — every van, and «إزالة من السيارة»;
//   · A VAN WITH TWO CAPTAINS: the shipment goes with the first; its «نقل إلى…» lists the van's
//     captains first («مع …») and switches it to the other — the captain whose route (and phone) it
//     lands on (Round 25: the van card shows the first captain only);
//   · AUTO BY DIRECTION («المحصنة اللى نفس الاتجاه بتاع العربيه تتحط تلقائى»): on the day's first read,
//     and again on «توزيع تلقائي», every shipment on no van whose area the direction of EXACTLY ONE
//     van names is proposed onto that van (`proposeByDirection`) — marked «مقترحة» until saved; two
//     vans of one direction, or none, leave it for the person;
//   · «حفظ» sends every change in ONE request (`distributionSaveBody`), all or nothing. A refusal
//     names its shipment: the screen is read again, that card goes back to where the server says it
//     is and says why, the other moves stay to be saved;
//   · An OVERDUE shipment placed on a van has its delivery day moved to the day by the save — said on
//     its card before the click («سيُنقل يوم تسليمها إلى …»), and in «السجل» after;
//   · Leaving with unsaved moves asks first — another day, a link, closing the tab.
//
// ROUND 24:
//   · A CREW WITHOUT A VAN — «عاوز لو عربيه من غير كود عادى تظهر ان اوزع عليها محصنات»: the read
//     lists the day's crew rows without a van after the vans; each is a card like a van's, «بدون
//     سيارة (n)» where the code goes (`lib/van-name.ts`), and takes drops, «نقل إلى…» and proposals;
//   · «تراجع» is ONE STEP BACK, as on «لوحة التشغيلة» («وعاوز تراجع دا يتراجع عن اخر عمليه مش كل
//     العمليات»): a move, a captain switched, «توزيع تلقائي» — each press takes back the last one
//     (`lib/crew-undo.ts`). The day's own proposals are where the history starts, not an operation.
//
// ROUND 24c — «عاوز اصغر المكان اللى فيه المحصنات واكبر المكان اللى فيه المحصنة بالعربيه»: the vans
// take about three quarters of a wide screen, three cards to a row at 1440 (`DISTRIBUTION_COLUMNS`,
// `VAN_GRID`), the محصنات on no van a quarter. On a phone the columns stack with the محصنات on no van
// FIRST, in a column that folds — the work to do, moved by «نقل إلى…» — and the vans under it. The
// van card's head is one line and its crew is drawn anew (`VanCard`).
//
// ROUND 25 — the owner on this screen:
//   · «لو ضيفت اى عربيه بتظهر فى توزيع المحصنات على طول انا عاوز اللى يظهر اللى نوعها محصنة بس ولازم
//     اكون دايس حفظ»: the read lists only the SAVED crew rows of the «محصنة» type (the server's rule);
//     a row of another type kept for what it already carries is marked and takes no new one. A
//     board save reads this screen again (`usePlanOperationsCrew`).
//   · «لما بعمل دراج و دروب لل محصنة على العربيه مش بتتحط»: the drop is the crew board's
//     (`lib/distribution-drag.ts`) — the dragged id in a ref, nothing drawn in `dragstart`, the WHOLE
//     screen accepting our drag, the target read under the pointer at the drop.
//   · «عاوز … احط فلتر فوق»: a filter bar on each column (`lib/distribution-filter.ts`), view only.
//   · «عاوز المحصنة تظهر صغيره عبارة عن البنك والفرع ولما اعمل هوفر عليها يجيب بقى معلومتها» and
//     «شكل العربية بالمحصنات يتغير»: the small chip with its card, the same on a van; the van card
//     with ONE captain's line led by the count, and the three package counts (`VanCard`). A van
//     with two captains shows the first; who a محصنة goes with is switched in its «نقل إلى…».
//
// WHO. The screen is `operationsShipment.view`'s; moving and saving are `operationsShipment.edit`'s
// (assign-delivery's grant — distributing IS assigning the delivery leg, for many at once). A reader
// without it sees the day's plan as it stands, with nothing to drag.
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  MAX_PAGE_SIZE,
  OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS,
  type Locale,
  type OperationsCurrencyDto,
  type OperationsSecuredDistributionCrewDto,
  type OperationsSecuredDistributionRowDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { cn } from '../../../shared/lib/cn';
import { errorMessage, hasError } from '../../../shared/lib/errors';
import { formatNumber } from '../../../shared/lib/format';
import { pluralKey } from '../../../shared/lib/plural';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useAppSelector } from '../../../store';
import { useMinWidth } from '../../atm/lib/useMinWidth';
import { useUnsavedGuard } from '../../atm/lib/useUnsavedGuard';
import { BOARD_FRAME } from '../../fleet/components/board-scroll';
import { DesignCancel, DesignDialog, DesignSave } from '../../fleet/components/DesignDialog';
import { FILTER_ICON } from '../../fleet/components/FilterWithIcon';
import { BoardIcon, PATH } from '../../fleet/components/FuelCardBoard';
import {
  useOperationsBanks,
  useOperationsCurrencies,
  useOperationsSecuredDistribution,
  useSaveSecuredDistribution,
  useVaultPackaging,
} from '../api/operations-queries';
import { BoardFigurePill, FIGURE_TONE } from '../components/BoardFigures';
import { ADD_BUTTON, BRAND_BUTTON, BoardRefusal } from '../components/ShipmentsBoard';
import {
  CardMark,
  ChipMark,
  ColumnFilterBar,
  DAY_BAR,
  DISTRIBUTION_COLUMNS,
  DayBox,
  DistributionColumn,
  EmptyLoad,
  FilterAreaSelect,
  FilterTextBox,
  MoveMenu,
  ShipmentCardBody,
  ShipmentChip,
  VAN_GRID,
  VanCard,
  dayText,
  type ChipMoneyLine,
  type MoveChoice,
} from '../components/SecuredDistributionParts';
import { SHIPMENT_PATH } from '../components/shipment-icons';
import {
  EMPTY_DRAFT,
  UNPLACED,
  captainOn,
  distributionChanges,
  distributionColumns,
  distributionSaveBody,
  isProposed,
  isStartedLeg,
  moveToVan,
  openingDistributionHistory,
  packagingRead,
  personName,
  placeShipment,
  placementOf,
  proposeByDirection,
  readDistributionDate,
  refusedShipmentId,
  reschedulesOnSave,
  sameDistributionDraft,
  takesShipments,
  vanPackages,
  withoutShipment,
  type DistributionDraft,
} from '../lib/secured-distribution';
import {
  acceptsShipmentDragOver,
  beginShipmentDrag,
  dropTargetFromMarks,
  dropTargetKey,
  droppedShipment,
  dropRefusalToast,
  resolveShipmentDrop,
  SHIPMENT_DRAG_TYPE,
  type ShipmentDropDecision,
  type ShipmentDropTarget,
} from '../lib/distribution-drag';
import {
  EMPTY_UNPLACED_FILTER,
  EMPTY_VAN_FILTER,
  NO_AREA,
  isUnplacedFiltering,
  isVanFiltering,
  matchesUnplacedFilter,
  matchesVanFilter,
  shipmentAreaOptions,
  vanAreaOptions,
  type UnplacedFilter,
  type VanFilter,
} from '../lib/distribution-filter';
import {
  rebaseHistory,
  record,
  startHistory,
  undo,
  undoableStep,
  type UndoHistory,
  type UndoWhat,
} from '../lib/crew-undo';
import { hasNoVan, looseCrewNumbers, vanCodeText, vanPhrase } from '../lib/van-name';
import { isHistoryTooLarge } from '../lib/shipment-history';
import { useCairoToday } from '../lib/use-cairo-today';

/**
 * What is under the pointer during a drag, read off the marks the screen draws (the DOM half of
 * `dropTargetFromMarks`): the nearest van card, else the column of the unplaced. A text node answers
 * through its parent.
 */
const targetAt = (node: EventTarget | null): ShipmentDropTarget | null => {
  const element = node instanceof Element ? node : node instanceof Node ? node.parentElement : null;
  if (element === null) return null;
  return dropTargetFromMarks({
    van: element.closest('[data-drop-van]')?.getAttribute('data-drop-van') ?? null,
    unplaced: element.closest('[data-drop-unplaced]') !== null,
  });
};

export const SecuredDistributionPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  const today = useCairoToday();
  const date = readDistributionDate(sp.get('date'), today);
  const canEdit = can('operationsShipment.edit');
  const canReadVault = can('operationsVault.view');

  const board = useOperationsSecuredDistribution(date);
  const banks = useOperationsBanks({
    page: 1,
    pageSize: MAX_PAGE_SIZE,
    sortBy: 'code',
    sortDir: 'asc',
  });
  const currencies = useOperationsCurrencies({ page: 1, pageSize: MAX_PAGE_SIZE });
  // The packages are the vault's (counted at its receipt): read where the reader may read the vault.
  const packaging = useVaultPackaging(canReadVault);
  const save = useSaveSecuredDistribution();

  const tooLarge = isHistoryTooLarge(board.error);
  const data = tooLarge ? undefined : board.data;
  const rows = data?.shipments ?? [];
  const vans = data?.crews ?? [];
  // The server's day — the one the vans and the shipments are of.
  const day = data?.date.slice(0, 10) ?? date ?? today;
  const minDay = data?.today.slice(0, 10) ?? today;

  // The person's work between the read and «حفظ» — with its history, so «تراجع» takes back one
  // operation a press (Round 24).
  const [history, setHistory] = useState<UndoHistory<DistributionDraft>>(() =>
    startHistory(EMPTY_DRAFT),
  );
  const draft = history.now;
  /** ONE operation on the draft; one that changed nothing is not recorded. */
  const applyDraft = (
    what: UndoWhat,
    change: (current: DistributionDraft) => DistributionDraft,
  ): void =>
    setHistory((current) =>
      record(current, change(current.now), what, { same: sameDistributionDraft }),
    );
  // The day whose first read has been proposed on — proposals are made once per day, not on every
  // re-read (a proposal the person took off must not come back by itself under their hand).
  const [seeded, setSeeded] = useState<string | null>(null);
  const [refused, setRefused] = useState<{ id: string; reason: string } | null>(null);
  const saving = useRef(false);
  // Round 24c — a computer's width (Tailwind's `lg`) puts the vans first; a phone the محصنات on no
  // van, in a column that folds.
  const wide = useMinWidth(1024);
  const [unplacedOpen, setUnplacedOpen] = useState(true);
  // Round 25 — the two filter bars. View only: hidden cards keep their place in the draft.
  const [unplacedFilter, setUnplacedFilter] = useState<UnplacedFilter>(EMPTY_UNPLACED_FILTER);
  const [vanFilter, setVanFilter] = useState<VanFilter>(EMPTY_VAN_FILTER);

  // A day's FIRST read: its proposals, made while rendering (React's «state from the previous
  // render» pattern) rather than in an effect, so the screen never shows the day un-proposed for a
  // frame — the cards would jump under the person's eyes. Proposed only for someone who can save
  // them: to anyone else a proposal is a promise the screen cannot keep.
  if (data !== undefined && seeded !== data.date.slice(0, 10)) {
    setSeeded(data.date.slice(0, 10));
    setRefused(null);
    // The proposals are the history's first operation (`openingDistributionHistory`): «تراجع» can
    // take them back too, the last press of it.
    setHistory(openingDistributionHistory(data.shipments, data.crews, canEdit));
  }

  const changes = distributionChanges(rows, draft);
  const dirty = changes.length > 0;
  const guard = useUnsavedGuard({ dirty });

  const setDay = (value: string): void => {
    guard.confirmLeave(() => {
      const next = new URLSearchParams(sp);
      // Emptied (or a past day typed in), the screen goes back to today.
      if (value === '' || value <= minDay) next.delete('date');
      else next.set('date', value);
      setSp(next);
      setHistory(startHistory(EMPTY_DRAFT));
      setSeeded(null);
      setRefused(null);
    });
  };

  const bankOf = (id: string) => banks.data?.items.find((bank) => bank.id === id);
  const bankNameOf = (id: string): string => bankOf(id)?.opsName ?? '';
  /** Every name a bank answers the search box by — its operational name and both of its names. */
  const bankWordsOf = (id: string): string[] => {
    const bank = bankOf(id);
    return bank === undefined ? [] : [bank.opsName, bank.name.ar, bank.name.en];
  };
  const currencyOf = (id: string): OperationsCurrencyDto | undefined =>
    currencies.data?.items.find((currency) => currency.id === id);
  const packagingOf = (id: string) => packaging.data?.get(id);
  // Round 25 critic — a 0 is written only once the vault's counts are in: while the read is out, or
  // after it failed, the van says «…» / «—» and the chip's card does not call a vault shipment «not in
  // the vault».
  const packagesRead = packagingRead(canReadVault, packaging);

  const columns = distributionColumns(rows, vans, draft);
  const vanById = new Map(vans.map((van) => [van.crewAssignmentId, van]));
  // Round 24 — the crews without a van, numbered as the board numbers them («بدون سيارة (n)»).
  // Round 25: the server's own number (`looseNumber`, among ALL the day's rows without a van) —
  // the screen lists the «محصنة» rows only, and counting those alone would rename a crew.
  const looseNumbers = looseCrewNumbers(vans);
  const looseNumberOf = (crewAssignmentId: string): string | null => {
    const number = vanById.get(crewAssignmentId)?.looseNumber ?? looseNumbers.get(crewAssignmentId);
    return number === undefined ? null : formatNumber(number, locale);
  };
  const vanName = (van: OperationsSecuredDistributionCrewDto): string =>
    vanPhrase(t, van, looseNumberOf(van.crewAssignmentId));
  const proposedCount = changes.filter((change) => draft.get(change.shipmentId)?.proposed).length;

  const rowById = new Map(rows.map((row) => [row.id, row]));

  /** Put a shipment somewhere — the drag's drop and the menu's choice. */
  const move = (
    row: OperationsSecuredDistributionRowDto,
    van: OperationsSecuredDistributionCrewDto | null,
  ): void => {
    if (!canEdit) return;
    applyDraft(
      van === null ? { kind: 'unplace' } : { kind: 'move', vars: { van: vanName(van) } },
      (current) =>
        van === null ? placeShipment(current, row, UNPLACED) : moveToVan(current, row, van),
    );
    if (refused?.id === row.id) setRefused(null);
  };

  /** Switch the captain a shipment goes with, on the two-captain van it is on. */
  const switchCaptain = (
    row: OperationsSecuredDistributionRowDto,
    van: OperationsSecuredDistributionCrewDto,
    captainEmployeeId: string,
  ): void => {
    if (!canEdit) return;
    const captain = captainOn(van, captainEmployeeId);
    if (captain === null) return;
    applyDraft({ kind: 'captain', vars: { name: personName(captain) } }, (current) =>
      placeShipment(current, row, {
        crewAssignmentId: van.crewAssignmentId,
        captainEmployeeId,
      }),
    );
  };

  const autoDistribute = (): void => {
    const next = proposeByDirection(rows, vans, draft);
    const added = [...next.keys()].filter((id) => !draft.has(id)).length;
    applyDraft({ kind: 'auto' }, () => next);
    if (added === 0) toast.info(t('operations.distribution.autoNone'));
    else
      toast.success(
        t(pluralKey('operations.distribution.autoDone', locale, added), {
          count: formatNumber(added, locale),
        }),
      );
  };

  const onSave = async (): Promise<void> => {
    const body = distributionSaveBody(day, rows, draft);
    if (body === null || saving.current) return;
    saving.current = true;
    try {
      // Resolves once the screens it moves have been read again (the hook's `onSettled`), so the
      // cards land where the server put them without a flicker back.
      const result = await save.mutateAsync(body);
      // Saved: nothing is left to take back.
      setHistory(startHistory(EMPTY_DRAFT));
      setRefused(null);
      toast.success(
        result.rescheduled > 0
          ? t(pluralKey('operations.distribution.savedRescheduled', locale, result.changed), {
              count: formatNumber(result.changed, locale),
              rescheduled: formatNumber(result.rescheduled, locale),
            })
          : t(pluralKey('operations.distribution.saved', locale, result.changed), {
              count: formatNumber(result.changed, locale),
            }),
      );
    } catch (error) {
      const reason = errorMessage(error, locale);
      const id = refusedShipmentId(error);
      if (id !== null) {
        // The refused move leaves the draft — and every step of its history: «تراجع» never brings
        // back a move the server has just refused.
        setHistory((current) =>
          rebaseHistory(current, (state) => withoutShipment(state, id), sameDistributionDraft),
        );
        setRefused({ id, reason });
      }
      toast.error(t('operations.distribution.refused', { reason }));
    } finally {
      saving.current = false;
    }
  };

  // ── «تراجع» — one operation a press (Round 24) ───────────────────────────────────────────────
  // Nothing while «حفظ» is in flight: its success starts the history afresh (`undoableStep`).
  const lastMove = undoableStep(history, save.isPending);
  const undoWords =
    lastMove === null
      ? null
      : t(`operations.distribution.undo.kind.${lastMove.what.kind}`, { ...lastMove.what.vars });
  const undoTitle =
    undoWords === null
      ? t('operations.crewPlan.undo.none')
      : t('operations.crewPlan.undo.title', { what: undoWords });
  const undoLast = (): void => {
    if (!canEdit || lastMove === null || undoWords === null) return;
    setHistory(undo);
    setRefused(null);
    toast.info(t('operations.crewPlan.undo.done', { what: undoWords }));
  };
  // Ctrl+Z (⌘Z) — the same press, outside a text box.
  const undoRef = useRef(undoLast);
  useEffect(() => {
    undoRef.current = undoLast;
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
      event.preventDefault();
      undoRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // ── Drag and drop (Round 25 — `lib/distribution-drag.ts`) ─────────────────────────────────────
  // WHO is dragged is `dragRef`, written by the chip's own `dragstart` and nothing else; `dragging`
  // and `over` are for the DRAWING only, set one task after the browser's first answer.
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const dragRef = useRef<string | null>(null);
  const overRef = useRef<string | null>(null);
  const drawnRef = useRef(false);
  const dragTimer = useRef<number | undefined>(undefined);

  /** What a drop of this shipment on this target would do — the drop's own answer. */
  const decide = (shipmentId: string, target: ShipmentDropTarget | null): ShipmentDropDecision => {
    const row = rowById.get(shipmentId);
    if (row === undefined) return { kind: 'stay' };
    return resolveShipmentDrop(
      placementOf(row, draft).crewAssignmentId,
      target,
      (crewAssignmentId) => vanById.get(crewAssignmentId),
      isStartedLeg(row),
      // A row that is not «محصنة» takes back the shipment saved on it (the save's keep rule).
      row.placedCrewAssignmentId,
    );
  };

  const settleDrag = (): void => {
    window.clearTimeout(dragTimer.current);
    dragRef.current = null;
    overRef.current = null;
    setDragging(null);
    setOver(null);
  };

  const startDrag = (shipmentId: string, event: DragEvent<HTMLElement>): void => {
    // The drag's data and who it is — no state: a re-render here can cost a slow PC its drag.
    beginShipmentDrag(event.dataTransfer, shipmentId);
    window.clearTimeout(dragTimer.current);
    dragRef.current = shipmentId;
    drawnRef.current = false;
  };

  /** Draw the drag — the faded chip, the vans that would take it — after the first answer. */
  const drawDrag = (shipmentId: string): void => {
    if (drawnRef.current) return;
    drawnRef.current = true;
    dragTimer.current = window.setTimeout(() => {
      if (dragRef.current !== shipmentId) return;
      setDragging(shipmentId);
    }, 0);
  };

  /** The drag ended — dropped (already settled), let go off the screen, or Esc. */
  const endDrag = (): void => {
    if (dragRef.current !== null) settleDrag();
  };
  const endDragRef = useRef(endDrag);
  useEffect(() => {
    endDragRef.current = endDrag;
  });
  // A chip gone from the page mid-drag (moved by a re-read, filtered away) never delivers its
  // `dragend` to React; a pointer moving with no button held means the drag is over.
  useEffect(() => {
    const moved = (event: PointerEvent): void => {
      if (event.buttons === 0 && dragRef.current !== null) endDragRef.current();
    };
    window.addEventListener('pointermove', moved, { passive: true });
    return () => window.removeEventListener('pointermove', moved);
  }, []);

  /** Our drag over the screen: accepted wherever it is; what is under the pointer is drawn. */
  const overDrag = (event: DragEvent<HTMLElement>): void => {
    const shipmentId = dragRef.current;
    if (!acceptsShipmentDragOver(shipmentId)) return;
    event.preventDefault();
    drawDrag(shipmentId);
    const key = dropTargetKey(targetAt(event.target));
    if (overRef.current !== key) {
      overRef.current = key;
      setOver(key);
    }
  };

  /** A refused drop is SAID — never only a chip that springs back. */
  const sayRefusal = (decision: Extract<ShipmentDropDecision, { kind: 'refuse' }>): void => {
    const van = vanById.get(decision.crewAssignmentId);
    if (van === undefined) return;
    // The van as the title, the whole reason under it — a toast's title is cut to one line.
    const words = dropRefusalToast(decision.reason, vanName(van), t);
    toast.error(words.title, words.description);
  };

  /**
   * THE SCREEN IS ONE DROP TARGET — its frame takes every event of OUR drag and accepts it
   * wherever the pointer is; the drop then finds what is under it (`targetAt`) and does what
   * `resolveShipmentDrop` says: a van card (anywhere on it) takes it, the left column takes it off
   * its van, a refusal is said.
   */
  const screenDrop: Pick<
    HTMLAttributes<HTMLElement>,
    'onDragOver' | 'onDragEnter' | 'onDragLeave' | 'onDrop'
  > = canEdit
    ? {
        onDragEnter: overDrag,
        onDragOver: overDrag,
        onDragLeave: (event) => {
          if (dragRef.current === null) return;
          // Moving onto another part of the screen is not leaving it.
          const to = event.relatedTarget;
          if (to instanceof Node && event.currentTarget.contains(to)) return;
          overRef.current = null;
          setOver(null);
        },
        onDrop: (event) => {
          const own = dragRef.current;
          const custom = event.dataTransfer.getData(SHIPMENT_DRAG_TYPE);
          // Not a drag of ours — a text dropped into a box: the browser's own drop.
          if (own === null && custom === '') return;
          event.preventDefault();
          const text = event.dataTransfer.getData('text/plain');
          const shipmentId = droppedShipment({ own, custom, text }, (id) => rowById.has(id));
          const decision = shipmentId === null ? null : decide(shipmentId, targetAt(event.target));
          settleDrag();
          const row = shipmentId === null ? undefined : rowById.get(shipmentId);
          if (row === undefined || decision === null) return;
          if (decision.kind === 'place') move(row, vanById.get(decision.crewAssignmentId) ?? null);
          else if (decision.kind === 'unplace') move(row, null);
          else if (decision.kind === 'refuse') sayRefusal(decision);
        },
      }
    : {};

  /** Under the pointer now, as a decision — for the drawing. */
  const overDecision = (key: string): ShipmentDropDecision['kind'] | null => {
    if (dragging === null || over !== key) return null;
    return decide(
      dragging,
      key === 'unplaced'
        ? { kind: 'unplaced' }
        : { kind: 'van', crewAssignmentId: key.slice('van|'.length) },
    ).kind;
  };
  /** Would the shipment being dragged land on this van? — the vans that light up. */
  const armedVan = (crewAssignmentId: string): boolean =>
    dragging !== null && decide(dragging, { kind: 'van', crewAssignmentId }).kind === 'place';
  const draggedPlaced =
    dragging !== null &&
    rowById.get(dragging) !== undefined &&
    placementOf(rowById.get(dragging) as OperationsSecuredDistributionRowDto, draft)
      .crewAssignmentId !== null;

  // ── A shipment's chip ──────────────────────────────────────────────────────────────────────────

  const moveChoices = (row: OperationsSecuredDistributionRowDto): MoveChoice[] => {
    const placement = placementOf(row, draft);
    const at = placement.crewAssignmentId;
    const current = at === null ? undefined : vanById.get(at);
    const choices: MoveChoice[] = [];
    // A van with two captains: who it goes with — the van card shows the first only (Round 25).
    if (current !== undefined && current.captains.length > 1) {
      for (const captain of current.captains) {
        choices.push({
          key: `captain|${captain.employeeId}`,
          label: t('operations.distribution.withCaptain', { name: personName(captain) }),
          sub: t('operations.distribution.captainOn', { van: vanName(current) }),
          current: captain.employeeId === placement.captainEmployeeId,
          onSelect: () => switchCaptain(row, current, captain.employeeId),
        });
      }
    }
    for (const van of vans) {
      choices.push({
        key: van.crewAssignmentId,
        label: vanName(van),
        sub: [van.captains[0] === undefined ? '' : personName(van.captains[0]), van.direction ?? '']
          .filter((part) => part !== '')
          .join(' — '),
        current: van.crewAssignmentId === at,
        ...(takesShipments(van, row.placedCrewAssignmentId)
          ? {}
          : {
              disabledReason:
                van.securedType === false
                  ? t('operations.distribution.notSecured')
                  : t('operations.distribution.noCaptain'),
            }),
        onSelect: () => move(row, van),
      });
    }
    if (at !== null) {
      choices.push({
        key: 'unplaced',
        label: t('operations.distribution.remove'),
        danger: true,
        onSelect: () => move(row, null),
      });
    }
    return choices;
  };

  /** Its amounts by currency, as its card lists them. */
  const moneyOf = (row: OperationsSecuredDistributionRowDto): ChipMoneyLine[] =>
    row.lines.map((line, index) => {
      const currency = currencyOf(line.currencyId);
      return {
        key: `${line.currencyId}|${index}`,
        label: currency?.name ?? currency?.code ?? '…',
        amount: line.amount,
      };
    });

  const chip = (row: OperationsSecuredDistributionRowDto): ReactNode => {
    const placement = placementOf(row, draft);
    const van =
      placement.crewAssignmentId === null ? undefined : vanById.get(placement.crewAssignmentId);
    const started = isStartedLeg(row);
    const movable = canEdit && !started;
    // Marked only while it is a change to save — a proposal a colleague has since made true (the
    // re-read already has it there) is nothing to save, and nothing to mark.
    const changed = changes.some((change) => change.shipmentId === row.id);
    const proposed = changed && isProposed(row, draft);
    const moved = changed && !proposed;
    const wasRefused = refused?.id === row.id;
    const captain = van === undefined ? null : captainOn(van, placement.captainEmployeeId);
    // On a two-captain van, a محصنة with the OTHER captain says so — the card shows the first only.
    const otherCaptain =
      van !== undefined && captain !== null && van.captains[0]?.employeeId !== captain.employeeId;
    const reschedules = (proposed || moved) && reschedulesOnSave(row, draft);
    const notes: { key: string; text: string; tone: 'info' | 'warn' | 'danger' }[] = [
      ...(row.overdue
        ? [
            {
              key: 'overdue',
              text: t('operations.distribution.overdueHint', { day: dayText(row.deliveryDate) }),
              tone: 'danger' as const,
            },
          ]
        : []),
      ...(proposed
        ? [
            {
              key: 'proposed',
              text: t('operations.distribution.proposedHint'),
              tone: 'warn' as const,
            },
          ]
        : []),
      ...(moved
        ? [{ key: 'moved', text: t('operations.distribution.movedHint'), tone: 'info' as const }]
        : []),
      ...(reschedules
        ? [
            {
              key: 'reschedule',
              text: t('operations.distribution.reschedules', {
                day: dayText(`${day}T00:00:00.000Z`),
              }),
              tone: 'warn' as const,
            },
          ]
        : []),
      ...(started
        ? [
            {
              key: 'started',
              text: t('operations.distribution.startedHint'),
              tone: 'info' as const,
            },
          ]
        : []),
      ...(wasRefused
        ? [
            {
              key: 'refused',
              text: `${t('operations.distribution.refusedMark')}: ${refused.reason}`,
              tone: 'danger' as const,
            },
          ]
        : []),
    ];
    return (
      <ShipmentChip
        key={row.id}
        row={row}
        bankName={bankNameOf(row.mainBankId)}
        branchName={row.destination?.name ?? row.origin?.name ?? ''}
        tone={wasRefused ? 'refused' : proposed ? 'proposed' : moved ? 'moved' : undefined}
        marks={
          <>
            {row.overdue && (
              <ChipMark
                tone="overdue"
                data-mark="overdue"
                icon={PATH.calendar}
                label={`${t('operations.distribution.overdue')} · ${dayText(row.deliveryDate)}`}
              />
            )}
            {proposed && (
              <ChipMark
                tone="proposed"
                data-mark="proposed"
                icon={SHIPMENT_PATH.route}
                label={t('operations.distribution.proposed')}
              />
            )}
            {moved && (
              <ChipMark
                tone="moved"
                data-mark="moved"
                icon={SHIPMENT_PATH.history}
                label={t('operations.distribution.moved')}
              />
            )}
            {reschedules && (
              <ChipMark
                tone="reschedule"
                data-mark="reschedule"
                icon={SHIPMENT_PATH.calendar}
                label={t('operations.distribution.reschedules', {
                  day: dayText(`${day}T00:00:00.000Z`),
                })}
              />
            )}
            {started && (
              <ChipMark
                tone="started"
                data-mark="started"
                icon={PATH.lock}
                label={t('operations.distribution.started')}
              />
            )}
            {otherCaptain && captain !== null && (
              <ChipMark
                tone="captain"
                data-mark="captain"
                icon={SHIPMENT_PATH.person}
                label={t('operations.distribution.withCaptain', { name: personName(captain) })}
              />
            )}
            {wasRefused && (
              <ChipMark
                tone="refused"
                data-mark="refused"
                icon={SHIPMENT_PATH.alert}
                label={`${t('operations.distribution.refusedMark')}: ${refused.reason}`}
              />
            )}
          </>
        }
        move={
          movable ? (
            <MoveMenu
              compact
              rowId={row.id}
              label={t('operations.distribution.moveTo')}
              choices={moveChoices(row)}
            />
          ) : undefined
        }
        card={
          <ShipmentCardBody
            row={row}
            bankName={bankNameOf(row.mainBankId)}
            money={moneyOf(row)}
            packages={packagingOf(row.id)}
            packagesRead={packagesRead}
            place={
              van === undefined
                ? null
                : captain === null
                  ? vanName(van)
                  : `${vanName(van)} · ${t('operations.distribution.withCaptain', { name: personName(captain) })}`
            }
            notes={notes}
          />
        }
        {...(movable
          ? {
              drag: {
                dragging: dragging === row.id,
                onDragStart: (event: DragEvent<HTMLElement>) => startDrag(row.id, event),
                onDragEnd: endDrag,
              },
            }
          : {})}
      />
    );
  };

  // ── The filters (Round 25) ───────────────────────────────────────────────────────────────────

  const unplacedShown = columns.unplaced.filter((row) =>
    matchesUnplacedFilter(row, unplacedFilter, bankWordsOf),
  );
  const vansShown = columns.vans.filter(({ van, rows: load }) =>
    matchesVanFilter(van, load, vanFilter, {
      name: vanCodeText(t, van, looseNumberOf(van.crewAssignmentId)),
      bankWordsOf,
    }),
  );
  const areaLabel = (option: { value: string; label: string }, none: string) =>
    option.value === NO_AREA ? { ...option, label: none } : option;
  const unplacedAreaOptions = shipmentAreaOptions(columns.unplaced, unplacedFilter.area).map(
    (option) => areaLabel(option, t('operations.distribution.filter.noArea')),
  );
  const vanAreaChoices = vanAreaOptions(columns.vans, [], vanFilter.area).map((option) =>
    areaLabel(option, t('operations.distribution.filter.noDirection')),
  );

  // ── The page ───────────────────────────────────────────────────────────────────────────────────

  const loaded = data !== undefined;
  const failed = !tooLarge && hasError(board.error) && !loaded;

  // RIGHT (first in RTL): the vans — three quarters of a wide screen (Round 24c).
  const vansColumn = (
    <DistributionColumn
      title={t('operations.distribution.vans')}
      count={vans.length}
      icon={PATH.truck}
      data-distribution-column="vans"
      filters={
        loaded && vans.length > 0 ? (
          <ColumnFilterBar
            data-filter-bar="vans"
            active={isVanFiltering(vanFilter)}
            shown={vansShown.length}
            total={columns.vans.length}
            onClear={() => setVanFilter(EMPTY_VAN_FILTER)}
          >
            <FilterTextBox
              data-filter="van-code"
              label={t('operations.distribution.filter.vanCode')}
              icon={FILTER_ICON.car}
              value={vanFilter.code}
              onChange={(code) => setVanFilter((current) => ({ ...current, code }))}
            />
            <FilterTextBox
              data-filter="van-search"
              label={t('operations.distribution.filter.search')}
              value={vanFilter.search}
              onChange={(search) => setVanFilter((current) => ({ ...current, search }))}
            />
            <FilterAreaSelect
              data-filter="van-area"
              label={t('operations.distribution.filter.area')}
              allLabel={t('operations.distribution.filter.allAreas')}
              value={vanFilter.area}
              options={vanAreaChoices}
              onChange={(area) => setVanFilter((current) => ({ ...current, area }))}
            />
          </ColumnFilterBar>
        ) : undefined
      }
    >
      {!loaded ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-6 w-6 text-brand-500" />
        </div>
      ) : vans.length === 0 ? (
        <EmptyLoad>{t('operations.distribution.noVans')}</EmptyLoad>
      ) : vansShown.length === 0 ? (
        <EmptyLoad>{t('operations.distribution.filter.none')}</EmptyLoad>
      ) : (
        <div className={VAN_GRID}>
          {vansShown.map(({ van, rows: load }) => {
            const key = `van|${van.crewAssignmentId}`;
            const decision = overDecision(key);
            return (
              <VanCard
                key={van.crewAssignmentId}
                van={van}
                looseNumber={looseNumberOf(van.crewAssignmentId)}
                crewPlanVisible={data.crewPlanVisible}
                day={day}
                count={load.length}
                packages={vanPackages(packagesRead, load, packagingOf)}
                {...(canEdit
                  ? {
                      drop: {
                        armed: armedVan(van.crewAssignmentId),
                        over:
                          decision === 'place'
                            ? ('place' as const)
                            : decision === 'refuse'
                              ? ('refuse' as const)
                              : null,
                      },
                    }
                  : {})}
              >
                {load.length === 0 ? (
                  <EmptyLoad>
                    {takesShipments(van)
                      ? canEdit
                        ? t('operations.distribution.dropHere')
                        : t(
                            hasNoVan(van)
                              ? 'operations.distribution.emptyCrew'
                              : 'operations.distribution.emptyVan',
                          )
                      : van.securedType === false
                        ? t('operations.distribution.notSecured')
                        : t('operations.distribution.noCaptain')}
                  </EmptyLoad>
                ) : (
                  load.map(chip)
                )}
              </VanCard>
            );
          })}
        </div>
      )}
    </DistributionColumn>
  );

  // LEFT: the shipments on no van — and where one is dragged to come off its van. A quarter of a
  // wide screen; on a phone, above the vans and foldable (Round 24c). The whole column, its head
  // included, takes a drop (`data-drop-unplaced`).
  const unplacedOver = overDecision('unplaced') === 'unplace';
  const unplacedColumn = (
    <DistributionColumn
      title={t('operations.distribution.unplaced')}
      count={columns.unplaced.length}
      icon={SHIPMENT_PATH.shipment}
      data-distribution-column="unplaced"
      data-drop-unplaced="true"
      {...(wide
        ? {}
        : { collapse: { open: unplacedOpen, onToggle: () => setUnplacedOpen((v) => !v) } })}
      className={cn(
        canEdit &&
          draggedPlaced &&
          !wide &&
          !unplacedOpen &&
          'outline-dashed outline-2 -outline-offset-4 outline-brand-300 dark:outline-brand-500/50',
        unplacedOver && !wide && !unplacedOpen && 'outline-brand-500 dark:outline-brand-400',
      )}
      filters={
        loaded && columns.unplaced.length > 0 ? (
          <ColumnFilterBar
            data-filter-bar="unplaced"
            active={isUnplacedFiltering(unplacedFilter)}
            shown={unplacedShown.length}
            total={columns.unplaced.length}
            onClear={() => setUnplacedFilter(EMPTY_UNPLACED_FILTER)}
          >
            <FilterTextBox
              data-filter="unplaced-search"
              label={t('operations.distribution.filter.search')}
              value={unplacedFilter.search}
              onChange={(search) => setUnplacedFilter((current) => ({ ...current, search }))}
            />
            <FilterAreaSelect
              data-filter="unplaced-area"
              label={t('operations.distribution.filter.area')}
              allLabel={t('operations.distribution.filter.allAreas')}
              value={unplacedFilter.area}
              options={unplacedAreaOptions}
              onChange={(area) => setUnplacedFilter((current) => ({ ...current, area }))}
            />
          </ColumnFilterBar>
        ) : undefined
      }
      bodyProps={{
        'data-drop-over': unplacedOver ? 'true' : undefined,
        className: cn(
          'rounded-b-2xl transition-colors',
          canEdit &&
            draggedPlaced &&
            'outline-dashed outline-2 -outline-offset-4 outline-brand-300 dark:outline-brand-500/50',
          unplacedOver &&
            'bg-brand-50 outline-brand-500 dark:bg-brand-500/10 dark:outline-brand-400',
        ),
      }}
    >
      {!loaded ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-6 w-6 text-brand-500" />
        </div>
      ) : columns.unplaced.length === 0 ? (
        <EmptyLoad>
          {rows.length === 0
            ? t('operations.distribution.empty')
            : t('operations.distribution.allPlaced')}
        </EmptyLoad>
      ) : (
        <div className="grid gap-1.5">
          {draggedPlaced && (
            <p className="text-center text-xs font-bold text-brand-600 dark:text-brand-300">
              {t('operations.distribution.dropBack')}
            </p>
          )}
          {unplacedShown.length === 0 ? (
            <EmptyLoad>{t('operations.distribution.filter.none')}</EmptyLoad>
          ) : (
            unplacedShown.map(chip)
          )}
        </div>
      )}
    </DistributionColumn>
  );

  return (
    <PageContainer fullHeight>
      <div className={BOARD_FRAME} data-distribution-page="true" {...screenDrop}>
        {/* The boards' toolbar: the figures at the start, the acts at the end. */}
        <div
          className="flex flex-wrap items-center justify-between gap-2"
          data-distribution-toolbar="true"
        >
          <div role="status" className="flex min-w-0 flex-wrap items-center gap-1.5">
            <BoardFigurePill
              icon={PATH.truck}
              tone={FIGURE_TONE.pound}
              label={t('operations.distribution.vans')}
              value={loaded ? formatNumber(vans.length, locale) : '…'}
              data-figure="vans"
            />
            <BoardFigurePill
              icon={SHIPMENT_PATH.shipment}
              tone={FIGURE_TONE.count}
              label={t('operations.distribution.shipments')}
              value={loaded ? formatNumber(rows.length, locale) : '…'}
              data-figure="shipments"
            />
            <BoardFigurePill
              icon={SHIPMENT_PATH.shipment}
              tone={FIGURE_TONE.others}
              label={t('operations.distribution.unplaced')}
              value={loaded ? formatNumber(columns.unplaced.length, locale) : '…'}
              data-figure="unplaced"
            />
          </div>
          {canEdit && (
            <span className="ms-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1 sm:gap-2">
              <button
                type="button"
                data-distribution-auto="true"
                disabled={!loaded}
                onClick={autoDistribute}
                title={t('operations.distribution.autoHint')}
                className={cn(BRAND_BUTTON, 'disabled:cursor-not-allowed disabled:opacity-50')}
              >
                <BoardIcon d={[...SHIPMENT_PATH.route]} className="h-3.5 w-3.5 rtl:-scale-x-100" />
                {t('operations.distribution.auto')}
              </button>
              {/* «تراجع» — the LAST operation only (Round 24); its tooltip says which. */}
              <button
                type="button"
                data-distribution-discard="true"
                data-distribution-undo={String(history.past.length)}
                disabled={lastMove === null}
                title={undoTitle}
                aria-label={undoTitle}
                aria-keyshortcuts="Control+Z Meta+Z"
                onClick={undoLast}
                className={cn(BRAND_BUTTON, 'disabled:cursor-not-allowed disabled:opacity-50')}
              >
                <BoardIcon d={[...SHIPMENT_PATH.undo]} className="h-3.5 w-3.5" />
                {t('operations.distribution.discard')}
              </button>
              <button
                type="button"
                data-distribution-save={changes.length}
                disabled={!dirty || save.isPending}
                aria-busy={save.isPending}
                onClick={() => void onSave()}
                className={cn(
                  dirty ? ADD_BUTTON : BRAND_BUTTON,
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                {save.isPending ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : (
                  <BoardIcon d={[...SHIPMENT_PATH.check]} className="h-3.5 w-3.5" width={2.5} />
                )}
                {t('operations.distribution.save', { count: formatNumber(changes.length, locale) })}
              </button>
            </span>
          )}
        </div>

        {/* The day, and what the marks on the cards mean. */}
        <div className={DAY_BAR} data-distribution-bar="true">
          <DayBox
            label={t('operations.distribution.day')}
            value={day}
            min={minDay}
            onChange={setDay}
          />
          <p className="w-full min-w-0 text-xs font-bold leading-5 text-slate-500 sm:w-auto sm:flex-1 dark:text-slate-400">
            {canEdit
              ? t('operations.distribution.dragHint')
              : t('operations.distribution.viewOnly')}
          </p>
          {canEdit && proposedCount > 0 && (
            <CardMark tone="proposed" data-proposed-count={String(proposedCount)}>
              {t('operations.distribution.proposedCount', {
                count: formatNumber(proposedCount, locale),
              })}
            </CardMark>
          )}
        </div>

        {tooLarge ? (
          <BoardRefusal>
            {t('operations.distribution.tooLarge', {
              max: formatNumber(OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS, locale),
            })}
          </BoardRefusal>
        ) : failed ? (
          <ErrorState error={board.error} onRetry={() => void board.refetch()} />
        ) : (
          <div className={DISTRIBUTION_COLUMNS} data-distribution-columns="true">
            {/* A computer: the vans first — the RIGHT, in RTL. A phone: the محصنات on no van
                first, foldable — they are the work to do, and «نقل إلى…» on each is how they move. */}
            {wide ? (
              <>
                {vansColumn}
                {unplacedColumn}
              </>
            ) : (
              <>
                {unplacedColumn}
                {vansColumn}
              </>
            )}
          </div>
        )}
      </div>

      {/* «لديك تغييرات غير محفوظة» — another day, a link in the menu, a reload. */}
      <DesignDialog
        open={guard.leaveOpen}
        onClose={guard.cancel}
        title={t('operations.distribution.leaveTitle')}
        icon={PATH.warn}
        width="lg"
        panelProps={{ 'data-distribution-leave': 'true' }}
        footer={
          <>
            <DesignSave
              onClick={guard.confirm}
              label={t('operations.distribution.leaveConfirm')}
              data-distribution-leave-confirm="true"
            />
            <DesignCancel onClick={guard.cancel} label={t('operations.distribution.leaveStay')} />
          </>
        }
      >
        <p className="text-[15px] font-semibold leading-7 text-slate-700 dark:text-slate-200">
          {t('operations.distribution.leaveBody', { count: formatNumber(changes.length, locale) })}
        </p>
      </DesignDialog>
    </PageContainer>
  );
};
