import { describe, expect, it } from 'vitest';
import {
  addDays,
  cairoCalendarDate,
  calendarDaysInclusive,
  dateOnlyIso,
  isoWeekday,
  leaveYearOf,
  toDateOnly,
} from './business-date';

describe('business-date (Cairo calendar, R10)', () => {
  it('maps a late-UTC instant to the NEXT Cairo calendar date', () => {
    // 23:30 UTC = 01:30 (+2) or 02:30 (+3) in Cairo — always the next day there.
    expect(dateOnlyIso(cairoCalendarDate(new Date('2026-01-15T23:30:00Z')))).toBe('2026-01-16');
    expect(dateOnlyIso(cairoCalendarDate(new Date('2026-01-15T12:00:00Z')))).toBe('2026-01-15');
  });

  it('normalizes datetimes to UTC-midnight date-only values', () => {
    expect(toDateOnly(new Date('2026-07-24T15:45:11Z')).toISOString()).toBe('2026-07-24T00:00:00.000Z');
  });

  it('computes ISO weekdays from date-only values (Fri=5, Sat=6)', () => {
    expect(isoWeekday(new Date('2026-07-24T00:00:00Z'))).toBe(5); // Friday
    expect(isoWeekday(new Date('2026-07-26T00:00:00Z'))).toBe(7); // Sunday
  });

  it('counts inclusive calendar spans and adds days', () => {
    const start = new Date('2026-12-30T00:00:00Z');
    expect(calendarDaysInclusive(start, addDays(start, 3))).toBe(4);
    expect(leaveYearOf(addDays(start, 3))).toBe(2027);
  });
});
