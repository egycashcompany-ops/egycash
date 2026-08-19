// What "this month" means, pinned against fixed dates rather than against today.
import { describe, expect, it } from 'vitest';
import { currentMonthRange, odometerRange } from './odometer-range';

const at = (iso: string): Date => new Date(iso);

describe('currentMonthRange', () => {
  it('spans the first to the LAST day of the month, both inclusive', () => {
    expect(currentMonthRange(at('2026-08-19T11:00:00.000Z'))).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    });
  });

  it('gets a 30-day month right', () => {
    expect(currentMonthRange(at('2026-09-15T00:00:00.000Z'))).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });

  it('gets February right in a leap year and a common one', () => {
    expect(currentMonthRange(at('2028-02-10T00:00:00.000Z')).to).toBe('2028-02-29');
    expect(currentMonthRange(at('2026-02-10T00:00:00.000Z')).to).toBe('2026-02-28');
  });

  it('does not roll off the end of the year', () => {
    expect(currentMonthRange(at('2026-12-31T23:00:00.000Z'))).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
  });

  it('reads the month in UTC, so a late-evening instant stays in its own month', () => {
    // 23:30 on the 31st is already the 1st in a positive offset; a local-time reading would
    // return September here and silently ask the server for the wrong days.
    expect(currentMonthRange(at('2026-08-31T23:30:00.000Z')).from).toBe('2026-08-01');
    // …and the first instant of the month is not dragged back into the previous one.
    expect(currentMonthRange(at('2026-08-01T00:00:00.000Z')).from).toBe('2026-08-01');
  });
});

describe('odometerRange', () => {
  const now = at('2026-08-19T11:00:00.000Z');

  it('fills in the month when the URL asks for NEITHER bound', () => {
    expect(odometerRange({ from: '', to: '' }, now)).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
      defaulted: true,
    });
  });

  it('leaves a FROM-only request open-ended — the month must not cap it', () => {
    // The server reads this as `>= from` with no upper bound. Filling `to` in would hide every
    // row after this month from someone who asked for everything since July.
    expect(odometerRange({ from: '2026-07-01', to: '' }, now)).toEqual({
      from: '2026-07-01',
      to: '',
      defaulted: false,
    });
  });

  it('leaves a TO-only request open at the start', () => {
    expect(odometerRange({ from: '', to: '2026-07-31' }, now)).toEqual({
      from: '',
      to: '2026-07-31',
      defaulted: false,
    });
  });

  it('passes both bounds through untouched', () => {
    expect(odometerRange({ from: '2026-01-01', to: '2026-03-31' }, now)).toEqual({
      from: '2026-01-01',
      to: '2026-03-31',
      defaulted: false,
    });
  });

  it('passes a single DAY through — the server covers the whole of it', () => {
    expect(odometerRange({ from: '2026-08-18', to: '2026-08-18' }, now)).toEqual({
      from: '2026-08-18',
      to: '2026-08-18',
      defaulted: false,
    });
  });
});
