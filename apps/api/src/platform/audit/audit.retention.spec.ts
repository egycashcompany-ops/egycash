// F4 — retention window math: floor enforcement is the load-bearing rule here (a
// misconfigured setting must never purge below the compliance floor).
import { describe, expect, it } from 'vitest';
import { computeRetentionWindow } from './audit.retention';

describe('computeRetentionWindow', () => {
  const now = new Date('2026-07-09T00:00:00.000Z');

  it('uses the configured value when it is at or above the 365-day floor', () => {
    expect(computeRetentionWindow(730, now).retentionDays).toBe(730);
    expect(computeRetentionWindow(365, now).retentionDays).toBe(365);
  });

  it('clamps below-floor configuration up to the 365-day floor', () => {
    expect(computeRetentionWindow(30, now).retentionDays).toBe(365);
    expect(computeRetentionWindow(0, now).retentionDays).toBe(365);
    expect(computeRetentionWindow(-10, now).retentionDays).toBe(365);
  });

  it('derives the cutoff from the enforced (possibly clamped) retention window', () => {
    const { cutoff } = computeRetentionWindow(365, now);
    expect(cutoff.toISOString()).toBe('2025-07-09T00:00:00.000Z');
  });

  it('a below-floor configuration still yields the floor-derived cutoff, not the configured one', () => {
    const clamped = computeRetentionWindow(30, now);
    const atFloor = computeRetentionWindow(365, now);
    expect(clamped.cutoff.toISOString()).toBe(atFloor.cutoff.toISOString());
  });
});
