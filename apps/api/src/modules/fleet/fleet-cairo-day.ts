// «اليوم» on a Fleet screen is a CAIRO calendar day. A top-up made at 00:30 in Cairo is the
// instant 22:30 UTC the evening before, and the owner calls it today's; a delete at 23:30 in Cairo
// belongs to that day, not to the next UTC one. Every figure the owner reads as «اليوم» — «شُحن
// اليوم», the deleted operations' from/to, a contract's first delivery when no day was given — is
// bounded by Cairo's midnights, computed here once for the module.
//
// Pure date arithmetic over Intl — the technique `it/shared/cairo-day.ts`, `atm/shared/cairo-time.ts`
// and HR's business date use; modules do not import each other's helpers, and a few lines need no
// timezone dependency. Egypt keeps summer time (last Friday of April → last Thursday of October),
// so the offset is read at the instant itself, never assumed.

const dayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Africa/Cairo',
  timeZoneName: 'longOffset',
});

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Cairo's offset from UTC, in minutes, at an instant (+120 in winter, +180 in summer). */
const cairoOffsetMinutes = (instant: Date): number => {
  const name =
    offsetFormatter.formatToParts(instant).find((part) => part.type === 'timeZoneName')?.value ??
    '';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (match === null) return 0; // "GMT" exactly — offset zero
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
};

/** A `YYYY-MM-DD` that names a real calendar day, as its UTC year, month (0-based) and day. */
const partsOf = (ymd: string): { year: number; month: number; day: number } => {
  const match = YMD.exec(ymd);
  const utc = match === null ? null : new Date(Date.UTC(+match[1]!, +match[2]! - 1, +match[3]!));
  if (utc === null || utc.toISOString().slice(0, 10) !== ymd) {
    throw new RangeError(`not a calendar day: ${JSON.stringify(ymd)}`);
  }
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth(), day: utc.getUTCDate() };
};

/** The first instant of a calendar date in Cairo, the date given by its UTC year, month and day. */
const cairoMidnight = (year: number, month: number, day: number): Date => {
  const guess = new Date(Date.UTC(year, month, day));
  // Corrected once with the offset in force at the first guess: on the night summer time starts
  // (midnight does not exist; the day begins at 01:00) this lands on the day's first instant.
  const corrected = new Date(guess.getTime() - cairoOffsetMinutes(guess) * 60_000);
  return new Date(guess.getTime() - cairoOffsetMinutes(corrected) * 60_000);
};

/** The Cairo calendar day of an instant, `YYYY-MM-DD`. */
export const cairoDayOf = (instant: Date): string => {
  const parts = dayFormatter.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

/**
 * The UTC instant of that Cairo day's first moment — midnight, or 01:00 on the night summer time
 * starts. Throws a `RangeError` for anything that is not a calendar day.
 */
export const cairoDayStart = (ymd: string): Date => {
  const { year, month, day } = partsOf(ymd);
  return cairoMidnight(year, month, day);
};

/** That Cairo day as `[start, end)` — 23 hours on the night summer time starts, 25 when it ends. */
export const cairoDayRange = (ymd: string): { start: Date; end: Date } => {
  const { year, month, day } = partsOf(ymd);
  return { start: cairoMidnight(year, month, day), end: cairoMidnight(year, month, day + 1) };
};

/**
 * Cairo's calendar day of `now`, as that date's UTC midnight — for a field stored as a UTC day
 * (`utcDay`) that must read as the day the person in Cairo is living.
 */
export const cairoTodayAsUtcDay = (now: Date = new Date()): Date => {
  const { year, month, day } = partsOf(cairoDayOf(now));
  return new Date(Date.UTC(year, month, day));
};
