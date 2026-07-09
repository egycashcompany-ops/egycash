// Expiration + scheduling math (Sprint 3.3 plan §2c/§2d).
import { describe, expect, it } from 'vitest';
import { computeScheduleDelayMs, isExpired, resolveExpiresAt } from './notification.expiry';

describe('resolveExpiresAt', () => {
  const now = new Date('2026-07-09T00:00:00.000Z');

  it('prefers the caller-supplied expiresAt over the template default', () => {
    const callerExpiresAt = new Date('2026-08-01T00:00:00.000Z');
    expect(resolveExpiresAt(callerExpiresAt, 24, now)).toBe(callerExpiresAt);
  });

  it('falls back to the template default expiry hours when the caller supplies none', () => {
    const resolved = resolveExpiresAt(undefined, 48, now);
    expect(resolved?.toISOString()).toBe('2026-07-11T00:00:00.000Z');
  });

  it('resolves to null when neither the caller nor the template declares an expiry', () => {
    expect(resolveExpiresAt(undefined, null, now)).toBeNull();
  });
});

describe('isExpired', () => {
  const now = new Date('2026-07-09T00:00:00.000Z');

  it('is false for a null expiresAt (never expires)', () => {
    expect(isExpired(null, now)).toBe(false);
  });

  it('is false for a future expiresAt', () => {
    expect(isExpired(new Date('2026-07-10T00:00:00.000Z'), now)).toBe(false);
  });

  it('is true for a past expiresAt', () => {
    expect(isExpired(new Date('2026-07-08T00:00:00.000Z'), now)).toBe(true);
  });

  it('is true at the exact expiry instant (inclusive)', () => {
    expect(isExpired(now, now)).toBe(true);
  });
});

describe('computeScheduleDelayMs', () => {
  const now = new Date('2026-07-09T00:00:00.000Z');

  it('returns the positive delay to a future sendAt', () => {
    const sendAt = new Date('2026-07-09T01:00:00.000Z');
    expect(computeScheduleDelayMs(sendAt, now)).toBe(60 * 60_000);
  });

  it('clamps a past sendAt to zero (send-now path)', () => {
    const sendAt = new Date('2026-07-08T00:00:00.000Z');
    expect(computeScheduleDelayMs(sendAt, now)).toBe(0);
  });

  it('returns zero for a sendAt exactly at now', () => {
    expect(computeScheduleDelayMs(now, now)).toBe(0);
  });
});
