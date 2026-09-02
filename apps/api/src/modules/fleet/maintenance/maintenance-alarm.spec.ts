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
  // No reading on record from before the service, so the bracket's lower half constrains nothing
  // — every expectation in this file is the arithmetic, unchanged, exactly as it always was.
  baselineLowerBound: null,
};

describe('computeAlarm (§4.4 — derived, guarded)', () => {
  it('computes remaining = interval − sinceService', () => {
    expect(computeAlarm(base)).toEqual({
      level: 'yellow',
      remainingKm: 1000,
      sinceServiceKm: 9000,
      // Computed, so there is no reason it could not be: see `maintenance-alarm-reason.spec.ts`.
      noAlarmReason: null,
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
      noAlarmReason: null,
    });
  });

  it('no rule / no readings / no baseline ⇒ no data, never a false alarm', () => {
    // The figures are the same "no data" they always were; each now also SAYS which guard
    // produced it, which is what `maintenance-alarm-reason.spec.ts` exists to pin exhaustively.
    const none = (noAlarmReason: string) => ({
      level: 'none',
      remainingKm: null,
      sinceServiceKm: null,
      noAlarmReason,
    });
    expect(computeAlarm({ ...base, intervalKm: 0 })).toEqual(none('noInterval'));
    expect(computeAlarm({ ...base, latestReading: null, latestReadingDate: null })).toEqual(
      none('noReading'),
    );
    expect(computeAlarm({ ...base, baselineCounter: null, baselineDate: null })).toEqual(
      none('noService'),
    );
  });

  it('a reading older than the last service says nothing about the new cycle (legacy guard)', () => {
    expect(computeAlarm({ ...base, latestReadingDate: new Date('2026-05-01') }).level).toBe('none');
  });
});

// The thresholds are SETTINGS, and the odometer registry now colours a column with them. These
// pin that the settings are what decide — the same inputs land on a different level when an
// administrator moves the thresholds, and nothing in the arithmetic is fixed to a number.
describe('the thresholds come from settings, not from the code', () => {
  // 5,000 km interval, 4,000 km driven since the service — the shape the odometer column shows.
  const driven = { ...base, intervalKm: 5000, latestReading: 120_000, baselineCounter: 116_000 };

  it('the SAME distance lands on a different level when the thresholds move', () => {
    // remaining = 5000 − 4000 = 1000.
    expect(computeAlarm({ ...driven, yellowKm: 500, redKm: 100 }).level).toBe('none');
    expect(computeAlarm({ ...driven, yellowKm: 1000, redKm: 300 }).level).toBe('yellow');
    expect(computeAlarm({ ...driven, yellowKm: 2000, redKm: 1000 }).level).toBe('red');
    // …and the distance itself never moves: only the verdict does.
    expect(computeAlarm({ ...driven, yellowKm: 2000, redKm: 1000 }).sinceServiceKm).toBe(4000);
  });

  it('reaching the interval is red under the defaults — the cycle is spent', () => {
    const spent = { ...driven, latestReading: 121_000 };
    expect(computeAlarm(spent)).toEqual({
      level: 'red',
      remainingKm: 0,
      sinceServiceKm: 5000,
      noAlarmReason: null,
    });
  });

  it('overrunning the interval stays red and reports the overrun, not a floor of zero', () => {
    const over = { ...driven, latestReading: 121_300 };
    expect(computeAlarm(over)).toEqual({
      level: 'red',
      remainingKm: -300,
      sinceServiceKm: 5300,
      noAlarmReason: null,
    });
  });

  it('a service today with no distance since is zero driven, never an alarm', () => {
    const fresh = { ...driven, latestReading: 116_000 };
    expect(computeAlarm(fresh)).toEqual({
      level: 'none',
      remainingKm: 5000,
      sinceServiceKm: 0,
      // A MEASURED `none` — the healthy car. Distinct from the four that could not be measured.
      noAlarmReason: null,
    });
  });

  it('red wins when the two thresholds meet, so a level is never ambiguous', () => {
    expect(computeAlarm({ ...driven, yellowKm: 1000, redKm: 1000 }).level).toBe('red');
  });
});
