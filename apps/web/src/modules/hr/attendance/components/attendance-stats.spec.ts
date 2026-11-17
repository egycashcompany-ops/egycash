// The employee period's figures, proven without a browser — they are pure arithmetic over rows.
//
// What these guard is not the sums (those are obvious) but the three places the obvious answer is
// wrong: the denominator that must not count Fridays, the hours average that must not divide by
// days nobody measured, and the night shift whose departure lands after midnight.
import { describe, expect, it } from 'vitest';
import { type AttendanceDayDto, type AttendanceDayStatus } from '@ecms/contracts';
import { ATTENDED_STATUSES, cairoMinutes, clockAt, periodStats } from './attendance-stats';
import { addDays, cairoToday, periodRange, rangeLabel } from './period';

const day = (over: Partial<AttendanceDayDto> = {}): AttendanceDayDto => ({
  id: 'd-1',
  employeeId: 'e-1',
  workDate: '2026-11-02',
  status: 'present',
  shiftId: 's-1',
  firstInAt: '2026-11-02T07:00:00.000Z',
  lastOutAt: '2026-11-02T15:00:00.000Z',
  workedMinutes: 480,
  lateMinutes: 0,
  earlyLeaveMinutes: 0,
  overtimeMinutes: 0,
  approvedOvertimeMinutes: 0,
  leaveId: null,
  flags: [],
  branchId: 'b-1',
  computedAt: '2026-11-02T18:00:00.000Z',
  frozenAt: null,
  version: 1,
  ...over,
});

describe('the Cairo clock', () => {
  it('reads an instant on the business calendar, not the browser', () => {
    // 07:00 UTC is 09:00 in Cairo in November (UTC+2).
    expect(cairoMinutes('2026-11-02T07:00:00.000Z')).toBe(9 * 60);
  });

  it('reads midnight as 00:00 and never as 24:00', () => {
    expect(cairoMinutes('2026-11-02T22:00:00.000Z')).toBe(0);
  });

  it('prints a minute-of-day as a clock', () => {
    expect(clockAt(9 * 60 + 49, 'en')).toBe('09:49');
    expect(clockAt(null, 'en')).toBe('—');
  });
});

