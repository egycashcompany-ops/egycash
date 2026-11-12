// «سجل الخزينة» (Round 12, `/operations/vault` — was «جرد الخزينة», the legacy `/vault1` screen).
//
// THE OWNER: «شاشة جرد الخزينة تكون سجل الخزينه المحصنات زى شاشة سجل الشحنات بالظبط واعمل فوق تقرير
// الخزينة يكون نفس الداتا اللى فى بيان الشحنات لكل بنك ونفس الشكل وكل حاجه بس مفيش فتر من الى هيكون
// لحظى على ف الخزينة». So the screen is two things, one over the other:
//
//   · ON TOP, «تقرير الخزينة» — what the vault holds NOW, per bank, in the very table «تجميع الخزينة»
//     draws («بيان الشحنات لكل بنك»: the same columns, the «عملات أخرى» breakdown, «الإجمالي» pinned
//     under the rows — `ReportTable`), with no «من» / «إلى»: it is live («لحظى»), read from
//     `GET /operations/reports/vault/held` — every محصنة IN the vault, exactly the list «محصنات
//     الخزينة» shows — through the same server roll-up as the period's report. Its card says when
//     it was read («حتى …»), and it moves on every receipt, cancelled receipt and release (it rides
//     the roll-up's cache, which every secured act and the vault custody topic refresh).
//     BESIDE IT, «إجمالي قيمة الشحنات» over the same total: the vault's money now, per currency —
//     the treasurer's own question. It sits in the table's row and takes the table's height, so it
//     costs the history below no space; it is not dropped (the brief allowed it where it fits).
//     The two share a fixed band (`HELD_BAND`), the table's rows scrolling inside it under a total
//     that stays, so the history keeps the rest of the screen.
//   · UNDER IT, the secured history — «سجل الشحنات» exactly (`ShipmentsHistoryPage.tsx`, the shared
//     `ShipmentsBoard`): «من» / «إلى» opening on this month to date, every محصنة COLLECTED OR
//     DELIVERED in the range whatever its stage (the server's `type=secured` — the dailies left
//     out, the 5,000-row cap counted after them), the board's filters, figures, edit and delete
//     (a row the vault holds stays locked), «السجل», the deleted محصنات of the range with their
//     restore, paging, and the refusal of a range too long or too large. On the secured board's
//     columns («تاريخ الاستلام» beside «تاريخ التسليم», the stage as the status — any of the six).
//
// WHO SEES WHAT. The screen is the vault's grant (`operationsVault.view`), and so is the live
// report. The history is the shipments' history endpoint, on the SHIPMENT grant
// (`operationsShipment.view`) — as «سجل الشحنات»; a treasurer holding only the vault's grants gets
// the report and a line saying what the history needs, never a request refused under his eyes.
//
// What went: the old inventory's receipt-by-receipt table (receipt number, packaging, the two
// treasurers, when). The report counts the same custody's packages per bank, and each محصنة's own
// story — who received it, when — is its «السجل» on the history below.
import { useSearchParams } from 'react-router-dom';
import {
  OPERATIONS_SECURED_STAGES,
  OPERATIONS_SHIPMENT_HISTORY_MAX_DAYS,
  OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS,
  MAX_PAGE_SIZE,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { formatNumber } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { useAppSelector } from '../../../store';
import {
  useOperationsBanks,
  useOperationsShipmentHistory,
  useVaultHeldReport,
} from '../api/operations-queries';
import { ReportTable } from '../components/ReportBoard';
import { BoardRefusal, ShipmentsBoard } from '../components/ShipmentsBoard';
import { SHIPMENT_PATH } from '../components/shipment-icons';
import { VaultValuePanel } from '../components/VaultValuePanel';
import { bankRank, reportRowsInOrder, type ReportBoardRow } from '../lib/report-board';
import {
  cairoToday,
  historyRangeProblem,
  isHistoryTooLarge,
  resolveHistoryRange,
} from '../lib/shipment-history';
import { cairoStampText, ltrIsolate } from '../lib/shipment-log';

/**
 * Remembered across visits: the secured board's filters (`boardFilterParams('secured')` —
 * day-board-filters.spec holds the two together), and NOT `from` / `to`: the range is what the
 * history IS, opening on this month to date, as «سجل الشحنات»'s does.
 */
const REMEMBERED_FILTERS = [
  'vehicle',
  'bank',
  'origin',
  'destination',
  'area',
  'captain',
  'stage',
  'notes',
] as const;

/**
 * «تقرير الخزينة»'s band on a computer: a fixed height (at most a third of the screen and a bit),
 * the report's table and its panel side by side in it, each scrolling inside — so the history
 * under it keeps the rest of the screen whatever the vault holds. Stacked on a phone, each card
 * capped so the page reaches the history.
 */
const HELD_BAND = 'mb-4 flex shrink-0 flex-col gap-4 lg:h-[min(19rem,36vh)] lg:flex-row';

/** The history's stage filter: any of the six — a history holds every stage a محصنة passes. */
const HISTORY_STAGES = OPERATIONS_SECURED_STAGES;

export const VaultInventoryPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state) => state.locale.locale);
  const search = useSearchParams();
  const [sp, setSp] = search;

  // ── «تقرير الخزينة» — live, no period ────────────────────────────────────────────────────────
  const held = useVaultHeldReport();
  // The boards' own query (the same parameters), so the catalog is one cache across them.
  const banks = useOperationsBanks({
    page: 1,
    pageSize: MAX_PAGE_SIZE,
    sortBy: 'code',
    sortDir: 'asc',
  });
  const rankOf = bankRank(banks.data?.items ?? []);
  // The banks in the reference order (Q31), the unattributed bucket last — as «تجميع الخزينة».
  const heldRows: ReportBoardRow[] = reportRowsInOrder(
    held.data?.rows ?? [],
    (row) => row.bankId === null,
    (row) => rankOf(row.bankId),
  ).map((row) => ({
    key: row.bankId ?? 'unattributed',
    label: row.bankName,
    unattributed: row.bankId === null,
    totals: row.totals,
  }));

  // ── The secured history — «سجل الشحنات» for the محصنات ───────────────────────────────────────
  const canSeeHistory = can('operationsShipment.view');
  const today = cairoToday();
  const range = resolveHistoryRange({ from: sp.get('from'), to: sp.get('to') }, today);
  // Refused here first, in words, rather than sent to be refused by the server.
  const problem = historyRangeProblem(range);
  const history = useOperationsShipmentHistory(range, canSeeHistory && problem === null, 'secured');

  useRememberedFilters(search, REMEMBERED_FILTERS);

  const setBound = (param: 'from' | 'to', value: string): void => {
    const next = new URLSearchParams(sp);
    // Emptied, a bound goes back to its default (the first of the month, or today).
    if (value === '') next.delete(param);
    else next.set(param, value);
    setSp(next);
  };

  const tooLarge = isHistoryTooLarge(history.error);
  const refusal =
    problem === 'order'
      ? t('operations.history.rangeOrder')
      : problem === 'tooLong'
        ? t('operations.history.rangeTooLong', {
            max: formatNumber(OPERATIONS_SHIPMENT_HISTORY_MAX_DAYS, locale),
          })
        : tooLarge
          ? t('operations.history.tooLarge', {
              max: formatNumber(OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS, locale),
            })
          : null;
  // A refusal replaces the rows AND the figures, as on «سجل الشحنات»: a refused refetch keeps its
  // last answer beside the error, and figures summed from it would contradict the message.
  const answered = problem === null && !tooLarge;

  return (
    <PageContainer fullHeight>
      {/* A computer: the band keeps its height and the history takes the rest, its rows scrolling
          in its table. A phone: ONE scroll for the whole page — the band, then the history at its
          own height — rather than the history squeezed into what the band leaves of the screen. */}
      <div
        className="flex min-h-0 flex-1 flex-col max-lg:block max-lg:overflow-y-auto"
        role="region"
        aria-label={t('operations.vaultHistory.title')}
        data-vault-history="true"
      >
        <section
          className={HELD_BAND}
          aria-label={t('operations.vaultHistory.held')}
          data-vault-held="true"
        >
          <ReportTable
            title={t('operations.vaultHistory.held')}
            titleIcon={SHIPMENT_PATH.bank}
            titleAside={
              held.data === undefined ? undefined : (
                // When it was read — Latin figures, the Cairo clock, kept in their own order.
                <span
                  data-vault-held-as-of="true"
                  className="shrink-0 whitespace-nowrap text-[11px] font-bold text-slate-500 dark:text-slate-400"
                >
                  {t('operations.vaultHistory.heldAsOf', {
                    at: ltrIsolate(cairoStampText(held.data.asOf)),
                  })}
                </span>
              )
            }
            keyHeader={t('operations.reports.bank')}
            countHeader={t('operations.vaultReport.securedCount')}
            rows={heldRows}
            total={held.data?.grandTotal}
            loading={held.isLoading}
            error={held.error}
            onRetry={() => void held.refetch()}
            empty={t('operations.vaultHistory.heldEmpty')}
            className="max-lg:max-h-[60vh] lg:min-h-0 lg:flex-1"
          />
          <VaultValuePanel
            grandTotal={held.data?.grandTotal}
            loading={held.isLoading}
            className="max-lg:max-h-[60vh] lg:w-80 lg:shrink-0 xl:w-[22rem]"
          />
        </section>

        {canSeeHistory ? (
          <ShipmentsBoard
            search={search}
            shipments={answered ? (history.data?.shipments ?? []) : []}
            crews={answered ? (history.data?.crews ?? []) : []}
            loaded={answered && history.data !== undefined}
            loading={answered && history.isLoading}
            error={refusal === null ? history.error : null}
            onRetry={() => void history.refetch()}
            datePickers={[
              {
                param: 'from',
                label: t('operations.history.from'),
                showLabel: true,
                value: range.from,
                onChange: (value) => setBound('from', value),
              },
              {
                param: 'to',
                label: t('operations.history.to'),
                showLabel: true,
                value: range.to,
                onChange: (value) => setBound('to', value),
              },
            ]}
            periodActive={sp.get('from') !== null || sp.get('to') !== null}
            periodParams={['from', 'to']}
            // «مش هيقدر يضيف … ومش هيقدر منها يسلم او يستلم» — the history's rule, as on «سجل الشحنات».
            canCreate={false}
            canToggleReceived={false}
            kind="secured"
            stages={HISTORY_STAGES}
            empty={t('operations.vaultHistory.empty')}
            refusal={refusal}
            paged
            // The deleted محصنات of the SAME range — asked for only when the range itself may be.
            deletedShipments={{ range, enabled: problem === null, type: 'secured' }}
          />
        ) : (
          <BoardRefusal>{t('operations.vaultHistory.needsShipmentView')}</BoardRefusal>
        )}
      </div>
    </PageContainer>
  );
};
