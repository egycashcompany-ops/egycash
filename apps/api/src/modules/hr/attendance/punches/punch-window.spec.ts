// The §13 clock-drift window, pinned: rows outside it are QUARANTINED with a reason, and the
// reason strings are part of what an import reviewer reads back.
import { describe, expect, it } from 'vitest';
import { punchWindowProblem, PUNCH_MAX_AGE_DAYS, PUNCH_MAX_FUTURE_MS } from './punch.service';

const NOW = new Date('2026-07-15T12:00:00.000Z');

describe('punchWindowProblem', () => {
  it('accepts now, the recent past, and small future skew', () => {
    expect(punchWindowProblem(NOW, NOW)).toBeNull();
    expect(punchWindowProblem(new Date(NOW.getTime() - 86_400_000), NOW)).toBeNull();
    expect(punchWindowProblem(new Date(NOW.getTime() + PUNCH_MAX_FUTURE_MS), NOW)).toBeNull();
  });

  it('quarantines the far future — a device clock running ahead', () => {
    expect(
      punchWindowProblem(new Date(NOW.getTime() + PUNCH_MAX_FUTURE_MS + 60_000), NOW),
    ).toBe('timestamp is in the future');
  });

  it('quarantines rows older than the retention window', () => {
    const old = new Date(NOW.getTime() - (PUNCH_MAX_AGE_DAYS + 1) * 86_400_000);
    expect(punchWindowProblem(old, NOW)).toContain('older than');
  });

  it('quarantines an unparseable timestamp', () => {
    expect(punchWindowProblem(new Date('nonsense'), NOW)).toBe('invalid timestamp');
  });
});
