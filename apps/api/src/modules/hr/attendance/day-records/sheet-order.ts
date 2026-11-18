// THE ORDER THE DAILY SHEET IS READ IN. Pure, and deliberately not a database sort.
//
// WHY IT CANNOT BE A DATABASE SORT. The sheet is a page of EMPLOYEES left-joined to whatever day
// rows exist, and the status on each line is RESOLVED when somebody looks — from the clock, the
// calendar and that date's punches — rather than read off a row. Half of what this orders by
// therefore does not exist in any collection at the moment the query runs: the resolved status, and
// the times of a day no recompute has concluded (`provisionalDay`). A `.sort()` could only order
// the rows that happen to be stored, which is the same class of defect as the sheet that showed
// five people out of a hundred.
//
// SO IT SORTS THE WHOLE DAY, IN MEMORY, BEFORE PAGINATION. That is not a compromise — it is the
// only correct place for it. `resolveSheetDay` already resolves every line of the branch-day in
// one pass because the counts demand it; ordering that set costs one comparison sort over ~1,755
// rows and makes page 2 a continuation of page 1 rather than its own little sorted island.
import {
  type AttendanceDayStatus,
  type AttendanceSheetRowDto,
  type AttendanceSheetSort,
  ATTENDANCE_DAY_STATUSES,
} from '@ecms/contracts';

/**
 * Where a status sits when the sheet is ordered BY status.
 *
 * Alphabetical would be meaningless in either language, so the order is the working day's own
 * shape: the people who are here, then the ones still expected, then the ones who are not coming,
 * then the days nobody owes work, and last the two kinds of nothing — a missing roster and a day
 * ECMS has not concluded. `ATTENDANCE_DAY_STATUSES` is the vocabulary this must stay exhaustive
 * over, and the spec asserts that it is.
 */
const STATUS_ORDER: readonly AttendanceDayStatus[] = [
  'present',
  'late',
  'earlyLeave',
  'lateAndEarly',
  'checkedIn',
  'incomplete',
  'pending',
  'absent',
  'onLeave',
  'holiday',
  'weekend',
  'dayOff',
  'noSchedule',
  'noRecord',
];

/** The index a status sorts at; an unknown value sorts last rather than throwing on a read path. */
const statusRank = (status: AttendanceDayStatus): number => {
  const at = STATUS_ORDER.indexOf(status);
  return at === -1 ? STATUS_ORDER.length : at;
};

/** The row's times, from the stored row when there is one and the read-time derivation otherwise. */
const timesOf = (
  row: AttendanceSheetRowDto,
): { firstInAt: string | null; lastOutAt: string | null; workedMinutes: number; lateMinutes: number } | null => {
  if (row.day !== null) return row.day;
  return row.provisionalDay;
};

/**
 * THE INSTANT a check-in or check-out happened, in milliseconds, or null.
 *
 * Compared as INSTANTS, never as minutes-after-midnight, and that is what makes a night shift sort
 * correctly: a sheet is one work date, a day is keyed by its SHIFT START (D3), so a check-out at
 * 00:30 belongs to the previous evening's line and is a later instant than its 22:00 check-in.
 * Reducing both to a wall clock would put that check-out first, before everyone who arrived in the
 * morning — the Cairo calendar day is already decided by the time a row reaches this file.
 */
const instant = (iso: string | null): number | null =>
  iso === null ? null : new Date(iso).getTime();

/** Whether this line has a check-in at all — the partition the time columns are ordered within. */
export const hasArrival = (row: AttendanceSheetRowDto): boolean =>
  timesOf(row)?.firstInAt != null;

/**
 * The comparable value of a row for one column: a number, a string, or null for "nothing to
 * compare". Null is what sends a line to the end, in BOTH directions.
 */
const valueOf = (row: AttendanceSheetRowDto, by: AttendanceSheetSort): number | string | null => {
  const times = timesOf(row);
  switch (by) {
    case 'checkIn':
      return instant(times?.firstInAt ?? null);
    case 'checkOut':
      return instant(times?.lastOutAt ?? null);
    case 'worked':
      // Zero worked minutes is NOT a measurement. Most of this workforce scans on arrival and
      // never scans out, so a `checkedIn` day genuinely has unknown hours — ordering those among
      // the people who worked a real zero-hour day would be a claim about them.
      return times === null || times.workedMinutes === 0 ? null : times.workedMinutes;
    case 'late':
      // Zero late minutes IS a measurement — it means on time — so it is kept and sorts as 0. A
      // line with no times at all has no punctuality to report, and that is the null.
      return times === null ? null : times.lateMinutes;
    case 'name':
      return row.employeeName;
    case 'code':
      return row.employeeCode;
    case 'status':
    default:
      // `default` rather than nothing after the last case: the switch IS exhaustive over
      // `AttendanceSheetSort`, and a closed schema means an unknown value cannot reach here, but
      // the compiler wants a value on every path and a read path must not throw for one.
      return statusRank(row.status);
  }
};

/**
 * Employee code, compared as text.
 *
 * It is the tiebreaker on every column, so that two people who arrived in the same minute hold the
 * same relative order on every reload and on every page — a sort that reshuffles equal rows makes
 * page 2 unreliable even when the comparison itself is right. Plain text comparison is enough
 * because the codes are zero-padded to one width (`0100052`), so text order IS numeric order.
 */
const byCode = (a: AttendanceSheetRowDto, b: AttendanceSheetRowDto): number =>
  a.employeeCode < b.employeeCode ? -1 : a.employeeCode > b.employeeCode ? 1 : 0;

/**
 * Order one resolved branch-day.
 *
 * Two rules on top of the comparison, both from the owner:
 *
 *  1. **A LINE WITH NOTHING TO COMPARE GOES LAST, IN BOTH DIRECTIONS.** Descending by check-in must
 *     not float «لم يحضر بعد» and «لا يوجد تسجيل» to the top of the morning and push the arrivals
 *     off the first page. This applies only to the columns where absence is possible — the times
 *     and the two minute counts; a name, a code and a status exist on every line, so there the
 *     partition would be inventing a distinction nobody asked for.
 *
 *  2. **TIES BREAK BY EMPLOYEE CODE**, always ascending, so the order is stable whichever way the
 *     column is pointing.
 *
 * Returns a new array; the caller's set is left alone.
 */
export const sortSheetRows = (
  rows: readonly AttendanceSheetRowDto[],
  by: AttendanceSheetSort,
  dir: 'asc' | 'desc',
): AttendanceSheetRowDto[] => {
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const left = valueOf(a, by);
    const right = valueOf(b, by);

    // 1 — nothing to compare, last either way.
    if (left === null && right === null) return byCode(a, b);
    if (left === null) return 1;
    if (right === null) return -1;

    const compared =
      typeof left === 'string' && typeof right === 'string'
        ? // The names are Arabic; `localeCompare` with the Arabic collator puts them in the order a
          // reader expects rather than in code-point order, which interleaves forms of the same
          // letter. Codes are ASCII digits, where the same call is plain text order.
          left.localeCompare(right, 'ar')
        : Number(left) - Number(right);

    // 2 — a stable tiebreak, never reversed with the column.
    return compared === 0 ? byCode(a, b) : compared * sign;
  });
};

/** Re-exported so the spec can assert the ranking stays exhaustive over the vocabulary. */
export { STATUS_ORDER, ATTENDANCE_DAY_STATUSES };
