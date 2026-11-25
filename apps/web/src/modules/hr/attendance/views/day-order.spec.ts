// The order of an employee's daily record.
//
// The rule that needs proving is the same one the sheet needs: over a backfilled year most dates
// have no times at all, so ordering by check-in must not open on three hundred empty lines.
import { describe, expect, it } from 'vitest';
import { sortEmployeeDays } from './day-order';
import type { EmployeeDay } from './view-types';

const day = (
  date: string,
  over: { inAt?: number; outAt?: number; worked?: number } = {},
): EmployeeDay => ({
  date,
  status: over.inAt === undefined ? 'noRecord' : 'present',
  inAt: over.inAt ?? null,
  outAt: over.outAt ?? null,
  expected: null,
  worked: over.worked ?? null,
  lateMinutes: null,
  earlyLeave: null,
  shortfall: null,
  tags: [],
});

const dates = (days: readonly EmployeeDay[]): string[] => days.map((d) => d.date);

describe('the default', () => {
  it('is newest first — a month is read backwards from its most recent day', () => {
    const days = [day('2026-11-01'), day('2026-11-02'), day('2026-11-03')];
    expect(dates(sortEmployeeDays(days, 'date', 'desc'))).toEqual([
      '2026-11-03',
      '2026-11-02',
      '2026-11-01',
    ]);
  });

  it('reverses on the toggle', () => {
    const days = [day('2026-11-03'), day('2026-11-01'), day('2026-11-02')];
    expect(dates(sortEmployeeDays(days, 'date', 'asc'))).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
    ]);
  });
});

describe('a day with nothing to compare', () => {
  const month = (): EmployeeDay[] => [
    day('2026-11-01', { inAt: 9 * 60 + 40, outAt: 17 * 60 + 40, worked: 480 }),
    day('2026-11-02'), // no scan at all
    day('2026-11-03', { inAt: 8 * 60, outAt: 16 * 60, worked: 480 }),
    day('2026-11-04', { inAt: 9 * 60 }), // checked in, never out
    day('2026-11-05', { inAt: 9 * 60, outAt: 17 * 60, worked: 480 }),
  ];

  it('goes last by check-in, in both directions', () => {
    expect(dates(sortEmployeeDays(month(), 'checkIn', 'asc'))).toEqual([
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-01',
      '2026-11-02',
    ]);
    // Descending puts the latest arrival first and STILL leaves the scan-less day at the end.
    expect(dates(sortEmployeeDays(month(), 'checkIn', 'desc'))).toEqual([
      '2026-11-01',
      '2026-11-04',
      '2026-11-05',
      '2026-11-03',
      '2026-11-02',
    ]);
  });

  it('puts BOTH the scan-less day and the one with no check-out last by check-out', () => {
    const ordered = sortEmployeeDays(month(), 'checkOut', 'desc');
    expect(dates(ordered).slice(0, 3)).toEqual(['2026-11-01', '2026-11-05', '2026-11-03']);
    // The two with no departure, in date order — the tiebreak among equals.
    expect(dates(ordered).slice(3)).toEqual(['2026-11-02', '2026-11-04']);
  });

  it('puts a day with no measured hours last by hours, in both directions', () => {
    for (const dir of ['asc', 'desc'] as const) {
      const tail = dates(sortEmployeeDays(month(), 'worked', dir)).slice(3);
      expect(tail, dir).toEqual(['2026-11-02', '2026-11-04']);
    }
  });
});

describe('the tiebreak', () => {
  it('is the date, ascending, however the list is being read', () => {
    // Three identical days: the order must be total and stable, or the list reshuffles on every
    // render and a reader loses their place.
    const days = [
      day('2026-11-03', { inAt: 540, outAt: 1020, worked: 480 }),
      day('2026-11-01', { inAt: 540, outAt: 1020, worked: 480 }),
      day('2026-11-02', { inAt: 540, outAt: 1020, worked: 480 }),
    ];
    for (const dir of ['asc', 'desc'] as const) {
      expect(dates(sortEmployeeDays(days, 'checkIn', dir)), dir).toEqual([
        '2026-11-01',
        '2026-11-02',
        '2026-11-03',
      ]);
    }
  });
});

describe('a night shift', () => {
  it('keeps a check-out after midnight as the latest departure, not the earliest', () => {
    // The views count the second time PAST midnight (`after()` in the view model), so a 01:10
    // check-out arrives here as 1510 rather than 70. Read plainly it would sort before every
    // ordinary morning departure.
    const days = [
      day('2026-11-01', { inAt: 22 * 60, outAt: 25 * 60 + 10, worked: 190 }),
      day('2026-11-02', { inAt: 9 * 60, outAt: 17 * 60, worked: 480 }),
    ];
    expect(dates(sortEmployeeDays(days, 'checkOut', 'asc'))).toEqual(['2026-11-02', '2026-11-01']);
  });
});

describe('the array it is given', () => {
  it('is never mutated — the calendar above the list still needs it oldest first', () => {
    const days = [day('2026-11-03'), day('2026-11-01')];
    sortEmployeeDays(days, 'date', 'asc');
    expect(dates(days)).toEqual(['2026-11-03', '2026-11-01']);
  });
});
