// Quiet-hours window math (Sprint 3.3 plan §3c) — server/UTC time, midnight-wrapping.
import { describe, expect, it } from 'vitest';
import { computeQuietHoursDeferralMs } from './notification.quiet-hours';

describe('computeQuietHoursDeferralMs', () => {
  it('returns null when quiet hours are disabled', () => {
    const now = new Date('2026-07-09T23:00:00.000Z');
    expect(
      computeQuietHoursDeferralMs(now, { enabled: false, start: '22:00', end: '07:00' }),
    ).toBeNull();
  });

  it('returns null for a zero-width window (treated as disabled)', () => {
    const now = new Date('2026-07-09T23:00:00.000Z');
    expect(
      computeQuietHoursDeferralMs(now, { enabled: true, start: '22:00', end: '22:00' }),
    ).toBeNull();
  });

  describe('a wrapping window (22:00 → 07:00)', () => {
    const window = { enabled: true, start: '22:00', end: '07:00' };

    it('defers when inside the window after midnight-wrap start', () => {
      const now = new Date('2026-07-09T23:30:00.000Z'); // 23:30
      const ms = computeQuietHoursDeferralMs(now, window);
      expect(ms).toBe(7.5 * 60 * 60_000); // 7h30m until 07:00
    });

    it('defers when inside the window before the end boundary', () => {
      const now = new Date('2026-07-10T03:00:00.000Z'); // 03:00
      const ms = computeQuietHoursDeferralMs(now, window);
      expect(ms).toBe(4 * 60 * 60_000); // 4h until 07:00
    });

    it('does not defer at the exact end boundary (end is exclusive)', () => {
      const now = new Date('2026-07-10T07:00:00.000Z');
      expect(computeQuietHoursDeferralMs(now, window)).toBeNull();
    });

    it('defers at the exact start boundary (start is inclusive)', () => {
      const now = new Date('2026-07-09T22:00:00.000Z');
      expect(computeQuietHoursDeferralMs(now, window)).toBe(9 * 60 * 60_000);
    });

    it('does not defer outside the window (daytime)', () => {
      const now = new Date('2026-07-09T12:00:00.000Z');
      expect(computeQuietHoursDeferralMs(now, window)).toBeNull();
    });
  });

  describe('a non-wrapping window (09:00 → 17:00)', () => {
    const window = { enabled: true, start: '09:00', end: '17:00' };

    it('defers inside the window', () => {
      const now = new Date('2026-07-09T12:00:00.000Z');
      expect(computeQuietHoursDeferralMs(now, window)).toBe(5 * 60 * 60_000);
    });

    it('does not defer outside the window', () => {
      const now = new Date('2026-07-09T20:00:00.000Z');
      expect(computeQuietHoursDeferralMs(now, window)).toBeNull();
    });
  });
});
