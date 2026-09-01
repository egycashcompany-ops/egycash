// The odometer bracket, applied to the BASELINE itself.
//
// `exitOdometer` is the number every later maintenance calculation measures from, and until now
// nothing had ever compared it with the odometer chain — different collections, different
// endpoints, no shared transaction, no reference. The bracket is the one comparison that needs no
// new data: a counter measured on the day the car left the workshop cannot be lower than a
// reading the chain already held BY that day, because an odometer does not run backwards.
//
// So this guard says one thing only: these two numbers are not on the same sequence. It does NOT
// say which of them is untrue — the workshop's counter remains the authoritative record of what
// the workshop measured, and nothing here replaces it with a chain reading.
import { describe, expect, it } from 'vitest';
import { computeAlarm, type AlarmInput } from './maintenance-alarm';

const D = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const SERVICE_DAY = '2026-06-10';
const AFTER = '2026-06-20';
const EXIT = 100_000;

const base: AlarmInput = {
  intervalKm: 10_000,
  yellowKm: 1000,
  redKm: 300,
  latestReading: EXIT + 2000,
  latestReadingDate: D(AFTER),
  baselineCounter: EXIT,
  baselineDate: D(SERVICE_DAY),
  baselineLowerBound: null,
};

const run = (over: Partial<AlarmInput> = {}) => computeAlarm({ ...base, ...over });

const REFUSED = {
  level: 'none',
  remainingKm: null,
  sinceServiceKm: null,
  noAlarmReason: 'baselineBelowChain',
} as const;

describe('the lower bound, and the boundary around it', () => {
  it('a baseline BELOW the reading the chain already held ⇒ refused, with no figures', () => {
    expect(run({ baselineLowerBound: EXIT + 1 })).toEqual(REFUSED);
    expect(run({ baselineLowerBound: 999_999 })).toEqual(REFUSED);
  });

  it('a baseline EQUAL to it ⇒ the arithmetic runs — the comparison is `<`, not `<=`', () => {
    // The car was read at X on its way in and left on X: it did not move in the workshop. That is
    // the ORDINARY case on a service day, and refusing it would turn "the car sat still" into a
    // data-integrity alarm.
    const result = run({ baselineLowerBound: EXIT });
    expect(result.noAlarmReason).toBeNull();
    expect(result.sinceServiceKm).toBe(2000);
  });

  it('a baseline ABOVE it ⇒ the arithmetic runs, unchanged', () => {
    expect(run({ baselineLowerBound: EXIT - 1 }).noAlarmReason).toBeNull();
    expect(run({ baselineLowerBound: 1 }).sinceServiceKm).toBe(2000);
  });

  it('the three points around the boundary, in order', () => {
    expect(run({ baselineLowerBound: EXIT + 1 }).noAlarmReason).toBe('baselineBelowChain');
    expect(run({ baselineLowerBound: EXIT }).noAlarmReason).toBeNull();
    expect(run({ baselineLowerBound: EXIT - 1 }).noAlarmReason).toBeNull();
  });

  it('NO lower bound ⇒ nothing to contradict, however the numbers fall', () => {
    // A car whose chain holds nothing from before its service has no bound. Absence is not a
    // violation, and inventing one from the other side would be inventing data.
    expect(run({ baselineLowerBound: null }).noAlarmReason).toBeNull();
    expect(run({ baselineLowerBound: null, baselineCounter: 1 }).noAlarmReason).toBeNull();
  });
});

describe('guard order — the durable problem is named before the temporary one', () => {
  it('an interval, a reading and a service still come first', () => {
    const bad = { baselineLowerBound: 999_999 };
    expect(run({ ...bad, intervalKm: 0 }).noAlarmReason).toBe('noInterval');
    expect(run({ ...bad, latestReading: null, latestReadingDate: null }).noAlarmReason).toBe(
      'noReading',
    );
    expect(run({ ...bad, baselineCounter: null, baselineDate: null }).noAlarmReason).toBe(
      'noService',
    );
  });

  it('but it BEATS readingOlderThanService when both hold', () => {
    // Both are true here: the baseline is unusable AND the newest reading predates the service.
    // Reporting "waiting for a reading after the service" would send an operator to record one —
    // and it would be subtracted from the same unusable baseline. The durable fault wins.
    const result = run({
      baselineLowerBound: 999_999,
      latestReadingDate: D('2026-06-01'),
    });
    expect(result.noAlarmReason).toBe('baselineBelowChain');
  });

  it('and it beats baselineAboveReading too — the cause, before the symptom', () => {
    // A baseline above every reading is also below a reading the chain already held: one broken
    // pair, two ways of noticing. The bracket names WHY, so it answers first.
    const result = run({
      baselineCounter: 900_000,
      baselineLowerBound: 999_999,
      latestReading: 120_000,
    });
    expect(result.noAlarmReason).toBe('baselineBelowChain');
  });

  it('with no lower bound, the upper-side guard still catches the negative distance', () => {
    // Proof the two are separate refusals rather than one written twice: remove the bound the
    // bracket needs, and D4 is still there.
    const result = run({ baselineCounter: 900_000, baselineLowerBound: null });
    expect(result.noAlarmReason).toBe('baselineAboveReading');
  });

  it('a healthy cycle still carries no reason at all', () => {
    expect(run({ baselineLowerBound: EXIT - 500 })).toEqual({
      level: 'none',
      remainingKm: 8000,
      sinceServiceKm: 2000,
      noAlarmReason: null,
    });
  });
});

