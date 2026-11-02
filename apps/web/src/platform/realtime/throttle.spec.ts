// The realtime throttle (D13): the fleet dashboard's live reads are marked stale on every signal but
// refetched at most once per 30-second window — a busy morning of saves costs two reads a minute,
// not one per save — and the plain sweep keeps every other prefix exactly as it was.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INVALIDATION_REGISTRY,
  THROTTLED_KEY_PREFIXES,
  keysForTopic,
} from './invalidation-registry';
import { REALTIME_THROTTLE_MS, createRefetchThrottle } from './throttle';

const NOW = ['fleet', 'dashboard', 'now'] as const;
const LIVE = ['fleet', 'dashboard', 'period', 'live'] as const;

const build = () => {
  const stale: string[] = [];
  const refetched: string[] = [];
  const throttle = createRefetchThrottle(
    {
      markStale: (prefix) => stale.push(JSON.stringify(prefix)),
      refetch: (prefix) => refetched.push(JSON.stringify(prefix)),
    },
    [NOW, LIVE],
  );
  return { stale, refetched, throttle };
};

describe('the refetch throttle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is thirty seconds', () => {
    expect(REALTIME_THROTTLE_MS).toBe(30_000);
  });

  it('turns a burst of fifty signals inside the window into one refetch, and one more after it', () => {
    const { stale, refetched, throttle } = build();
    for (let i = 0; i < 50; i += 1) {
      throttle.push(NOW);
      vi.advanceTimersByTime(500); // 50 signals over 25 s
    }
    expect(refetched).toEqual([JSON.stringify(NOW)]);
    // Every signal marked the read stale (refetchType 'none'): a closed tab reads fresh on return.
    expect(stale).toHaveLength(50);
    vi.advanceTimersByTime(REALTIME_THROTTLE_MS - 25_000 - 1);
    expect(refetched).toHaveLength(1);
    vi.advanceTimersByTime(1);
    // The window closed with signals in it: one trailing refetch carries all of them.
    expect(refetched).toHaveLength(2);
    // And a quiet window after it closes with nothing.
    vi.advanceTimersByTime(REALTIME_THROTTLE_MS * 3);
    expect(refetched).toHaveLength(2);
  });

  it('refetches at once on the first signal after a quiet spell', () => {
    const { refetched, throttle } = build();
    throttle.push(NOW);
    vi.advanceTimersByTime(REALTIME_THROTTLE_MS); // the window closes, nothing pending
    expect(refetched).toHaveLength(1);
    vi.advanceTimersByTime(60_000);
    throttle.push(NOW);
    expect(refetched).toHaveLength(2);
  });

  it('never refetches a prefix more than once per window, however long the stream lasts', () => {
    const { refetched, throttle } = build();
    for (let second = 0; second < 300; second += 1) {
      throttle.push(NOW);
      vi.advanceTimersByTime(1000);
    }
    // Five minutes of one signal a second: the first at once, then one per 30-second window.
    expect(refetched.length).toBeLessThanOrEqual(1 + 300 / 30);
    expect(refetched.length).toBeGreaterThanOrEqual(300 / 30);
  });

  it('keeps one window per prefix', () => {
    const { refetched, throttle } = build();
    throttle.push(NOW);
    throttle.push(LIVE);
    throttle.push(NOW);
    expect(refetched).toEqual([JSON.stringify(NOW), JSON.stringify(LIVE)]);
  });

  it('owns only its prefixes, and a cancelled throttle never fires', () => {
    const { refetched, throttle } = build();
    expect(throttle.owns(NOW)).toBe(true);
    expect(throttle.owns(LIVE)).toBe(true);
    expect(throttle.owns(['fleet', 'dashboard'])).toBe(false);
    expect(throttle.owns(['fleet', 'vehicles'])).toBe(false);
    throttle.push(NOW);
    throttle.push(NOW);
    throttle.cancel();
    vi.advanceTimersByTime(REALTIME_THROTTLE_MS * 2);
    expect(refetched).toHaveLength(1);
  });
});

describe('the throttled prefixes in the registry', () => {
  it('are the fleet dashboard’s R1 and its LIVE period read — never a past period', () => {
    expect(THROTTLED_KEY_PREFIXES).toEqual([NOW, LIVE]);
  });

  it('ride the fleet rows whose writes move a dashboard figure, and no other module', () => {
    const carrying = (prefix: readonly unknown[]): string[] =>
      Object.keys(INVALIDATION_REGISTRY).filter((topic) =>
        keysForTopic(topic).some((key) => JSON.stringify(key) === JSON.stringify(prefix)),
      );
    expect(carrying(NOW).every((topic) => topic.startsWith('fleet.'))).toBe(true);
    expect(carrying(NOW)).toEqual(
      expect.arrayContaining([
        'fleet.vehicle',
        'fleet.driverProfile',
        'fleet.dutyAssignment',
        'fleet.maintenanceVisit',
        'fleet.odometerLog',
        'fleet.accident',
        'fleet.violation',
        'fleet.vehicleLicensing',
        'fleet.notice',
        'fleet.dealershipInvoice',
        'fleet.fuelCard',
        'fleet.receipt',
      ]),
    );
    // The period tabs count km, visits, accidents, card/custody spend and dealership rows.
    expect(carrying(LIVE).sort()).toEqual(
      [
        'fleet.accident',
        'fleet.catalogItem',
        'fleet.dealershipInvoice',
        'fleet.maintenanceVisit',
        'fleet.odometerLog',
        'fleet.receipt',
        'fleet.vehicle',
        'fleet.vehicleType',
      ].sort(),
    );
    // The custody rows reach tab 1's custody line through the custody hooks' own key, not R1.
    expect(carrying(NOW)).not.toContain('fleet.custodyOperation');
  });
});
