// A day picked on an IT screen is a CAIRO calendar day — the day the table beside the filter
// prints. The screen sends it as `YYYY-MM-DD`, which parses to that date's UTC midnight; but a
// hand-over typed at 01:30 on 28 October in Cairo is the instant 27 October 22:30 UTC, and the
// register shows it under the 28th. Reading the picked day as a UTC day would file it under the
// 27th — so a from/to window runs from Cairo's midnight to Cairo's next midnight instead.
//
// Pure date arithmetic over Intl — the technique `atm/shared/cairo-time.ts` and HR's business date
// use; modules do not import each other's helpers, and four lines need no timezone dependency.
// Egypt keeps summer time, so the offset is read at the instant itself, never assumed.
const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Africa/Cairo',
  timeZoneName: 'longOffset',
});

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

/** The first instant of a calendar date in Cairo, the date given by its UTC year, month and day. */
const cairoMidnight = (year: number, month: number, day: number): Date => {
  const guess = new Date(Date.UTC(year, month, day));
  // Corrected once with the offset in force at the first guess: on the night summer time starts
  // (midnight does not exist; the day begins at 01:00) this lands on the day's first instant.
  const corrected = new Date(guess.getTime() - cairoOffsetMinutes(guess) * 60_000);
  return new Date(guess.getTime() - cairoOffsetMinutes(corrected) * 60_000);
};

/** Where a «من» day starts: midnight in Cairo of the day the date names. */
export const cairoDayStart = (day: Date): Date =>
  cairoMidnight(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());

/** Where an «إلى» day ends, exclusive: midnight in Cairo of the FOLLOWING day. */
export const cairoDayEnd = (day: Date): Date =>
  cairoMidnight(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1);
