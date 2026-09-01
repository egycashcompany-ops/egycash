// `noAlarmReason` — the guard that stopped the calculation, named.
//
// `level: 'none'` is five different situations wearing one word: a cycle measured and found
// healthy, and four separate reasons a cycle could not be measured at all. Everything downstream
// showed them identically, so a reader could not tell "this car is fine" from "this car's type
// has no service interval", nor know what to go and fix.
//
// The reason is reported from INSIDE the guards, because they are the only thing that knows which
// one returned. What this file proves is that the label never drifts from the guard: not on the
// happy paths, and above all not where SEVERAL conditions are true at once — the case where a
// plausible-looking reason is most likely to be the wrong one.
import { describe, expect, it } from 'vitest';
import { computeAlarm, type AlarmInput } from './maintenance-alarm';

const D = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const YELLOW = 1000;
const RED = 300;

const SERVICE_DAY = '2026-06-10';
const BASELINE = 100_000;

/** The axes that decide which guard fires. Every combination of them is exercised below. */
const INTERVALS = [
  { label: 'no interval', intervalKm: 0 },
  { label: 'interval 10,000', intervalKm: 10_000 },
] as const;

const READINGS = [
  { label: 'no reading', latestReading: null, latestReadingDate: null },
  { label: 'reading BEFORE the service', latestReading: 104_000, latestReadingDate: D('2026-06-01') },
  { label: 'reading ON the service day', latestReading: 104_000, latestReadingDate: D(SERVICE_DAY) },
  { label: 'reading AFTER the service', latestReading: 104_000, latestReadingDate: D('2026-06-20') },
] as const;

const BASELINES = [
  { label: 'no service', baselineCounter: null, baselineDate: null },
  { label: 'service on 10 June', baselineCounter: BASELINE, baselineDate: D(SERVICE_DAY) },
] as const;

/**
 * What SHOULD be reported, written out independently of the implementation: the first true
 * condition in the guards' own order. Deliberately a plain re-statement rather than a call into
 * the module — a test that asked the code what it does could never catch the code being wrong.
 */
const expectedReason = (input: AlarmInput): string | null => {
  if (input.intervalKm <= 0) return 'noInterval';
  if (input.latestReading === null || input.latestReadingDate === null) return 'noReading';
  if (input.baselineCounter === null || input.baselineDate === null) return 'noService';
  if (input.latestReadingDate <= input.baselineDate) return 'readingOlderThanService';
  return null;
};

const CASES = INTERVALS.flatMap((i) =>
  READINGS.flatMap((r) =>
    BASELINES.map((b) => ({
      label: `${i.label} · ${r.label} · ${b.label}`,
      input: { ...i, ...r, ...b, yellowKm: YELLOW, redKm: RED } as AlarmInput,
    })),
  ),
);

describe('every combination reports the guard that actually fired', () => {
  it('covers all 16 of them', () => {
    expect(CASES).toHaveLength(INTERVALS.length * READINGS.length * BASELINES.length);
    expect(CASES).toHaveLength(16);
  });

  for (const { label, input } of CASES) {
    it(label, () => {
      const result = computeAlarm(input);
      const expected = expectedReason(input);
      expect(result.noAlarmReason).toBe(expected);

      // And the reason agrees with the FIGURES, in both directions: a stated reason means no
      // numbers, and no reason means the numbers are there. Neither can be true alone.
      if (expected === null) {
        expect(result.sinceServiceKm).not.toBeNull();
        expect(result.remainingKm).not.toBeNull();
      } else {
        expect(result.level).toBe('none');
        expect(result.sinceServiceKm).toBeNull();
        expect(result.remainingKm).toBeNull();
      }
    });
  }
});

describe('the specific traps, named', () => {
  const run = (over: Partial<AlarmInput>) =>
    computeAlarm({
      intervalKm: 10_000,
      yellowKm: YELLOW,
      redKm: RED,
      latestReading: 104_000,
      latestReadingDate: D('2026-06-20'),
      baselineCounter: BASELINE,
      baselineDate: D(SERVICE_DAY),
      ...over,
    });

  it('interval 0 WITH a service present ⇒ noInterval, never readingOlderThanService', () => {
    // The trap: the service exists, so `lastServiceAt` on the DTO is set, and a client guessing
    // from that alone would announce the wrong cause. The interval stopped it first.
    expect(run({ intervalKm: 0, latestReadingDate: D('2026-06-01') }).noAlarmReason).toBe(
      'noInterval',
    );
  });

  it('interval 0 WITHOUT a service ⇒ still noInterval', () => {
    expect(
      run({ intervalKm: 0, baselineCounter: null, baselineDate: null }).noAlarmReason,
    ).toBe('noInterval');
  });

  it('no reading AND no service ⇒ noReading — the earlier guard wins', () => {
    expect(
      run({
        latestReading: null,
        latestReadingDate: null,
        baselineCounter: null,
        baselineDate: null,
      }).noAlarmReason,
    ).toBe('noReading');
  });

  it('no reading WITH a valid service ⇒ noReading', () => {
    expect(run({ latestReading: null, latestReadingDate: null }).noAlarmReason).toBe('noReading');
  });

  it('no service with ANY reading ⇒ noService', () => {
    for (const date of ['2026-06-01', SERVICE_DAY, '2026-06-20']) {
      expect(
        run({ latestReadingDate: D(date), baselineCounter: null, baselineDate: null })
          .noAlarmReason,
      ).toBe('noService');
    }
  });

  it('the service day itself counts as NOT newer — the guard is `<=`', () => {
    expect(run({ latestReadingDate: D(SERVICE_DAY) }).noAlarmReason).toBe(
      'readingOlderThanService',
    );
  });

  it('readingOlderThanService can NEVER appear without both a reading and a service', () => {
    // It is the only reason that presupposes the two guards before it passed. If it can be
    // produced without them, the order has been broken.
    for (const { input } of CASES) {
      if (computeAlarm(input).noAlarmReason !== 'readingOlderThanService') continue;
      expect(input.latestReading).not.toBeNull();
      expect(input.latestReadingDate).not.toBeNull();
      expect(input.baselineCounter).not.toBeNull();
      expect(input.baselineDate).not.toBeNull();
      expect(input.intervalKm).toBeGreaterThan(0);
    }
  });
});

describe('a computed answer carries NO reason — including a healthy one', () => {
  const healthy = (reading: number) =>
    computeAlarm({
      intervalKm: 10_000,
      yellowKm: YELLOW,
      redKm: RED,
      latestReading: reading,
      latestReadingDate: D('2026-06-20'),
      baselineCounter: BASELINE,
      baselineDate: D(SERVICE_DAY),
    });

  it('a healthy car is `none` with FIGURES and no reason — not a missing answer', () => {
    // The distinction the whole change exists for: this `none` was measured.
    const result = healthy(102_000);
    expect(result.level).toBe('none');
    expect(result.sinceServiceKm).toBe(2000);
    expect(result.remainingKm).toBe(8000);
    expect(result.noAlarmReason).toBeNull();
  });

  it('and neither yellow nor red carries one', () => {
    expect(healthy(109_400).level).toBe('yellow');
    expect(healthy(109_400).noAlarmReason).toBeNull();
    expect(healthy(109_800).level).toBe('red');
    expect(healthy(109_800).noAlarmReason).toBeNull();
  });
});
