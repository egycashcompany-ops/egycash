// The order of an employee's daily record. Pure, and in the views layer because the component that
// draws the list is what asks for it — `view-model.ts` maps DTOs into these shapes and may not be
// imported from here without a cycle.
import type { EmployeeDay, EmployeeDaySort } from './view-types';

/**
 * THE ORDER OF AN EMPLOYEE'S DAILY RECORD.
 *
 * Sorted on the CLIENT, unlike the daily sheet's, and the difference is pagination rather than
 * principle: a period is one person's complete run of dates — at most a year, all of it already in
 * the browser — so there is no page 2 for a client-side sort to fragment. The sheet is a page of a
 * branch-day and must therefore be ordered on the server before it is cut.
 *
 * The same two rules apply as on the sheet, because a reader should not have to learn two:
 *
 *  · NEWEST FIRST by default — a month is read from its most recent day backwards.
 *  · A DAY WITH NOTHING TO COMPARE GOES LAST, in both directions. Over a backfilled year most
 *    dates have no times at all, so sorting by check-in descending without this rule would open on
 *    three hundred empty lines.
 */
export const sortEmployeeDays = (
  days: readonly EmployeeDay[],
  by: EmployeeDaySort,
  dir: 'asc' | 'desc',
): EmployeeDay[] => {
  const valueOf = (day: EmployeeDay): number | null => {
    switch (by) {
      case 'checkIn':
        return day.inAt;
      case 'checkOut':
        return day.outAt;
      case 'worked':
        return day.worked;
      case 'date':
      default:
        // The ISO date parses as an instant and every day of a period has one, so this column
        // never produces the null that sends a line to the end.
        return Date.parse(`${day.date}T00:00:00.000Z`);
    }
  };
  const sign = dir === 'desc' ? -1 : 1;
  return [...days].sort((a, b) => {
    const left = valueOf(a);
    const right = valueOf(b);
    // The date is the tiebreak on every other column, and always ascending, so two days that
    // compare equal keep one canonical order however the list is being read.
    const byDate = a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    if (left === null && right === null) return byDate;
    if (left === null) return 1;
    if (right === null) return -1;
    return left === right ? byDate : (left - right) * sign;
  });
};
