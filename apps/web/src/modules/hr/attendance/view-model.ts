// From what the API answers to what the views draw.
//
// The views are presentational and take minutes after Cairo midnight; the API answers instants and
// the thirteen-value day vocabulary. This is the one place the two meet, so the daily sheet, the
// employee page, the profile tab and My Attendance cannot drift into three different readings of
// the same row.
//
// NOTHING IS INVENTED HERE. A time nobody recorded stays `null`, a day the engine has concluded
// nothing about says so, and no figure is computed that the server did not send.
import {
  type AttendanceDayDto,
  type AttendanceEmployeeDayDto,
  type AttendanceDayStatus,
  type AttendanceSheetRowDto,
  type Locale,
} from '@ecms/contracts';
import { type EmployeeDay, type SheetRow, type TimeSpan, type ViewStatus } from './views';
// One `cairoToday` for the module, and it lives beside the period helpers that default to it.
export { cairoToday } from './components/period';

/** One formatter, made once. `h23` so midnight reads 00 and never 24. */
const cairoClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
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

/**
 * The second of two Cairo times, counted PAST midnight when it falls before the first.
 *
 * A night shift is keyed to the date it started (D3), so its check-out at one in the morning
 * belongs to the previous day's line. Read plainly it would draw a bar running backwards across
 * the whole morning; counted as 25:10 it draws forwards, and the views already understand
 * "> 1440" as "after midnight".
 */
const after = (first: number | null, second: number): number =>
  first !== null && second < first ? second + MINUTES_IN_DAY : second;

/** Minutes after Cairo midnight, right now. */
export const cairoNowMinutes = (now: Date = new Date()): number => cairoMinutes(now.toISOString());

/**
 * The day vocabulary as the views name it.
 *
 * `checkedIn` splits on the date: ON TODAY it means somebody is at work and has not scanned out
 * yet, which is an ordinary live state; on a PAST date the same stored value means the day ended
 * with no check-out, which is a different thing to tell a reader. The engine has one value for
 * both because the fact is the same; the screen has two because the question is not.
 */
export const toViewStatus = (status: AttendanceDayStatus, isToday: boolean): ViewStatus => {
  switch (status) {
    case 'present':
      return 'present';
    case 'late':
      return 'late';
    case 'earlyLeave':
      return 'earlyLeave';
    case 'lateAndEarly':
      return 'lateAndEarly';
    case 'checkedIn':
      return isToday ? 'checkedIn' : 'incomplete';
    case 'incomplete':
      return 'incomplete';
    case 'pending':
      return 'notYetIn';
    case 'absent':
      return 'absent';
    case 'onLeave':
      return 'onLeave';
    case 'weekend':
    case 'dayOff':
      return 'dayOff';
    case 'holiday':
      return 'holiday';
    case 'noSchedule':
      return 'noSchedule';
    // The engine has concluded nothing about this date and no scan was seen for it. The view
    // status already existed for "no row at all"; now the SERVER says it too, for a date it
    // resolved rather than one the client found missing, and both arrive at the same word.
    case 'noRecord':
      return 'noRecord';
  }
};

/** What was expected of somebody, in the views' minutes — null when nobody said. */
const expectedSpan = (startAt: string | null, endAt: string | null): TimeSpan | null => {
  if (startAt === null || endAt === null) return null;
  const start = cairoMinutes(startAt);
  return { start, end: after(start, cairoMinutes(endAt)) };
};

/** The row's own marks: the flags the engine raised, and the freeze. Already localized. */
const marksOf = (day: AttendanceDayDto | null, label: (key: string) => string): string[] => {
  if (day === null) return [];
  return [
    ...day.flags.map((flag) => label(`attendance.flag.${flag}`)),
    ...(day.frozenAt === null ? [] : [label('attendance.days.frozen')]),
  ];
};

