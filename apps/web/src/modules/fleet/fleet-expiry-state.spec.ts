// `expiryState` — the fuel-card, vehicle and driver screens' «منتهية / قريبًا» tag and figures.
//
// R-02 / Q-02: a card or licence is expired ON its expiry day, by the Cairo calendar day — the rule
// the dashboard counts with (`expiryStateOn`) and every `licExpBefore` link applies. The instant
// comparison it replaced kept a card expiring today «قريبًا» until its stored midnight passed, so a
// screen's own «منتهية» was one lower than the dashboard figure that linked to it.
import { describe, expect, it } from 'vitest';
import { expiryState } from './components/FuelCardBoard';

/** Cairo 2 Nov 2026, 00:30 — still 1 Nov in UTC (22:30). */
const CAIRO_2_NOV_0030 = Date.parse('2026-11-01T22:30:00.000Z');

describe('expiryState — the Cairo day, expired ON the expiry day', () => {
  it('a date of today is expired already, though its stored midnight is still ahead in UTC', () => {
    expect(expiryState('2026-11-02T00:00:00.000Z', 30, CAIRO_2_NOV_0030)).toBe('expired');
  });

  it('a non-midnight stamp on today is expired all day, not from that hour on', () => {
    expect(expiryState('2026-11-02T18:00:00.000Z', 30, CAIRO_2_NOV_0030)).toBe('expired');
  });

  it('tomorrow is «soon» within the warning days, later «valid»; no date is «unknown»', () => {
    expect(expiryState('2026-11-03T00:00:00.000Z', 30, CAIRO_2_NOV_0030)).toBe('soon');
    expect(expiryState('2026-12-02T00:00:00.000Z', 30, CAIRO_2_NOV_0030)).toBe('soon');
    expect(expiryState('2026-12-03T00:00:00.000Z', 30, CAIRO_2_NOV_0030)).toBe('valid');
    expect(expiryState(null, 30, CAIRO_2_NOV_0030)).toBe('unknown');
  });
});
