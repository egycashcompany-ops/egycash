// The Cairo day, pinned: the edges that a UTC server gets wrong (00:00–02:00/03:00 Cairo) and the two
// DST change days, so "today" means the same date to the API, the browser and the tests.
//
// Egypt's DST (since 2023): it starts on the last Friday of April at 00:00 (the clock jumps to 01:00,
// UTC+3) and ends on the last Thursday of October at 24:00 (the clock goes back to 23:00, UTC+2).
// In 2026 those are Friday 24 April and Thursday 29 October.
import { describe, expect, it } from 'vitest';
import {
  CAIRO_TIME_ZONE,
  addDaysYmd,
  cairoCalendarDate,
  cairoDayStart,
  cairoYmd,
  calendarDayBounds,
  daysBetweenYmd,
  isYmd,
  nextCairoMidnight,
  ymdOf,
  ymdToUtcDate,
} from './cairo-date.js';

const at = (iso: string): Date => new Date(iso);

describe('cairoYmd — the Cairo calendar date of an instant', () => {
  it('is already tomorrow in Cairo while UTC is still on today (winter, UTC+2)', () => {
    expect(CAIRO_TIME_ZONE).toBe('Africa/Cairo');
    expect(cairoYmd(at('2026-10-31T22:30:00Z'))).toBe('2026-11-01');
    expect(cairoYmd(at('2026-10-31T21:59:59.999Z'))).toBe('2026-10-31');
    expect(cairoYmd(at('2026-10-31T22:00:00Z'))).toBe('2026-11-01');
  });

  it('turns a day an hour earlier in summer (UTC+3)', () => {
    expect(cairoYmd(at('2026-07-14T20:59:59.999Z'))).toBe('2026-07-14');
    expect(cairoYmd(at('2026-07-14T21:00:00Z'))).toBe('2026-07-15');
  });

  it('crosses a year at Cairo midnight, not at UTC midnight', () => {
    expect(cairoYmd(at('2026-12-31T22:30:00Z'))).toBe('2027-01-01');
    expect(cairoYmd(at('2026-12-31T21:30:00Z'))).toBe('2026-12-31');
  });

  it('on the DST start day (Fri 2026-04-24): 21:30Z is still Thursday, 22:30Z is Friday 01:30', () => {
    // Before the jump the zone is UTC+2: 21:30Z = 23:30 Thursday.
    expect(cairoYmd(at('2026-04-23T21:30:00Z'))).toBe('2026-04-23');
    // 22:00Z is 00:00 UTC+2 — which does not exist; the clock reads 01:00 UTC+3.
    expect(cairoYmd(at('2026-04-23T22:00:00Z'))).toBe('2026-04-24');
    expect(cairoYmd(at('2026-04-23T22:30:00Z'))).toBe('2026-04-24');
    // The evening after: UTC+3 now, so Saturday begins at 21:00Z.
    expect(cairoYmd(at('2026-04-24T20:30:00Z'))).toBe('2026-04-24');
    expect(cairoYmd(at('2026-04-24T21:30:00Z'))).toBe('2026-04-25');
    expect(cairoYmd(at('2026-04-24T22:30:00Z'))).toBe('2026-04-25');
  });

  it('on the DST end day (Thu 2026-10-29): the 25-hour Thursday ends at 22:00Z', () => {
    // Thursday began at 00:00 UTC+3 = 21:00Z the day before.
    expect(cairoYmd(at('2026-10-28T20:30:00Z'))).toBe('2026-10-28');
    expect(cairoYmd(at('2026-10-28T21:30:00Z'))).toBe('2026-10-29');
    // At 21:00Z (24:00 UTC+3) the clock goes back to 23:00 UTC+2: still Thursday for another hour.
    expect(cairoYmd(at('2026-10-29T21:30:00Z'))).toBe('2026-10-29');
    expect(cairoYmd(at('2026-10-29T22:30:00Z'))).toBe('2026-10-30');
  });
});

