import { describe, expect, it } from 'vitest';
import { hoursAndMinutes, minutesBetween } from './presence-format';

describe('presence durations', () => {
  it('splits minutes into hours and minutes', () => {
    expect(hoursAndMinutes(205)).toEqual({ h: 3, m: 25 });
    expect(hoursAndMinutes(59)).toEqual({ h: 0, m: 59 });
    expect(hoursAndMinutes(0)).toEqual({ h: 0, m: 0 });
  });

  it('never reads a negative or fractional time', () => {
    expect(hoursAndMinutes(-5)).toEqual({ h: 0, m: 0 });
    expect(hoursAndMinutes(61.9)).toEqual({ h: 1, m: 1 });
  });

  it('counts whole minutes since an instant, and none for one in the future', () => {
    const now = Date.parse('2026-11-03T10:00:00Z');
    expect(minutesBetween('2026-11-03T08:35:20Z', now)).toBe(84);
    expect(minutesBetween('2026-11-03T10:05:00Z', now)).toBe(0);
  });
});
