// What a day READS AS, which is not always what the row SAYS.
//
// THE PROBLEM THIS SOLVES. The branch servers push their scans and then call `days/recompute` for
// the employees who scanned — only for those employees, because they are the only ones the device
// has anything to say about. So the people a daily sheet is read to find, the ones who have not
// turned up, are precisely the people whose rows nobody rewrites all day. A no-show's row is
// written at most once, by whatever recompute happened to run, and then sits untouched until the
// nightly pass at 2 AM. Very often there is no row at all.
//
// A stored status therefore cannot be trusted to answer "what is this day?" while the date is
// still being lived. The answer has to be worked out when somebody looks, from the clock against
// the hour the person was due. That is this function, and every read path uses it — the sheet
// today, the summary endpoint when it arrives — so that all of them say the same thing about the
// same day.
//
// NOTHING IS WRITTEN BY LOOKING. Resolving at read time is what makes it possible to show 1,300
// employees' standing today without minting 1,300 rows for a date that is not over, and it is
// also why no `expectedEndAt` is stored on the row: a stored expectation goes stale the moment HR
// edits the working pattern mid-day, and it would then be consulted for exactly the date it is
// wrong about.
//
// Pure, and injected with both `now` and `today`, for the usual reason: a function that reads the
// clock cannot be tested against the boundary it exists to implement.
import { type AttendanceDayStatus } from '@ecms/contracts';

export interface DisplayStatusInput {
  /**
   * The stored row's status, or null when the engine has written no row for this employee-day —
   * which is the ordinary case for somebody who has not scanned today.
   */
  stored: AttendanceDayStatus | null;
  /** The day in question: UTC-midnight date-only, as everything date-only in HR is. */
  workDate: Date;
  /** Today in Cairo, UTC-midnight date-only. Injected with `now`, from one reading of the clock. */
  today: Date;
  /**
   * The instant this employee was due to finish on `workDate`, resolved from their assignment or
   * their branch's default pattern AS THOSE STAND NOW, or null when nobody has said when they are
   * due. Null is a real answer here, not a missing one.
   */
  expectedEnd: Date | null;
  /**
   * What the WORK CALENDAR says about the date — organization-wide, so one answer serves a whole
   * page of employees. Without it a Friday morning would read as «لم يحضر بعد» for the entire
   * company and a Friday evening as «غائب»: nobody is expected on a weekend or a public holiday,
   * and the engine says so for the rows it writes, so the resolution has to say so for the rows
   * it does not.
   */
  calendar: 'working' | 'weekend' | 'holiday';
  /** The instant the reader is reading at. */
  now: Date;
}

/**
 * The display status, or null for "this employee has no day here at all" — a line the caller
 * leaves out rather than filling in.
 *
 * The rules, in order:
 *
 *  1. **A settled row is the answer.** Every status except `pending` and `absent` is a conclusion
 *     drawn from evidence — a presence, a leave, a holiday, a weekend — and evidence does not
 *     change as the clock moves. Those rows are returned untouched, which also means this function
 *     never needs an expectation for them.
 *
 *  2. **A past date is over, and needs no expectation either.** A `pending` row on a date that has
 *     passed reads as `absent`: the day ended and nobody arrived. This is the case that covers the
 *     hours between an afternoon branch recompute and the nightly pass, and it is answered without
 *     looking anything up, which is what keeps a month's worth of rows cheap to read.
 *
 *  3. **No row on a past date is NOT an absence.** It means the engine never concluded that day
 *     for that person — most often because they were not employed on it, which is exactly when
 *     `deriveDay` returns no row at all. Inventing «غائب» there would put a claim on screen that
 *     nobody ever made, so the answer is null and the line is omitted.
 *
 *  4. **The calendar speaks before absence does**, exactly as it does in the engine. Nobody is
 *     expected on a weekend or a public holiday, so a line with no row — or one left at `pending`
 *     or `absent` by a calendar that has since changed — reads as the day it actually is. Without
 *     this the whole company would read «لم يحضر بعد» every Friday morning.
 *
 *  5. **Today (or later) is decided from the expected end.** Before it, «لم يحضر بعد»; after it,
 *     «غائب». This is where a row the branch left at `absent` earlier in the day is read back as
 *     `pending`, and where somebody with no row at all appears on the sheet without one being
 *     written for them.
 *
 *  6. **No expectation at all means no expectation.** With neither an assignment nor a pattern,
 *     nobody has said when this person works, so the day is `noSchedule` — not a failure to
 *     attend, and equally not a rest day. The same answer the engine gives, for the same reason.
 */
export const resolveDisplayStatus = (input: DisplayStatusInput): AttendanceDayStatus | null => {
  const { stored, workDate, today, expectedEnd, calendar, now } = input;

  // 1 — settled by evidence. Note this runs BEFORE the calendar: somebody who actually worked a
  // public holiday has a `present` row, and that is the truth about their day.
  if (stored !== null && stored !== 'pending' && stored !== 'absent') return stored;

  // 3 — no row on a date that has passed is no answer at all, not an absence.
  const past = workDate.getTime() < today.getTime();
  if (past && stored === null) return null;

  // 4 — the calendar, for everything the engine has not already settled.
  if (calendar !== 'working') return calendar;

  // 2 — the date has passed and nobody arrived.
  if (past) return 'absent';

  // 6 — nobody said when they were due. A GAP, NOT A REST DAY: the weekend and the holidays have
  // already answered above, so on a working day this means the schedule is missing, and saying
  // «يوم راحة» would both be false and hide the thing HR has to fix.
  if (expectedEnd === null) return 'noSchedule';

  // 5 — still winnable, or not.
  return now < expectedEnd ? 'pending' : 'absent';
};
