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
//   · A VAN WITH TWO CAPTAINS: the shipment goes with the first; the chip on its card («مع …»)
//     switches it to the other — the captain whose route (and phone) it lands on;
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
// WHO. The screen is `operationsShipment.view`'s; moving and saving are `operationsShipment.edit`'s
// (assign-delivery's grant — distributing IS assigning the delivery leg, for many at once). A reader
// without it sees the day's plan as it stands, with nothing to drag.
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  MAX_PAGE_SIZE,
  OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS,
  type Locale,
  type OperationsCurrencyDto,
  type OperationsDayBoardVehicleCrewDto,
  type OperationsSecuredDistributionRowDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { cn } from '../../../shared/lib/cn';
import { errorMessage, hasError } from '../../../shared/lib/errors';
import { formatNumber } from '../../../shared/lib/format';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useAppSelector } from '../../../store';
import { useUnsavedGuard } from '../../atm/lib/useUnsavedGuard';
import { BOARD_FRAME } from '../../fleet/components/board-scroll';
import { DesignCancel, DesignDialog, DesignSave } from '../../fleet/components/DesignDialog';
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
  DAY_BAR,
  DayBox,
  DistributionColumn,
  EmptyLoad,
  MoveMenu,
  SHIPMENT_DRAG_TYPE,
  ShipmentCard,
  VanCard,
  carriesShipment,
  dayText,
  type MoveChoice,
} from '../components/SecuredDistributionParts';
import { SHIPMENT_PATH } from '../components/shipment-icons';
import { boardFigures } from '../lib/day-board';
import {
  EMPTY_DRAFT,
  UNPLACED,
  captainOn,
  distributionChanges,
  distributionColumns,
  distributionSaveBody,
  isProposed,
  isStartedLeg,
  loadFigures,
  moveToVan,
  nextCaptain,
  personName,
  placeShipment,
  placementOf,
  proposeByDirection,
  readDistributionDate,
  refusedShipmentId,
  reschedulesOnSave,
  takesShipments,
  withoutShipment,
  type DistributionDraft,
} from '../lib/secured-distribution';
import { isHistoryTooLarge } from '../lib/shipment-history';
import { useCairoToday } from '../lib/use-cairo-today';

/** The left column's drop key — a shipment dropped there is taken off its van. */
const UNPLACED_KEY = 'unplaced';

