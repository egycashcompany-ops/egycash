// «لوحة تحكم الحركة» — the two reads as queries (plan §5.6, D15).
//
//   R1 ['fleet','dashboard','now']                     the «الآن» tabs; no parameter in the key, so a
//                                                      filter change never re-reads it.
//   R2 ['fleet','dashboard','period', liveness, query] the period tabs; `tab` is in neither key.
//
// A reader with no key of a read never asks for it (`enabled`), so the page costs nobody a 403.
// The realtime registry invalidates both prefixes (HUB, D13); the throttle lives there, not here.
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';
import { type FleetDashboardPeriodQuery } from '@ecms/contracts';
import {
  NOW_INTERVAL_MS,
  NOW_STALE_MS,
  PERIOD_STALE_MS,
  msUntilCairoMidnight,
  type PeriodLiveness,
} from '../lib/fleet-dashboard-refresh';
import { getFleetDashboardNow, getFleetDashboardPeriod } from './fleet-dashboard-api';

export const fleetDashboardKeys = {
  all: ['fleet', 'dashboard'] as const,
  now: ['fleet', 'dashboard', 'now'] as const,
  period: (liveness: PeriodLiveness, query: FleetDashboardPeriodQuery) =>
    ['fleet', 'dashboard', 'period', liveness, query] as const,
  /** Every period read whose range reaches today — what midnight and the realtime signals move. */
  livePeriod: ['fleet', 'dashboard', 'period', 'live'] as const,
  /** The closed ranges: the realtime signals leave them alone; midnight moves «الشهر الماضي» only. */
  pastPeriod: ['fleet', 'dashboard', 'period', 'past'] as const,
};

/**
 * What Cairo's midnight moves: R1, the live period reads (a preset moves its window, today's hatched
 * column moves on), and «الشهر الماضي» — a closed range, but its key (`{ preset: 'lastMonth' }`)
 * is the same in every month, so on the 1st it would keep the month before on screen under a name
 * that now means another. A past custom range is left alone: midnight changes nothing in it.
 */
export const invalidateAtCairoMidnight = (qc: QueryClient): void => {
  void qc.invalidateQueries({ queryKey: fleetDashboardKeys.now });
  void qc.invalidateQueries({ queryKey: fleetDashboardKeys.livePeriod });
  void qc.invalidateQueries({
    queryKey: fleetDashboardKeys.pastPeriod,
    predicate: (query) =>
      (query.queryKey[4] as FleetDashboardPeriodQuery | undefined)?.preset === 'lastMonth',
  });
};

/** R1. Fresh for a minute; re-read on focus and every five minutes while the page is seen. */
export const useFleetDashboardNow = (enabled: boolean) =>
  useQuery({
    queryKey: fleetDashboardKeys.now,
    queryFn: getFleetDashboardNow,
    enabled,
    staleTime: NOW_STALE_MS,
    refetchOnWindowFocus: true,
    refetchInterval: NOW_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

/** R2. Fresh for five minutes; the previous answer stays on screen while a new filter loads. */
export const useFleetDashboardPeriod = (
  query: FleetDashboardPeriodQuery,
  liveness: PeriodLiveness,
  enabled: boolean,
) =>
  useQuery({
    queryKey: fleetDashboardKeys.period(liveness, query),
    queryFn: () => getFleetDashboardPeriod(query),
    enabled,
    staleTime: PERIOD_STALE_MS,
    placeholderData: keepPreviousData,
  });

/**
 * One timer: at the next Cairo midnight (from the echoed `asOf` of whichever read the reader holds —
 * see `midnightClock`), what `invalidateAtCairoMidnight` names is invalidated, so «today» turns over
 * with the city even on a page left open all night.
 */
export const useCairoMidnightRefresh = (asOf: string | undefined, fetchedAt: number): void => {
  const qc = useQueryClient();
  useEffect(() => {
    if (asOf === undefined || fetchedAt <= 0) return undefined;
    const timer = window.setTimeout(
      () => invalidateAtCairoMidnight(qc),
      msUntilCairoMidnight(asOf, fetchedAt, Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [asOf, fetchedAt, qc]);
};
