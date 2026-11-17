// From the API's answer to what the views draw — proven without a browser, because it is a pure
// mapping and the mistakes it can make are all arithmetic or vocabulary.
//
// The three that matter: the Cairo clock (a time read off the browser's zone is the wrong time for
// anybody abroad and for everybody between Cairo midnight and UTC midnight), the night shift whose
// check-out lands after midnight, and the day the engine has concluded NOTHING about — which must
// not borrow the look of a rest day.
import { describe, expect, it } from 'vitest';
import {
  ATTENDANCE_DAY_STATUSES,
  type AttendanceDayDto,
  type AttendanceSheetRowDto,
} from '@ecms/contracts';
import {
  cairoMinutes,
  cairoToday,
  datesBetween,
  toEmployeeDay,
  toSheetRow,
  toViewStatus,
} from './view-model';
import { addDays, MAX_PERIOD_DAYS, periodRange, rangeLabel } from './components/period';
import { FILTER_STATUSES } from './pages/DailySheetPage';

const label = (key: string): string => key;

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

const sheetRow = (over: Partial<AttendanceSheetRowDto> = {}): AttendanceSheetRowDto => ({
  employeeId: 'e-1',
  employeeCode: '0102301',
  employeeName: 'سارة أحمد',
  employeePhotoFileId: null,
  employeeDepartment: { ar: 'الخزينة', en: 'Treasury' },
  branchId: 'b-1',
  date: '2026-11-02',
  status: 'present',
  expectedStartAt: '2026-11-02T07:00:00.000Z',
  expectedEndAt: '2026-11-02T15:00:00.000Z',
  day: day(),
  ...over,
});

describe('the business clock', () => {
  it('reads an instant on Cairo, not on the browser', () => {
    // 07:00 UTC is 09:00 in Cairo in November (UTC+2).
    expect(cairoMinutes('2026-11-02T07:00:00.000Z')).toBe(9 * 60);
  });

  it('reads midnight as 00:00 and never as 24:00', () => {
    expect(cairoMinutes('2026-11-02T22:00:00.000Z')).toBe(0);
  });

  it('reads today off the company calendar', () => {
    // Just past midnight in Cairo is still yesterday in UTC — the sheet must open on the day the
    // branches are actually working.
    expect(cairoToday(new Date('2026-11-17T22:30:00.000Z'))).toBe('2026-11-18');
  });
});

describe('the day vocabulary, as the screens say it', () => {
  it('has a word for every status the engine can store', () => {
    // A status with no mapping would be a compile error inside `toViewStatus`; this proves the
    // enum it switches over is the one the contracts declare, so growing the enum breaks here.
    for (const status of ATTENDANCE_DAY_STATUSES) {
      expect(typeof toViewStatus(status, false)).toBe('string');
    }
  });

  it('splits a check-in with no check-out on whether the day is over', () => {
    // The same stored value, two different things to tell a reader: at work now, or a day that
    // ended without a check-out.
    expect(toViewStatus('checkedIn', true)).toBe('checkedIn');
    expect(toViewStatus('checkedIn', false)).toBe('incomplete');
  });

  it('calls a weekend a rest day and a missing roster something else entirely', () => {
    expect(toViewStatus('weekend', false)).toBe('dayOff');
    expect(toViewStatus('noSchedule', false)).toBe('noSchedule');
  });
});

