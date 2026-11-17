// The read-time resolution, pinned at every boundary it has.
//
// This function exists because of one operational fact: the branch servers recompute only the
// employees who scanned, so a no-show's row is written at most once and then left alone until the
// nightly pass — and very often there is no row at all. Every case below is a shape that really
// occurs on this deployment, not a hypothetical.
import { describe, expect, it } from 'vitest';
import { resolveDisplayStatus } from './resolve-display-status';

const TODAY = new Date(Date.UTC(2026, 10, 17)); // 2026-11-17, Cairo standard time (UTC+2)
const YESTERDAY = new Date(Date.UTC(2026, 10, 16));
const TOMORROW = new Date(Date.UTC(2026, 10, 18));

/** 17:00 Cairo on the 17th = 15:00 UTC. */
const EXPECTED_END = new Date(Date.UTC(2026, 10, 17, 15, 0));
const MORNING = new Date(Date.UTC(2026, 10, 17, 8, 0)); // 10:00 Cairo
const EVENING = new Date(Date.UTC(2026, 10, 17, 17, 0)); // 19:00 Cairo

const resolve = (over: Partial<Parameters<typeof resolveDisplayStatus>[0]> = {}) =>
  resolveDisplayStatus({
    stored: null,
    workDate: TODAY,
    today: TODAY,
    expectedEnd: EXPECTED_END,
    calendar: 'working',
    now: MORNING,
    ...over,
  });

describe('today, which is the whole reason this function exists', () => {
  it('shows «لم يحضر بعد» before the expected end and «غائب» after it, with NO row at all', () => {
    // Nobody has written anything for this person, and nothing is written by looking: this is how
    // 1,300 employees per branch appear on a sheet for a date that is not over.
    expect(resolve({ stored: null, now: MORNING })).toBe('pending');
    expect(resolve({ stored: null, now: EVENING })).toBe('absent');
  });

  it('reads a row the branch left at `pending` the same way', () => {
    expect(resolve({ stored: 'pending', now: MORNING })).toBe('pending');
    expect(resolve({ stored: 'pending', now: EVENING })).toBe('absent');
  });

  it('reads back an `absent` stored earlier TODAY as pending — the clock, not the row, decides', () => {
    // A row written at 08:00 by an older build, or by a recompute that ran before the expectation
    // was set, says `absent` for somebody who is simply not in yet. The stored value is not the
    // authority for a date still being lived.
    expect(resolve({ stored: 'absent', now: MORNING })).toBe('pending');
    expect(resolve({ stored: 'absent', now: EVENING })).toBe('absent');
  });

  it('turns over exactly at the expected end', () => {
    expect(resolve({ now: new Date(EXPECTED_END.getTime() - 1) })).toBe('pending');
    expect(resolve({ now: EXPECTED_END })).toBe('absent');
  });

  it('is a day off when nobody said when this person was due', () => {
    // No assignment and no branch pattern. An empty day is then not a failure to attend — it is a
    // day the company never claimed, which is the same answer the engine gives for the same reason.
    expect(resolve({ expectedEnd: null, now: MORNING })).toBe('dayOff');
    expect(resolve({ expectedEnd: null, now: EVENING })).toBe('dayOff');
    expect(resolve({ expectedEnd: null, stored: 'pending' })).toBe('dayOff');
  });
});

describe('a settled row answers for itself, whatever the clock says', () => {
  // Every status but `pending` and `absent` is a conclusion drawn from evidence, and evidence does
  // not change as the afternoon wears on. This also means no expectation has to be looked up for
  // these rows — which is what keeps a month of history cheap to read.
  const settled = [
    'present',
    'checkedIn',
    'late',
    'earlyLeave',
    'lateAndEarly',
    'onLeave',
    'weekend',
    'holiday',
    'incomplete',
    'dayOff',
  ] as const;

  it.each(settled)('%s is returned untouched, today and in the past', (status) => {
    expect(resolve({ stored: status, now: MORNING })).toBe(status);
    expect(resolve({ stored: status, now: EVENING })).toBe(status);
    expect(resolve({ stored: status, workDate: YESTERDAY, expectedEnd: null })).toBe(status);
  });

  it('does not need an expectation to return one', () => {
    expect(resolve({ stored: 'present', expectedEnd: null })).toBe('present');
  });
});

