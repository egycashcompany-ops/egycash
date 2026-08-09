// The derived licence state, tested as the pure function it is — no database, no request, and an
// injected clock. §6 says the state is derived and never stored; this is what makes that claim
// checkable rather than aspirational.
import { describe, expect, it } from 'vitest';
import { IT_LICENSE_STATES } from '@ecms/contracts';
import { DAY_MS, isOverSeats, licenseState } from './license-state';

const NOW = new Date('2026-08-09T12:00:00.000Z');
const inDays = (days: number): Date => new Date(NOW.getTime() + days * DAY_MS);

describe('licenseState', () => {
  it('calls a licence with no end date perpetual', () => {
    expect(licenseState(null, 30, NOW)).toBe('perpetual');
  });

  it('reads a past date as expired', () => {
    expect(licenseState(inDays(-1), 30, NOW)).toBe('expired');
  });

  // The boundary is inclusive: the moment the date arrives, the licence has run out.
  it('treats the exact expiry moment as expired, not as still active', () => {
    expect(licenseState(new Date(NOW.getTime()), 30, NOW)).toBe('expired');
  });

  it('warns inside the window and stays active outside it', () => {
    expect(licenseState(inDays(10), 30, NOW)).toBe('expiringSoon');
    expect(licenseState(inDays(30), 30, NOW)).toBe('expiringSoon');
    expect(licenseState(inDays(31), 30, NOW)).toBe('active');
  });

  // 0 is the honest way to say "no early warning" — the same convention `it.ticket.autoCloseDays`
  // already uses for "we do not auto-close". It must NOT suppress `expired`.
  it('collapses the warning window at 0 without hiding an expiry', () => {
    expect(licenseState(inDays(1), 0, NOW)).toBe('active');
    expect(licenseState(inDays(-1), 0, NOW)).toBe('expired');
  });

  it('only ever answers with a state the contract declares', () => {
    for (const days of [-100, -1, 0, 1, 29, 30, 31, 1000]) {
      expect(IT_LICENSE_STATES).toContain(licenseState(inDays(days), 30, NOW));
    }
    expect(IT_LICENSE_STATES).toContain(licenseState(null, 30, NOW));
  });
});

describe('isOverSeats', () => {
  it('is never true for an unlimited licence', () => {
    expect(isOverSeats(null, 10_000)).toBe(false);
  });

  // Using every seat is compliance, not a breach. Off-by-one here would warn every fully-deployed
  // licence in the company, which is how a real warning becomes noise.
  it('allows a licence to be used to the last seat', () => {
    expect(isOverSeats(5, 5)).toBe(false);
    expect(isOverSeats(5, 6)).toBe(true);
  });

  it('is false for an unused licence', () => {
    expect(isOverSeats(5, 0)).toBe(false);
  });
});