describe('a line of the daily sheet', () => {
  it('carries the times, the expectation and the department', () => {
    const row = toSheetRow(sheetRow(), { today: '2026-11-02', locale: 'en', label });
    expect(row.inAt).toBe(9 * 60);
    expect(row.outAt).toBe(17 * 60);
    expect(row.expected).toEqual({ start: 9 * 60, end: 17 * 60 });
    expect(row.department).toBe('Treasury');
    expect(toSheetRow(sheetRow(), { today: '2026-11-02', locale: 'ar', label }).department).toBe(
      'الخزينة',
    );
  });

  it('counts a check-out after midnight PAST midnight, not back across the morning', () => {
    // In 20:00 Cairo, out 02:00 the next morning — one shift, keyed to the day it started (D3).
    const row = toSheetRow(
      sheetRow({
        day: day({
          firstInAt: '2026-11-02T18:00:00.000Z',
          lastOutAt: '2026-11-03T00:00:00.000Z',
        }),
      }),
      { today: '2026-11-02', locale: 'en', label },
    );
    expect(row.inAt).toBe(20 * 60);
    expect(row.outAt).toBe(26 * 60);
  });

  it('says nothing about a person with no day row rather than inventing zeros', () => {
    const row = toSheetRow(sheetRow({ status: 'pending', day: null }), {
      today: '2026-11-02',
      locale: 'en',
      label,
    });
    expect(row.status).toBe('notYetIn');
    expect(row.inAt).toBeNull();
    expect(row.outAt).toBeNull();
    expect(row.lateMinutes).toBe(0);
    expect(row.tags).toEqual([]);
  });

  it('shows the marks the engine raised, and the freeze', () => {
    const row = toSheetRow(
      sheetRow({ day: day({ flags: ['manualPunch'], frozenAt: '2026-12-01T00:00:00.000Z' }) }),
      { today: '2026-11-02', locale: 'en', label },
    );
    expect(row.tags).toEqual(['attendance.flag.manualPunch', 'attendance.days.frozen']);
  });
});

describe('a day of an employee period', () => {
  it('leaves hours null when there is no check-out', () => {
    const mapped = toEmployeeDay(
      '2026-11-02',
      day({ status: 'checkedIn', lastOutAt: null, workedMinutes: 0 }),
      { today: '2026-11-18', label },
    );
    expect(mapped.worked).toBeNull();
    expect(mapped.status).toBe('incomplete');
  });

  it('keeps a date with no row at all, and names it', () => {
    const mapped = toEmployeeDay('2026-11-02', null, { today: '2026-11-18', label });
    expect(mapped.status).toBe('noRecord');
    expect(mapped.inAt).toBeNull();
    expect(mapped.worked).toBeNull();
  });
});

describe('the period the screens ask for', () => {
  it('runs this month from the first to TODAY, not to the month’s end', () => {
    expect(periodRange('thisMonth', '2026-11-17')).toEqual({
      from: '2026-11-01',
      to: '2026-11-17',
    });
  });

  it('runs last month end to end, across a year boundary', () => {
    expect(periodRange('lastMonth', '2026-01-09')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
  });

  it('spans thirty days inclusive of today', () => {
    expect(periodRange('last30', '2026-11-17')).toEqual({ from: '2026-10-19', to: '2026-11-17' });
  });

  it('gives the calendar a contiguous run of dates', () => {
    // The month grid lays its weeks out by POSITION, so one missing date would push every cell
    // after it onto the wrong weekday.
    const dates = datesBetween('2026-10-30', '2026-11-02');
    expect(dates).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('shifts a day across a month boundary', () => {
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('caps a hand-typed period at what one request can carry', () => {
    // 92 days is the server's own export and recompute cap, and a page holds at most 100 rows —
    // a longer range would silently drop days off the table and out of every figure above it.
    expect(MAX_PERIOD_DAYS).toBe(92);
  });

  it('labels a range end to end', () => {
    expect(rangeLabel({ from: '2026-10-19', to: '2026-11-17' }, 'en')).toContain('19 Oct 2026');
  });
});

describe('the sheet’s counters are also its filter', () => {
  it('groups the statuses the way the screen reads them', () => {
    // `late` is a presence, but a supervisor scanning the band wants it called out, so it is its
    // own counter. `checkedIn` sits with `present`: on this payroll an arrival alone IS the
    // ordinary present day.
    expect(FILTER_STATUSES.present).toEqual(['present', 'checkedIn']);
    expect(FILTER_STATUSES.late).toEqual(['late', 'lateAndEarly', 'earlyLeave']);
    expect(FILTER_STATUSES.notYetIn).toEqual(['pending']);
    expect(FILTER_STATUSES.absent).toEqual(['absent']);
    expect(FILTER_STATUSES.onLeave).toEqual(['onLeave']);
  });

  it('covers every status a person can be in, once', () => {
    const all = Object.values(FILTER_STATUSES).flat();
    expect(new Set(all).size).toBe(all.length);
    for (const status of all) {
      expect(ATTENDANCE_DAY_STATUSES).toContain(status);
    }
  });
});
