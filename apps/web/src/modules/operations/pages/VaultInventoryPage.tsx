// «سجل الخزينة» (Round 12, `/operations/vault` — was «جرد الخزينة», the legacy `/vault1` screen).
//
// THE OWNER: «شاشة جرد الخزينة تكون سجل الخزينه المحصنات زى شاشة سجل الشحنات بالظبط واعمل فوق تقرير
// الخزينة يكون نفس الداتا اللى فى بيان الشحنات لكل بنك ونفس الشكل وكل حاجه بس مفيش فتر من الى هيكون
// لحظى على ف الخزينة». And then: «سجل الخزينه لما اوس على تقرير يفتح ززى موديل زى لوحة التحكم اللى
// عملنها فى العهدة». So the screen is the secured history, and the report opens over it:
//
//   · THE SCREEN is the secured history — «سجل الشحنات» exactly (`ShipmentsHistoryPage.tsx`, the
//     shared `ShipmentsBoard`), taking the whole page as that one does: «من» / «إلى» opening on this
//     month to date, every محصنة COLLECTED OR DELIVERED in the range whatever its stage (the
//     server's `type=secured` — the dailies left out, the 5,000-row cap counted after them), the
//     board's filters, figures, edit and delete (a row the vault holds stays locked), «السجل», the
//     deleted محصنات of the range with their restore, paging, and the refusal of a range too long
//     or too large. On the secured board's columns («تاريخ الاستلام» beside «تاريخ التسليم», the
//     stage as the status — any of the six).
//   · «تقرير الخزينة» — what the vault holds NOW, per bank — is a button in the history's toolbar,
//     right beside «إخفاء الإحصائيات» and in its look, as «لوحة تحكم» sits beside «الإحصائيات» on
//     Fleet's custody board. It opens the report over the whole screen
//     (`components/VaultHeldReportDialog.tsx`): its figure tiles, the very table of «تجميع الخزينة»
//     («بيان الشحنات لكل بنك»), «إجمالي قيمة الشحنات» beside it, Excel and PDF — live («لحظى»),
//     with no «من» / «إلى». It used to be a band over the history, folding away to give the history
//     its rows back (and remembering that per browser); as a modal it costs the history nothing, so
//     the band, its fold and what it remembered are gone.
//
// WHO SEES WHAT. The screen is the vault's grant (`operationsVault.view`), and so is the live
// report. The history is the shipments' history endpoint, on the SHIPMENT grant
// (`operationsShipment.view`) — as «سجل الشحنات». A treasurer holding only the vault's grants has
// no history, so no toolbar to open the report from: the page shows him the report itself, the
// modal's own body at the screen's height (`VaultHeldReportInline`), and a line saying what the
// history needs — never a request refused under his eyes.
//
// What went: the old inventory's receipt-by-receipt table (receipt number, packaging, the two
// treasurers, when). The report counts the same custody's packages per bank, and each محصنة's own
// story — who received it, when — is its «السجل» in the history.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  OPERATIONS_SECURED_STAGES,
  OPERATIONS_SHIPMENT_HISTORY_MAX_DAYS,
  OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { formatNumber } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { useAppSelector } from '../../../store';
import { BoardIcon, PATH } from '../../fleet/components/FuelCardBoard';
import { useOperationsShipmentHistory } from '../api/operations-queries';
import { BRAND_BUTTON, BoardRefusal, ShipmentsBoard } from '../components/ShipmentsBoard';
import { VaultHeldReportDialog, VaultHeldReportInline } from '../components/VaultHeldReportDialog';
import {
  cairoToday,
  historyRangeProblem,
  isHistoryTooLarge,
  resolveHistoryRange,
} from '../lib/shipment-history';

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

/** The history's stage filter: any of the six — a history holds every stage a محصنة passes. */
const HISTORY_STAGES = OPERATIONS_SECURED_STAGES;

export const VaultInventoryPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state) => state.locale.locale);
  const search = useSearchParams();
  const [sp, setSp] = search;

  const canSeeHistory = can('operationsShipment.view');

  // ── «تقرير الخزينة» — over the whole screen, read only while open (closed on the way in) ──────
  const [reportOpen, setReportOpen] = useState(false);

  // ── The secured history — «سجل الشحنات» for the محصنات ───────────────────────────────────────
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

  if (!canSeeHistory) {
    // A vault-only reader: the report itself, at the screen's height, and what the history needs.
    // A computer: the report takes the screen, its banks scrolling in its table. A phone: ONE
    // scroll for the whole page.
    return (
      <PageContainer fullHeight>
        <div
          className="flex min-h-0 flex-1 flex-col gap-4 max-lg:block max-lg:space-y-4 max-lg:overflow-y-auto"
          role="region"
          aria-label={t('operations.vaultHistory.title')}
          data-vault-history="true"
        >
          <VaultHeldReportInline />
          <BoardRefusal>{t('operations.vaultHistory.needsShipmentView')}</BoardRefusal>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer fullHeight>
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
        // «لما اوس على تقرير يفتح … زى لوحة التحكم اللى عملنها فى العهدة»: right beside «إخفاء
        // الإحصائيات», in its look — as «لوحة تحكم» sits beside «الإحصائيات» on the custody board.
        // Drawn whatever the history's own answer: the report is not the history's, and a range
        // refused or still loading leaves what the vault holds now as readable as ever.
        toolbarExtras={() => (
          <button
            type="button"
            data-vault-held-open="true"
            aria-haspopup="dialog"
            aria-expanded={reportOpen}
            onClick={() => setReportOpen(true)}
            className={BRAND_BUTTON}
          >
            <BoardIcon d={PATH.trend} className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            {t('operations.vaultHistory.open')}
          </button>
        )}
      />
      <VaultHeldReportDialog open={reportOpen} onClose={() => setReportOpen(false)} />
    </PageContainer>
  );
};
