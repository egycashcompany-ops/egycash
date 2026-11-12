// «تسليم المحصنات» (Round 12) — the vault hands each van of the day its load.
//
// The owner: «ولما يحفظ نفس الشاشة هنعمل زيها للخزنة هيكون فوق كل عربيه تسليم وطباعه اللى هيطبع هقولك
// عليه بعدين ايه هو بس لما يدوس تسليم المحصنات هتتسلم ساعتها وخلاص مش هتبقى ف الخزنة».
//
// «نفس الشاشة»: the distribution's read and its two columns (`SecuredDistributionParts.tsx`) — the
// day's vans on the RIGHT, each with the shipments Operations SAVED on it, and the day's shipments
// on no van on the LEFT, for the vault's information («للعلم فقط»: placing is Operations' act, on
// «توزيع المحصنات»). Nothing here moves: no drag, no menu, no proposal.
//
// Over each van, two acts:
//   · «تسليم» (`operationsVault.dispatch`) — a confirmation that says what leaves (the van, its
//     captains, how many, how much, which), then the dispatch that already exists (`POST
//     /operations/secured/dispatch`) with that van's crew row and ITS shipments the vault HOLDS
//     (`handoverRequest`). They leave the vault on the click — «هتتسلم ساعتها وخلاص مش هتبقى ف
//     الخزنة» — and so leave this screen. A shipment on the van the vault has not received yet is
//     listed under it and NOT sent, with why: the vault cannot hand over what it does not hold (the
//     dispatch would refuse it);
//   · «طباعة» — the van's load on the company's report form (`lib/van-load-sheet.ts`), PROVISIONAL
//     until the owner says what the paper is («اللى هيطبع هقولك عليه بعدين»).
//
// WHO. The screen is `operationsVault.view`'s; «تسليم» is `operationsVault.dispatch`'s. A treasurer
// holding only the vault's grants does not hear a placement Operations saves (the assignment
// topics are the shipment grant's), so the screen re-reads itself once a minute and whenever the
// tab comes back into view, as the vault's other screens do.
import { useRef, useState } from 'react';
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
import { formatAmount, formatNumber } from '../../../shared/lib/format';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useAppSelector } from '../../../store';
import { BOARD_FRAME } from '../../fleet/components/board-scroll';
import { DesignCancel, DesignDialog, DesignSave } from '../../fleet/components/DesignDialog';
import { BoardIcon, PATH } from '../../fleet/components/FuelCardBoard';
import { printFleetReport } from '../../fleet/lib/fleet-report-print';
import {
  useDispatchSecured,
  useOperationsBanks,
  useOperationsCurrencies,
  useOperationsSecuredDistribution,
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
  MoneyLine,
  ShipmentCard,
  VanCard,
  dayText,
} from '../components/SecuredDistributionParts';
import { SHIPMENT_PATH } from '../components/shipment-icons';
import { boardFigures } from '../lib/day-board';
import {
  EMPTY_DRAFT,
  captainOn,
  distributionColumns,
  handoverRequest,
  handoverShipments,
  loadFigures,
  notYetInVault,
  personName,
  readDistributionDate,
} from '../lib/secured-distribution';
import { isHistoryTooLarge } from '../lib/shipment-history';
import { useCairoToday } from '../lib/use-cairo-today';
import { vanLoadSheet } from '../lib/van-load-sheet';

