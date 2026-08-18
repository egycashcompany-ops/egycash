import { describe, expect, it } from 'vitest';
import {
  currentMonthRange,
  isIsoDate,
  isRangeValid,
  rangeFromParams,
  toIsoDate,
} from './report-range';

describe('report range (B5)', () => {
  it('defaults to the current month, both bounds inclusive — the legacy default', () => {
    expect(currentMonthRange(new Date('2026-08-18T09:00:00.000Z'))).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    });
  });

  it('gets the last day right in a short month and in a leap February', () => {
    expect(currentMonthRange(new Date('2026-02-10T00:00:00.000Z')).to).toBe('2026-02-28');
    expect(currentMonthRange(new Date('2028-02-10T00:00:00.000Z')).to).toBe('2028-02-29');
    expect(currentMonthRange(new Date('2026-04-10T00:00:00.000Z')).to).toBe('2026-04-30');
  });

  it('reads a range out of the URL and falls back PER FIELD, not per range', () => {
    const now = new Date('2026-08-18T09:00:00.000Z');
    expect(rangeFromParams({ from: '2026-06-05', to: '2026-06-20' }, now)).toEqual({
      from: '2026-06-05',
      to: '2026-06-20',
    });
    // Half an intent is kept: the typed bound survives, only the missing one falls back.
    expect(rangeFromParams({ from: '2026-06-05', to: null }, now)).toEqual({
      from: '2026-06-05',
      to: '2026-08-31',
    });
    expect(rangeFromParams({ from: null, to: '2026-06-20' }, now)).toEqual({
      from: '2026-08-01',
      to: '2026-06-20',
    });
  });

  it('ignores junk in the URL rather than passing it to the API', () => {
    const now = new Date('2026-08-18T09:00:00.000Z');
    expect(rangeFromParams({ from: 'yesterday', to: '2026-13-01' }, now)).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    });
  });

  it('rejects dates that are well-formed but not real days', () => {
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-06-31')).toBe(false);
    expect(isIsoDate('2026-06-30')).toBe(true);
    expect(isIsoDate(null)).toBe(false);
    expect(isIsoDate('2026-6-3')).toBe(false);
  });

  it('refuses an inverted range instead of swapping it', () => {
    expect(isRangeValid({ from: '2026-06-01', to: '2026-06-30' })).toBe(true);
    expect(isRangeValid({ from: '2026-06-30', to: '2026-06-01' })).toBe(false);
    // A single-day range is a range.
    expect(isRangeValid({ from: '2026-06-01', to: '2026-06-01' })).toBe(true);
  });

  it('formats in UTC so a late-evening local time cannot report the wrong month', () => {
    expect(toIsoDate(new Date('2026-08-31T23:30:00.000Z'))).toBe('2026-08-31');
  });
});
