// WHAT A DAY READS AS, which is not always what the row SAYS — and never a claim the engine has
// not made.
//
// THE PROBLEM THIS SOLVES, in two halves.
//
// The first half is that a stored status cannot answer "what is this day?" while the date is still
// being lived. The branch servers push their scans and call `days/recompute` for the employees who
// scanned — only those, because they are the only ones the device has anything to say about. So the
// people a daily sheet is read to find, the ones who have not turned up, are precisely the people
// whose rows nobody rewrites all day. A no-show's row is written at most once and then sits until
// the nightly pass.
//
// The second half is worse, and it is what production showed. For an employed person with no
// stored row on a PAST date this function used to answer `null`, and both callers DROPPED THE
// LINE. A sheet for any past date therefore listed only the handful of people a recompute happened
// to have run for — four or five names out of a hundred — and the counts beneath it counted those
// four or five. Two years of imported history read as an empty company.
//
// So the resolution now has a different shape. It is handed BOTH the stored row and what the engine
// says about that date from live inputs (`deriveDay`, the same function `computeDay` stores from),
// and it picks between them. That has one property worth stating plainly, because every screen
// depends on it:
//
//   WHAT A READER SEES IS WHAT A RECOMPUTE WOULD STORE.
//
// The sheet, the employee page, their CSVs and the summary all resolve through here, so they cannot
// disagree about the same employee on the same day — which they did, for months, because the sheet
// resolved its own answer and the employee page read a status straight off the row.
//
// NOTHING IS WRITTEN BY LOOKING. Resolving at read time is what makes it possible to show 1,300
// employees' standing today without minting 1,300 rows for a date that is not over, and it is also
// why no expectation is stored on a row: a stored expectation goes stale the moment HR edits the
// working pattern mid-day, and it would then be consulted for exactly the date it is wrong about.
import { type AttendanceDayStatus } from '@ecms/contracts';

/**
 * The stored statuses this resolution REFUSES TO TAKE AT FACE VALUE, each for its own reason.
 *
 * `pending` and `absent` are the two the engine writes provisionally: `pending` is a day in
 * progress, and an `absent` written at ten in the morning is a statement about a day that had not
 * finished. Both are re-decided from the clock.
 *
 * `dayOff` is here because NOTHING DERIVES IT ANY MORE. Every stored `dayOff` is a legacy row from
 * before `noSchedule` existed, written when an employee with no shift assignment was reported as
 * owed no work. Production is full of them, and they are exactly the rows the owner is looking at
 * when he says that 12 and 15 November read «يوم راحة» although he scanned on both. Taking such a
 * row at face value would hold a wrong answer on screen for as long as it sits in the database; re-
 * resolving it means a day with punches shows the punches, and a day without them says which kind
 * of nothing it was.
 *
 * `incomplete` is deliberately NOT here. It is also legacy, but it carries real times and reads
 * correctly, and payroll prices frozen `incomplete` rows exactly as they were priced when the month
 * closed — so re-labelling them on screen would make the screen disagree with the payslip.
 */
const RE_RESOLVED: readonly AttendanceDayStatus[] = ['pending', 'absent', 'dayOff'];

export interface DayResolutionInput {
  /** The stored row's status, or null when the engine has written no row for this employee-day. */
  stored: AttendanceDayStatus | null;
  /**
   * What `deriveDay` says about this date, computed now from live inputs — the punches, the leave,
   * the calendar, the manager's decision and the expectation as they stand. `null` means the
   * employee was not employed on the date, which is the one case that yields no line at all.
   */
  derived: AttendanceDayStatus | null;
}

/**
 * The display status, or null for "this person has no day here at all".
 *
 * The rules, in order:
 *
 *  1. **Not employed on the date, no line.** `deriveDay` returns nothing for a date outside
 *     somebody's employment, and so does this. It is the ONLY null, and that is the fix: it used
 *     to be returned for a missing row too, which is how a hundred people became five.
 *
 *  2. **A settled row is the answer.** Everything except the three in `RE_RESOLVED` is a conclusion
 *     drawn from evidence — a presence, a leave, a holiday, a weekend — and evidence does not change
 *     as the clock moves.
 *
 *  3. **Otherwise the live derivation answers**, which is what keeps the screen and a recompute in
 *     agreement: a day with punches shows them, a weekend reads as a weekend, a day nobody has
 *     rostered reads «لا يوجد جدول».
 *
 *  4. **An absence must have been CONCLUDED, never inferred by a screen.** When the derivation would
 *     say `absent` but no row ever concluded this day — no row at all, or only a legacy `dayOff` —
 *     the honest answer is `noRecord`: nothing has been decided about this date and no scan was seen
 *     for it. A reader gets «لا يوجد تسجيل», not an accusation. This is the difference between "the
 *     backfill has not reached this day" and "this person did not come", and on a deployment whose
 *     history was imported but never re-derived those two cover most of two years. A stored `pending`
 *     or `absent` IS a conclusion, so it reads `absent` once the date has passed, exactly as before.
 */
export const resolveDayStatus = ({
  stored,
  derived,
}: DayResolutionInput): AttendanceDayStatus | null => {
  // 1 — not employed on this date.
  if (derived === null) return null;

  // 2 — settled by evidence.
  if (stored !== null && !RE_RESOLVED.includes(stored)) return stored;

  // 4 — an inferred absence is reported as the gap it is.
  if (derived === 'absent' && (stored === null || stored === 'dayOff')) return 'noRecord';

  // 3 — the live derivation.
  return derived;
};
