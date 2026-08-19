// The report range, as the two report screens read and write it.
//
// Pure and shared, because both screens must agree on what "this month" is and what a URL means.
// The legacy screens defaulted to the current month (contad_app.js:4862) and both bounds were
// INCLUSIVE there; the API keeps that contract, so nothing here converts to an exclusive bound —
// doing that in two places is how a report quietly loses its last day.

/** `YYYY-MM-DD` in UTC. Reports are date-only; a local-timezone render would shift the month. */
export const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

export interface ReportRange {
  from: string;
  to: string;
}

/** The current month, both bounds inclusive — the legacy default. */
export const currentMonthRange = (now: Date): ReportRange => ({
  from: toIsoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
  to: toIsoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))),
});

/**
 * The range a URL asks for, falling back to the current month per field.
 *
 * Per FIELD rather than per range: a user who typed only a start date has expressed half an
 * intent, and blanking it back to the whole month would throw that away.
 */
export const rangeFromParams = (
  params: { from: string | null; to: string | null },
  now: Date,
): ReportRange => {
  const fallback = currentMonthRange(now);
  return {
    from: isIsoDate(params.from) ? params.from : fallback.from,
    to: isIsoDate(params.to) ? params.to : fallback.to,
  };
};

/** True for a well-formed `YYYY-MM-DD` that names a real day. */
export const isIsoDate = (value: string | null): value is string => {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && toIsoDate(parsed) === value;
};

/**
 * Whether a range is usable. An inverted range is REFUSED rather than silently swapped: swapping
 * would show a report for a period nobody asked for, under a header that reads back what they
 * typed.
 */
export const isRangeValid = (range: ReportRange): boolean =>
  isIsoDate(range.from) && isIsoDate(range.to) && range.from <= range.to;
