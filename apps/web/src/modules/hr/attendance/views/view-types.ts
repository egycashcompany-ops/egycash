// View models for the attendance screens. These components only draw: the page maps its DTOs to
// these shapes and passes them in. Times are minutes after the work day's midnight (Cairo), so a
// night-shift check-out after midnight is simply > 1440. `null` means "no value", never zero.

export type ViewStatus =
  | 'present'
  | 'late'
  | 'earlyLeave' // present, and left before the hour they were due to
  | 'lateAndEarly'
  // A check-in with no check-out, on ANY date. «حضر فقط», and every figure on such a day is blank
  // rather than zero — the owner's ruling of 18 November, which also removed the separate «في
  // العمل» reading this list used to carry for today.
  | 'incomplete'
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
  /** The profile photo's file, so the page can draw the face (`avatar`). */
  photoFileId?: string | null;
  /** The face, drawn by the page (it fetches the photo); initials when absent. */
  avatar?: React.ReactNode;
  department?: string | null;
  jobTitle?: string | null;
  branch?: string | null;
  status: ViewStatus;
  expected: TimeSpan | null;
  inAt: number | null;
  outAt: number | null;
  /**
   * The day's figures, in minutes, and `null` MEANS NULL: nothing was measured, so nothing is
   * drawn. A day with a check-in and no check-out carries null in all three, which is why the
   * sheet can show «حضر فقط» beside an arrival time and no hours — the case that used to read
   * «ساعات العمل 0:00» against somebody still at work.
   */
  worked: number | null;
  lateMinutes: number | null;
  /** How much of the required day is missing — «النقص». Different from `lateMinutes`. */
  shortfallMinutes: number | null;
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
  /** «إجمالي النقص» — the period's missing time, which is the figure a deduction reads. */
  shortfallTotal: number;
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
  lateMinutes: number | null;
  /** The day's missing time, or null when the day cannot be judged. */
  shortfall: number | null;
  tags: string[];
  /** Optional per-day action (e.g. «اتخاذ قرار»). */
  action?: React.ReactNode;
  /** Every scan of the day, in order — the scan log. Empty when there were none. */
  scans?: ScanEntry[];
  /** Scans beyond the counted arrival and departure; the «N repeats» badge shows only when > 0. */
  repeats?: number;
}

/** One scan in the employee's scan log. */
export interface ScanEntry {
  /** Cairo wall clock to the second, «08:59:41». */
  time: string;
  /** Days after the work date the scan fell on (a night or 24-hour shift's check-out). */
  dayOffset: number;
  direction: 'in' | 'out' | 'unknown';
  role: 'arrival' | 'departure' | 'repeat';
  source: 'device' | 'manual' | 'regularization' | 'web';
  device: string | null;
  branch: string | null;
}

/**
 * THE COLUMNS THE SHEET CAN BE ORDERED BY.
 *
 * Spelled out here rather than imported from `@ecms/contracts` because this file is the views'
 * own vocabulary and deliberately imports nothing — the components only draw, and the page maps
 * its DTOs to these shapes. The two lists must agree all the same, since the value travels to the
 * server as `sortBy`, so `view-types.spec.ts` asserts they do.
 */
export type SheetSortKey =
  | 'checkIn'
  | 'checkOut'
  | 'worked'
  | 'late'
  | 'shortfall'
  | 'name'
  | 'code'
  | 'status';

export interface SheetSort {
  by: SheetSortKey;
  dir: 'asc' | 'desc';
}

/**
 * THE COLUMNS AN EMPLOYEE'S DAILY RECORD CAN BE ORDERED BY — the date and the three figures a
 * reader scans a month for. Fewer than the sheet's, because a period is one person: their name,
 * code and status do not vary down the list in a way worth sorting on.
 */
export type EmployeeDaySort = 'date' | 'checkIn' | 'checkOut' | 'worked';

export interface EmployeeDaysSort {
  by: EmployeeDaySort;
  dir: 'asc' | 'desc';
}
