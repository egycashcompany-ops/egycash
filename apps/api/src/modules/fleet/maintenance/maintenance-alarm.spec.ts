import { describe, expect, it } from 'vitest';
import { computeAlarm } from './maintenance-alarm';

const base = {
  intervalKm: 10_000,
  yellowKm: 1000,
  redKm: 300,
  latestReading: 125_000,
  latestReadingDate: new Date('2026-08-01'),
  baselineCounter: 116_000,
  baselineDate: new Date('2026-06-01'),
};

describe('computeAlarm (§4.4 — derived, guarded)', () => {
  it('computes remaining = interval − sinceService', () => {
    expect(computeAlarm(base)).toEqual({
      level: 'yellow',
      remainingKm: 1000,
      sinceServiceKm: 9000,
    });
  });

  it('goes red at the red threshold and stays none above yellow', () => {
    expect(computeAlarm({ ...base, latestReading: 125_800 }).level).toBe('red');
    expect(computeAlarm({ ...base, latestReading: 124_000 }).level).toBe('none');
    // Overdue: remaining goes negative and stays red.
    expect(computeAlarm({ ...base, latestReading: 127_000 })).toEqual({
      level: 'red',
      remainingKm: -1000,
      sinceServiceKm: 11_000,
    });
  });

  it('no rule / no readings / no baseline ⇒ no data, never a false alarm', () => {
    const none = { level: 'none', remainingKm: null, sinceServiceKm: null };
    expect(computeAlarm({ ...base, intervalKm: 0 })).toEqual(none);
    expect(computeAlarm({ ...base, latestReading: null, latestReadingDate: null })).toEqual(none);
    expect(computeAlarm({ ...base, baselineCounter: null, baselineDate: null })).toEqual(none);
  });

  it('a reading older than the last service says nothing about the new cycle (legacy guard)', () => {
    expect(computeAlarm({ ...base, latestReadingDate: new Date('2026-05-01') }).level).toBe('none');
  });
});
