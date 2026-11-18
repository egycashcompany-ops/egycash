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
export type SheetFilter = 'all' | 'present' | 'late' | 'notYetIn' | 'absent' | 'onLeave';

export interface SheetSummary {
  employees: number;
  present: number;
  late: number;
  notYetIn: number;
  absent: number;
  onLeave: number;
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
