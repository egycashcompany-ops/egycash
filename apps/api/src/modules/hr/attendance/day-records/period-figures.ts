// ONE EMPLOYEE'S PERIOD, ADDED UP. PURE: handed day rows, hands back figures.
//
// It lives on the server because the client must not do arithmetic over a month. The employee's
// page, the profile tab and My Attendance all read the same numbers from here, so the three cannot
// disagree about the same person, and neither can two readers on two screens.
//
// EVERY FIGURE IS A QUANTITY (§1): days, clock times and minutes. Nothing here prices anything.
import { type AttendanceDayFigures, type AttendanceDayStatus } from '@ecms/contracts';

/**
 * The statuses that mean "came to work".
 *
 * They are the five `payroll/compensation/attendance-quantities.ts` counts into `attendedDays`,
 * restated here rather than imported because attendance must not reach into payroll's internals —
 * and pinned to payroll's list by `period-figures.spec.ts`, which imports both and asserts they
 * are the same set. «حضر 23 يومًا» on this screen and 23 attended days in the payroll run have to
 * be the same 23 days, or one of the two is lying to somebody.
 */
export const ATTENDED_STATUSES: readonly AttendanceDayStatus[] = [
  'present',
  'checkedIn',
  'late',
  'earlyLeave',
  'lateAndEarly',
];

/**
 * The statuses that were never a day at work: the two the calendar gives, the rest day a shift
 * gives, and a covered leave. They are the days «من 24 يوم عمل» leaves out — counting Fridays
 * against somebody's attendance would put a full month out of reach by construction.
 */
// A day counts as EXPECTED only when somebody was expected AND the engine concluded what happened.
// `noRecord` (nothing known — typically before the person's first scan) and `pending` (not
// concluded yet) are left out: counting them made «14 of 22» beside 0 absent days, a rate about
// the data's start date rather than the person. `noSchedule` stays IN — a missing roster is a
// gap HR must see.
const NOT_EXPECTED: readonly AttendanceDayStatus[] = ['weekend', 'holiday', 'dayOff', 'onLeave', 'noRecord', 'pending'];

/** The fields of a day row these figures read — nothing else of it is their business. */
export interface FigureRow {
  status: AttendanceDayStatus;
  firstInAt: Date | null;
  lastOutAt: Date | null;
  /**
   * The REPORTED figures of the day, not the stored ones — so every counter here inherits the one
   * blanking rule instead of restating it. A day with no check-out contributes to no total at all,
   * which is the honest answer: nobody knows what it was.
   */
  figures: AttendanceDayFigures;
}

export interface PeriodFigures {
  daysPresent: number;
  daysExpected: number;
  usualArrival: number | null;
  usualDeparture: number | null;
  avgWorkedMinutes: number | null;
  totalWorkedMinutes: number;
  /**
   * Days that are late BY THE RULE. The engine reports no late minutes on a day whose eight hours
   * were completed, so this counter needs no clause of its own to honour the owner's rule: an
   * employee who arrives at 09:40 every day and leaves at 17:40 every day has a late-day count of
   * zero, and that is correct rather than lenient.
   */
  lateDays: number;
  lateMinutesTotal: number;
  /** «إجمالي النقص» — the period's missing time, which is the figure a deduction would read. */
  shortfallMinutesTotal: number;
  absentDays: number;
  incompleteDays: number;
}

const MINUTES_IN_DAY = 1440;

/** One formatter, made once. `h23` so midnight reads 00 and never 24. */
const cairoClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Minutes past Cairo midnight for an instant — the business clock, never the server's zone. */
export const cairoMinutesOfDay = (at: Date): number => {
  const parts = cairoClock.formatToParts(at);
  const part = (type: 'hour' | 'minute'): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  return part('hour') * 60 + part('minute');
};

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : Math.round(values.reduce((a, b) => a + b, 0) / values.length);

export const periodFigures = (rows: readonly FigureRow[]): PeriodFigures => {
  const arrivals: number[] = [];
  const departures: number[] = [];
  let daysPresent = 0;
  let daysExpected = 0;
  let lateDays = 0;
  let lateMinutesTotal = 0;
  let shortfallMinutesTotal = 0;
  let absentDays = 0;
  let incompleteDays = 0;
  let workedDays = 0;
  let totalWorkedMinutes = 0;

  for (const row of rows) {
    if (ATTENDED_STATUSES.includes(row.status)) daysPresent += 1;
    if (!NOT_EXPECTED.includes(row.status)) daysExpected += 1;
    if (row.status === 'absent') absentDays += 1;
    const late = row.figures.lateMinutes ?? 0;
    if (late > 0) {
      lateDays += 1;
      lateMinutesTotal += late;
    }
    shortfallMinutesTotal += row.figures.shortfallMinutes ?? 0;
    // A check-in with nothing after it, whatever the engine called the day.
    if (row.firstInAt !== null && row.lastOutAt === null) incompleteDays += 1;
    const worked = row.figures.workedMinutes ?? 0;
    if (worked > 0) {
      workedDays += 1;
      totalWorkedMinutes += worked;
    }

    if (row.firstInAt !== null) arrivals.push(cairoMinutesOfDay(row.firstInAt));
    if (row.lastOutAt !== null) {
      const out = cairoMinutesOfDay(row.lastOutAt);
      // A check-out EARLIER on the clock than the check-in happened after midnight: a night shift,
      // keyed to the day it started (D3). Counted as 25:10 rather than 01:10, or one night shift
      // drags a month of ordinary departures back by hours.
      const crossed = row.firstInAt !== null && out < cairoMinutesOfDay(row.firstInAt);
      departures.push(crossed ? out + MINUTES_IN_DAY : out);
    }
  }

  const departure = mean(departures);
  return {
    daysPresent,
    daysExpected,
    usualArrival: mean(arrivals),
    // Folded back onto the clock: an average of 25:10 is ten past one in the morning.
    usualDeparture: departure === null ? null : departure % MINUTES_IN_DAY,
    // Averaged over the days that HAVE hours. On this payroll most days are a scan in and nothing
    // out, so dividing by every attended day would report half the real figure.
    avgWorkedMinutes: workedDays === 0 ? null : Math.round(totalWorkedMinutes / workedDays),
    totalWorkedMinutes,
    lateDays,
    lateMinutesTotal,
    shortfallMinutesTotal,
    absentDays,
    incompleteDays,
  };
};
