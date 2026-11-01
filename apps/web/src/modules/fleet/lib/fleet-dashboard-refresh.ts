// «لوحة تحكم الحركة» — how fresh the two reads stay, with no server cache (plan §5.6, D15).
//
//   R1 (the «الآن» tabs): 60 s fresh, re-read on focus, every 5 minutes while the page is seen, and
//      at the next Cairo midnight — «today» turns over there, so every figure of the day must too.
//   R2 (the period tabs): 5 minutes fresh, the previous answer kept on screen while a new filter
//      loads. A range wholly in the past is a different key (`past`) from a live one, so the realtime
//      registry can leave a closed month alone.
//
// Everything here is pure: the page passes the clock in, so the specs can pin it.
import { nextCairoMidnight, type FleetDashboardPeriodQuery } from '@ecms/contracts';

export const NOW_STALE_MS = 60_000;
export const NOW_INTERVAL_MS = 5 * 60_000;
export const PERIOD_STALE_MS = 5 * 60_000;
/** The heading's «آخر تحديث قبل N ثانية» ticks this often. */
export const FRESHNESS_TICK_MS = 5_000;

/** Never fire a midnight refresh sooner than this (a clock a little ahead of the server's). */
const MIN_DELAY_MS = 1_000;

/**
 * How long until R1 must be read again because Cairo's day turns over.
 *
 * Measured on the SERVER's clock, from its echoed `asOf`: the delay is the server's distance to the
 * next Cairo midnight, less the time the answer has spent in this browser since it arrived. A browser
 * clock set to another day or zone does not move it.
 */
export const msUntilCairoMidnight = (asOf: string, fetchedAt: number, now: number): number => {
  const serverNow = Date.parse(asOf);
  if (Number.isNaN(serverNow)) return MIN_DELAY_MS;
  const toMidnight = nextCairoMidnight(new Date(serverNow)).getTime() - serverNow;
  return Math.max(MIN_DELAY_MS, toMidnight - Math.max(0, now - fetchedAt));
};

export type PeriodLiveness = 'past' | 'live';

/**
 * R2's key segment: `past` for a range that ended before today — «الشهر الماضي», or a custom range
 * whose `to` is before R1's echoed `today` — and `live` for everything else (or when today is not
 * known yet: a range that might include today is never treated as closed).
 */
export const periodLiveness = (
  query: FleetDashboardPeriodQuery,
  today: string | undefined,
): PeriodLiveness => {
  if (query.preset === 'lastMonth') return 'past';
  if (query.preset === 'custom' && today !== undefined && query.to !== undefined && query.to < today) {
    return 'past';
  }
  return 'live';
};

/** «آخر تحديث …»: just now (under 5 s), N seconds, or N minutes ago. `null` before the first answer. */
export type Freshness = { unit: 'now' } | { unit: 'seconds' | 'minutes'; n: number };

export const freshness = (updatedAt: number, now: number): Freshness | null => {
  if (updatedAt <= 0) return null;
  const seconds = Math.max(0, Math.floor((now - updatedAt) / 1000));
  if (seconds < 5) return { unit: 'now' };
  if (seconds < 60) return { unit: 'seconds', n: seconds };
  return { unit: 'minutes', n: Math.floor(seconds / 60) };
};