describe('the period figures', () => {
  it('counts a day at work by exactly the list payroll pays', () => {
    // The guard that matters: if payroll's list and this one drift, the screen and the payslip
    // disagree about the same month.
    expect([...ATTENDED_STATUSES].sort()).toEqual(
      ['present', 'checkedIn', 'late', 'earlyLeave', 'lateAndEarly'].sort(),
    );
  });

  it('leaves rest days out of the denominator', () => {
    const rows = [
      day({ id: 'a', status: 'present' }),
      day({ id: 'b', status: 'weekend', firstInAt: null, lastOutAt: null, workedMinutes: 0 }),
      day({ id: 'c', status: 'holiday', firstInAt: null, lastOutAt: null, workedMinutes: 0 }),
      day({ id: 'd', status: 'onLeave', firstInAt: null, lastOutAt: null, workedMinutes: 0 }),
      day({ id: 'e', status: 'absent', firstInAt: null, lastOutAt: null, workedMinutes: 0 }),
    ];
    const stats = periodStats(rows);
    // One present out of two days anybody was due in — not one out of five.
    expect(stats.attendedDays).toBe(1);
    expect(stats.expectedDays).toBe(2);
    expect(stats.absentDays).toBe(1);
  });

  it('keeps a day with no roster in the denominator and names it separately', () => {
    // Nobody said when this person works, which is a gap HR must see — not a rest day, and not
    // something to quietly drop out of their attendance.
    const stats = periodStats([
      day({ id: 'a', status: 'noSchedule', firstInAt: null, lastOutAt: null, workedMinutes: 0 }),
    ]);
    expect(stats.expectedDays).toBe(1);
    expect(stats.attendedDays).toBe(0);
    expect(stats.noScheduleDays).toBe(1);
  });

  it('averages hours over the days that HAVE hours', () => {
    const rows = [
      day({ id: 'a', workedMinutes: 480 }),
      // Checked in and never out: present, hours genuinely unknown.
      day({ id: 'b', status: 'checkedIn', lastOutAt: null, workedMinutes: 0 }),
    ];
    const stats = periodStats(rows);
    expect(stats.totalWorkedMinutes).toBe(480);
    expect(stats.workedDays).toBe(1);
    // 8:00, not 4:00 — dividing by the unmeasured day would halve the figure on this payroll,
    // where most days are check-in only.
    expect(stats.averageWorkedMinutes).toBe(480);
    expect(stats.attendedDays).toBe(2);
    expect(stats.checkedInOnlyDays).toBe(1);
  });

  it('reports no average at all when nothing was measured', () => {
    const stats = periodStats([day({ lastOutAt: null, workedMinutes: 0, status: 'checkedIn' })]);
    expect(stats.averageWorkedMinutes).toBeNull();
    expect(stats.averageDepartureMinutes).toBeNull();
  });

  it('averages a night shift’s departure past midnight, not back to the small hours', () => {
    const rows = [
      // In 20:00 Cairo, out 02:00 Cairo the next morning — one shift, keyed to the day it started.
      day({
        id: 'night',
        firstInAt: '2026-11-02T18:00:00.000Z',
        lastOutAt: '2026-11-03T00:00:00.000Z',
        workedMinutes: 360,
      }),
    ];
    // 02:00, having been averaged as 26:00 and folded back — not dragged to the middle of the day.
    expect(periodStats(rows).averageDepartureMinutes).toBe(2 * 60);
  });

  it('takes the last punch from the newest scan of either kind', () => {
    const stats = periodStats([
      day({ id: 'a', workDate: '2026-11-01', lastOutAt: '2026-11-01T15:00:00.000Z' }),
      day({
        id: 'b',
        workDate: '2026-11-03',
        firstInAt: '2026-11-03T07:30:00.000Z',
        lastOutAt: null,
        workedMinutes: 0,
      }),
    ]);
    expect(stats.lastPunchAt).toBe('2026-11-03T07:30:00.000Z');
  });

  it('counts the days a manager decided', () => {
    expect(periodStats([day({ flags: ['overriddenByManager'] })]).decidedDays).toBe(1);
  });

  it('answers an empty period without inventing a zero', () => {
    const stats = periodStats([]);
    expect(stats.expectedDays).toBe(0);
    expect(stats.averageArrivalMinutes).toBeNull();
    expect(stats.lastPunchAt).toBeNull();
  });
});

describe('the period picker’s dates', () => {
  it('runs this month from the first to TODAY, not to the month’s end', () => {
    expect(periodRange('thisMonth', '2026-11-17')).toEqual({
      from: '2026-11-01',
      to: '2026-11-17',
    });
  });

  it('runs last month end to end', () => {
    expect(periodRange('lastMonth', '2026-11-17')).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
  });

  it('crosses a year boundary backwards', () => {
    expect(periodRange('lastMonth', '2026-01-09')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
  });

  it('spans thirty days inclusive of today', () => {
    expect(periodRange('last30', '2026-11-17')).toEqual({ from: '2026-10-19', to: '2026-11-17' });
  });

  it('shifts a day across a month boundary', () => {
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('reads today off the Cairo calendar', () => {
    // Just after midnight in Cairo on the 18th is still the 17th in UTC — the business day is the
    // one the branches are working.
    expect(cairoToday(new Date('2026-11-17T22:30:00.000Z'))).toBe('2026-11-18');
  });

  it('labels a range end to end', () => {
    expect(rangeLabel({ from: '2026-10-19', to: '2026-11-17' }, 'en')).toContain('19 Oct 2026');
  });
});

describe('every status the vocabulary has is accounted for', () => {
  it('never counts one day as both attended and absent', () => {
    const statuses: AttendanceDayStatus[] = [
      'present',
      'checkedIn',
      'late',
      'earlyLeave',
      'lateAndEarly',
      'pending',
      'absent',
      'onLeave',
      'weekend',
      'holiday',
      'incomplete',
      'dayOff',
      'noSchedule',
    ];
    for (const status of statuses) {
      const stats = periodStats([
        day({ status, firstInAt: null, lastOutAt: null, workedMinutes: 0 }),
      ]);
      expect(stats.attendedDays + stats.absentDays).toBeLessThanOrEqual(1);
    }
  });
});