/** One line of the daily sheet. `actions` are the page's own buttons, passed through untouched. */
export const toSheetRow = (
  row: AttendanceSheetRowDto,
  options: {
    today: string;
    locale: Locale;
    label: (key: string) => string;
    actions?: React.ReactNode;
  },
): SheetRow => {
  const day = row.day;
  // THE TIMES COME FROM EITHER, and the fallback is the point: a scan imported onto a date no
  // recompute has reached has no stored row, and reading only `day` is what put thirty-nine people
  // at the door and five sets of times on screen. `day` wins where it exists — it is the concluded
  // record — and `provisionalDay` is the reading of the punches the server took when it answered.
  const times = day ?? row.provisionalDay;
  const inAt = times?.firstInAt == null ? null : cairoMinutes(times.firstInAt);
  return {
    id: row.employeeId,
    name: row.employeeName,
    code: row.employeeCode,
    // Initials, deliberately: a page of fifty faces is fifty authenticated image requests, and the
    // photo answers nothing this screen is opened to ask.
    photoUrl: null,
    department: row.employeeDepartment === null ? null : row.employeeDepartment[options.locale],
    status: toViewStatus(row.status, row.date.slice(0, 10) === options.today),
    expected: expectedSpan(row.expectedStartAt, row.expectedEndAt),
    inAt,
    outAt: times?.lastOutAt == null ? null : after(inAt, cairoMinutes(times.lastOutAt)),
    lateMinutes: times?.lateMinutes ?? 0,
    overtimeApproved: day?.approvedOvertimeMinutes ?? 0,
    overtimeDerived: day?.overtimeMinutes ?? 0,
    tags: marksOf(day, options.label),
    ...(options.actions === undefined ? {} : { actions: options.actions }),
  };
};

/**
 * One day of an employee's period, from the SERVER'S RESOLUTION of that date.
 *
 * It used to be handed a day ROW or null, and null meant "the client found no row for this date" —
 * which the client then had to interpret. That is where the two screens came apart: the sheet asked
 * the server what a date WAS and the employee page guessed from what it had been sent. Now the
 * server answers one entry per date, with the status it would store, and this only renders it.
 *
 * `day` is still nullable for the one case the server omits: a date outside the employment.
 */
export const toEmployeeDay = (
  date: string,
  day: AttendanceEmployeeDayDto | null,
  options: { today: string; label: (key: string) => string; action?: React.ReactNode },
): EmployeeDay => {
  const inAt = day?.firstInAt == null ? null : cairoMinutes(day.firstInAt);
  return {
    date,
    status: day === null ? 'noRecord' : toViewStatus(day.status, date === options.today),
    inAt,
    outAt: day?.lastOutAt == null ? null : after(inAt, cairoMinutes(day.lastOutAt)),
    // THE EXPECTATION NOW ARRIVES, resolved per date by the server. The old comment here said the
    // day list did not carry one and that inventing it would be a second derivation — true then,
    // and the reason the period endpoint carries it.
    expected: day === null ? null : expectedSpan(day.expectedStartAt, day.expectedEndAt),
    // Hours that were measured, or null — never a confident zero against a day with no check-out.
    worked: day === null || day.workedMinutes === 0 ? null : day.workedMinutes,
    lateMinutes: day?.lateMinutes ?? 0,
    // A provisional day is one the engine has not concluded: the punches are real and the status is
    // a reading of them. Marked so a reader knows which, and so «لا يوجد تسجيل» is not the only
    // clue that the backfill still has work to do.
    tags: day !== null && day.provisional && day.punches.length > 0
      ? [options.label('attendanceView.provisional')]
      : [],
    ...(options.action === undefined ? {} : { action: options.action }),
  };
};

/** Every date from `from` to `to` inclusive, oldest first — the calendar's contiguous run. */
export const datesBetween = (from: string, to: string): string[] => {
  const out: string[] = [];
  const last = Date.parse(`${to}T00:00:00.000Z`);
  for (let at = Date.parse(`${from}T00:00:00.000Z`); at <= last; at += MINUTES_IN_DAY * 60_000) {
    out.push(new Date(at).toISOString().slice(0, 10));
  }
  return out;
};
