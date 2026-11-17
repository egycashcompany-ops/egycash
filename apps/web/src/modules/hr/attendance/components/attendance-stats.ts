// What one employee's stretch of days adds up to — PURE, and computed from the day rows the
// screen already has.
//
// NO NEW ENDPOINT, deliberately. Every figure on the employee screens is a reading of
// `AttendanceDayDto` rows that the month view fetches anyway: a period is capped at 92 days, so
// the arithmetic is over at most 92 objects and belongs where the rows are. A summary endpoint
// would add a second source for numbers the client can already see, and the two would disagree
// the first time one of them changed.
//
// EVERY FIGURE IS A QUANTITY (§1): days, clock times and minutes. Nothing here prices anything.
import { type AttendanceDayDto, type AttendanceDayStatus } from '@ecms/contracts';

/**
 * The statuses that mean "came to work" — the SAME five
 * `payroll/compensation/attendance-quantities.ts` counts into `attendedDays`, named here so the
 * card and the payslip cannot drift apart. «حضر 15 يومًا» on this screen and 15 attended days in
 * the payroll run must be the same 15 days, or one of the two screens is lying to somebody.
 *
 * `checkedIn` is among them, by the owner's ruling: on this payroll most people scan on arrival
 * and never scan out, so an arrival alone is the ordinary attended day.
 *
 * `incomplete` is NOT, exactly as payroll has it: nothing derives it any more, and the rows that
 * still carry it were priced as absences in months that are already closed.
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
 * gives, and a covered leave. They are the days the "out of N" denominator leaves out — counting
 * Fridays against somebody's attendance would make a perfect month unreachable by construction.
 */
const NOT_EXPECTED: readonly AttendanceDayStatus[] = ['weekend', 'holiday', 'dayOff', 'onLeave'];

const CAIRO_TZ = 'Africa/Cairo';

/** One formatter, made once. `h23` so midnight reads 00 and never 24. */
const cairoClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: CAIRO_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Minutes past Cairo midnight for an instant — the business clock, never the browser's. */
export const cairoMinutes = (iso: string): number => {
  const parts = cairoClock.formatToParts(new Date(iso));
  const part = (type: 'hour' | 'minute'): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  return part('hour') * 60 + part('minute');
};

const MINUTES_IN_DAY = 1440;

export interface PeriodStats {
  /** Days at work, by the payroll list above. */
  attendedDays: number;
  /** Days somebody was due in — the denominator, and never the raw length of the period. */
  expectedDays: number;
  /** Days with a check-in and no check-out: present, hours unknown. */
  checkedInOnlyDays: number;
  absentDays: number;
  /** Days nobody has said when this person works — a gap in the roster, not an absence. */
  noScheduleDays: number;
  /** Days a manager's decision stands over what the devices saw. */
  decidedDays: number;
  /** Days with measured hours: the only days an average of hours can honestly divide by. */
  workedDays: number;
  totalWorkedMinutes: number;
  /** Mean over `workedDays`; null when nothing was measured. */
  averageWorkedMinutes: number | null;
  /** Mean Cairo minute-of-day of the first scan, and of the last; null when there were none. */
  averageArrivalMinutes: number | null;
  averageDepartureMinutes: number | null;
  /** The most recent scan anywhere in the period — the header's «آخر بصمة». */
  lastPunchAt: string | null;
}

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : Math.round(values.reduce((a, b) => a + b, 0) / values.length);

export const periodStats = (rows: readonly AttendanceDayDto[]): PeriodStats => {
  const has = (status: AttendanceDayStatus, list: readonly AttendanceDayStatus[]): boolean =>
    list.includes(status);

  const arrivals: number[] = [];
  const departures: number[] = [];
  let attendedDays = 0;
  let expectedDays = 0;
  let checkedInOnlyDays = 0;
  let absentDays = 0;
  let noScheduleDays = 0;
  let decidedDays = 0;
  let workedDays = 0;
  let totalWorkedMinutes = 0;
  let lastPunchAt: string | null = null;

  for (const row of rows) {
    if (has(row.status, ATTENDED_STATUSES)) attendedDays += 1;
    if (!has(row.status, NOT_EXPECTED)) expectedDays += 1;
    if (row.status === 'absent') absentDays += 1;
    if (row.status === 'noSchedule') noScheduleDays += 1;
    if (row.flags.includes('overriddenByManager')) decidedDays += 1;
    // A check-in with no check-out, whatever the engine called the day.
    if (row.firstInAt !== null && row.lastOutAt === null) checkedInOnlyDays += 1;
    if (row.workedMinutes > 0) {
      workedDays += 1;
      totalWorkedMinutes += row.workedMinutes;
    }

    if (row.firstInAt !== null) arrivals.push(cairoMinutes(row.firstInAt));
    if (row.lastOutAt !== null) {
      const out = cairoMinutes(row.lastOutAt);
      // A departure EARLIER on the clock than the arrival happened after midnight: a night shift
      // keyed to the day it started (D3). Counted as 25:10 rather than 01:10, or one night shift
      // would drag a month of ordinary departures back by hours.
      const crossed = row.firstInAt !== null && out < cairoMinutes(row.firstInAt);
      departures.push(crossed ? out + MINUTES_IN_DAY : out);
    }

    const latest = row.lastOutAt ?? row.firstInAt;
    if (latest !== null && (lastPunchAt === null || latest > lastPunchAt)) lastPunchAt = latest;
  }

  const averageDeparture = mean(departures);

  return {
    attendedDays,
    expectedDays,
    checkedInOnlyDays,
    absentDays,
    noScheduleDays,
    decidedDays,
    workedDays,
    totalWorkedMinutes,
    averageWorkedMinutes: workedDays === 0 ? null : Math.round(totalWorkedMinutes / workedDays),
    averageArrivalMinutes: mean(arrivals),
    // Folded back onto the clock: an average of 25:10 is 01:10 in the morning.
    averageDepartureMinutes: averageDeparture === null ? null : averageDeparture % MINUTES_IN_DAY,
    lastPunchAt,
  };
};

/** A minute-of-day as a clock reads it: `09:49`. LTR-locked, like every other time (R10). */
export const clockAt = (minuteOfDay: number | null, locale: 'ar' | 'en'): string => {
  if (minuteOfDay === null) return '—';
  const nf = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { useGrouping: false });
  const hours = Math.floor(minuteOfDay / 60) % 24;
  const minutes = minuteOfDay % 60;
  return `${nf.format(hours).padStart(2, nf.format(0))}:${nf.format(minutes).padStart(2, nf.format(0))}`;
};
