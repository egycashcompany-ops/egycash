// Which counter of the baseline visit the alarm measures from — the choice, and R3.
//
// Pure: the bounds arrive already cut by the caller (`computeAlarms` asks the chain BEFORE each
// counter's own day, R4), and the rule handed in is the real `computeAlarm`. So every case here is
// the arithmetic the board will show, not a restatement of it.
import { describe, expect, it } from 'vitest';
import { computeAlarm } from './maintenance-alarm';
import { measureFromVisit, type AlarmCommon, type VisitCounters } from './measure-from-visit';

const D = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const iso = (day: string): string => D(day).toISOString();

const IN = '2026-10-06';
const OUT = '2026-10-15';

const common: AlarmCommon = {
  intervalKm: 5000,
  yellowKm: 1000,
  redKm: 300,
  latestReading: 25_631,
  latestReadingDate: D('2026-10-20'),
};

/** Car 295: in on 6 October at 22,790. The chain stood at 22,400 the day before. */
const visit = (over: Partial<VisitCounters> = {}): VisitCounters => ({
  visitId: 'visit-295',
  inDate: D(IN),
  outDate: D(OUT),
  entryCounter: 22_790,
  exitCounter: 22_850,
  exitBound: { reading: 22_840, date: D('2026-10-14') },
  entryBound: { reading: 22_400, date: D('2026-10-05') },
  standIn: null,
  ...over,
});

const run = (over: Partial<VisitCounters> = {}, commonOver: Partial<AlarmCommon> = {}) =>
  measureFromVisit(computeAlarm, { ...common, ...commonOver }, visit(over));

describe('the counter used, when nothing contradicts it', () => {
  it('the exit counter comes first — the reading the car drove away on', () => {
    const { result, baseline } = run();
    expect(result.noAlarmReason).toBeNull();
    expect(result.sinceServiceKm).toBe(25_631 - 22_850);
    expect(baseline).toEqual({
      visitId: 'visit-295',
      inDate: iso(IN),
      outDate: iso(OUT),
      entryCounter: 22_790,
      exitCounter: 22_850,
      source: 'exit',
      counter: 22_850,
      counterDate: iso(OUT),
      judgedAgainst: { reading: 22_840, date: iso('2026-10-14') },
      exitSetAside: null,
    });
  });

  it('with no exit counter, the entry counter — judged against its own day’s bound', () => {
    const { result, baseline } = run({ exitCounter: null });
    expect(result.sinceServiceKm).toBe(2841);
    expect(baseline).toMatchObject({
      source: 'entry',
      counter: 22_790,
      counterDate: iso(IN),
      judgedAgainst: { reading: 22_400, date: iso('2026-10-05') },
      exitSetAside: null,
    });
  });

  it('with neither, the reading of the check-out day stands in — judged against nothing', () => {
    const standIn = { reading: 22_860, date: D(OUT) };
    const { result, baseline } = run({ entryCounter: null, exitCounter: null, standIn });
    expect(result.sinceServiceKm).toBe(25_631 - 22_860);
    // It IS the chain: comparing it with itself proves nothing, so no judged-against point.
    expect(baseline).toMatchObject({
      source: 'reading',
      counter: 22_860,
      counterDate: iso(OUT),
      judgedAgainst: null,
      exitSetAside: null,
      entryCounter: null,
      exitCounter: null,
    });
  });

  it('with neither and no reading to stand in, there is nothing to measure from', () => {
    const { result, baseline } = run({ entryCounter: null, exitCounter: null, standIn: null });
    expect(result.noAlarmReason).toBe('noService');
    expect(baseline).toMatchObject({ source: 'reading', counter: null, judgedAgainst: null });
  });

  it('no visit at all: the rule answers on its own, and there are no facts', () => {
    expect(measureFromVisit(computeAlarm, common, null)).toEqual({
      result: {
        level: 'none',
        remainingKm: null,
        sinceServiceKm: null,
        noAlarmReason: 'noService',
      },
      baseline: null,
    });
  });
});