describe('a date that has passed', () => {
  it('reads a stale `pending` as the absence it turned out to be', () => {
    // THE CASE THE OWNER CAUGHT. A branch recompute in the afternoon leaves the row at `pending`,
    // nothing rewrites it until 2 AM, and in between the sheet must not keep claiming the person
    // might still arrive on a day that has ended.
    expect(resolve({ stored: 'pending', workDate: YESTERDAY, expectedEnd: null })).toBe('absent');
  });

  it('needs no expectation to say so — the day ended, and that is the whole argument', () => {
    // Deliberate: resolving a month of history must not cost an assignment lookup per row.
    expect(resolve({ stored: 'pending', workDate: YESTERDAY, expectedEnd: null, now: MORNING })).toBe(
      'absent',
    );
    expect(resolve({ stored: 'absent', workDate: YESTERDAY, expectedEnd: null })).toBe('absent');
  });

  it('does NOT invent an absence where the engine wrote no row', () => {
    // No row on a past date means the engine never concluded that day for that person — most often
    // because they were not employed on it, which is exactly when `deriveDay` returns no row.
    // `null` means "leave this line out", not "absent".
    expect(resolve({ stored: null, workDate: YESTERDAY, expectedEnd: null })).toBeNull();
    expect(resolve({ stored: null, workDate: YESTERDAY, expectedEnd: EXPECTED_END })).toBeNull();
  });
});

describe('the calendar speaks before absence does', () => {
  // Without this the whole company reads «لم يحضر بعد» every Friday morning and «غائب» every
  // Friday evening — 1,300 fabricated absences a week, on the screen a supervisor trusts.
  it('says weekend or holiday for a line with no row, whatever the clock says', () => {
    for (const calendar of ['weekend', 'holiday'] as const) {
      expect(resolve({ calendar, stored: null, now: MORNING })).toBe(calendar);
      expect(resolve({ calendar, stored: null, now: EVENING })).toBe(calendar);
      expect(resolve({ calendar, stored: null, expectedEnd: null })).toBe(calendar);
    }
  });

  it('corrects a `pending` or `absent` row written before the calendar said so', () => {
    // The engine would write `weekend` for this day today; a row that predates the calendar change
    // must not keep claiming an absence the next recompute would erase.
    expect(resolve({ calendar: 'weekend', stored: 'pending' })).toBe('weekend');
    expect(resolve({ calendar: 'holiday', stored: 'absent', workDate: YESTERDAY })).toBe('holiday');
  });

  it('does NOT overrule a day somebody actually worked', () => {
    // A present or late row on a public holiday is the truth about that person's day, and the
    // settled-row rule runs first precisely so the calendar cannot talk over it.
    expect(resolve({ calendar: 'holiday', stored: 'present' })).toBe('present');
    expect(resolve({ calendar: 'weekend', stored: 'checkedIn' })).toBe('checkedIn');
    expect(resolve({ calendar: 'holiday', stored: 'onLeave' })).toBe('onLeave');
  });

  it('still omits a past date the engine never concluded, holiday or not', () => {
    // No row and not employed then: there is no day here to label at all.
    expect(resolve({ calendar: 'holiday', stored: null, workDate: YESTERDAY })).toBeNull();
  });
});

describe('a date in the future', () => {
  it('is not yet in, because nothing has happened and the end is still ahead', () => {
    expect(resolve({ workDate: TOMORROW, stored: null })).toBe('pending');
  });

  it('still lets the calendar speak — a weekend written ahead stays a weekend', () => {
    expect(resolve({ workDate: TOMORROW, stored: 'weekend' })).toBe('weekend');
  });
});
