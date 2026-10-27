// The settlement pages' and papers' days, times and stamps
// (docs/12-planning/atm-settlements-phase1.md §9.3, §10.4).
import { describe, expect, it } from 'vitest';
import * as operationView from './operation-view';
import {
  cairoDay,
  cairoToday,
  cairoTomorrow,
  formatPaperDate,
  formatPaperTimestamp,
  formatTime12,
  nextDay,
  runCompact,
} from './settlement-dates';

describe('the Cairo day', () => {
  it('is the boards’ own, re-exported rather than redeclared', () => {
    expect(cairoDay).toBe(operationView.cairoDay);
    expect(cairoToday).toBe(operationView.cairoToday);
  });

  it('tomorrow crosses Cairo midnight, not UTC midnight', () => {
    // Cairo keeps summer time (UTC+3) until the last Thursday of October: 23:30 UTC on the 26th is
    // already 02:30 on the 27th there, so tomorrow is the 28th.
    expect(cairoTomorrow(new Date('2026-10-26T23:30:00Z'))).toBe('2026-10-28');
    // 20:00 UTC on the 26th is 23:00, still the 26th in Cairo: tomorrow is the 27th.
    expect(cairoTomorrow(new Date('2026-10-26T20:00:00Z'))).toBe('2026-10-27');
  });

  it('the next day rolls over months and years, leap day included', () => {
    expect(nextDay('2026-10-31')).toBe('2026-11-01');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
    expect(nextDay('2028-02-28')).toBe('2028-02-29');
    expect(() => nextDay('31/12/2026')).toThrow(RangeError);
  });
});

describe('the papers’ formats', () => {
  it('a date prints d/m/yyyy, Western digits, no padding', () => {
    expect(formatPaperDate('2026-10-27')).toBe('27/10/2026');
    expect(formatPaperDate('2026-03-05')).toBe('5/3/2026');
  });

  it('the Note’s stamp prints m/d/yy h:mm:ss on the Cairo clock (24-hour)', () => {
    expect(formatPaperTimestamp('2026-01-05T18:03:09Z')).toBe('1/5/26 20:03:09');
    expect(formatPaperTimestamp(new Date('2026-01-05T22:00:00Z'))).toBe('1/6/26 0:00:00');
  });

  it('a time prints on the 12-hour clock, ص / م in Arabic and AM / PM in English', () => {
    expect(formatTime12('21:00', 'ar')).toBe('9:00 م');
    expect(formatTime12('21:00', 'en')).toBe('9:00 PM');
    expect(formatTime12('09:30', 'ar')).toBe('9:30 ص');
    expect(formatTime12('00:15', 'en')).toBe('12:15 AM');
    expect(formatTime12('12:00', 'ar')).toBe('12:00 م');
    expect(formatTime12(null, 'ar')).toBe('');
    expect(formatTime12('9:00', 'ar')).toBe('');
  });

  it('the compact run fits the seals sheet’s narrow column', () => {
    expect(runCompact(2, '21:00')).toBe('2 · 9:00 م');
    expect(runCompact(1, '08:00', 'en')).toBe('1 · 8:00 AM');
    expect(runCompact(3, null)).toBe('3');
  });
});
