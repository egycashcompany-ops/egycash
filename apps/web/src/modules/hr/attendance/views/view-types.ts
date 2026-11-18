// View models for the attendance screens. These components only draw: the page maps its DTOs to
// these shapes and passes them in. Times are minutes after the work day's midnight (Cairo), so a
// night-shift check-out after midnight is simply > 1440. `null` means "no value", never zero.

export type ViewStatus =
  | 'present'
  | 'late'
  | 'earlyLeave' // present, and left before the hour they were due to
  | 'lateAndEarly'
  | 'checkedIn' // checked in today, no check-out yet
  | 'incomplete' // a past day with a check-in and no check-out
  | 'notYetIn'
  | 'absent'
  | 'onLeave'
  | 'dayOff'
  | 'holiday'
  | 'noSchedule'
  // The engine has concluded nothing about this date — before the hire, after the exit, or a day
  // the nightly pass has not reached. It is NOT a rest day, and it must not be drawn as one.
  | 'noRecord';

export interface TimeSpan {
  start: number;
  end: number;
}

export interface SheetRow {
  id: string;
  name: string;
  code: string;
  photoUrl?: string | null;
  department?: string | null;
  status: ViewStatus;
  expected: TimeSpan | null;
  inAt: number | null;
  outAt: number | null;
  lateMinutes: number;
  /** Approved / derived overtime in minutes; both 0 hides the cell. */
  overtimeApproved: number;
  overtimeDerived: number;
  /** Short tags such as «بصمة يدوية» or «قرار مدير». Already localized. */
  tags: string[];
  /** The row's existing buttons («اتخاذ قرار», «اعتماد الإضافي»). */
  actions?: React.ReactNode;
}

/** The six counters above the sheet; each one is also a filter. */
/**
 * The sheet's counters. The last three are what makes the band ADD UP TO THE TOTAL.
 *
 * It used to be the first five, which between them named eight of the statuses the server counts.
 * Everyone in the other five — and on a deployment with no default working pattern that is most of
 * the company — was counted by the server, shown in the table, and in NO counter at all: a band
 * reading «5» above a total of «100». Silence about ninety-five people.
 */
export type SheetFilter =
  | 'all'
  | 'present'
  | 'late'
  | 'notYetIn'
  | 'absent'
  | 'onLeave'
  // Nobody has said when these people work, so nothing can be said about their punctuality.
  | 'noSchedule'
  // ECMS has concluded nothing about their day — most often history that is not re-derived yet.
  | 'noRecord'
  // A rest day by the calendar or by a schedule: the weekend, a public holiday, a legacy rest row.
  | 'offDay';

export interface SheetSummary {
  employees: number;
  present: number;
  late: number;
  notYetIn: number;
  absent: number;
  onLeave: number;
  /** Nobody has said when these people work. */
  noSchedule: number;
  /** ECMS has concluded nothing about their day. */
  noRecord: number;
  /** The weekend, a public holiday, or a schedule's rest day. */
  offDay: number;
  /**
   * The scans this sheet CANNOT show: machine ids that map to no employee, so they have no line to
   * sit on and no bucket to be counted in. `null` where the reader may not see them.
   *
   * It is drawn beside the band rather than folded into it, because it is not a count OF the
   * company — `identities` is a count of machine ids, and ECMS does not know who is behind them.
   * Saying nothing is what let thirty-nine people at the door read as five on screen.
   */
  unlinked: { identities: number; rows: number } | null;
}

export interface EmployeeHeader {
  /** May be empty where the login has no employee file — the avatar then shows no initials. */
  name: string;
  code: string;
  photoUrl?: string | null;
  department?: string | null;
  branch?: string | null;
  jobTitle?: string | null;
  /** Already formatted, e.g. «الاثنين 16 نوفمبر 2026، 9:38 ص». */
  lastPunch?: string | null;
}

export interface EmployeeKpis {
  daysPresent: number;
  daysExpected: number;
  /** Average first check-in / last check-out over the period, minutes after midnight. */
  usualArrival: number | null;
  usualDeparture: number | null;
  /** Average worked minutes over the days that have both scans, and their total. */
  avgWorked: number | null;
  totalWorked: number;
  lateDays: number;
  lateMinutesTotal: number;
  absentDays: number;
  incompleteDays: number;
}

export interface EmployeeDay {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  status: ViewStatus;
  inAt: number | null;
  outAt: number | null;
  expected: TimeSpan | null;
  /** Worked minutes; null when it cannot be counted (no check-out). */
  worked: number | null;
  lateMinutes: number;
  tags: string[];
  /** Optional per-day action (e.g. «اتخاذ قرار»). */
  action?: React.ReactNode;
}
