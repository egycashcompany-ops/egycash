// «لوحة تحكم الحركة» — the two reads as queries (plan §5.6, D15).
//
//   R1 ['fleet','dashboard','now']                     the «الآن» tabs; no parameter in the key, so a
//                                                      filter change never re-reads it.
//   R2 ['fleet','dashboard','period', liveness, query] the period tabs; `tab` is in neither key.
//
// A reader with no key of a read never asks for it (`enabled`), so the page costs nobody a 403.
// The realtime registry invalidates both prefixes (HUB, D13); the throttle lives there, not here.
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
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
 * One timer: at the next Cairo midnight (from R1's echoed `asOf`), R1 is invalidated, so «today»
 * turns over with the city even on a page left open all night.
 */
export const useCairoMidnightRefresh = (asOf: string | undefined, fetchedAt: number): void => {
  const qc = useQueryClient();
  useEffect(() => {
    if (asOf === undefined || fetchedAt <= 0) return undefined;
    const timer = window.setTimeout(
      () => void qc.invalidateQueries({ queryKey: fleetDashboardKeys.now }),
      msUntilCairoMidnight(asOf, fetchedAt, Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [asOf, fetchedAt, qc]);
};
