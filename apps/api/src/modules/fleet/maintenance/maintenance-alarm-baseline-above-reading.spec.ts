// D4 — the reading sits BELOW the baseline it would be measured from.
//
// `latestReading - baselineCounter` is presented as "distance travelled since the service". When
// the subtraction comes out negative that sentence is not merely pessimistic, it is impossible:
// an odometer does not run backwards (FR-2 refuses it), so a negative result is proof that the
// two numbers did not come off the same counter. The workshop's exit reading and the odometer
// chain are written by different endpoints into different collections with no invariant between
// them, so nothing at write time prevents the pair from being incomparable.
//
// This guard refuses to answer, for the same reason the four before it do. It is a DEFENSIVE
// INTEGRITY GUARD and nothing more: it does not say which of the two numbers is wrong, it does
// not make the baseline trustworthy, and it is not the baseline-provenance design — that remains
// a separate, deferred domain decision.
import { describe, expect, it } from 'vitest';
import { computeAlarm, type AlarmInput } from './maintenance-alarm';

const D = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const SERVICE_DAY = '2026-06-10';
const AFTER = '2026-06-20';
const BEFORE = '2026-06-01';
const BASELINE = 100_000;

const base: AlarmInput = {
  intervalKm: 10_000,
  yellowKm: 1000,
  redKm: 300,
  latestReading: BASELINE + 2000,
  latestReadingDate: D(AFTER),
  baselineCounter: BASELINE,
  baselineDate: D(SERVICE_DAY),
};

const run = (over: Partial<AlarmInput> = {}) => computeAlarm({ ...base, ...over });

const REFUSED = {
  level: 'none',
  remainingKm: null,
  sinceServiceKm: null,
  noAlarmReason: 'baselineAboveReading',
} as const;

describe('the new state, and the two boundaries around it', () => {
  it('reading BELOW the baseline ⇒ baselineAboveReading, and no figures at all', () => {
    // Not "a negative distance shown carefully" — no distance. The whole point is that the
    // arithmetic never runs, so there is nothing for a screen to round, tint, or explain away.
    expect(run({ latestReading: BASELINE - 100 })).toEqual(REFUSED);
    expect(run({ latestReading: 1 })).toEqual(REFUSED);
    expect(run({ latestReading: 0 })).toEqual(REFUSED);
  });

  it('reading EQUAL to the baseline ⇒ the arithmetic runs — the guard is `<`, not `<=`', () => {
    // Zero km since the service is a real, measured answer: the car has not moved. Refusing it
    // would hide a healthy cycle behind a data-integrity label, and `<=` here is the single
    // character that turns this guard from defensive into wrong.
    const result = run({ latestReading: BASELINE });
    expect(result.noAlarmReason).toBeNull();
    expect(result.sinceServiceKm).toBe(0);
    expect(result.remainingKm).toBe(10_000);
    expect(result.level).toBe('none');
  });

  it('reading one km ABOVE the baseline ⇒ the arithmetic runs, unchanged', () => {
    const result = run({ latestReading: BASELINE + 1 });
    expect(result.noAlarmReason).toBeNull();
    expect(result.sinceServiceKm).toBe(1);
    expect(result.remainingKm).toBe(9999);
  });

  it('the three points around the boundary, in order', () => {
    expect(run({ latestReading: BASELINE - 1 }).noAlarmReason).toBe('baselineAboveReading');
    expect(run({ latestReading: BASELINE }).noAlarmReason).toBeNull();
    expect(run({ latestReading: BASELINE + 1 }).noAlarmReason).toBeNull();
  });
});

describe('the guards before it keep their order — D4 is LAST', () => {
  it('no reading, with a baseline above anything ⇒ noReading, never D4', () => {
    // `latestReading` is null here; a guard placed before the null check would either crash or
    // compare against null and answer with the wrong label.
    expect(
      run({ latestReading: null, latestReadingDate: null, baselineCounter: 10_000_000 })
        .noAlarmReason,
    ).toBe('noReading');
  });

  it('no baseline, with a reading present ⇒ noService, never D4', () => {
    expect(run({ baselineCounter: null, baselineDate: null, latestReading: 1 }).noAlarmReason).toBe(
      'noService',
    );
  });

  it('reading date ON or BEFORE the service day ⇒ readingOlderThanService, never D4', () => {
    // Both conditions are true at once in each of these. The date guard is first and stays first.
    for (const date of [BEFORE, SERVICE_DAY]) {
      expect(
        run({ latestReading: BASELINE - 5000, latestReadingDate: D(date) }).noAlarmReason,
      ).toBe('readingOlderThanService');
    }
  });

  it('no interval, with a reading below the baseline ⇒ noInterval, never D4', () => {
    expect(run({ intervalKm: 0, latestReading: BASELINE - 5000 }).noAlarmReason).toBe('noInterval');
  });

  it('every earlier guard beats D4 when both apply — checked as one table', () => {
    const belowBaseline = { latestReading: BASELINE - 5000 };
    const table: { over: Partial<AlarmInput>; expected: string }[] = [
      { over: { ...belowBaseline, intervalKm: 0 }, expected: 'noInterval' },
      {
        over: { ...belowBaseline, latestReading: null, latestReadingDate: null },
        expected: 'noReading',
      },
      {
        over: { ...belowBaseline, baselineCounter: null, baselineDate: null },
        expected: 'noService',
      },
      {
        over: { ...belowBaseline, latestReadingDate: D(SERVICE_DAY) },
        expected: 'readingOlderThanService',
      },
      { over: belowBaseline, expected: 'baselineAboveReading' },
    ];
    for (const { over, expected } of table) {
      expect(run(over).noAlarmReason).toBe(expected);
    }
  });
});