export const SecuredDistributionPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  const today = useCairoToday();
  const date = readDistributionDate(sp.get('date'), today);
  const canEdit = can('operationsShipment.edit');

  const board = useOperationsSecuredDistribution(date);
  const banks = useOperationsBanks({
    page: 1,
    pageSize: MAX_PAGE_SIZE,
    sortBy: 'code',
    sortDir: 'asc',
  });
  const currencies = useOperationsCurrencies({ page: 1, pageSize: MAX_PAGE_SIZE });
  // The packages are the vault's (counted at its receipt): read where the reader may read the vault.
  const packaging = useVaultPackaging(can('operationsVault.view'));
  const save = useSaveSecuredDistribution();

  const tooLarge = isHistoryTooLarge(board.error);
  const data = tooLarge ? undefined : board.data;
  const rows = data?.shipments ?? [];
  const vans = data?.crews ?? [];
  // The server's day — the one the vans and the shipments are of.
  const day = data?.date.slice(0, 10) ?? date ?? today;
  const minDay = data?.today.slice(0, 10) ?? today;

  // The person's work between the read and «حفظ».
  const [draft, setDraft] = useState<DistributionDraft>(EMPTY_DRAFT);
  // The day whose first read has been proposed on — proposals are made once per day, not on every
  // re-read (a proposal the person took off must not come back by itself under their hand).
  const [seeded, setSeeded] = useState<string | null>(null);
  const [refused, setRefused] = useState<{ id: string; reason: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const saving = useRef(false);

  // A day's FIRST read: its proposals, made while rendering (React's «state from the previous
  // render» pattern) rather than in an effect, so the screen never shows the day un-proposed for a
  // frame — the cards would jump under the person's eyes. Proposed only for someone who can save
  // them: to anyone else a proposal is a promise the screen cannot keep.
  if (data !== undefined && seeded !== data.date.slice(0, 10)) {
    setSeeded(data.date.slice(0, 10));
    setRefused(null);
    setDraft(canEdit ? proposeByDirection(data.shipments, data.crews, EMPTY_DRAFT) : EMPTY_DRAFT);
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
      setDraft(EMPTY_DRAFT);
      setSeeded(null);
      setRefused(null);
    });
  };

  const bankNameOf = (id: string): string =>
    banks.data?.items.find((bank) => bank.id === id)?.opsName ?? '';
  const currencyOf = (id: string): OperationsCurrencyDto | undefined =>
    currencies.data?.items.find((currency) => currency.id === id);
  const packagingOf = (id: string) => packaging.data?.get(id);

  const columns = distributionColumns(rows, vans, draft);
  const vanById = new Map(vans.map((van) => [van.crewAssignmentId, van]));
  const proposedCount = changes.filter((change) => draft.get(change.shipmentId)?.proposed).length;

  const rowById = new Map(rows.map((row) => [row.id, row]));

  /** Put a shipment somewhere — the drag's drop and the menu's choice. */
  const move = (
    row: OperationsSecuredDistributionRowDto,
    van: OperationsDayBoardVehicleCrewDto | null,
  ): void => {
    if (!canEdit) return;
    setDraft((current) =>
      van === null ? placeShipment(current, row, UNPLACED) : moveToVan(current, row, van),
    );
    if (refused?.id === row.id) setRefused(null);
  };

  const autoDistribute = (): void => {
    const next = proposeByDirection(rows, vans, draft);
    const added = [...next.keys()].filter((id) => !draft.has(id)).length;
    setDraft(next);
    if (added === 0) toast.info(t('operations.distribution.autoNone'));
    else
      toast.success(t('operations.distribution.autoDone', { count: formatNumber(added, locale) }));
  };

  const onSave = async (): Promise<void> => {
    const body = distributionSaveBody(day, rows, draft);
    if (body === null || saving.current) return;
    saving.current = true;
    try {
      // Resolves once the screens it moves have been read again (the hook's `onSettled`), so the
      // cards land where the server put them without a flicker back.
      const result = await save.mutateAsync(body);
      setDraft(EMPTY_DRAFT);
      setRefused(null);
      toast.success(
        result.rescheduled > 0
          ? t('operations.distribution.savedRescheduled', {
              count: formatNumber(result.changed, locale),
              rescheduled: formatNumber(result.rescheduled, locale),
            })
          : t('operations.distribution.saved', { count: formatNumber(result.changed, locale) }),
      );
    } catch (error) {
      const reason = errorMessage(error, locale);
      const id = refusedShipmentId(error);
      if (id !== null) {
        setDraft((current) => withoutShipment(current, id));
        setRefused({ id, reason });
      }
      toast.error(t('operations.distribution.refused', { reason }));
    } finally {
      saving.current = false;
    }
  };

  // ── Drag and drop ──────────────────────────────────────────────────────────────────────────────

  const draggedRow = dragging === null ? undefined : rowById.get(dragging);
  /** May the shipment being dragged land here? A van with a captain, other than its own; the left column for one on a van. */
  const accepts = (key: string): boolean => {
    if (draggedRow === undefined) return false;
    const at = placementOf(draggedRow, draft).crewAssignmentId;
    if (key === UNPLACED_KEY) return at !== null;
    const van = vanById.get(key);
    return van !== undefined && takesShipments(van) && at !== key;
  };

  const dropTarget = (key: string, onRow: (row: OperationsSecuredDistributionRowDto) => void) => ({
    onDragOver: (event: DragEvent) => {
      if (!carriesShipment(event) || !accepts(key)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (over !== key) setOver(key);
    },
    onDragEnter: (event: DragEvent) => {
      if (!carriesShipment(event) || !accepts(key)) return;
      event.preventDefault();
      setOver(key);
    },
    onDragLeave: (event: DragEvent) => {
      // Moving onto a card INSIDE the target is not leaving it.
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setOver((current) => (current === key ? null : current));
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      const id = event.dataTransfer.getData(SHIPMENT_DRAG_TYPE) || dragging;
      setOver(null);
      setDragging(null);
      const row = id === null ? undefined : rowById.get(id);
      if (row !== undefined && accepts(key)) onRow(row);
    },
  });

  // ── A shipment's card ──────────────────────────────────────────────────────────────────────────

  const moveChoices = (row: OperationsSecuredDistributionRowDto): MoveChoice[] => {
    const at = placementOf(row, draft).crewAssignmentId;
    const choices: MoveChoice[] = vans.map((van) => ({
      key: van.crewAssignmentId,
      label: t('operations.distribution.vanLabel', { code: van.vehicleCode ?? '…' }),
      sub: [van.captains.map(personName).join(' · '), van.direction ?? '']
        .filter((part) => part !== '')
        .join(' — '),
      current: van.crewAssignmentId === at,
      ...(takesShipments(van) ? {} : { disabledReason: t('operations.distribution.noCaptain') }),
      onSelect: () => move(row, van),
    }));
    if (at !== null) {
      choices.push({
        key: UNPLACED_KEY,
        label: t('operations.distribution.remove'),
        danger: true,
        onSelect: () => move(row, null),
      });
    }
    return choices;
  };

  const card = (row: OperationsSecuredDistributionRowDto): ReactNode => {
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
    const other = van === undefined ? null : nextCaptain(van, placement.captainEmployeeId);
    return (
      <ShipmentCard
        key={row.id}
        row={row}
        bankName={bankNameOf(row.mainBankId)}
        figures={boardFigures([row], currencyOf)}
        packages={packagingOf(row.id)}
        tone={wasRefused ? 'refused' : proposed ? 'proposed' : moved ? 'moved' : undefined}
        marks={
          <>
            {row.overdue && (
              <CardMark
                tone="overdue"
                data-mark="overdue"
                title={t('operations.distribution.overdueHint', { day: dayText(row.deliveryDate) })}
              >
                {t('operations.distribution.overdue')} · {dayText(row.deliveryDate)}
              </CardMark>
            )}
            {proposed && (
              <CardMark
                tone="proposed"
                data-mark="proposed"
                title={t('operations.distribution.proposedHint')}
              >
                {t('operations.distribution.proposed')}
              </CardMark>
            )}
            {moved && (
              <CardMark
                tone="moved"
                data-mark="moved"
                title={t('operations.distribution.movedHint')}
              >
                {t('operations.distribution.moved')}
              </CardMark>
            )}
            {(proposed || moved) && reschedulesOnSave(row, draft) && (
              <CardMark tone="reschedule" data-mark="reschedule">
                {t('operations.distribution.reschedules', { day: dayText(`${day}T00:00:00.000Z`) })}
              </CardMark>
            )}
            {started && (
              <CardMark
                tone="started"
                data-mark="started"
                title={t('operations.distribution.startedHint')}
              >
                <BoardIcon d={[...PATH.lock]} className="h-2.5 w-2.5" />
                {t('operations.distribution.started')}
              </CardMark>
            )}
            {wasRefused && (
              <CardMark tone="refused" data-mark="refused" title={refused.reason}>
                {t('operations.distribution.refusedMark')}
              </CardMark>
            )}
          </>
        }
        controls={
          <>
            {/* A van with two captains: who this one goes with, and the switch to the other. */}
            {van !== undefined &&
              van.captains.length > 1 &&
              captain !== null &&
              (movable && other !== null ? (
                <button
                  type="button"
                  data-captain-switch={row.id}
                  title={t('operations.distribution.switchCaptain', { name: personName(other) })}
                  aria-label={t('operations.distribution.switchCaptain', {
                    name: personName(other),
                  })}
                  onClick={() =>
                    setDraft((current) =>
                      placeShipment(current, row, {
                        crewAssignmentId: van.crewAssignmentId,
                        captainEmployeeId: other.employeeId,
                      }),
                    )
                  }
                  className="inline-flex max-w-[11rem] items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200 dark:hover:bg-emerald-500/20"
                >
                  <BoardIcon d={[...SHIPMENT_PATH.person]} className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    {t('operations.distribution.withCaptain', { name: personName(captain) })}
                  </span>
                  <BoardIcon
                    d={[...SHIPMENT_PATH.reorder]}
                    className="h-3 w-3 shrink-0 rotate-90"
                  />
                </button>
              ) : (
                <span className="truncate text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                  {t('operations.distribution.withCaptain', { name: personName(captain) })}
                </span>
              ))}
            {movable && (
              <MoveMenu
                rowId={row.id}
                label={t('operations.distribution.moveTo')}
                choices={moveChoices(row)}
              />
            )}
          </>
        }
        {...(movable
          ? {
              drag: {
                dragging: dragging === row.id,
                onDragStart: (event: DragEvent<HTMLElement>) => {
                  event.dataTransfer.setData(SHIPMENT_DRAG_TYPE, row.id);
                  event.dataTransfer.setData('text/plain', row.id);
                  event.dataTransfer.effectAllowed = 'move';
                  setDragging(row.id);
                },
                onDragEnd: () => {
                  setDragging(null);
                  setOver(null);
                },
              },
            }
          : {})}
      />
    );
  };

  // ── The page ───────────────────────────────────────────────────────────────────────────────────

  const loaded = data !== undefined;
  const failed = !tooLarge && hasError(board.error) && !loaded;

  return (
    <PageContainer fullHeight>
      <div className={BOARD_FRAME} data-distribution-page="true">
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
              <button
                type="button"
                data-distribution-discard="true"
                disabled={!dirty}
                onClick={() => {
                  setDraft(EMPTY_DRAFT);
                  setRefused(null);
                }}
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
          <div
            className="grid gap-4 lg:min-h-[24rem] lg:flex-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
            data-distribution-columns="true"
          >
            {/* RIGHT (first in RTL): the vans. */}
            <DistributionColumn
              title={t('operations.distribution.vans')}
              count={vans.length}
              icon={PATH.truck}
              data-distribution-column="vans"
            >
              {!loaded ? (
                <div className="flex justify-center py-10">
                  <Spinner className="h-6 w-6 text-brand-500" />
                </div>
              ) : vans.length === 0 ? (
                <EmptyLoad>{t('operations.distribution.noVans')}</EmptyLoad>
              ) : (
                <div className="grid items-start gap-3 xl:grid-cols-2">
                  {columns.vans.map(({ van, rows: load }) => (
                    <VanCard
                      key={van.crewAssignmentId}
                      van={van}
                      crewPlanVisible={data.crewPlanVisible}
                      figures={loadFigures(load, currencyOf, packagingOf)}
                      {...(canEdit
                        ? {
                            drop: {
                              armed: accepts(van.crewAssignmentId),
                              over: over === van.crewAssignmentId,
                              handlers: dropTarget(van.crewAssignmentId, (row) => move(row, van)),
                            },
                          }
                        : {})}
                    >
                      {load.length === 0 ? (
                        <EmptyLoad>
                          {takesShipments(van)
                            ? canEdit
                              ? t('operations.distribution.dropHere')
                              : t('operations.distribution.emptyVan')
                            : t('operations.distribution.noCaptain')}
                        </EmptyLoad>
                      ) : (
                        load.map(card)
                      )}
                    </VanCard>
                  ))}
                </div>
              )}
            </DistributionColumn>

            {/* LEFT: the shipments on no van — and where one is dragged to come off its van. */}
            <DistributionColumn
              title={t('operations.distribution.unplaced')}
              count={columns.unplaced.length}
              icon={SHIPMENT_PATH.shipment}
              data-distribution-column="unplaced"
              bodyProps={{
                'data-drop-over': over === UNPLACED_KEY ? 'true' : undefined,
                className: cn(
                  'rounded-b-2xl transition-colors',
                  canEdit &&
                    accepts(UNPLACED_KEY) &&
                    'outline-dashed outline-2 -outline-offset-4 outline-brand-300 dark:outline-brand-500/50',
                  over === UNPLACED_KEY &&
                    'bg-brand-50 outline-brand-500 dark:bg-brand-500/10 dark:outline-brand-400',
                ),
                ...(canEdit ? dropTarget(UNPLACED_KEY, (row) => move(row, null)) : {}),
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
                <div className="grid gap-2">
                  {dragging !== null && accepts(UNPLACED_KEY) && (
                    <p className="text-center text-xs font-bold text-brand-600 dark:text-brand-300">
                      {t('operations.distribution.dropBack')}
                    </p>
                  )}
                  {columns.unplaced.map(card)}
                </div>
              )}
            </DistributionColumn>
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