describe('the same-day rule, DERIVED from the bracket rather than chosen', () => {
  // A reading dated exactly on `outDate` satisfies `date <= outDate`, so it belongs to the
  // bracket's LOWER bound. The invariant therefore requires `exitOdometer >= it` — which means
  // every same-day reading the invariant PERMITS yields `reading - baseline <= 0`.
  //
  // A same-day reading can therefore never describe positive distance since the service. It is,
  // by the invariant's own classification, evidence about the cycle BEFORE it. That is why
  // `latestReadingDate <= baselineDate` stays as it is: `<` would admit only readings whose
  // contribution is zero or negative, replacing an honest "waiting for a reading after the
  // service" with a measured nothing.
  const sameDay = (reading: number) =>
    run({
      latestReading: reading,
      latestReadingDate: D(SERVICE_DAY),
      baselineLowerBound: reading,
    });

  it('every same-day reading the invariant permits sits at or below the baseline', () => {
    for (const reading of [EXIT - 5000, EXIT - 1, EXIT]) {
      expect(reading, 'permitted by the bracket').toBeLessThanOrEqual(EXIT);
      expect(reading - EXIT, 'so its contribution cannot be positive').toBeLessThanOrEqual(0);
    }
  });

  it('and each is answered `readingOlderThanService`, not a measured zero', () => {
    for (const reading of [EXIT - 5000, EXIT - 1, EXIT]) {
      expect(sameDay(reading).noAlarmReason, String(reading)).toBe('readingOlderThanService');
      expect(sameDay(reading).sinceServiceKm).toBeNull();
    }
  });

  it('a same-day reading ABOVE the baseline is exactly what the bracket forbids', () => {
    // The only way a same-day reading could contribute a positive distance is by violating the
    // lower bound — so it is caught as a data fault, not admitted as a cycle.
    expect(sameDay(EXIT + 5000).noAlarmReason).toBe('baselineBelowChain');
  });

  it('the day AFTER is where a real cycle begins', () => {
    const result = run({
      latestReading: EXIT + 300,
      latestReadingDate: D('2026-06-11'),
      baselineLowerBound: EXIT,
    });
    expect(result.noAlarmReason).toBeNull();
    expect(result.sinceServiceKm).toBe(300);
  });
});

describe('car 200 — a fixture, and an honest one', () => {
  // The visit records 50,000 on 31 August. The chain holds a reading of 50,000 from before that
  // day and one of 59,800 dated 20 August. Nothing in the system establishes which instrument
  // either number came from, and this file does not claim to know: it pins what the SYSTEM does.
  const car200 = (over: Partial<AlarmInput> = {}): AlarmInput => ({
    intervalKm: 5000,
    yellowKm: 1000,
    redKm: 300,
    latestReading: 59_800,
    latestReadingDate: D('2026-08-20'),
    baselineCounter: 50_000,
    baselineDate: D('2026-08-31'),
    // On 31 August the chain already stood at 59,800 — recorded on the 20th, eleven days before.
    baselineLowerBound: 59_800,
    ...over,
  });

  it('the baseline is refused, because the chain had already passed it by that date', () => {
    expect(computeAlarm(car200())).toEqual(REFUSED);
  });

  it('the FIRST post-service reading no longer flips it to a false red', () => {
    // This is the harm the guard exists for. Before it, the first reading dated after 31 August
    // produced `since = 9,850` on a 5,000 km interval — instantly red, on distance that was not
    // driven since the service. Now the pair is refused instead of measured.
    const next = computeAlarm(
      car200({ latestReading: 59_850, latestReadingDate: D('2026-09-02') }),
    );
    expect(next.noAlarmReason).toBe('baselineBelowChain');
    expect(next.level).toBe('none');
    expect(next.sinceServiceKm).toBeNull();
    expect(next.sinceServiceKm).not.toBe(9850);
  });

  it('a reading ON the close date is refused for the same reason, not as a measured zero', () => {
    const sameDay = computeAlarm(car200({ latestReadingDate: D('2026-08-31') }));
    expect(sameDay.noAlarmReason).toBe('baselineBelowChain');
  });

  it('the PRIOR 50,000 reading is not, on its own, evidence of anything', () => {
    // Had the chain held only 50,000 by 31 August, the bracket would be satisfied and the pair
    // would compare — 50,000 against 50,000 is a car that did not move, which is a real state.
    // The refusal above comes from the 59,800, not from the 50,000.
    const onlyPrior = computeAlarm(car200({ baselineLowerBound: 50_000, latestReading: 50_000 }));
    expect(onlyPrior.noAlarmReason).toBe('readingOlderThanService');
    const later = computeAlarm(
      car200({
        baselineLowerBound: 50_000,
        latestReading: 50_400,
        latestReadingDate: D('2026-09-02'),
      }),
    );
    expect(later.noAlarmReason).toBeNull();
    expect(later.sinceServiceKm).toBe(400);
  });

  it('and nothing here decides whether 50,000 was right — only that it does not compare', () => {
    // The guard reports a relationship between two numbers. It substitutes neither for the other,
    // and no code path rewrites the stored counter.
    const result = computeAlarm(car200());
    expect(result.sinceServiceKm).toBeNull();
    expect(result.remainingKm).toBeNull();
    expect(result.level).toBe('none');
  });
});