export const VaultHandoverPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  const today = useCairoToday();
  const date = readDistributionDate(sp.get('date'), today);
  const canHandOver = can('operationsVault.dispatch');

  // A reader without the shipment grant hears no placement: the screen re-reads itself for them.
  const board = useOperationsSecuredDistribution(date, true, !can('operationsShipment.view'));
  const banks = useOperationsBanks({
    page: 1,
    pageSize: MAX_PAGE_SIZE,
    sortBy: 'code',
    sortDir: 'asc',
  });
  const currencies = useOperationsCurrencies({ page: 1, pageSize: MAX_PAGE_SIZE });
  const packaging = useVaultPackaging(true);
  const dispatch = useDispatchSecured();

  const tooLarge = isHistoryTooLarge(board.error);
  const data = tooLarge ? undefined : board.data;
  const rows = data?.shipments ?? [];
  const vans = data?.crews ?? [];
  const day = data?.date.slice(0, 10) ?? date ?? today;
  const minDay = data?.today.slice(0, 10) ?? today;
  const loaded = data !== undefined;
  const failed = !tooLarge && hasError(board.error) && !loaded;

  const [confirming, setConfirming] = useState<string | null>(null);
  const sending = useRef(false);

  const setDay = (value: string): void => {
    const next = new URLSearchParams(sp);
    if (value === '' || value <= minDay) next.delete('date');
    else next.set('date', value);
    setSp(next);
  };

  const bankNameOf = (id: string): string =>
    banks.data?.items.find((bank) => bank.id === id)?.opsName ?? '';
  const currencyOf = (id: string): OperationsCurrencyDto | undefined =>
    currencies.data?.items.find((currency) => currency.id === id);
  const packagingOf = (id: string) => packaging.data?.get(id);

  // The SAVED places — the vault moves nothing.
  const columns = distributionColumns(rows, vans, EMPTY_DRAFT);
  const confirmVan = confirming === null ? undefined : vans.find((van) => van.crewAssignmentId === confirming);

  const print = (van: OperationsDayBoardVehicleCrewDto, load: readonly OperationsSecuredDistributionRowDto[]): void => {
    try {
      printFleetReport(
        vanLoadSheet({
          t,
          day,
          van,
          crewPlanVisible: data?.crewPlanVisible ?? false,
          rows: load,
          bankNameOf,
          currencyOf,
          packagingOf,
          amount: (value) => formatAmount(value, locale),
          // Latin digits on paper, as its money: a sheet that mixes the two reads as two sources.
          count: (value) => formatAmount(value, locale),
        }),
      );
    } catch {
      toast.error(t('operations.handover.popupBlocked'));
    }
  };

  const handOver = async (van: OperationsDayBoardVehicleCrewDto): Promise<void> => {
    const body = handoverRequest(rows, van.crewAssignmentId);
    if (body === null || sending.current) return;
    sending.current = true;
    try {
      await dispatch.mutateAsync(body);
      toast.success(
        t('operations.handover.done', {
          count: formatNumber(body.shipmentIds.length, locale),
          code: van.vehicleCode ?? '…',
        }),
      );
      setConfirming(null);
    } catch (error) {
      toast.error(
        t('operations.handover.failed', {
          code: van.vehicleCode ?? '…',
          reason: errorMessage(error, locale),
        }),
      );
    } finally {
      sending.current = false;
    }
  };

  /** A shipment's card — read-only: where it stands, and whether the vault holds it. */
  const card = (row: OperationsSecuredDistributionRowDto, van?: OperationsDayBoardVehicleCrewDto) => {
    const captain = van === undefined ? null : captainOn(van, row.delivery?.captainEmployeeId ?? null);
    return (
      <ShipmentCard
        key={row.id}
        row={row}
        bankName={bankNameOf(row.mainBankId)}
        figures={boardFigures([row], currencyOf)}
        packages={packagingOf(row.id)}
        marks={
          <>
            {row.overdue && (
              <CardMark tone="overdue" data-mark="overdue">
                {t('operations.distribution.overdue')} · {dayText(row.deliveryDate)}
              </CardMark>
            )}
            {van !== undefined && row.status !== 'inVault' && (
              <CardMark tone="waiting" data-mark="not-in-vault" title={t('operations.handover.notInVaultHint')}>
                {t('operations.handover.notInVault')}
              </CardMark>
            )}
          </>
        }
        controls={
          van !== undefined && van.captains.length > 1 && captain !== null ? (
            <span className="truncate text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
              {t('operations.distribution.withCaptain', { name: personName(captain) })}
            </span>
          ) : undefined
        }
      />
    );
  };

  const confirmLoad = confirmVan === undefined ? [] : handoverShipments(rows, confirmVan.crewAssignmentId);
  const confirmHeld = confirmVan === undefined ? [] : notYetInVault(rows, confirmVan.crewAssignmentId);

  return (
    <PageContainer fullHeight>
      <div className={BOARD_FRAME} data-handover-page="true">
        <div className="flex flex-wrap items-center justify-between gap-2" data-handover-toolbar="true">
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
              label={t('operations.handover.ready')}
              value={
                loaded
                  ? formatNumber(
                      vans.reduce((sum, van) => sum + handoverShipments(rows, van.crewAssignmentId).length, 0),
                      locale,
                    )
                  : '…'
              }
              data-figure="ready"
            />
            <BoardFigurePill
              icon={SHIPMENT_PATH.shipment}
              tone={FIGURE_TONE.others}
              label={t('operations.distribution.unplaced')}
              value={loaded ? formatNumber(columns.unplaced.length, locale) : '…'}
              data-figure="unplaced"
            />
          </div>
        </div>

        <div className={DAY_BAR} data-handover-bar="true">
          <DayBox label={t('operations.distribution.day')} value={day} min={minDay} onChange={setDay} />
          <p className="w-full min-w-0 text-xs font-bold leading-5 text-slate-500 sm:w-auto sm:flex-1 dark:text-slate-400">
            {t('operations.handover.hint')}
          </p>
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
            data-handover-columns="true"
          >
            <DistributionColumn
              title={t('operations.distribution.vans')}
              count={vans.length}
              icon={PATH.truck}
              data-handover-column="vans"
            >
              {!loaded ? (
                <div className="flex justify-center py-10">
                  <Spinner className="h-6 w-6 text-brand-500" />
                </div>
              ) : vans.length === 0 ? (
                <EmptyLoad>{t('operations.distribution.noVans')}</EmptyLoad>
              ) : (
                <div className="grid items-start gap-3 xl:grid-cols-2">
                  {columns.vans.map(({ van, rows: load }) => {
                    const ready = handoverShipments(load, van.crewAssignmentId);
                    const held = notYetInVault(load, van.crewAssignmentId);
                    return (
                      <VanCard
                        key={van.crewAssignmentId}
                        van={van}
                        crewPlanVisible={data.crewPlanVisible}
                        figures={loadFigures(load, currencyOf, packagingOf)}
                        actions={
                          <>
                            {canHandOver && (
                              <button
                                type="button"
                                data-handover-open={van.crewAssignmentId}
                                aria-haspopup="dialog"
                                disabled={ready.length === 0}
                                title={ready.length === 0 ? t('operations.handover.nothing') : undefined}
                                onClick={() => setConfirming(van.crewAssignmentId)}
                                className={cn(
                                  ready.length > 0 ? ADD_BUTTON : BRAND_BUTTON,
                                  'disabled:cursor-not-allowed disabled:opacity-50',
                                )}
                              >
                                <BoardIcon d={[...PATH.truck]} className="h-3.5 w-3.5" />
                                {t('operations.handover.handover', {
                                  count: formatNumber(ready.length, locale),
                                })}
                              </button>
                            )}
                            <button
                              type="button"
                              data-handover-print={van.crewAssignmentId}
                              onClick={() => print(van, load)}
                              className={BRAND_BUTTON}
                            >
                              <BoardIcon d={[...PATH.pdf]} className="h-3.5 w-3.5" />
                              {t('operations.handover.print')}
                            </button>
                          </>
                        }
                        footer={
                          held.length > 0 ? (
                            <p
                              data-handover-held={held.length}
                              className="flex items-start gap-1.5 rounded-lg bg-slate-100 px-2 py-1.5 text-[11px] font-bold leading-5 text-slate-600 dark:bg-slate-800/70 dark:text-slate-300"
                            >
                              <BoardIcon d={[...SHIPMENT_PATH.info]} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              {t('operations.handover.heldNote', { count: formatNumber(held.length, locale) })}
                            </p>
                          ) : undefined
                        }
                      >
                        {load.length === 0 ? (
                          <EmptyLoad>{t('operations.distribution.emptyVan')}</EmptyLoad>
                        ) : (
                          load.map((row) => card(row, van))
                        )}
                      </VanCard>
                    );
                  })}
                </div>
              )}
            </DistributionColumn>

            <DistributionColumn
              title={t('operations.distribution.unplaced')}
              count={columns.unplaced.length}
              icon={SHIPMENT_PATH.shipment}
              data-handover-column="unplaced"
              extra={
                <span className="ms-auto text-[11px] font-bold text-slate-500 dark:text-slate-400">
                  {t('operations.handover.unplacedHint')}
                </span>
              }
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
                <div className="grid gap-2">{columns.unplaced.map((row) => card(row))}</div>
              )}
            </DistributionColumn>
          </div>
        )}
      </div>

      {/* «تسليم» — what leaves, before the click. */}
      {confirmVan !== undefined && (
        <DesignDialog
          open
          onClose={() => setConfirming(null)}
          title={t('operations.handover.confirmTitle', { code: confirmVan.vehicleCode ?? '…' })}
          subtitle={
            confirmVan.captains.length === 0
              ? undefined
              : confirmVan.captains.map(personName).join(' · ')
          }
          icon={PATH.truck}
          width="2xl"
          wrapTitle
          panelProps={{ 'data-handover-confirm': confirmVan.crewAssignmentId }}
          footer={
            <>
              <DesignSave
                onClick={() => void handOver(confirmVan)}
                busy={dispatch.isPending}
                disabled={confirmLoad.length === 0}
                label={t('operations.handover.confirm', {
                  count: formatNumber(confirmLoad.length, locale),
                })}
                data-handover-confirm-save="true"
              />
              <DesignCancel onClick={() => setConfirming(null)} label={t('operations.handover.back')} />
            </>
          }
        >
          <div
            data-handover-confirm-body="true"
            className="flex items-start gap-3 rounded-xl border border-violet-300 bg-violet-50 px-4 py-3 text-[15px] font-semibold leading-7 text-violet-900 dark:border-violet-500/40 dark:bg-violet-500/[0.08] dark:text-violet-100"
          >
            <BoardIcon d={[...PATH.truck]} className="mt-1.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-300" />
            <span>
              {t('operations.handover.confirmBody', {
                count: formatNumber(confirmLoad.length, locale),
                code: confirmVan.vehicleCode ?? '…',
              })}
            </span>
          </div>
          <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-[#2b3b6b] dark:bg-[#0a1233]/80">
            <MoneyLine
              figures={loadFigures(confirmLoad, currencyOf, packagingOf)}
              packages={loadFigures(confirmLoad, currencyOf, packagingOf).packages}
              showZero
            />
            <ul className="max-h-48 space-y-1 overflow-y-auto text-sm font-bold text-slate-700 dark:text-slate-200">
              {confirmLoad.map((row) => (
                <li key={row.id} data-handover-confirm-row={row.id} className="leading-snug">
                  {bankNameOf(row.mainBankId) || '…'} · {row.origin?.name ?? '…'} ←{' '}
                  {row.destination?.name ?? '…'}
                </li>
              ))}
            </ul>
          </section>
          {confirmHeld.length > 0 && (
            <section
              data-handover-confirm-held={confirmHeld.length}
              className="space-y-1.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
            >
              <p>
                {t('operations.handover.heldNote', { count: formatNumber(confirmHeld.length, locale) })}
              </p>
              <ul className="space-y-0.5 text-xs font-bold">
                {confirmHeld.map((row) => (
                  <li key={row.id} data-handover-held-row={row.id}>
                    {bankNameOf(row.mainBankId) || '…'} · {row.origin?.name ?? '…'} ←{' '}
                    {row.destination?.name ?? '…'}
                    {row.securedStage !== null && ` — ${t(`operations.board.stage.${row.securedStage}`)}`}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </DesignDialog>
      )}
    </PageContainer>
  );
};