describe('R3 — an exit counter a reading contradicts gives way to the entry counter', () => {
  it('exit BELOW the chain, entry good ⇒ measured from the entry, the exit set aside', () => {
    // Late closure: out on the 15th at 22,795, with 23,500 typed in for the 10th afterwards.
    const late = { reading: 23_500, date: D('2026-10-10') };
    const { result, baseline } = run({ exitCounter: 22_795, exitBound: late });
    expect(result.noAlarmReason).toBeNull();
    expect(result.sinceServiceKm).toBe(2841);
    expect(baseline).toMatchObject({
      source: 'entry',
      counter: 22_790,
      counterDate: iso(IN),
      judgedAgainst: { reading: 22_400, date: iso('2026-10-05') },
      exitCounter: 22_795,
      exitSetAside: {
        because: 'belowChain',
        conflict: { reading: 23_500, date: iso('2026-10-10') },
      },
    });
  });

  it('exit ABOVE the latest reading, entry good ⇒ measured from the entry', () => {
    // A typo: 28,790 for 22,790.
    const { result, baseline } = run({ exitCounter: 28_790 });
    expect(result.noAlarmReason).toBeNull();
    expect(result.sinceServiceKm).toBe(2841);
    expect(baseline?.source).toBe('entry');
    expect(baseline?.exitSetAside).toEqual({
      because: 'aboveReading',
      conflict: { reading: 25_631, date: iso('2026-10-20') },
    });
  });

  it('BOTH contradicted ⇒ the exit counter’s own refusal stands, nothing set aside', () => {
    const late = { reading: 23_500, date: D('2026-10-10') };
    const { result, baseline } = run({
      exitCounter: 22_795,
      exitBound: late,
      entryBound: { reading: 22_900, date: D('2026-10-05') },
    });
    expect(result.noAlarmReason).toBe('baselineBelowChain');
    expect(result.sinceServiceKm).toBeNull();
    expect(baseline).toMatchObject({
      source: 'exit',
      counter: 22_795,
      judgedAgainst: { reading: 23_500 },
      exitSetAside: null,
    });
  });

  it('an entry counter above the latest reading is no way out either', () => {
    const { result, baseline } = run(
      { exitCounter: 28_790, entryCounter: 26_000 },
      { latestReading: 25_631 },
    );
    expect(result.noAlarmReason).toBe('baselineAboveReading');
    expect(baseline?.source).toBe('exit');
    expect(baseline?.exitSetAside).toBeNull();
  });

  it('a contradicted exit counter with NO entry counter keeps its refusal', () => {
    const { result, baseline } = run({ entryCounter: null, exitCounter: 28_790 });
    expect(result.noAlarmReason).toBe('baselineAboveReading');
    expect(baseline).toMatchObject({ source: 'exit', exitSetAside: null });
  });

  it('an entry counter contradicted on its own has nothing to fall back to', () => {
    const { result, baseline } = run({
      exitCounter: null,
      entryBound: { reading: 22_900, date: D('2026-10-05') },
    });
    expect(result.noAlarmReason).toBe('baselineBelowChain');
    expect(baseline).toMatchObject({ source: 'entry', exitSetAside: null });
  });

  it('only the two contradictions open R3 — a stale latest reading does not', () => {
    // The exit counter is fine; the newest reading simply predates the check-out.
    const { result, baseline } = run(
      {},
      { latestReadingDate: D('2026-10-12'), latestReading: 22_845 },
    );
    expect(result.noAlarmReason).toBe('readingOlderThanService');
    expect(baseline?.source).toBe('exit');
  });

  it('the entry counter’s answer is taken as it is — waiting for a reading included', () => {
    // The exit counter is contradicted and the entry one is not; the newest reading predates the
    // check-out, so the honest answer is «wait for a reading», measured from the entry counter.
    const late = { reading: 23_500, date: D('2026-10-10') };
    const { result, baseline } = run(
      { exitCounter: 22_795, exitBound: late },
      { latestReading: 23_500, latestReadingDate: D('2026-10-10') },
    );
    expect(result.noAlarmReason).toBe('readingOlderThanService');
    expect(baseline?.source).toBe('entry');
    expect(baseline?.exitSetAside?.because).toBe('belowChain');
  });

  it('the cycle starts on the check-out day whichever counter is used', () => {
    // A reading between check-in and check-out stays «older than the service» under R3 too.
    const late = { reading: 23_500, date: D('2026-10-10') };
    const fromEntry = run({ exitCounter: 22_795, exitBound: late });
    expect(fromEntry.baseline?.outDate).toBe(iso(OUT));
  });
});

describe('what R3 never does', () => {
  it('it never measures from a chain reading in place of a workshop counter', () => {
    const late = { reading: 23_500, date: D('2026-10-10') };
    const { baseline } = run({ exitCounter: 22_795, exitBound: late });
    expect([baseline?.entryCounter, baseline?.exitCounter]).toContain(baseline?.counter);
  });

  it('and whatever it measures from, the figure is latest − that counter', () => {
    for (const over of [
      {},
      { exitCounter: null },
      { exitCounter: 28_790 },
      { exitCounter: 22_795, exitBound: { reading: 23_500, date: D('2026-10-10') } },
    ]) {
      const { result, baseline } = run(over);
      expect(result.sinceServiceKm, JSON.stringify(over)).toBe(25_631 - (baseline?.counter ?? 0));
    }
  });
});
