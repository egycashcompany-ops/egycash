// The period figures, proven without a database — they are arithmetic over rows.
//
// What these guard is not the sums but the four places the obvious answer is wrong: the list that
// must equal payroll's, the denominator that must not count Fridays, the hours average that must
// not divide by days nobody measured, and the night shift whose departure lands after midnight.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type AttendanceDayStatus } from '@ecms/contracts';
import {
  ATTENDED_STATUSES,
  cairoMinutesOfDay,
  periodFigures,
  type FigureRow,
} from './period-figures';

const row = (over: Partial<FigureRow> = {}): FigureRow => ({
  status: 'present',
  firstInAt: new Date('2026-11-02T07:00:00.000Z'),
  lastOutAt: new Date('2026-11-02T15:00:00.000Z'),
  workedMinutes: 480,
  lateMinutes: 0,
  ...over,
});

describe('the Cairo clock', () => {
  it('reads an instant on the business calendar, not the server zone', () => {
    // 07:00 UTC is 09:00 in Cairo in November (UTC+2).
    expect(cairoMinutesOfDay(new Date('2026-11-02T07:00:00.000Z'))).toBe(9 * 60);
  });

  it('reads midnight as 00:00 and never as 24:00', () => {
    expect(cairoMinutesOfDay(new Date('2026-11-02T22:00:00.000Z'))).toBe(0);
  });
});

describe('the period figures', () => {
  it('counts a day at work by exactly the list payroll pays', () => {
    // THE GUARD THAT MATTERS. If payroll's list and this one drift, «أيام الحضور» on the screen and
    // `attendedDays` on the payslip are two different answers about the same month, and nothing
    // else in the system would notice.
    //
    // Payroll's list is private to its own module and attendance must not reach into it, so this
    // reads the source — the pin lives in the spec, where a cross-feature import belongs, and it
    // fails the moment either side is edited.
    const payroll = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../payroll/compensation/attendance-quantities.ts'),
      'utf8',
    );
    const declaration = /const ATTENDED_STATUSES = \[([^\]]*)\] as const;/.exec(payroll);
    expect(declaration, 'payroll still declares ATTENDED_STATUSES').not.toBeNull();
    const paid = [...(declaration?.[1] ?? '').matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]);
    expect(paid.length).toBeGreaterThan(0);
    expect([...ATTENDED_STATUSES].sort()).toEqual([...paid].sort());
  });

  it('leaves rest days out of the denominator', () => {
    const figures = periodFigures([
      row({ status: 'present' }),
      row({ status: 'weekend', firstInAt: null, lastOutAt: null, workedMinutes: 0 }),
      row({ status: 'holiday', firstInAt: null, lastOutAt: null, workedMinutes: 0 }),
      row({ status: 'onLeave', firstInAt: null, lastOutAt: null, workedMinutes: 0 }),
      row({ status: 'absent', firstInAt: null, lastOutAt: null, workedMinutes: 0 }),
    ]);
    // One present out of the two days anybody was due in — not one out of five.
    expect(figures.daysPresent).toBe(1);
    expect(figures.daysExpected).toBe(2);
    expect(figures.absentDays).toBe(1);
  });

  it('keeps a day with no roster in the denominator', () => {
    // Nobody said when this person works. That is a gap HR must see, not a rest day.
    const figures = periodFigures([
      row({ status: 'noSchedule', firstInAt: null, lastOutAt: null, workedMinutes: 0 }),
    ]);
    expect(figures.daysExpected).toBe(1);
    expect(figures.daysPresent).toBe(0);
  });

  it('averages hours over the days that HAVE hours', () => {
    const figures = periodFigures([
      row({ workedMinutes: 480 }),
      row({ status: 'checkedIn', lastOutAt: null, workedMinutes: 0 }),
    ]);
    expect(figures.totalWorkedMinutes).toBe(480);
    // 8:00, not 4:00 — dividing by the unmeasured day would halve the figure on this payroll,
    // where most days are a check-in and nothing else.
    expect(figures.avgWorkedMinutes).toBe(480);
    expect(figures.daysPresent).toBe(2);
    expect(figures.incompleteDays).toBe(1);
  });

  it('reports no average at all when nothing was measured', () => {
    const figures = periodFigures([
      row({ status: 'checkedIn', lastOutAt: null, workedMinutes: 0 }),
    ]);
    expect(figures.avgWorkedMinutes).toBeNull();
    expect(figures.usualDeparture).toBeNull();
    expect(figures.usualArrival).toBe(9 * 60);
  });

  it('averages a night shift’s departure past midnight, not back to the small hours', () => {
    // In 20:00 Cairo, out 02:00 the next morning — one shift, keyed to the day it started.
    const figures = periodFigures([
      row({
        firstInAt: new Date('2026-11-02T18:00:00.000Z'),
        lastOutAt: new Date('2026-11-03T00:00:00.000Z'),
        workedMinutes: 360,
      }),
    ]);
    expect(figures.usualDeparture).toBe(2 * 60);
  });

  it('counts a late day once and its minutes in full', () => {
    const figures = periodFigures([
      row({ status: 'late', lateMinutes: 12 }),
      row({ status: 'late', lateMinutes: 30 }),
      row({ status: 'present', lateMinutes: 0 }),
    ]);
    expect(figures.lateDays).toBe(2);
    expect(figures.lateMinutesTotal).toBe(42);
  });

  it('answers an empty period without inventing a zero', () => {
    const figures = periodFigures([]);
    expect(figures.daysExpected).toBe(0);
    expect(figures.usualArrival).toBeNull();
    expect(figures.avgWorkedMinutes).toBeNull();
  });

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
      const figures = periodFigures([
        row({ status, firstInAt: null, lastOutAt: null, workedMinutes: 0 }),
      ]);
      expect(figures.daysPresent + figures.absentDays).toBeLessThanOrEqual(1);
    }
  });
});
