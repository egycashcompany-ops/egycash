// Which day an open board shows (2026-10-27) — the Cairo calendar day of the open time, today by
// default, then tomorrow, everything ahead, and the earlier days left open.
import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayViewCounts,
  dayViewRange,
  isInDayView,
  readBoardDayView,
  rowsInDayView,
} from './board-day';

// 10:00 Cairo on 27 October 2026.
const NOW = new Date('2026-10-27T07:00:00.000Z');
const at = (iso: string) => ({ openedAt: iso });

describe('readBoardDayView', () => {
  it('reads the four views and falls back to today for anything else', () => {
    expect(readBoardDayView('tomorrow')).toBe('tomorrow');
    expect(readBoardDayView('upcoming')).toBe('upcoming');
    expect(readBoardDayView('earlier')).toBe('earlier');
    expect(readBoardDayView(null)).toBe('today');
    expect(readBoardDayView('yesterday')).toBe('today');
  });
});

describe('addDays', () => {
  it('moves across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('isInDayView — by the CAIRO day of the open time', () => {
  it('today: an open time early on the Cairo day that is still yesterday in UTC', () => {
    // 01:30 Cairo on the 27th = 22:30Z on the 26th.
    expect(isInDayView('2026-10-26T22:30:00.000Z', 'today', NOW)).toBe(true);
    expect(isInDayView('2026-10-26T22:30:00.000Z', 'earlier', NOW)).toBe(false);
  });

  it('tomorrow is one day, upcoming is every day after today, earlier every day before', () => {
    const tomorrow = '2026-10-28T04:00:00.000Z'; // 06:00 Cairo on the 28th — a force date
    const nextWeek = '2026-11-03T04:00:00.000Z';
    const lastWeek = '2026-10-20T08:00:00.000Z';
    expect(isInDayView(tomorrow, 'tomorrow', NOW)).toBe(true);
    expect(isInDayView(tomorrow, 'upcoming', NOW)).toBe(true);
    expect(isInDayView(nextWeek, 'tomorrow', NOW)).toBe(false);
    expect(isInDayView(nextWeek, 'upcoming', NOW)).toBe(true);
    expect(isInDayView(lastWeek, 'earlier', NOW)).toBe(true);
    expect(isInDayView(lastWeek, 'upcoming', NOW)).toBe(false);
  });
});

describe('the views over one board', () => {
  const rows = [
    at('2026-10-27T08:00:00.000Z'),
    at('2026-10-27T12:00:00.000Z'),
    at('2026-10-28T04:00:00.000Z'),
    at('2026-11-02T04:00:00.000Z'),
    at('2026-10-25T08:00:00.000Z'),
  ];

  it('counts each view, tomorrow inside upcoming', () => {
    expect(dayViewCounts(rows, NOW)).toEqual({ today: 2, tomorrow: 1, upcoming: 2, earlier: 1 });
  });

  it('keeps the board’s own order inside a view', () => {
    expect(rowsInDayView(rows, 'today', NOW)).toEqual([rows[0], rows[1]]);
  });

  it('names the day — or the days the rows span — a statement is «عن»', () => {
    expect(dayViewRange('today', rows, NOW)).toEqual({ from: '2026-10-27', to: '2026-10-27' });
    expect(dayViewRange('tomorrow', [], NOW)).toEqual({ from: '2026-10-28', to: '2026-10-28' });
    expect(dayViewRange('upcoming', rowsInDayView(rows, 'upcoming', NOW), NOW)).toEqual({
      from: '2026-10-28',
      to: '2026-11-02',
    });
    expect(dayViewRange('earlier', [], NOW)).toEqual({ from: '2026-10-26', to: '2026-10-26' });
  });
});
