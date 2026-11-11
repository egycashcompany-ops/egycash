// «سجل الشحنات» — the shipments history: «عاوز اعمل dublicat للشاشة دى بس التاريخ هيكون من الى
// زياده يعنى عشان اقدر امسك الhistory بتاع الشحنات».
//
// THE SAME BOARD as «اليوم التشغيلي» (`DailyOperationsPage.tsx`) — the figures and the «عملات أخرى»
// breakdown, the same filters (the van's code among them), the same table with its hover cards,
// row colours, receipt images, edit / ✓ / delete and «إضافة شحنة» — drawn by the one shared
// component (`components/ShipmentsBoard.tsx`), so the two cannot drift. What differs is the period:
// two dates, «من» and «إلى», at the date filter's place, where the day board has one.
//
// The rows are the SERVER's (`GET /operations/shipments/history?from=&to=`): the day board's union
// over every day of the range, both bounds inclusive. A range is bounded twice, so a history read
// stays a screen and not an export: at most `OPERATIONS_SHIPMENT_HISTORY_MAX_DAYS` days, checked
// here before asking, and at most `OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS` shipments, which only the
// server can count and which it REFUSES past rather than cutting short. Both are said in words in
// the table's place. The table is cut into pages; the filters and figures run over every row.
import { useSearchParams } from 'react-router-dom';
import {
  OPERATIONS_SHIPMENT_HISTORY_MAX_DAYS,
  OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { formatNumber } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { useAppSelector } from '../../../store';
import { useOperationsShipmentHistory } from '../api/operations-queries';
import { ShipmentsBoard } from '../components/ShipmentsBoard';
import {
  cairoToday,
  historyRangeProblem,
  isHistoryTooLarge,
  resolveHistoryRange,
} from '../lib/shipment-history';

/**
 * Remembered across visits: the filters, and NOT `from` / `to`. Like the day board's `date`, the
 * range is what the screen IS — a bare visit opens on this month to date — so restoring the range
 * last looked at would answer a question nobody asked today. The same list as the day board's.
 */
const REMEMBERED_FILTERS = [
  'vehicle',
  'bank',
  'origin',
  'destination',
  'area',
  'captain',
  'type',
  'received',
  'notes',
] as const;

export const ShipmentsHistoryPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const search = useSearchParams();
  const [sp, setSp] = search;

  const today = cairoToday();
  const range = resolveHistoryRange({ from: sp.get('from'), to: sp.get('to') }, today);
  // Refused here first, in words, rather than sent to be refused by the server.
  const problem = historyRangeProblem(range);
  const history = useOperationsShipmentHistory(range, problem === null);

  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

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
  // A refusal replaces the rows AND the figures. The server can refuse a range it answered a
  // moment ago — a refetch after a save, once the range has passed the cap — and the query then
  // keeps its last answer beside the error: figures drawn from it would be sums over a list the
  // server just declined to give, above a message saying so.
  const answered = problem === null && !tooLarge;

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
        // A shipment added from the history is today's work, whatever range is on screen.
        defaultDate={today}
        empty={t('operations.history.empty')}
        refusal={refusal}
        paged
      />
    </PageContainer>
  );
};
