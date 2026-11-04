import { describe, expect, it } from 'vitest';
import { birthdayCountdown } from './birthday';

describe('birthdayCountdown — Cairo calendar days, never a clock', () => {
  it('counts the days to this year’s birthday when it is still ahead', () => {
    expect(birthdayCountdown('1990-03-12', '2026-03-01')).toMatchObject({
      next: '2026-03-12',
      days: 11,
      turning: 36,
    });
  });

  it('moves to next year once this year’s birthday has passed', () => {
    expect(birthdayCountdown('1990-03-12', '2026-11-03')).toMatchObject({
      next: '2027-03-12',
      days: 129,
      turning: 37,
    });
  });

  it('says 0 on the birthday itself, and the age the person turns today', () => {
    expect(birthdayCountdown('1990-11-03', '2026-11-03')).toEqual({
      next: '2026-11-03',
      days: 0,
      turning: 36,
      progress: 1,
    });
  });

  it('is one day away on the eve', () => {
    expect(birthdayCountdown('1990-11-04', '2026-11-03').days).toBe(1);
  });

  it('crosses the new year', () => {
    expect(birthdayCountdown('1985-01-01', '2026-12-31')).toMatchObject({
      next: '2027-01-01',
      days: 1,
    });
  });

  it('keeps 29 February on the 28th in a common year, and on the 29th in a leap year', () => {
    expect(birthdayCountdown('2000-02-29', '2026-02-01').next).toBe('2026-02-28');
    expect(birthdayCountdown('2000-02-29', '2028-02-01').next).toBe('2028-02-29');
    expect(birthdayCountdown('2000-02-29', '2026-02-28').days).toBe(0);
  });

  it('fills the bar with the share of the year already behind', () => {
    const halfway = birthdayCountdown('1990-01-01', '2026-07-02');
    expect(halfway.progress).toBeGreaterThan(0.49);
    expect(halfway.progress).toBeLessThan(0.51);
    expect(birthdayCountdown('1990-11-04', '2026-11-04').progress).toBe(1);
  });
});