describe('what D4 is NOT about', () => {
  it('a healthy computed cycle still carries NO reason', () => {
    const result = run({ latestReading: BASELINE + 2000 });
    expect(result).toEqual({
      level: 'none',
      remainingKm: 8000,
      sinceServiceKm: 2000,
      noAlarmReason: null,
    });
  });

  it('a legitimate OVERRUN — negative remainingKm — is untouched by D4', () => {
    // The distinction that decides whether this guard is defensive or destructive. A car that has
    // driven PAST its interval has a positive distance and a negative remainder: that is the red
    // alarm working, and it is exactly the shape D4 must never intercept.
    const result = run({ latestReading: BASELINE + 11_000 });
    expect(result).toEqual({
      level: 'red',
      remainingKm: -1000,
      sinceServiceKm: 11_000,
      noAlarmReason: null,
    });
  });

  it('D4 keys on negative sinceServiceKm, never on negative remainingKm', () => {
    // Swept rather than sampled: across a wide span of readings, every refusal must coincide with
    // reading < baseline, and every negative remainder that is NOT a refusal must be a red alarm.
    let refusals = 0;
    let overruns = 0;
    for (let reading = BASELINE - 5000; reading <= BASELINE + 20_000; reading += 250) {
      const result = run({ latestReading: reading });
      if (result.noAlarmReason === 'baselineAboveReading') {
        refusals += 1;
        expect(reading).toBeLessThan(BASELINE);
        expect(result.remainingKm).toBeNull();
        expect(result.sinceServiceKm).toBeNull();
        continue;
      }
      expect(result.noAlarmReason).toBeNull();
      expect(result.sinceServiceKm).toBeGreaterThanOrEqual(0);
      if ((result.remainingKm ?? 0) < 0) {
        overruns += 1;
        expect(result.level).toBe('red');
      }
    }
    expect(refusals).toBeGreaterThan(0);
    expect(overruns).toBeGreaterThan(0);
  });

  it('thresholds and arithmetic are untouched for every comparable pair', () => {
    // yellow/red boundaries, restated independently of the module, over the whole eligible range.
    for (let reading = BASELINE; reading <= BASELINE + 20_000; reading += 100) {
      const result = run({ latestReading: reading });
      const since = reading - BASELINE;
      const remaining = 10_000 - since;
      expect(result.sinceServiceKm).toBe(since);
      expect(result.remainingKm).toBe(remaining);
      expect(result.level).toBe(remaining <= 300 ? 'red' : remaining <= 1000 ? 'yellow' : 'none');
    }
  });
});

describe('the car-200 shape', () => {
  // The concrete case the diagnosis was opened on: a workshop visit closed on 31 August recording
  // 50,000, while the odometer chain's highest reading is 59,800. The two are not proven to be
  // readings of the same instrument, and nothing in the write path makes them so.
  const car200 = (latestReading: number, latestReadingDate: string): AlarmInput => ({
    intervalKm: 5000,
    yellowKm: 1000,
    redKm: 300,
    latestReading,
    latestReadingDate: D(latestReadingDate),
    baselineCounter: 50_000,
    baselineDate: D('2026-08-31'),
  });

  it('a later eligible reading BELOW the baseline is refused, not shown as −100 km', () => {
    const result = computeAlarm(car200(49_900, '2026-09-02'));
    expect(result.noAlarmReason).toBe('baselineAboveReading');
    expect(result.sinceServiceKm).toBeNull();
    expect(result.sinceServiceKm).not.toBe(-100);
    expect(result.remainingKm).toBeNull();
    expect(result.level).toBe('none');
  });

  it('the extra-digit shape — a baseline far above the chain — is refused too', () => {
    // 599,000 typed for 59,900 at check-out. Before this guard the projection answered
    // `sinceServiceKm: -539,150` with `noAlarmReason: null`: a car reported as measured and
    // healthy, and silent until the chain climbed past the typo.
    const result = computeAlarm({ ...car200(59_850, '2026-09-02'), baselineCounter: 599_000 });
    expect(result).toEqual(REFUSED);
  });

  it('D4 does NOT rescue the case it was diagnosed beside — 59,800 is still above 50,000', () => {
    // Honesty about the limit: the pair that started all this is comparable in this narrow,
    // arithmetic sense, so the guard says nothing about it. The baseline may still be untrue.
    // Proving the baseline is a provenance question, and it is deliberately out of scope here.
    const today = computeAlarm(car200(59_800, '2026-08-20'));
    expect(today.noAlarmReason).toBe('readingOlderThanService');

    const next = computeAlarm(car200(59_850, '2026-09-02'));
    expect(next.noAlarmReason).toBeNull();
    expect(next.sinceServiceKm).toBe(9850);
    expect(next.level).toBe('red');
  });
});
