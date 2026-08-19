// Which days the odometer table asks the server for.
//
// The log grows without bound — one row per vehicle per day it runs — so "no date filter" is not a
// neutral default, it is a request for the whole history. Opening the page therefore means the
// CURRENT MONTH unless the reader has said otherwise, and the server is what narrows it.
//
// The bounds are UTC and date-only, matching what the API does with them: `from` is coerced to
// that day's midnight UTC and compared with `$gte`, and `to` is compared against the NEXT
// midnight with `$lt`, so the day it names is included whole. Rendering the month in local time
// would shift it either side of a timezone and silently ask for the wrong days. (The operations
// report screens default the same way, for the same reason; the semantics are copied rather than
// imported, because a module reaching into another module's lib to borrow six lines is a worse
// trade than the six lines.)

export interface OdometerRange {
  /** `YYYY-MM-DD`, or '' for no lower bound. */
  from: string;
  /** `YYYY-MM-DD`, or '' for no upper bound. */
  to: string;
}

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

/** The first and last day of the month `now` falls in, both inclusive. */
export const currentMonthRange = (now: Date): OdometerRange => ({
  from: isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
  // Day 0 of the next month IS the last day of this one — no month-length table, no leap years.
  to: isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))),
});

/**
 * The range to send, given what the URL asks for.
 *
 * The month fills in only when NEITHER bound is given. Filling in per-field would quietly answer
 * a different question than the one asked: "from the 1st of July" is an open-ended request, and
 * capping it at the end of this month would hide every row after it. One bound alone stays one
 * bound alone — which is exactly what the server already supports.
 */
export const odometerRange = (
  params: { from: string; to: string },
  now: Date,
): OdometerRange & { defaulted: boolean } => {
  if (params.from === '' && params.to === '') {
    return { ...currentMonthRange(now), defaulted: true };
  }
  return { from: params.from, to: params.to, defaulted: false };
};
