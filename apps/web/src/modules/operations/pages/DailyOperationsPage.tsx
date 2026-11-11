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
// TODAY, AND ONLY TODAY — «اليوم التشغيلي دى هنشيل منها التاريخ … هو هيجيب بتاعت اليوم». The
// day picker this screen once added over legacy is gone: looking at another day is what the
// history is for. The day is Cairo's, named in the request rather than left to the server (which
// would answer the UTC day for the first hours after a Cairo midnight), and it moves on by itself
// on a screen left open overnight (`useCairoToday`).
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../../platform/localization/useT';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { useOperationsDayBoard } from '../api/operations-queries';
import { ShipmentsBoard } from '../components/ShipmentsBoard';
import { useCairoToday } from '../lib/use-cairo-today';

/**
 * Remembered across visits: the filters — the board's day is always today, so there is no period
 * to remember. The SAME list as the history's, and as the board's own filters
 * (`DAY_BOARD_FILTER_PARAMS`) — day-board-filters.spec holds the three together.
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

export const DailyOperationsPage = (): JSX.Element => {
  const t = useT();
  const search = useSearchParams();
  const [sp, setSp] = search;

  const today = useCairoToday();
  const board = useOperationsDayBoard(today);

  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  // An old link or bookmark may still carry the day picker's `?date=`. It is never read — the board
  // is today's whatever it says — and it is dropped from the address bar so it does not sit there
  // looking like the day on screen. `replace`: tidying a URL is not a place to go Back to.
  useEffect(() => {
    if (!sp.has('date')) return;
    const next = new URLSearchParams(sp);
    next.delete('date');
    setSp(next, { replace: true });
  }, [sp, setSp]);

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
        // The desk's working screen: new shipments are entered here, and delivered here.
        canCreate
        canToggleReceived
        empty={t('operations.dailyOps.empty')}
      />
    </PageContainer>
  );
};
