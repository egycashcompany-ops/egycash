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
// ROUND 25 — the same van card and the same small chip as «توزيع المحصنات» («وبرضو شكل المحصنة زى
// ما كانت على الشمال تفضل زى ما هى شكلها على العربية»): the van's head, ONE captain's line led by the
// count, the three package counts always; each محصنة bank · branch, its card on hover. «تسليم» and
// «طباعة» stay over each van; the confirmation and the printed sheet keep the money and every detail.
//
// ROUND 26 — the same van card, with its hover card («لما اقف على العربية يطلع كارت بقى بالقادة
// والاخصائيين اللى على العربيه والسواقيين»), the counts each in their colour. The printed sheet stays
// black on white.
//
// ROUND 26b — «لون واحد لكل العربيات»: the same one look on every van here as on «توزيع المحصنات»
// (no van wears a colour of its own), the van card redrawn — the captain in a frame of his own, the
// four counts in a row of their own; the top row the day at the start and the figures in the middle
// (`TopRow`), as on «توزيع المحصنات».
//
// WHICH DAY. «تسليم» is TODAY's act (`handoverBlock`): the vault hands a van its load on the day the
// van goes out. A future day stays on screen — it is the plan, and «طباعة» works there so a sheet can
// be ready ahead — but its «تسليم» is off, with why, and the day bar says so. The confirmation names
// the day it hands over on.
//
// ROUND 33 — «انا عاوزك تفتحلى الايام اللى فاتت فى تسليم المحصنات ك روية فقط زى ما عملنا فى شاشة توزيع
// المحصنات». «يوم التسليم» takes a past day (it had a floor at today), and a past day opens as that
// day's RECORD, view only, by «توزيع المحصنات»'s own rule (`isRecordScreen` — the URL's day before the
// read is in, then the SERVER's `past`, plus midnight passing on a screen left open). A record has
// ONE gate, `canHandOver = mayHandOver && !isRecord`: no «تسليم» on any van, no confirmation, nothing
// sent (the server refuses a past day's van anyway, 422 `OPERATIONS_DISPATCH_NOT_TODAY`). What it
// shows is each van with what rode it, and what became of each محصنة as the vault reads it back —
// handed over (when, and by whom: `recordHandovers`), kept in the vault, or never received — the
// calm notice «سجل يوم … — للعرض فقط، لا يمكن التعديل» under the top row, and «سجل · للعرض فقط» with
// «العودة إلى اليوم» where the acts would stand. The filters of the day, the hover cards and «طباعة»
// still work: reading and printing are not changing — the printed sheet says it is a record.
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
  cairoYmd,
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
import { pluralKey } from '../../../shared/lib/plural';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useAppSelector } from '../../../store';
import { useMinWidth } from '../../atm/lib/useMinWidth';
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
import { BoardFigurePill } from '../components/BoardFigures';
import { COLUMN_WARN, COUNT_LOOK, VANS_FIGURE } from '../components/distribution-look';
import { ADD_BUTTON, BRAND_BUTTON, BoardRefusal } from '../components/ShipmentsBoard';
import {
  ChipMark,
  DISTRIBUTION_COLUMNS,
  DayBox,
  DayNote,
  DistributionColumn,
  EmptyLoad,
  MoneyLine,
  RecordNotice,
  ShipmentCardBody,
  ShipmentChip,
  TOP_FIGURES,
  TopRow,
  VAN_GRID,
  VanCard,
  countText,
  dayText,
} from '../components/SecuredDistributionParts';
import { SHIPMENT_PATH } from '../components/shipment-icons';
import {
  EMPTY_DRAFT,
  captainOn,
  distributionColumns,
  distributionDayChange,
  handoverBlock,
  handoverRequest,
  handoverShipments,
  handoverWhen,
  isRecordScreen,
  loadFigures,
  notYetInVault,
  packagingRead,
  personName,
  readDistributionDay,
  recordHandoverState,
  recordHandovers,
  recordPackaging,
  vanHandoverRecord,
  vanPackages,
  type VanHandoverRecord,
} from '../lib/secured-distribution';
import { isHistoryTooLarge } from '../lib/shipment-history';
import { useCairoToday } from '../lib/use-cairo-today';
import { vanLoadSheet } from '../lib/van-load-sheet';
import { hasNoVan, looseCrewNumbers, vanPhrase } from '../lib/van-name';
import { PACKAGE_KINDS } from '../lib/van-card';
import { PLAN_ICON } from '../components/crew-plan-icons';

