// The business calendar is Africa/Cairo (Leave design R10; the fleet dashboard's R-01/R-02).
//
// Two kinds of "date" meet here and must never be confused:
//   · an INSTANT — a request clock, a `createdAt` — whose calendar date depends on the zone it is
//     read in. Between 00:00 and 02:00 (03:00 in summer) Cairo is already on the next day while UTC
//     is still on the previous one, so `new Date().toISOString().slice(0, 10)` names yesterday;
//   · a DATE-ONLY value — an expiry, an accident date, a reading's day — stored as UTC midnight of
//     the day the clerk typed. Its calendar date is its UTC date part, whatever the zone.
// `cairoYmd` turns the first into a 'YYYY-MM-DD'; `ymdOf` reads the second. Everything else here is
// plain arithmetic on 'YYYY-MM-DD' strings, which compare correctly as strings.
//
// Pure `Intl` (the HR business-date technique), so the API and the browser share one answer and
// neither grows a timezone dependency. Egypt observes DST again (since 2023: the last Friday of April
// to the last Thursday of October), so no offset is ever hard-coded.

export const CAIRO_TIME_ZONE = 'Africa/Cairo';

const DAY_MS = 24 * 60 * 60 * 1000;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

// `formatToParts` rather than a locale whose format happens to be 'YYYY-MM-DD': the parts are
// specified, a locale's punctuation is not. `h23` so midnight reads 00, never 24.
const cairoParts = new Intl.DateTimeFormat('en-US', {
  timeZone: CAIRO_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The Cairo wall clock at an instant. Throws a RangeError on an invalid Date, as `Intl` does. */
const cairoWallClock = (instant: Date): WallClock => {
  const read: Record<string, number> = {};
  for (const part of cairoParts.formatToParts(instant)) {
    if (part.type !== 'literal') read[part.type] = Number(part.value);
  }
  return {
    year: read.year ?? 0,
    month: read.month ?? 0,
    day: read.day ?? 0,
    hour: read.hour ?? 0,
    minute: read.minute ?? 0,
    second: read.second ?? 0,
  };
};

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

const ymdFromUtc = (at: number): string => {
  const date = new Date(at);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
};

/** The UTC-midnight epoch of a 'YYYY-MM-DD', or `null` when it is not a real calendar date. */
const utcMidnightOf = (value: string): number | null => {
  const match = YMD.exec(value);
  if (match === null) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const at = Date.UTC(year, month - 1, day);
  const back = new Date(at);
  // `Date.UTC` rolls 2026-02-30 over into March; a real date survives the round trip unchanged.
  // (Years 0–99 are also mapped to 1900–1999 by `Date.UTC`, and fail here for the same reason.)
  return back.getUTCFullYear() === year &&
    back.getUTCMonth() === month - 1 &&
    back.getUTCDate() === day
    ? at
    : null;
};

const requireYmd = (value: string, what: string): number => {
  const at = utcMidnightOf(value);
  if (at === null) throw new RangeError(`${what} must be a real 'YYYY-MM-DD' date, got '${value}'`);
  return at;
};

/** 'YYYY-MM-DD' that is a real calendar date. */
export const isYmd = (value: string): boolean => utcMidnightOf(value) !== null;

/** The Africa/Cairo calendar date of an instant, 'YYYY-MM-DD' (Intl, DST-aware — never a fixed offset). */
export const cairoYmd = (instant: Date): string => {
  const clock = cairoWallClock(instant);
  return `${pad(clock.year, 4)}-${pad(clock.month, 2)}-${pad(clock.day, 2)}`;
};

/** 'YYYY-MM-DD' → Date at 00:00:00.000Z. Throws a RangeError on anything that is not a real date. */
export const ymdToUtcDate = (ymd: string): Date => new Date(requireYmd(ymd, 'ymd'));

/**
 * UTC-midnight Date of the Cairo calendar date the instant falls on.
 *
 * MOVED from `apps/api/src/modules/hr/shared/business-date.ts`, which now re-exports it: the same
 * answer (the Cairo date, stored the date-only way), read through the parts formatter above.
 */
export const cairoCalendarDate = (instant: Date): Date => ymdToUtcDate(cairoYmd(instant));

/**
 * The UTC date part of a stored date-only value or an ISO string ('2026-11-01T10:00:00Z' →
 * '2026-11-01'). A bare 'YYYY-MM-DD' is returned as it is. Throws a RangeError on an invalid date.
 */
export const ymdOf = (value: Date | string): string => {
  if (typeof value === 'string' && isYmd(value)) return value;
  const at = (typeof value === 'string' ? new Date(value) : value).getTime();
  if (Number.isNaN(at)) throw new RangeError(`not a date: '${String(value)}'`);
  return ymdFromUtc(at);
};

/** The calendar day `days` after (negative: before) a 'YYYY-MM-DD'. */
export const addDaysYmd = (ymd: string, days: number): string =>
  ymdFromUtc(requireYmd(ymd, 'ymd') + Math.trunc(days) * DAY_MS);

/** to − from in whole days ('2026-11-01','2026-11-01' → 0; negative when `to` comes first). */
export const daysBetweenYmd = (from: string, to: string): number =>
  Math.round((requireYmd(to, 'to') - requireYmd(from, 'from')) / DAY_MS);

/** Cairo's UTC offset at an instant, in ms (wall clock − instant, to the second). */
const cairoOffsetMs = (at: number): number => {
  const clock = cairoWallClock(new Date(at));
  const wall = Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
  );
  return wall - Math.floor(at / 1000) * 1000;
};

/**
 * The instant Cairo's day `ymd` begins (handles the DST change days).
 *
 * Local midnight minus the offset in force AT that instant: guessed with the offset at UTC midnight,
 * then corrected once with the offset at the guess. On the last Friday of April 00:00 does not exist
 * (the clock jumps to 01:00), and the correction lands on the jump itself — the day's first instant.
 */
export const cairoDayStart = (ymd: string): Date => {
  const midnight = requireYmd(ymd, 'ymd');
  const guess = midnight - cairoOffsetMs(midnight);
  return new Date(midnight - cairoOffsetMs(guess));
};

/** The instant the Cairo day after the instant's own begins: cairoDayStart(addDaysYmd(cairoYmd(instant), 1)). */
export const nextCairoMidnight = (instant: Date): Date =>
  cairoDayStart(addDaysYmd(cairoYmd(instant), 1));

/**
 * R-02 calendar-day bounds for the list filters: { from: `${from}T00:00:00.000Z`, before:
 * `${to}T23:59:59.999Z` }.
 *
 * The ONE place the "first instant / last instant of the named days" rule lives; API counts and web
 * pages both call it, so a count equals its link even for an expiry imported at a non-midnight
 * instant. The days are UTC days because the values they bound are stored date-only (UTC midnight
 * of the typed day) — `ymdOf` reads them the same way.
 */
export const calendarDayBounds = (from: string, to: string): { from: Date; before: Date } => ({
  from: new Date(requireYmd(from, 'from')),
  before: new Date(requireYmd(to, 'to') + DAY_MS - 1),
});
