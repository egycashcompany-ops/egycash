// Daily operations (B2) — the replacement for the legacy `/main_ops` screen, in the Fleet boards'
// look («عدل الـ ui بتاع … الشاشة زى الحركة»): a toolbar, the dark icon filter bar, the figures
// behind «الإحصائيات», then the dark table.
//
// WHAT THE LEGACY SCREEN WAS (discovery §5.1, contad_app.js:253-300): the desk's working set for
// TODAY — daily shipments collected today, plus secured shipments due for delivery today that had
// already left the vault. Its table (main_ops.ejs:829-897): م | السيارة | اسم البنك | من فرع |
// الى فرع | العملة | قيمة الشحنة | قائد الطاقم | التاريخ | النوع | المنطقة | ملاحظات | actions.
//
// The membership rule is the SERVER's (`GET /operations/shipments/day-board`), and so are the
// names: each row arrives with its branches (by name, with their banks) and the crew of the leg
// its type reports on. This page owns only its DAY; everything drawn over the answer — filters,
// figures, table, row actions — is the shared board (`components/ShipmentsBoard.tsx`), which the
// shipments history (`ShipmentsHistoryPage.tsx`) draws over a range of days, so the two screens
// cannot drift apart.
//
// ONE ADDITION over legacy: a date picker. The default is still today, so the legacy answer is
// the default answer; being able to look at yesterday is additive, not a changed rule.
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../../platform/localization/useT';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { useOperationsDayBoard } from '../api/operations-queries';
import { ShipmentsBoard } from '../components/ShipmentsBoard';

/**
 * Remembered across visits: the filters, and NOT `date`. The day is what the board IS — it opens
 * on today, server-side — so restoring last Tuesday would answer a question nobody asked. The
 * filters narrow whichever day is open, which is exactly what is worth keeping. The SAME list as
 * the history's, and as the board's own filters (`DAY_BOARD_FILTER_PARAMS`) — day-board-filters.spec
 * holds the three together.
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

/** `?date=` empty means today, resolved by the server. */
export const resolveBoardDate = (raw: string | null): string | null =>
  raw !== null && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;

export const DailyOperationsPage = (): JSX.Element => {
  const t = useT();
  const search = useSearchParams();
  const [sp, setSp] = search;

  const date = resolveBoardDate(sp.get('date'));
  const board = useOperationsDayBoard(date);

  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  // The day the server answered for — what the picker shows while `?date=` is empty.
  const boardDay = (board.data?.date ?? '').slice(0, 10);

  return (
    <PageContainer fullHeight>
      <ShipmentsBoard
        search={search}
        shipments={board.data?.shipments ?? []}
        crews={board.data?.crews ?? []}
        loaded={board.data !== undefined}
        loading={board.isLoading}
        error={board.error}
        onRetry={() => void board.refetch()}
        datePickers={[
          {
            param: 'date',
            label: t('operations.dailyOps.date'),
            value: date ?? boardDay,
            onChange: (value) => {
              const next = new URLSearchParams(sp);
              if (value === '') next.delete('date');
              else next.set('date', value);
              setSp(next);
            },
          },
        ]}
        periodActive={date !== null}
        periodParams={['date']}
        // A new shipment opens on the day being looked at, not on "today".
        defaultDate={date ?? boardDay}
        empty={t('operations.dailyOps.empty')}
      />
    </PageContainer>
  );
};