describe('cairoCalendarDate — the Cairo date, stored the date-only way', () => {
  it('is UTC midnight of the Cairo date (the HR helper it replaces)', () => {
    expect(cairoCalendarDate(at('2026-10-31T22:30:00Z')).toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );
    expect(cairoCalendarDate(at('2026-11-01T12:00:00Z')).toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );
    expect(cairoCalendarDate(at('2026-04-23T22:00:00Z')).toISOString()).toBe(
      '2026-04-24T00:00:00.000Z',
    );
  });

  it('refuses an invalid instant rather than inventing a date', () => {
    expect(() => cairoCalendarDate(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe('cairoDayStart — the instant a Cairo day begins', () => {
  it('is 22:00Z the day before in winter and 21:00Z in summer', () => {
    expect(cairoDayStart('2026-11-01').toISOString()).toBe('2026-10-31T22:00:00.000Z');
    expect(cairoDayStart('2026-07-15').toISOString()).toBe('2026-07-14T21:00:00.000Z');
  });

  it('on the DST start day begins at the jump itself (00:00 does not exist; 01:00 does)', () => {
    expect(cairoDayStart('2026-04-23').toISOString()).toBe('2026-04-22T22:00:00.000Z');
    expect(cairoDayStart('2026-04-24').toISOString()).toBe('2026-04-23T22:00:00.000Z');
    expect(cairoDayStart('2026-04-25').toISOString()).toBe('2026-04-24T21:00:00.000Z');
  });

  it('around the DST end day: Thursday at 21:00Z, Friday at 22:00Z (Thursday lasts 25 hours)', () => {
    expect(cairoDayStart('2026-10-29').toISOString()).toBe('2026-10-28T21:00:00.000Z');
    expect(cairoDayStart('2026-10-30').toISOString()).toBe('2026-10-29T22:00:00.000Z');
    const thursday = cairoDayStart('2026-10-30').getTime() - cairoDayStart('2026-10-29').getTime();
    expect(thursday).toBe(25 * 60 * 60 * 1000);
  });

  it('is the first instant of its day: one millisecond earlier is the day before', () => {
    for (const day of ['2026-04-24', '2026-04-25', '2026-10-29', '2026-10-30', '2026-11-01']) {
      const start = cairoDayStart(day);
      expect(cairoYmd(start), day).toBe(day);
      expect(cairoYmd(new Date(start.getTime() - 1)), day).toBe(addDaysYmd(day, -1));
    }
  });

  it('refuses a day that does not exist', () => {
    expect(() => cairoDayStart('2026-02-30')).toThrow(RangeError);
  });
});

describe('nextCairoMidnight — when "today" next changes', () => {
  it('is the start of the next Cairo day, seen from either side of UTC midnight', () => {
    expect(nextCairoMidnight(at('2026-10-31T21:30:00Z')).toISOString()).toBe(
      '2026-10-31T22:00:00.000Z',
    );
    expect(nextCairoMidnight(at('2026-10-31T22:30:00Z')).toISOString()).toBe(
      '2026-11-01T22:00:00.000Z',
    );
  });

  it('follows the DST start day: Thursday night → the jump; Friday night → 21:00Z', () => {
    expect(nextCairoMidnight(at('2026-04-23T21:30:00Z')).toISOString()).toBe(
      '2026-04-23T22:00:00.000Z',
    );
    expect(nextCairoMidnight(at('2026-04-23T22:30:00Z')).toISOString()).toBe(
      '2026-04-24T21:00:00.000Z',
    );
  });

  it('follows the DST end day: the long Thursday ends at 22:00Z', () => {
    expect(nextCairoMidnight(at('2026-10-29T21:30:00Z')).toISOString()).toBe(
      '2026-10-29T22:00:00.000Z',
    );
    expect(nextCairoMidnight(at('2026-10-29T22:30:00Z')).toISOString()).toBe(
      '2026-10-30T22:00:00.000Z',
    );
  });
});

describe('Ymd arithmetic', () => {
  it('isYmd accepts real calendar dates only', () => {
    expect(isYmd('2026-11-01')).toBe(true);
    expect(isYmd('2028-02-29')).toBe(true);
    expect(isYmd('2026-02-29')).toBe(false);
    expect(isYmd('2026-02-30')).toBe(false);
    expect(isYmd('2026-13-01')).toBe(false);
    expect(isYmd('2026-11-1')).toBe(false);
    expect(isYmd('2026-11-01T00:00:00Z')).toBe(false);
    expect(isYmd('')).toBe(false);
  });

  it('ymdToUtcDate is UTC midnight, and refuses what is not a date', () => {
    expect(ymdToUtcDate('2026-11-01').toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(() => ymdToUtcDate('2026-02-30')).toThrow(RangeError);
    expect(() => ymdToUtcDate('01/11/2026')).toThrow(RangeError);
  });

  it('ymdOf reads the UTC date part of a stored date-only value or ISO string', () => {
    expect(ymdOf('2026-11-01T10:00:00Z')).toBe('2026-11-01');
    expect(ymdOf('2026-11-01T23:59:59.999Z')).toBe('2026-11-01');
    expect(ymdOf('2026-11-01')).toBe('2026-11-01');
    expect(ymdOf(new Date('2026-11-01T00:00:00.000Z'))).toBe('2026-11-01');
    // An instant written with an offset is read in UTC, like every stored value.
    expect(ymdOf('2026-11-01T01:00:00+03:00')).toBe('2026-10-31');
    expect(() => ymdOf('not a date')).toThrow(RangeError);
  });

  it('addDaysYmd crosses months, years and leap days', () => {
    expect(addDaysYmd('2026-11-01', 0)).toBe('2026-11-01');
    expect(addDaysYmd('2026-11-01', -1)).toBe('2026-10-31');
    expect(addDaysYmd('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysYmd('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysYmd('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDaysYmd('2026-11-01', -29)).toBe('2026-10-03');
    // DST never moves a calendar day.
    expect(addDaysYmd('2026-04-23', 1)).toBe('2026-04-24');
    expect(addDaysYmd('2026-10-29', 1)).toBe('2026-10-30');
  });

  it('daysBetweenYmd counts whole days, negative when to comes first', () => {
    expect(daysBetweenYmd('2026-11-01', '2026-11-01')).toBe(0);
    expect(daysBetweenYmd('2026-10-01', '2026-10-31')).toBe(30);
    expect(daysBetweenYmd('2026-11-01', '2026-10-31')).toBe(-1);
    expect(daysBetweenYmd('2028-01-01', '2028-12-31')).toBe(365);
    expect(daysBetweenYmd('2026-04-01', '2026-04-30')).toBe(29);
    expect(daysBetweenYmd('2026-10-01', '2026-11-01')).toBe(31);
  });
});

describe('calendarDayBounds — the first and last instant of the named days (R-02)', () => {
  it('runs from 00:00:00.000Z of `from` to 23:59:59.999Z of `to`', () => {
    const { from, before } = calendarDayBounds('2026-11-01', '2026-11-30');
    expect(from.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(before.toISOString()).toBe('2026-11-30T23:59:59.999Z');
  });

  it('holds an expiry imported at a non-midnight instant on its own day', () => {
    const { from, before } = calendarDayBounds('2026-11-01', '2026-11-01');
    const stamped = new Date('2026-11-01T10:00:00Z').getTime();
    expect(stamped >= from.getTime() && stamped <= before.getTime()).toBe(true);
    // A `before = today 00:00Z` bound would have missed it.
    expect(stamped <= new Date('2026-11-01T00:00:00Z').getTime()).toBe(false);
  });

  it('refuses a day that does not exist', () => {
    expect(() => calendarDayBounds('2026-02-30', '2026-03-01')).toThrow(RangeError);
  });
});