export const VaultHandoverPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  const today = useCairoToday();
  // Round 33 — any real day, a past one too: it opens as its record.
  const date = readDistributionDay(sp.get('date'));
  const mayHandOver = can('operationsVault.dispatch');

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
  // Round 33 — a past day is its RECORD, view only, by «توزيع المحصنات»'s rule: once the read is in,
  // the SERVER's `past` (the PC's clock never overrides it) and midnight passing on a screen left
  // open; before it, the URL's day against the live Cairo day (`isRecordScreen`).
  const isRecord = isRecordScreen(
    day,
    today,
    data === undefined
      ? null
      : {
          today: data.today.slice(0, 10),
          past: data.past,
          readOn: cairoYmd(new Date(board.dataUpdatedAt)),
        },
  );
  // Every act below asks this one: who may hand over, on a day that is not a record.
  const canHandOver = mayHandOver && !isRecord;
  const loaded = data !== undefined;
  const failed = !tooLarge && hasError(board.error) && !loaded;

  const [confirming, setConfirming] = useState<string | null>(null);
  // Round 24c — below a computer's width the column of محصنات on no van folds.
  const wide = useMinWidth(1024);
  const [unplacedOpen, setUnplacedOpen] = useState(true);
  const sending = useRef(false);

  const setDay = (value: string): void => {
    // Emptied, or today, the screen is on its default — today; any other day, a past one too (its
    // record), is asked for by name. A URL left as it is (today picked on a screen with no `?date=`
    // that midnight turned into yesterday's record) asks nothing by itself: the read is asked again.
    const { date: asked, reread } = distributionDayChange(sp.get('date'), value, today);
    const next = new URLSearchParams(sp);
    if (asked === null) next.delete('date');
    else next.set('date', asked);
    setSp(next);
    setConfirming(null);
    if (reread) void board.refetch();
  };
  /** Round 33 — «العودة إلى اليوم»: off a record, onto today (the distribution's own act). */
  const backToToday = (): void => setDay('');

  const bankNameOf = (id: string): string =>
    banks.data?.items.find((bank) => bank.id === id)?.opsName ?? '';
  const currencyOf = (id: string): OperationsCurrencyDto | undefined =>
    currencies.data?.items.find((currency) => currency.id === id);
  // Round 33 — a record's packages are the read's own (held, or handed over since): the vault's
  // holdings no longer carry what left on the day's vans. Every other day reads the holdings.
  const recordCounts = isRecord ? recordPackaging(data?.recordPackages) : null;
  const packagingOf = (id: string) =>
    recordCounts === null ? packaging.data?.get(id) : recordCounts.get(id);
  // Round 25 critic — no 0 before the vault's counts are in (`vanPackages`).
  const packagesRead = recordCounts === null ? packagingRead(true, packaging) : 'ready';
  // Round 33 — what the vault handed over that day, when and by whom (a record's only).
  const handovers = isRecord ? recordHandovers(data?.recordHandovers) : null;

  // The SAVED places — the vault moves nothing.
  const columns = distributionColumns(rows, vans, EMPTY_DRAFT);
  /**
   * Any محصنة on no van — the column's head and the page's figure wear the rose (Round 27). Round 33:
   * not on a record — nothing there waits to be placed; the count stays, in its own cyan.
   */
  const waiting = loaded && !isRecord && columns.unplaced.length > 0;
  // A record opens no confirmation: one left open when midnight passed closes with the day.
  const confirmVan =
    confirming === null || !canHandOver
      ? undefined
      : vans.find((van) => van.crewAssignmentId === confirming);
  // Round 24 — a crew without a van hands its load over like a van: «بدون سيارة (n)» on its card, on
  // the sheet and in every sentence (`lib/van-name.ts`), numbered as the board numbers it.
  // Round 25 — the server's number among ALL the day's rows without a van (`looseNumber`).
  const looseNumbers = looseCrewNumbers(vans);
  const looseNumberOf = (crewAssignmentId: string): string | null => {
    const number =
      vans.find((van) => van.crewAssignmentId === crewAssignmentId)?.looseNumber ??
      looseNumbers.get(crewAssignmentId);
    return number === undefined ? null : formatNumber(number, locale);
  };
  const vanName = (van: OperationsDayBoardVehicleCrewDto): string =>
    vanPhrase(t, van, looseNumberOf(van.crewAssignmentId));
  // The day's packages, as the vault counted them — the page's figures.
  const dayPackages = vanPackages(packagesRead, rows, packagingOf);

  /**
   * Round 33 — a record's van, in words: «سُلِّمت محصنتان · سلّمها … · 10:15» — how many left, who
   * pressed «تسليم», and when (the day too when it was another); null when nothing on it left.
   */
  const handedPhrase = (handed: VanHandoverRecord): string | null =>
    handed.handedOver === 0
      ? null
      : [
          t(pluralKey('operations.handover.record.vanHanded', locale, handed.handedOver), {
            count: countText(handed.handedOver, locale),
          }),
          handed.names.length === 0
            ? null
            : t('operations.handover.record.by', { name: handed.names.join('، ') }),
          handed.at === null ? null : handoverWhen(handed.at, day),
        ]
          .filter((part): part is string => part !== null)
          .join(' · ');

  const print = (
    van: OperationsDayBoardVehicleCrewDto,
    load: readonly OperationsSecuredDistributionRowDto[],
  ): void => {
    try {
      printFleetReport(
        vanLoadSheet({
          t,
          day,
          // Round 33 — a record's sheet says it is one, and what was handed over.
          record: isRecord
            ? { handedOver: handedPhrase(vanHandoverRecord(load, handovers)) }
            : null,
          van,
          looseNumber: looseNumberOf(van.crewAssignmentId),
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

  // «تسليم» is today's only: a future day is the plan. Against the LIVE Cairo day, so a screen left
  // open past midnight on yesterday's read turns it off as well. Round 33: never on a record.
  const handoverToday = day === today && !isRecord;

  const handOver = async (van: OperationsDayBoardVehicleCrewDto): Promise<void> => {
    const body = handoverRequest(rows, van.crewAssignmentId);
    // The button and the dialog are off on any other day and on a record; this is the last word
    // before the request.
    if (body === null || !handoverToday || !canHandOver || sending.current) return;
    sending.current = true;
    try {
      await dispatch.mutateAsync(body);
      toast.success(
        t(pluralKey('operations.handover.done', locale, body.shipmentIds.length), {
          count: countText(body.shipmentIds.length, locale),
          van: vanName(van),
        }),
      );
      setConfirming(null);
    } catch (error) {
      toast.error(
        t('operations.handover.failed', {
          van: vanName(van),
          reason: errorMessage(error, locale),
        }),
      );
    } finally {
      sending.current = false;
    }
  };

  /**
   * A shipment's chip — read-only: the same small chip as «توزيع المحصنات» (Round 25), its card on
   * hover with where it stands and whether the vault holds it.
   */
  const card = (
    row: OperationsSecuredDistributionRowDto,
    van?: OperationsDayBoardVehicleCrewDto,
  ) => {
    const captain =
      van === undefined ? null : captainOn(van, row.delivery?.captainEmployeeId ?? null);
    // The van card shows its first captain only: a محصنة with the other one says so.
    const otherCaptain =
      van !== undefined && captain !== null && van.captains[0]?.employeeId !== captain.employeeId;
    // Round 33 — on a record's van, what became of it: left the vault, stayed in it, never received.
    const state = isRecord && van !== undefined ? recordHandoverState(row) : null;
    const handover = state === 'handedOver' ? handovers?.get(row.id) : undefined;
    const handedWhen = handover === undefined ? null : handoverWhen(handover.at, day);
    const waiting = !isRecord && van !== undefined && row.status !== 'inVault';
    return (
      <ShipmentChip
        key={row.id}
        row={row}
        bankName={bankNameOf(row.mainBankId)}
        branchName={row.destination?.name ?? row.origin?.name ?? ''}
        unplaced={van === undefined}
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
            {waiting && (
              <ChipMark
                tone="waiting"
                data-mark="not-in-vault"
                icon={SHIPMENT_PATH.info}
                label={t('operations.handover.notInVault')}
              />
            )}
            {state === 'handedOver' && (
              <ChipMark
                tone="handed"
                data-mark="handed-over"
                icon={SHIPMENT_PATH.checkCircle}
                label={[
                  t('operations.handover.record.handedMark'),
                  handedWhen,
                  handover?.byName ?? null,
                ]
                  .filter((part): part is string => part !== null && part !== '')
                  .join(' · ')}
              />
            )}
            {state === 'keptInVault' && (
              <ChipMark
                tone="waiting"
                data-mark="kept-in-vault"
                icon={SHIPMENT_PATH.info}
                label={t('operations.handover.record.keptMark')}
              />
            )}
            {state === 'notReceived' && (
              <ChipMark
                tone="waiting"
                data-mark="not-received"
                icon={SHIPMENT_PATH.info}
                label={t('operations.handover.record.notReceivedMark')}
              />
            )}
            {otherCaptain && (
              <ChipMark
                tone="captain"
                data-mark="captain"
                icon={SHIPMENT_PATH.person}
                label={t('operations.distribution.withCaptain', { name: personName(captain) })}
              />
            )}
          </>
        }
        card={
          <ShipmentCardBody
            row={row}
            bankName={bankNameOf(row.mainBankId)}
            money={row.lines.map((line, index) => {
              const currency = currencyOf(line.currencyId);
              return {
                key: `${line.currencyId}|${index}`,
                label: currency?.name ?? currency?.code ?? '…',
                amount: line.amount,
              };
            })}
            packages={packagingOf(row.id)}
            packagesRead={packagesRead}
            place={
              van === undefined
                ? null
                : captain === null
                  ? vanName(van)
                  : `${vanName(van)} · ${t('operations.distribution.withCaptain', { name: personName(captain) })}`
            }
            notes={[
              ...(row.overdue
                ? [
                    {
                      key: 'overdue',
                      text: t('operations.distribution.overdueHint', {
                        day: dayText(row.deliveryDate),
                      }),
                      tone: 'danger' as const,
                    },
                  ]
                : []),
              ...(waiting
                ? [
                    {
                      key: 'not-in-vault',
                      text: t('operations.handover.notInVaultHint'),
                      tone: 'info' as const,
                    },
                  ]
                : []),
              ...(state === null
                ? []
                : [
                    {
                      key: `record-${state}`,
                      text:
                        state === 'keptInVault'
                          ? t('operations.handover.record.keptNote')
                          : state === 'notReceived'
                            ? t('operations.handover.record.notReceivedNote')
                            : handedWhen === null
                              ? t('operations.handover.record.handedMark')
                              : handover?.byName === null || handover?.byName === undefined
                                ? t('operations.handover.record.handedNoteAt', { when: handedWhen })
                                : t('operations.handover.record.handedNote', {
                                    when: handedWhen,
                                    name: handover.byName,
                                  }),
                      tone: 'info' as const,
                    },
                  ]),
            ]}
          />
        }
      />
    );
  };

  // The vans — three quarters of a wide screen, as on «توزيع المحصنات» (Round 24c).
  const vansColumn = (
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
        <div className={VAN_GRID}>
          {columns.vans.map(({ van, rows: load }) => {
            const ready = handoverShipments(load, van.crewAssignmentId);
            const held = notYetInVault(load, van.crewAssignmentId);
            const block = handoverBlock(day, today, ready.length);
            // Round 33 — a record's van, read back: what left, who handed it over and when.
            const handed = isRecord ? vanHandoverRecord(load, handovers) : null;
            const handedWords = handed === null ? null : handedPhrase(handed);
            return (
              <VanCard
                key={van.crewAssignmentId}
                van={van}
                looseNumber={looseNumberOf(van.crewAssignmentId)}
                crewPlanVisible={data.crewPlanVisible}
                day={day}
                count={load.length}
                packages={vanPackages(packagesRead, load, packagingOf)}
                // Round 33 — a record is read back: no placing alarm on a van.
                calm={isRecord}
                actions={
                  <>
                    {canHandOver && (
                      <button
                        type="button"
                        data-handover-open={van.crewAssignmentId}
                        data-handover-block={block ?? undefined}
                        aria-haspopup="dialog"
                        disabled={block !== null}
                        title={
                          block === 'notToday'
                            ? t('operations.handover.notToday')
                            : block === 'nothing'
                              ? t('operations.handover.nothing')
                              : undefined
                        }
                        onClick={() => setConfirming(van.crewAssignmentId)}
                        className={cn(
                          block === null ? ADD_BUTTON : BRAND_BUTTON,
                          'disabled:cursor-not-allowed disabled:opacity-50',
                        )}
                      >
                        <BoardIcon d={[...PATH.truck]} className="h-3.5 w-3.5" />
                        {t('operations.handover.handover', {
                          count: countText(ready.length, locale),
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
                  handed !== null ? (
                    load.length === 0 ? undefined : (
                      <div
                        data-handover-record-van={String(handed.handedOver)}
                        className="space-y-0.5 rounded-lg bg-slate-100 px-2 py-1.5 text-[11px] font-bold leading-5 text-slate-600 dark:bg-slate-800/70 dark:text-slate-300"
                      >
                        <p className="flex items-start gap-1.5">
                          <BoardIcon
                            d={[
                              ...(handedWords === null
                                ? SHIPMENT_PATH.info
                                : SHIPMENT_PATH.checkCircle),
                            ]}
                            className={cn(
                              'mt-0.5 h-3.5 w-3.5 shrink-0',
                              handedWords !== null && 'text-sky-600 dark:text-sky-300',
                            )}
                          />
                          <span data-handover-record-handed="true">
                            {handedWords ?? t('operations.handover.record.vanNone')}
                          </span>
                        </p>
                        {handedWords !== null && handed.notHandedOver > 0 && (
                          <p data-handover-record-kept={handed.notHandedOver} className="ps-5">
                            {t(
                              pluralKey(
                                'operations.handover.record.vanKept',
                                locale,
                                handed.notHandedOver,
                              ),
                              { count: countText(handed.notHandedOver, locale) },
                            )}
                          </p>
                        )}
                      </div>
                    )
                  ) : held.length > 0 ? (
                    <p
                      data-handover-held={held.length}
                      className="flex items-start gap-1.5 rounded-lg bg-slate-100 px-2 py-1.5 text-[11px] font-bold leading-5 text-slate-600 dark:bg-slate-800/70 dark:text-slate-300"
                    >
                      <BoardIcon
                        d={[...SHIPMENT_PATH.info]}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0"
                      />
                      {t(pluralKey('operations.handover.heldNote', locale, held.length), {
                        count: countText(held.length, locale),
                      })}
                    </p>
                  ) : undefined
                }
              >
                {load.length === 0 ? (
                  <EmptyLoad>
                    {t(
                      hasNoVan(van)
                        ? 'operations.distribution.emptyCrew'
                        : 'operations.distribution.emptyVan',
                    )}
                  </EmptyLoad>
                ) : (
                  load.map((row) => card(row, van))
                )}
              </VanCard>
            );
          })}
        </div>
      )}
    </DistributionColumn>
  );

  // The day's محصنات on no van, for information — a quarter of a wide screen; on a phone it stays
  // after the vans (the vault's work is the vans) and folds (Round 24c).
  const unplacedColumn = (
    <DistributionColumn
      title={t('operations.distribution.unplaced')}
      count={columns.unplaced.length}
      icon={SHIPMENT_PATH.shipment}
      data-handover-column="unplaced"
      warn={waiting}
      {...(wide
        ? {}
        : { collapse: { open: unplacedOpen, onToggle: () => setUnplacedOpen((v) => !v) } })}
      extra={
        <span className="ms-auto text-[11px] font-bold text-slate-500 dark:text-slate-400">
          {t(
            isRecord
              ? 'operations.handover.record.unplacedHint'
              : 'operations.handover.unplacedHint',
          )}
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
        <div className="grid gap-1.5">{columns.unplaced.map((row) => card(row))}</div>
      )}
    </DistributionColumn>
  );

  const confirmLoad =
    confirmVan === undefined ? [] : handoverShipments(rows, confirmVan.crewAssignmentId);
  const confirmHeld =
    confirmVan === undefined ? [] : notYetInVault(rows, confirmVan.crewAssignmentId);

  return (
    <PageContainer fullHeight>
      <div className={BOARD_FRAME} data-handover-page="true">
        {/* Round 26b — the day at the start, the figures in the middle (`TopRow`), as on «توزيع
            المحصنات»; the vault's acts stay on each van. */}
        <TopRow
          data-handover-toolbar="true"
          day={
            // Round 33 — no floor: a past day opens as its record.
            <DayBox label={t('operations.distribution.day')} value={day} onChange={setDay} />
          }
          figures={
            <div role="status" data-handover-figures="true" className={TOP_FIGURES}>
              <BoardFigurePill
                compact
                icon={PATH.truck}
                tone={VANS_FIGURE}
                label={t('operations.distribution.vans')}
                value={loaded ? countText(vans.length, locale) : '…'}
                data-figure="vans"
              />
              {/* The counts in their own colours, as on every van. */}
              {/* Round 33 — a record counts what was handed over; today, what is ready to be. */}
              <BoardFigurePill
                compact
                icon={COUNT_LOOK.shipments.icon}
                tone={COUNT_LOOK.shipments.square}
                label={t(
                  isRecord ? 'operations.handover.record.handedOver' : 'operations.handover.ready',
                )}
                value={
                  loaded
                    ? countText(
                        isRecord
                          ? columns.vans.reduce(
                              (sum, load) =>
                                sum + vanHandoverRecord(load.rows, handovers).handedOver,
                              0,
                            )
                          : vans.reduce(
                              (sum, van) =>
                                sum + handoverShipments(rows, van.crewAssignmentId).length,
                              0,
                            ),
                        locale,
                      )
                    : '…'
                }
                data-figure={isRecord ? 'handed' : 'ready'}
              />
              {/* R27 critic — one number, one colour: while any wait, the rose of the column's
                  head (its warning, its count); none waiting, the محصنات' own cyan. */}
              <BoardFigurePill
                compact
                icon={waiting ? PATH.warn : COUNT_LOOK.shipments.icon}
                tone={waiting ? COLUMN_WARN.figure : COUNT_LOOK.shipments.square}
                label={t('operations.distribution.unplaced')}
                value={loaded ? countText(columns.unplaced.length, locale) : '…'}
                data-figure="unplaced"
              />
              {dayPackages !== null &&
                PACKAGE_KINDS.map((kind) => (
                  <BoardFigurePill
                    key={kind}
                    compact
                    icon={COUNT_LOOK[kind].icon}
                    tone={COUNT_LOOK[kind].square}
                    label={t(`operations.distribution.${kind}`)}
                    value={
                      !loaded || dayPackages === 'pending'
                        ? '…'
                        : dayPackages === 'failed'
                          ? '—'
                          : countText(dayPackages[kind], locale)
                    }
                    data-figure={kind}
                  />
                ))}
            </div>
          }
          end={
            isRecord ? (
              // Round 33 — a record has no acts: where they would stand, the day says it is one, and
              // the way back to today (a move between days, not a change — for every reader).
              <span
                data-handover-record-acts="true"
                className="flex max-w-full flex-wrap items-center justify-center gap-1.5 sm:justify-end"
              >
                <span
                  data-handover-record-mark="true"
                  className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-sky-200 bg-sky-50 px-2 py-1.5 text-[11px] font-black text-sky-800 sm:gap-1.5 sm:px-3 sm:py-2 sm:text-xs dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200"
                >
                  <BoardIcon d={[...PATH.lock]} className="h-3.5 w-3.5" />
                  {t('operations.distribution.record.mark')}
                </span>
                <button
                  type="button"
                  data-handover-today="true"
                  onClick={backToToday}
                  title={t('operations.handover.record.todayHint', {
                    day: dayText(`${today}T00:00:00.000Z`),
                  })}
                  className={BRAND_BUTTON}
                >
                  <BoardIcon d={[...SHIPMENT_PATH.calendar]} className="h-3.5 w-3.5" />
                  {t('operations.distribution.record.today')}
                </button>
              </span>
            ) : undefined
          }
        />

        {isRecord ? (
          // Round 33 — a past day: the calm notice of «توزيع المحصنات»'s record, in the hint's place.
          <RecordNotice
            data-handover-record={day}
            title={t('operations.distribution.record.title', {
              day: dayText(`${day}T00:00:00.000Z`),
            })}
            body={t('operations.handover.record.body')}
          />
        ) : handoverToday ? (
          <DayNote data-handover-bar="true">
            <BoardIcon
              d={[...SHIPMENT_PATH.info]}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500"
            />
            <p className="min-w-0 text-xs font-bold leading-5 text-slate-500 dark:text-slate-400">
              {t('operations.handover.hint')}
            </p>
          </DayNote>
        ) : (
          // A future day: said once, under the day it is about — the vans' buttons only repeat it on
          // hover.
          <p
            data-handover-bar="true"
            data-handover-plan-day={day}
            className="flex min-w-0 items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-bold leading-5 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
          >
            <BoardIcon d={[...SHIPMENT_PATH.info]} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t('operations.handover.planDay', { day: dayText(day) })}
          </p>
        )}

        {tooLarge ? (
          <BoardRefusal>
            {t('operations.distribution.tooLarge', {
              max: countText(OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS, locale),
            })}
          </BoardRefusal>
        ) : failed ? (
          <ErrorState error={board.error} onRetry={() => void board.refetch()} />
        ) : (
          <div className={DISTRIBUTION_COLUMNS} data-handover-columns="true">
            {vansColumn}
            {unplacedColumn}
          </div>
        )}
      </div>

      {/* «تسليم» — what leaves, before the click. */}
      {confirmVan !== undefined && (
        <DesignDialog
          open
          onClose={() => setConfirming(null)}
          title={t('operations.handover.confirmTitle', { van: vanName(confirmVan) })}
          subtitle={
            confirmVan.captains.length === 0
              ? undefined
              : confirmVan.captains.map(personName).join(' · ')
          }
          icon={hasNoVan(confirmVan) ? [...PLAN_ICON.noVan] : PATH.truck}
          width="2xl"
          wrapTitle
          panelProps={{ 'data-handover-confirm': confirmVan.crewAssignmentId }}
          footer={
            <>
              <DesignSave
                onClick={() => void handOver(confirmVan)}
                busy={dispatch.isPending}
                disabled={confirmLoad.length === 0 || !handoverToday}
                label={t(pluralKey('operations.handover.confirm', locale, confirmLoad.length), {
                  count: countText(confirmLoad.length, locale),
                })}
                data-handover-confirm-save="true"
              />
              <DesignCancel
                onClick={() => setConfirming(null)}
                label={t('operations.handover.back')}
              />
            </>
          }
        >
          <div
            data-handover-confirm-body="true"
            className="flex items-start gap-3 rounded-xl border border-violet-300 bg-violet-50 px-4 py-3 text-[15px] font-semibold leading-7 text-violet-900 dark:border-violet-500/40 dark:bg-violet-500/[0.08] dark:text-violet-100"
          >
            <BoardIcon
              d={[...PATH.truck]}
              className="mt-1.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-300"
            />
            <span>
              {t('operations.handover.confirmBody', {
                count: countText(confirmLoad.length, locale),
                van: vanName(confirmVan),
                // The day it leaves on, named before the click — it can only be today.
                day: dayText(day),
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
                {t(pluralKey('operations.handover.heldNote', locale, confirmHeld.length), {
                  count: countText(confirmHeld.length, locale),
                })}
              </p>
              <ul className="space-y-0.5 text-xs font-bold">
                {confirmHeld.map((row) => (
                  <li key={row.id} data-handover-held-row={row.id}>
                    {bankNameOf(row.mainBankId) || '…'} · {row.origin?.name ?? '…'} ←{' '}
                    {row.destination?.name ?? '…'}
                    {row.securedStage !== null &&
                      ` — ${t(`operations.board.stage.${row.securedStage}`)}`}
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
